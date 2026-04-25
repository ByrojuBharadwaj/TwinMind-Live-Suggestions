# Stage 4 — Chat Panel + Streaming Detailed Answers

**Status:** Complete
**Duration:** ~Days 7–8 of 10
**Goal:** Clicking a suggestion or typing a question produces a grounded, streamed answer in the right-hand chat panel — fast first token, multi-turn coherent, cancelable.

---

## Objective

Make suggestion cards *actually do something* and give users a general-purpose chat surface. Both flows share the same infrastructure: a streaming Groq endpoint, a chat store that accumulates deltas in real time, and a single panel that renders user/assistant bubbles with streaming cursors, copy buttons, and a stop control.

**Exit criteria (all met):**
- [x] `/api/chat` streams Groq responses back as plain text chunks
- [x] Suggestion clicks push a user bubble and stream a detailed answer
- [x] Free-form composer supports Enter-to-send, Shift+Enter newlines
- [x] Stop button cancels an in-flight stream; partial content is retained
- [x] Abort is plumbed end-to-end (client AbortController → Groq fetch signal)
- [x] Multi-turn coherence — history (last 12 messages) fed into each call
- [x] Session summary + windowed transcript included in every request
- [x] Copy-to-clipboard on every finished assistant message
- [x] Smart auto-scroll pauses when user scrolls up
- [x] Graceful errors (missing key, HTTP failures) shown inline without zombie state
- [x] Build, type-check, and lint all clean

---

## Technical Decisions (locked before coding)

| Question | Decision | Reasoning |
|----------|----------|-----------|
| **Streaming protocol client-facing** | Server parses Groq's OpenAI-style SSE, emits raw UTF-8 text via `ReadableStream` | Client just does `reader.read()` — no SSE parsing in the browser, no extra library. |
| **Endpoint topology** | **One** `/api/chat` endpoint with `mode: "chat" \| "detailed"` param | Same streaming infrastructure, same store, same abort logic. Modes differ only in system prompt + request framing. |
| **Context composition** | System message = user-editable prompt + `---` + session summary + transcript context (+ selected suggestion block for detailed mode); history as proper `user`/`assistant` turns; new question as the final `user` | Matches OpenAI chat conventions so Groq handles multi-turn naturally. Context blocks refresh every call so the "live" meeting stays current. |
| **Abort wiring** | One `AbortController` ref per controller instance; new send or manual stop aborts the previous one; `req.signal` passed to `fetch(GROQ_URL)` so upstream is cancelled too | Clean cancellation, no orphaned streams, no accidental cost leaks. |
| **Suggestion-click framing** | Push visible user bubble `"Expand: {title}"` + `sourceSuggestionId` back-reference, then stream the assistant response | Chat history stays readable on export; the provenance of each assistant reply is preserved. |
| **History window** | Last **12** messages, excluding the currently-streaming assistant message | Keeps token budget bounded. Session summary covers longer-range context. |
| **Temperatures** | **0.4** for detailed (grounded expansions), **0.5** for chat (a bit more latitude) | Slight variation from suggestions (0.5); detailed answers should stick closer to transcript. |
| **Transcript slice for chat** | `expandedAnswerContextWindowSec > 0` → windowed; `= 0` → full transcript | Matches the Settings default (0 = full). Users with very long meetings can cap it. |
| **Rendering** | Plain text + `whitespace-pre-wrap`; no markdown parser | Markdown parsers complicate mid-stream rendering. Prompt explicitly asks for light formatting. Revisit in Stage 5 if reviewers expect it. |
| **New request while streaming** | Aborts previous request | Queueing felt like over-engineering for a sidebar chat; user intent is "I want this one now". |

---

## Steps Performed

### 1. `app/api/chat/route.ts` — streaming Groq proxy

The most substantive server code this stage.

Flow:
1. Extract bearer → 401 if missing
2. Parse JSON body → 400 if malformed
3. `buildMessages(body)` assembles the full `messages` array for Groq:
   - System message = user's system prompt + `---` separator + conditional `SESSION_SUMMARY` / `TRANSCRIPT_CONTEXT` / `SELECTED_SUGGESTION` blocks
   - `history` items appended as proper `user` / `assistant` turns
   - Final `user` message is the current question
4. POST to Groq with `stream: true`, mode-specific temperature, `max_tokens: 1500`, and `req.signal` wired to the upstream fetch so client aborts propagate
5. Upstream errors (non-OK, empty body, network) mapped to structured JSON responses
6. On success: construct a `ReadableStream` that:
   - Reads upstream bytes in a loop
   - Maintains a rolling `buffer` and splits on `\n\n` SSE boundaries
   - Skips frames that don't start with `data:`
   - Parses each frame's JSON, extracts `choices[0].delta.content`, enqueues raw bytes to the client
   - Closes cleanly on `[DONE]`
   - Swallows `AbortError` (client disconnect is expected)
   - Appends a `[stream interrupted: ...]` note for unexpected errors
7. Returns `Response` with `content-type: text/plain; charset=utf-8`, `cache-control: no-cache, no-transform`

Runtime set to `nodejs` with `maxDuration: 60`. **Edge runtime was rejected** because it lacks consistent streaming-request-signal behavior for our needs.

### 2. `store/useChatStore.ts` — streaming lifecycle state

New Zustand store (no `persist` — session state).

State:
- `messages: ChatMessage[]` — oldest-first
- `isStreaming: boolean` — for disabling the composer's submit + swapping in the Stop button
- `streamingId: string | null` — which assistant message is currently being filled
- `lastError: string | null` — dismissible error banner content

Mutations:
- `addUserMessage(content, sourceSuggestionId?)` — returns the new message id; `sourceSuggestionId` back-links click-generated bubbles
- `beginAssistantMessage()` — creates an empty assistant bubble immediately (lets the UI render the blinking cursor before the first token lands) and returns its id
- `appendAssistantDelta(id, delta)` — append-in-place update; takes advantage of Zustand's shallow diff so only the affected message re-renders
- `finalizeAssistantMessage(id)` — trims trailing whitespace, flips `isStreaming` off, clears `streamingId`
- `failAssistantMessage(id, error)` — finalizes with an error flag, sets `lastError` for the banner

Selector:
- `historyForRequest(max = 12)` — filters out empty messages AND the currently-streaming one, returns last N as `{ role, content }[]` ready for Groq

### 3. `lib/useChatController.ts` — orchestrator hook

Thin surface for the page:
- `sendMessage(text)` — composer submit
- `expandSuggestion(s)` — suggestion-card click
- `stopGeneration()` — stop button
- `resetChat()` — reserved for Stage 5 / export flows

Both send paths go through a shared private `streamAssistantResponse()`:
1. Read settings + session + suggestions stores via `.getState()` (no subscription — we want current values at call time)
2. Guard on missing API key → sets `lastError`, bails
3. `beginAssistantMessage()` to create the empty bubble
4. Tear down prior `AbortController` (via ref), create a new one
5. Compute transcript context from `expandedAnswerContextWindowSec` (windowed or full)
6. Build request body: mode, system prompt, summary, transcript, optional suggestion, history, userMessage
7. POST `/api/chat` with `signal: controller.signal` and `Authorization: Bearer <key>`
8. Loop `reader.read()` → `appendAssistantDelta()` on every chunk
9. `finalizeAssistantMessage()` on clean end
10. On `AbortError` → finalize with current content (user clicked Stop; treat partial as final)
11. On any other error → `failAssistantMessage()` with the error text

Key pattern: the controller **never** renders anything or holds state beyond the abort ref; all state lives in the store.

### 4. `components/ChatPanel.tsx` — full rewrite

Replaced the Stage 1 stub with a complete three-region panel: header, scrollable messages, composer.

**Header:**
- "CHAT" label
- "generating…" indicator (accent-colored dot + pulse) appears only while `isStreaming`

**Messages area:**
- Empty state with `MessageSquare` icon + "Click a suggestion to expand / Or type your own question"
- Each message renders via `<MessageBubble>` — user right-aligned in accent purple ring, assistant left-aligned in panel background with ring
- `whitespace-pre-wrap` preserves line breaks from both user input and model output
- **Streaming cursor**: if `streamingId === message.id` AND content is non-empty, render a tiny pulsing accent-colored bar at the end
- **Copy button** renders under every assistant message with non-empty content; clipboard write + 1.5s "Copied" state with checkmark
- **Smart auto-scroll** — same 40px pin threshold as the transcript panel; scrolling up pauses, scrolling back re-engages

**Error banner:**
- Thin red strip between messages and composer with dismiss button, shown when `lastError` is set

**Composer:**
- Textarea with `rows={1}`, `max-h-32`, resizable via content; disabled without API key
- Placeholder adapts: `"Ask anything about this meeting…"` vs `"Add a Groq API key in Settings to chat."`
- **Send button** (paper plane icon, accent purple) when idle; disabled when draft is empty or no key
- **Stop button** (red square) swaps in while streaming
- Footer hint: `"Enter sends · Shift+Enter newline"`

Keyboard:
- `Enter` → submit (prevents default textarea newline)
- `Shift+Enter` → newline

### 5. `app/page.tsx` — integration

- Imported `useChatController()`
- `onSelectSuggestion(s)` now calls `void expandSuggestion(s)` (was a no-op stub in Stage 3)
- Passed `onSend={(text) => void sendMessage(text)}` and `onStop={stopGeneration}` to `ChatPanel`

No other files touched.

---

## Files Added / Modified

### Added
| Path | Purpose |
|------|---------|
| `app/api/chat/route.ts` | Streaming Groq chat proxy with SSE parsing + abort plumbing |
| `store/useChatStore.ts` | Messages, streaming flags, history selector |
| `lib/useChatController.ts` | sendMessage / expandSuggestion / stopGeneration orchestrator |

### Modified
| Path | Change |
|------|--------|
| `components/ChatPanel.tsx` | Full rewrite: bubbles, cursor, copy, stop, auto-scroll, error banner |
| `app/page.tsx` | Wired chat controller; onSelectSuggestion now expands |

---

## Verification

| Check | Result |
|-------|--------|
| `ReadLints` on full project | No errors |
| `npm run build` | Compiled clean; `/api/chat` registered as dynamic alongside the other three |
| `npm run dev` + HTTP smoke test | 200 OK |
| Bundle size | 14.6 kB (up from 13 kB in Stage 3) — entirely from chat UI |
| Manual end-to-end | Suggestion click → user bubble → streaming assistant reply with cursor → Copy works. Composer Enter/Shift+Enter respected. Stop mid-stream keeps partial content. |

---

## The Two Flows (end-to-end)

### Free-form chat
```
  User types "What did she say about Q3?" + Enter
    ↓
  useChatController.sendMessage(text)
    ↓
  store.addUserMessage(text)
  store.beginAssistantMessage() → empty bubble, cursor visible
    ↓
  POST /api/chat {
    mode: "chat",
    systemPrompt: settings.chatPrompt,
    sessionSummary, transcriptContext,
    history: last 12 messages,
    userMessage: text,
  }
    ↓
  Server builds messages[] and streams Groq response
    ↓
  Client reader.read() loop → store.appendAssistantDelta(id, chunk)
    ↓
  Stream closes → store.finalizeAssistantMessage(id)
```

### Suggestion click
```
  User clicks an "Ask" or "Fact-check" card
    ↓
  useChatController.expandSuggestion(s)
    ↓
  store.addUserMessage("Expand: " + s.title, sourceSuggestionId=s.id)
  store.beginAssistantMessage()
    ↓
  POST /api/chat {
    mode: "detailed",
    systemPrompt: settings.detailedAnswerPrompt,
    sessionSummary, transcriptContext,
    suggestion: { type, title, preview, reasoning },
    history, userMessage: "Expand: " + title,
  }
    ↓
  Server system message includes SELECTED_SUGGESTION block
    ↓
  Same streaming pipeline as chat mode
```

Both paths are differentiated **only** at request-build time. The store, UI rendering, abort, and error handling are 100% shared.

---

## Context Composition Reference (for the Stage 5 README)

```
[system]   settings.chatPrompt  (or detailedAnswerPrompt)
           ---
           SESSION_SUMMARY:
           {rolling bullets from /api/summary}

           TRANSCRIPT_CONTEXT:
           {last expandedAnswerContextWindowSec seconds, or full if = 0}

           SELECTED_SUGGESTION:           ← detailed mode only
           type: {type}
           title: {title}
           preview: {preview}
           reasoning: {reasoning}
[user]     history[-12].content
[assistant] history[-11].content
  ...
[user]     current message
```

---

## Known Tradeoffs (documented in code)

1. **Markdown not rendered.** Mid-stream markdown parsing adds real complexity; the chat prompt was written to prefer light formatting. If reviewers expect bold/lists, Stage 5 could add `react-markdown` with `remark-gfm` and a streaming-safe renderer.
2. **No regenerate button on assistant messages.** Nice-to-have, skipped for scope; Stop + retype is the workaround.
3. **History hard-capped at 12.** Very long chats drop the earliest turns from prompt context. Session summary covers meeting content so quality degradation should be minimal.
4. **New send aborts previous stream.** Deliberate. If a user clicks two cards back-to-back, the second wins. Queueing added complexity without meaningful UX benefit for a sidebar chat.
5. **Rolling summary not surfaced in UI.** Same as Stage 3 — it works but isn't visible yet. Stage 5 export will include it.

---

## Snags & Learnings

1. **Edge runtime doesn't love streaming + AbortSignal** — first instinct was `export const runtime = "edge"` for faster cold starts, but cancellation behavior was inconsistent. `nodejs` runtime handles `req.signal` → upstream `fetch` abort cleanly, which matters more than the ~50ms cold-start difference.
2. **SSE frame buffering** — first cut of the stream parser split on `\n` instead of `\n\n`, which occasionally cut JSON mid-line when Groq emitted large deltas. The spec is two newlines between SSE frames; be strict about it.
3. **Empty initial bubble pattern** — calling `beginAssistantMessage()` before the first token lands lets the UI render the cursor immediately on user action, making the app feel snappier than if we waited for the first chunk. Zero perceived latency to "something is happening".
4. **`historyForRequest` must exclude the streaming message** — otherwise an in-progress half-sentence gets sent back to Groq in the next call as if it were the final assistant turn. Subtle bug, caught by explicitly testing a rapid "ask a question → ask a follow-up before first finishes" flow in my head and then in code.
5. **`AbortError` is success on stop** — user-initiated stop is NOT a failure. `finalizeAssistantMessage()` with the partial content is the right call; showing a red error banner when the user explicitly clicked Stop would be obnoxious.
6. **Chunk decoder `{ stream: true }` flag** — `TextDecoder.decode(value, { stream: true })` is required to handle UTF-8 multi-byte sequences that straddle chunk boundaries. Without it, emoji and non-ASCII characters can occasionally garble.

---

## Deliverables Checklist

- [x] Streaming chat working end-to-end with a real Groq key
- [x] Suggestion clicks expand via the detailed-answer prompt
- [x] Multi-turn conversations work with correct history
- [x] Stop + auto-abort on new request
- [x] Copy to clipboard on every finished assistant reply
- [x] Errors shown inline, never silent, never fatal to the session
- [x] Fully keyboard-usable composer
- [x] Type-safe, lint-clean, build-clean

### Deferred to later stages (by design)

- Export button (JSON/text dump with timestamps) → **Stage 5**
- Latency audit with measured TTFT numbers → **Stage 5**
- README with full prompt strategy + architecture diagram → **Stage 5**
- Dogfood pass against a real 15-min meeting → **Stage 5**
- Vercel deployment + public URL → **Stage 5**
- Optional: markdown rendering for assistant messages → **Stage 5 stretch**

---

## Next Up — Stage 5

**Export, polish, latency, README, deploy — submission-ready.**

- Export button → JSON + plain-text session dump (transcript + every batch + chat history with timestamps)
- Latency audit: measure cold-reload-to-first-suggestion, chat-send-to-first-token; trim whatever's slow
- Full README: setup, stack, **actual prompts shown**, context-composition diagram, measured latency numbers, tradeoffs, limitations
- Error polish: toast system, missing-key banner, mic-denied fallback, network-offline indicator
- Code hygiene pass: extract reusable bits, remove scaffolding comments, consistent ordering
- Dogfood: run through a real 15-min call or podcast playback, fix the top 3 friction points
- Deploy to Vercel → public URL
- Final submission package: deployed URL + GitHub repo + planning/stage docs
