# Stage 3 — Live Suggestions Engine

**Status:** Complete
**Duration:** ~Days 4–6 of 10
**Goal:** Produce 3 useful, varied, context-aware suggestion cards every ~30 seconds from the live transcript — the single most heavily weighted capability in the assignment.

---

## Objective

Build the generation loop that turns the rolling transcript into three fresh suggestion cards every refresh interval. This is the core of the grade: the assignment explicitly states *"Quality of live suggestions"* is the #1 evaluation criterion. Stages 1 and 2 existed to make this stage possible; everything after this stage consumes what we build here.

**Exit criteria (all met):**
- [x] `/api/suggestions` route proxies to Groq GPT-OSS 120B with JSON mode
- [x] `/api/summary` route for the rolling session summary
- [x] Strict-JSON prompt produces exactly 3 suggestions per call, typed into one of 5 categories
- [x] Auto-refresh every `refreshIntervalSec` while recording, skipped when transcript hasn't grown
- [x] Manual refresh button flushes the current audio chunk, waits for pending transcriptions, then generates
- [x] Anti-repetition via last-2-batches titles fed back into the prompt
- [x] Rolling session summary regenerated every 3rd done batch in the background
- [x] New batches appear at the top with timestamp dividers; older batches stay visible below
- [x] Per-type color badges (Ask / Point / Answer / Fact-check / Clarify) + hover lift + skeleton loaders + error cards
- [x] Build, type-check, and lint all clean

---

## Technical Decisions (locked before coding)

| Question | Decision | Reasoning |
|----------|----------|-----------|
| **Model ID** | `openai/gpt-oss-120b` on Groq | Assignment mandate — same model for all candidates so prompt quality is what gets compared. |
| **Structured output** | `response_format: { type: "json_object" }` + strict schema embedded in the prompt | Reliable parse path. Add regex `{...}` extraction as belt-and-braces fallback in case the model wraps the JSON. |
| **Temperature** | **0.5** for suggestions, **0.2** for summaries | Variety in cards without hallucination; deterministic summaries since they're plumbing. |
| **Summary strategy** | Regenerate every 3rd done batch, full-transcript input | Cheap background call. Keeps long meetings coherent without expanding the live-suggestion window. |
| **Trigger guard** | Skip auto-tick if transcript length hasn't grown since last batch | Saves Groq calls during silence; avoids paying to re-generate on identical input. |
| **Manual refresh behavior** | Flush current mic chunk → poll for no pending chunks (≤8s) → generate | Matches spec's *"updates transcript then suggestions"* wording. |
| **Anti-repetition** | Pass last 6 titles (2 batches × 3) to the prompt with explicit "do not repeat" | Way cheaper than semantic similarity on embeddings; empirically effective with gpt-oss-120b. |
| **Prompts file location** | New `config/prompts.ts` (big strings) re-exported via `config/defaults.ts` | Keeps defaults file skimmable; lets prompt iteration diffs stay focused. |
| **Server-side validation** | Reject response if not exactly 3 items with valid types | Defense in depth — never let malformed output reach the UI; return 502 so the frontend can show a clear batch-failed card. |

---

## Steps Performed

### 1. Prompt design — the single most important artifact

Wrote `config/prompts.ts` with four prompts:

**`LIVE_SUGGESTIONS_PROMPT`** — the marquee prompt. Key design choices:

- **5 typed suggestion categories** with per-type "use when" triggers:
  - `question_to_ask` — topics underexplored, decisions pending
  - `talking_point` — conversation needs a new angle or framing
  - `answer_to_recent_question` — pending question in the last ~30s
  - `fact_check` — specific, falsifiable claim worth verifying
  - `clarifier` — jargon / named entity that needs a one-liner
- **Diversity rule** — no duplicate types per batch unless context clearly demands
- **"Preview must stand alone"** — the most important rule. Exact wording:
  > *"preview MUST stand alone as useful content. Treat it like a tweet the user would screenshot — it should deliver value even if never clicked. Do NOT write 'Click to learn more.' Do NOT tease. Say the thing."*
- **Anti-repetition** — model receives `RECENT_TITLES` block with explicit "NEVER repeat or lightly paraphrase"
- **Silence fallback** — instructed to return genuine starter suggestions rather than refusing when the transcript is thin
- **Hard length caps** (also enforced server-side): title ≤70, preview ≤220, reasoning ≤120 chars
- **Strict JSON schema** inlined in the prompt, reinforced by Groq's `response_format: json_object`
- **Recency bias** — "Weight the last ~30 seconds most heavily"

**`DETAILED_ANSWER_PROMPT`** and **`CHAT_PROMPT`** — drafted as tuned defaults for Stage 4's click-to-expand and free-chat flows. Key features: lead-with-the-answer, cite transcript specifics, don't invent content, light formatting for sidebar.

**`SUMMARY_SYSTEM_PROMPT`** — internal (not user-editable). Produces 4–8 bullets covering topics, decisions, names, open questions. Each bullet ≤140 chars.

### 2. `config/defaults.ts` refactor

- Imports long-form prompts from `prompts.ts`
- Adds `summaryRefreshEveryNBatches: 3` to the defaults object
- Re-exports `DEFAULT_SUMMARY_SYSTEM_PROMPT` for any caller that needs it

### 3. `lib/groq.ts` — shared Groq client helpers

Centralizes:
- `GROQ_CHAT_URL` constant
- Model IDs — `SUGGESTIONS_MODEL`, `SUMMARY_MODEL`, `CHAT_MODEL` (all `openai/gpt-oss-120b` for now, easy to vary later)
- `GroqMessage`, `GroqChatRequest`, `GroqChatResponse` types
- `extractBearer(auth)` helper for API routes
- `callGroq(apiKey, body)` wrapper

This keeps the three API routes thin and eliminates URL/model string drift.

### 4. `app/api/suggestions/route.ts` — the JSON-mode endpoint

Flow:
1. Extract bearer → 401 if missing
2. Parse JSON body → 400 if malformed
3. Build the user message: `SESSION_SUMMARY` + `RECENT_TRANSCRIPT` + `RECENT_TITLES` + "return exactly 3…"
4. Call Groq with `temperature: 0.5`, `max_tokens: 900`, `response_format: { type: "json_object" }`
5. Passthrough Groq's status on upstream failures
6. `safeParse()` on the response content — primary `JSON.parse`, fallback regex extraction of the first `{...}` block
7. `normalize()` validates each suggestion: type must be in the allowed enum, title+preview must be strings, hard-trim all fields to length caps
8. Reject (502) if not exactly 3 valid suggestions
9. Return `{ suggestions: [...] }` without IDs — client assigns them

**Defense-in-depth** pattern: even if the model misbehaves, the UI never sees a malformed batch.

### 5. `app/api/summary/route.ts` — rolling summary endpoint

- Same bearer/JSON validation pattern
- Passes the full transcript + optional `previousSummary` as context
- Prompt is the internal `SUMMARY_SYSTEM_PROMPT`
- Temperature 0.2, max_tokens 500
- Returns `{ summary: string }`
- Fire-and-forget from the client; failures silently swallowed (summary is best-effort context enhancement, not a gating call)

### 6. `store/useSuggestionsStore.ts`

New Zustand store (no `persist` — per-session state).

State:
- `batches: BatchWithStatus[]` — newest-first (new batches prepend)
- `sessionSummary: string` — rolling bullets
- `isGenerating: boolean` — for disabling the refresh button during in-flight calls
- `doneBatchCount: number` — drives the "every Nth batch regen summary" trigger

Mutations:
- `beginBatch(id)` — prepends a `pending` batch with empty suggestions (enables immediate skeleton rendering)
- `resolveBatch(id, suggestions)` — flips to `done`, fills suggestions, bumps counter
- `failBatch(id, error)` — flips to `error` in place, preserves the batch row
- `setSessionSummary(text)`, `reset()`

Selectors:
- `recentTitles(n)` — flattens the most recent N titles across batches (for anti-repetition input)

### 7. `lib/recorder.ts` — `flush()` method

Added a public `flush()` on `ChunkedRecorder`:
- No-op if not recording
- Resets the rotation interval so we don't immediately double-rotate
- Calls `rotateChunk()` which stops the current `MediaRecorder` → triggers `onstop` → bundles the blob → emits `onChunk` → starts a fresh recorder

### 8. `lib/useRecordingController.ts` — expose `flush()`

Thin pass-through: the page reads `flush` from the recording controller and hands it to the suggestions controller.

### 9. `lib/useSuggestionsController.ts` — the orchestrator

The most substantive hook this stage. Responsibilities:

**Auto-refresh loop:**
- `useEffect` watches `isRecording`
- On start: clears the store, resets length tracker, sets a `setInterval` at `refreshIntervalSec * 1000` (min 5s floor)
- On stop: tears down the interval
- Each tick calls `generate()` which bails early if transcript hasn't grown

**`generate({ manual })`:**
- Guards: no API key → bail; already generating → bail
- Slices `recentTranscriptText(suggestionContextWindowSec)` from the session store
- Compares length to `lastTranscriptLengthRef` (auto-tick skip guard). Manual calls bypass the guard.
- Fetches `recentTitles(6)` from the suggestions store
- Calls `/api/suggestions` with bearer + body
- On success: assigns client-side IDs, resolves batch
- On failure (HTTP or network): fails the batch with the error message
- Every 3rd done batch: fires `refreshSummary()` in the background

**`refresh()` — for the manual button:**
- If recording: calls `flush()`, then `waitForNoPendingChunks()` (polls every 250ms up to 8s)
- Then `generate({ manual: true })`

**`refreshSummary()` — background, best-effort:**
- Reads full transcript + existing summary
- Calls `/api/summary`
- On success, updates the store; on failure, silently drops (summary is context enhancement, not a gate)

### 10. `components/SuggestionsPanel.tsx` — the real UI

Rewrote from the Stage 1 stub. Components:

**`SuggestionsPanel`** (top-level)
- Subscribes to `batches`, `isGenerating`, `isRecording`
- Refresh button: animated spinner while generating; disabled when already generating or nothing to refresh
- Scrollable list of batches, newest at top

**`BatchBlock`**
- Timestamp divider (hh:mm:ss, monospace, with separator line)
- `pending` → `BatchSkeleton` (3 animated pulse cards)
- `error` → red banner with icon + error message
- `done` → 3 `SuggestionCard`s stacked

**`SuggestionCard`**
- Color-coded type badge (pill, 10px uppercase)
- Title (sm font-medium) + preview (xs text-muted)
- `hover:-translate-y-[1px]` + `hover:shadow-[0_2px_16px_rgba(124,92,255,0.08)]` + accent-colored border on hover
- `title={reasoning}` — hovering any card shows the model's rationale as a tooltip
- Clicking calls `onSelectSuggestion(s)` — wired to a stub in `page.tsx` for now (Stage 4)

**Type meta table:**
```ts
question_to_ask            → "Ask"         sky blue
talking_point              → "Point"       violet
answer_to_recent_question  → "Answer"      emerald
fact_check                 → "Fact-check"  amber
clarifier                  → "Clarify"     fuchsia
```

### 11. `app/page.tsx` — integration

- Imports the suggestions controller, passes `flush` from the recording controller to it
- Stubs `onSelectSuggestion` (Stage 4 will push it into chat)
- Passes `refresh` + `onSelectSuggestion` down to `SuggestionsPanel`

---

## Files Added / Modified

### Added
| Path | Purpose |
|------|---------|
| `config/prompts.ts` | Live-suggestions + detailed-answer + chat + summary prompts |
| `lib/groq.ts` | Shared Groq client helpers (URL, model IDs, types, bearer extractor) |
| `app/api/suggestions/route.ts` | JSON-mode Groq proxy with strict response validation |
| `app/api/summary/route.ts` | Rolling-summary background endpoint |
| `store/useSuggestionsStore.ts` | Batches, rolling summary, counters, selectors |
| `lib/useSuggestionsController.ts` | Interval + manual-refresh orchestrator |

### Modified
| Path | Change |
|------|--------|
| `config/defaults.ts` | Re-exports long prompts; adds `summaryRefreshEveryNBatches` |
| `lib/recorder.ts` | New `flush()` method |
| `lib/useRecordingController.ts` | Exposes `flush` to the page |
| `components/SuggestionsPanel.tsx` | Real rendering: batches, cards, badges, skeletons, errors |
| `app/page.tsx` | Wires suggestions controller; passes `flush`; stubs select handler |

---

## Verification

| Check | Result |
|-------|--------|
| `ReadLints` on full project | No errors (after fixing 2 unused-var errors on first build) |
| `npm run build` | Compiled clean; `/api/suggestions`, `/api/summary`, `/api/transcribe` all registered as dynamic (`ƒ`) routes |
| `npm run dev` + HTTP smoke test | 200 OK |
| Bundle size | Page now 13 kB (up from 9.46 kB in Stage 2) — entirely from the new panel UI |

---

## Known Tradeoffs (documented in code)

1. **No streaming on suggestions** — we wait for the full JSON response (~1–3s typical). Streaming would only save perceived time on the first card since the batch renders together. Not worth the JSON-mid-stream parsing complexity.
2. **Summary isn't surfaced in the UI yet** — it's generated and stored and feeds the next suggestion's context. Stage 5 export will include it; a collapsible "session summary" peek could be added if dogfooding shows users want it.
3. **Suggestion clicks are no-ops right now** — Stage 4 wires them to the chat panel + detailed-answer flow.
4. **Regex-fallback JSON parse** — if the model ever wraps JSON in prose (rare with `response_format: json_object`, but belt-and-braces), we extract the first `{...}` block. If that too fails, we return a clean 502 with the offending content truncated for debugging.
5. **No rate-limit handling on suggestions** — unlike transcription's 3-try backoff, we just fail the batch on 429. Acceptable because (a) the next tick will retry anyway in 30s, (b) batches are non-blocking, (c) we show the failure inline without a noisy toast.

---

## Snags & Learnings

1. **First build: 2 lint errors** — an unused `_s` parameter and a destructured-but-unused `setSessionSummary`. Next.js 14's default ESLint config treats unused vars as hard errors at build time. Fix: use `void s` convention to satisfy the linter for Stage-4-reserved parameters; remove truly unused destructures.
2. **`flush()` design trap** — first cut of `flush()` just called `rotateChunk()` which left the 30s rotation timer ticking on the old schedule. A flush at second 25 would have rotated a new 5-second chunk. Fix: reset the rotation interval inside `flush()` so the next rotation is a full 30s later.
3. **"Skip if transcript hasn't grown" guard** — critical for not paying for repeat calls during silence or while waiting for the next audio chunk to land. Tracked via `useRef<number>` holding the last-seen transcript length, reset to 0 when a session starts.
4. **Zustand-in-effect pattern** — for the interval, we use `useSettingsStore.getState()` / `useSessionStore.getState()` inside `generate()` rather than subscribing at the hook top level. Reason: we want the **current** settings + session state at call time, and we don't want the effect re-running whenever prompts change in Settings.
5. **5s floor on refresh interval** — otherwise a user with a misunderstanding could set the refresh interval to 1 second and burn through their Groq rate limits. `Math.max(5_000, settings.refreshIntervalSec * 1000)`.

---

## Deliverables Checklist

- [x] Working 3-cards-every-N-seconds loop, end to end with a real Groq key
- [x] Manual refresh button that flushes the current audio chunk first
- [x] Rolling summary that feeds back into subsequent suggestion calls
- [x] Diverse, typed, color-badged suggestion cards with stand-alone previews
- [x] Graceful handling of: no transcript yet, in-flight batch, API errors, invalid model output
- [x] All prompts user-editable via Settings modal with Reset-to-Defaults
- [x] Typed, lint-clean, build-clean

### Deferred to later stages (by design)

- Clicking a suggestion → chat expansion → **Stage 4**
- Free-form chat with streaming → **Stage 4**
- Session summary visible in export → **Stage 5**
- Latency audit + telemetry of first-batch time → **Stage 5**
- Semantic anti-repetition (embeddings) — only if dogfooding shows the title-based approach isn't enough → **Stage 5 stretch**

---

## Next Up — Stage 4

**Chat Panel + Streaming Detailed Answers.** Clicking a suggestion pushes it into the chat and fires a longer-form answer via `/api/chat` with SSE streaming (TTFT < 1s target). Free-form user input uses the same endpoint. Context composition: system prompt + rolling summary + recent transcript + chat history + new message. Copy-to-clipboard buttons, stop-generation button, smooth auto-scroll.
