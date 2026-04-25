# TwinMind — Live Suggestions

Real-time AI meeting copilot. Listens to live audio, transcribes in ~30-second chunks, and continuously surfaces **3 fresh, context-aware suggestions** the user can act on right now. Clicking any suggestion opens a detailed, streaming answer in the chat panel; users can also chat freely against the full meeting context.

Built for the TwinMind Live Suggestions assignment (April 2026).

## Demo

- **Deployed app:** https://twin-mind-live-suggestions-gamma.vercel.app?_vercel_share=JkamAMF5yIMK4w2Wnq21jXAJ3Eh5a0Z7
- **GitHub repo:** https://github.com/ByrojuBharadwaj/TwinMind-Live-Suggestions

Open the app, paste a Groq API key in Settings, hit **Start mic** — first transcript chunk + batch of 3 suggestions appears within ~30 seconds.

---

## Table of contents

1. [Setup](#setup)
2. [Stack](#stack)
3. [Architecture](#architecture)
4. [Prompt strategy](#prompt-strategy)
5. [Context composition](#context-composition)
6. [Latency](#latency)
7. [Settings](#settings)
8. [Export](#export)
9. [Tradeoffs & known limitations](#tradeoffs--known-limitations)
10. [Deploying to Vercel](#deploying-to-vercel)
11. [Development logs](#development-logs)

---

## Setup

Requires Node.js 20+ and a Groq API key ([console.groq.com](https://console.groq.com)).

```bash
npm install
npm run dev
```

Open http://localhost:3000, click the settings gear, paste your Groq API key.

**The key is stored only in your browser's `localStorage` and attached per-request as a header.** It is never committed, never shipped, and never stored on any server we operate.

### Production build

```bash
npm run build
npm start
```

### No environment variables are required

This project intentionally has no `.env` file. See `.env.example` for the reasoning.

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 14** (App Router) | Native Vercel deploy, first-class API routes for SSE streaming |
| Language | **TypeScript** | Type safety across store + server boundary |
| Styling | **Tailwind CSS** + CSS variables | Fastest path to a polished dark UI |
| State | **Zustand** with `persist` middleware on settings only | Minimal boilerplate; per-session state stays ephemeral per assignment spec |
| Icons | **lucide-react** | Tree-shakeable, consistent stroke |
| AI | **Groq** — Whisper Large V3 (transcription) + `openai/gpt-oss-120b` (suggestions, chat, summary) | Assignment mandate. Groq offers sub-second TTFT on streaming chat. |

### Directory layout

```
app/
  api/
    transcribe/route.ts     ← multipart proxy → Groq Whisper
    suggestions/route.ts    ← JSON-mode proxy → Groq GPT-OSS 120B
    summary/route.ts        ← rolling summary proxy
    chat/route.ts           ← streaming SSE proxy with abort plumbing
  layout.tsx
  page.tsx                  ← 3-column shell + controllers
  globals.css
components/
  Header.tsx                ← mic button, timer, export menu, settings gear
  TranscriptPanel.tsx       ← left column
  SuggestionsPanel.tsx      ← middle column (the grade)
  ChatPanel.tsx             ← right column
  SettingsModal.tsx         ← API key + editable prompts + context windows
config/
  prompts.ts                ← tuned production prompts (user-editable)
  defaults.ts               ← numeric defaults + re-exports
lib/
  recorder.ts               ← ChunkedRecorder (30s restart pattern)
  groq.ts                   ← shared client helpers + model IDs
  time.ts                   ← formatElapsed, formatClock
  export.ts                 ← JSON + text session dump
  useRecordingController.ts ← mic ↔ transcribe pipeline
  useSuggestionsController.ts ← interval + manual refresh + rolling summary
  useChatController.ts      ← streaming send / expand / stop
store/
  useSettingsStore.ts       ← persisted: API key, prompts, context windows
  useSessionStore.ts        ← transcript chunks + recording flag
  useSuggestionsStore.ts    ← batches + session summary
  useChatStore.ts           ← messages + streaming state
types/
  index.ts                  ← shared contracts
docs/
  planning.md               ← 5-stage plan
  stage1.md … stage5.md     ← per-stage development log
```

---

## Architecture

```
     Microphone                              Groq API
         │                                      │
         ▼                                      │
  ChunkedRecorder ──30s blobs──▶ /api/transcribe ──▶ Whisper Large V3
         │                                      │
         │                             text ◀───┘
         ▼
  useSessionStore  ◀─── transcript chunks ────┐
         │                                    │
         │    recentTranscriptText(sec)       │
         ▼                                    │
  useSuggestionsController                    │
         │                                    │
         │    every refreshIntervalSec        │
         ▼                                    │
     /api/suggestions ──▶ GPT-OSS 120B (JSON mode)
         │                                    │
         ▼                                    │
  useSuggestionsStore (batches, summary)      │
         │                                    │
         │   every 3rd batch                  │
         ▼                                    │
     /api/summary ──▶ GPT-OSS 120B            │
                                              │
  User clicks card  OR  types in composer     │
         │                                    │
         ▼                                    │
  useChatController                           │
         │                                    │
         ▼                                    │
     /api/chat (streaming SSE) ──▶ GPT-OSS 120B
         │                                    │
         ▼                                    │
  useChatStore (messages, streamingId) ◀──────┘
         │
         ▼
  ChatPanel renders bubbles + streaming cursor
```

Each **store** is a single source of truth, each **controller** hook is an orchestrator with no UI, each **API route** is a thin Groq proxy. Components consume stores; controllers update them. No component talks to an API route directly.

---

## Prompt strategy

Three user-editable prompts live in [`config/prompts.ts`](./config/prompts.ts) and can be overridden from the Settings modal. Below are the tuned defaults and the reasoning behind each.

### 1. Live Suggestions prompt (the core of the grade)

The assignment's #1 evaluation criterion is *"Quality of live suggestions: Useful, well-timed, varied by context."* The prompt is built around that directive.

Key design decisions:

- **5 typed categories with explicit "use when" triggers** — forces the model to pick the right mix based on what's happening in the last 30 seconds, rather than defaulting to one type:
  - `question_to_ask` — topic underexplored, decisions pending
  - `talking_point` — conversation needs a new angle
  - `answer_to_recent_question` — there's a pending question the user could answer
  - `fact_check` — a specific, falsifiable claim was made
  - `clarifier` — jargon or a named entity that needs a one-liner
- **"Preview must stand alone"** — the single most important rule, quoted verbatim in the prompt:
  > *"preview MUST stand alone as useful content. Treat it like a tweet the user would screenshot — it should deliver value even if never clicked. Do NOT write 'Click to learn more.' Do NOT tease. Say the thing."*
- **Diversity rule** — no two cards of the same type per batch unless context strongly demands it
- **Anti-repetition** — the last 6 titles (2 batches × 3 cards) are fed back to the model with explicit "NEVER repeat or paraphrase"
- **Recency bias** — "Weight the last ~30 seconds most heavily"
- **Silence fallback** — instructed to return genuine starter suggestions rather than apologizing when transcript is thin
- **Hard length caps** — title ≤70, preview ≤220, reasoning ≤120 chars (enforced both in prompt and server-side)
- **Strict JSON schema** inlined in the prompt and enforced via Groq's `response_format: { type: "json_object" }`

### 2. Detailed Answer prompt (suggestion-click expansion)

- Lead with the direct answer; no throat-clearing
- 2–5 short paragraphs or tight bullets
- Cite specific transcript moments when grounding claims
- If the suggestion was a question to ask, draft the actual wording
- Separate verifiable vs. uncertain when fact-checking
- Never invent transcript content

### 3. Chat prompt (free-form user questions)

- Lead with the answer; short paragraphs or bullets
- Ground claims in transcript when relevant
- Handle both meeting-specific and general questions cleanly
- Light formatting suitable for a sidebar chat

### 4. Summary prompt (internal, not user-editable)

Runs every 3rd successful suggestion batch against the full transcript. Produces 4–8 bullets: topics, decisions, named entities, open questions. Feeds back into every subsequent suggestion and chat call so long meetings stay coherent without blowing the 90-second live-suggestion window.

### Defense in depth on model output

Even with `response_format: json_object`, we don't trust the output blindly. The suggestions route:

1. Tries `JSON.parse` on the response
2. Falls back to regex-extracting the first `{...}` block
3. Validates that each suggestion has a type from the allowed enum, plus string title/preview
4. Hard-trims each field to the length caps
5. Returns `502` if not exactly 3 valid suggestions

Malformed output never reaches the UI — the affected batch shows a clear error card and the next tick retries.

---

## Context composition

Every LLM call passes context in a structured way so the model knows what's live, what's summarized, and what's conversation state.

### Live Suggestions request

```
[system]  LIVE_SUGGESTIONS_PROMPT (user-editable)
[user]    SESSION_SUMMARY:
          {rolling bullets}

          RECENT_TRANSCRIPT:
          {last suggestionContextWindowSec seconds — default 90}

          RECENT_TITLES (do NOT repeat or paraphrase):
          - {title 1}
          - {title 2}
          - ... (up to 6 titles)

          Return exactly 3 suggestions as strict JSON per the schema.
```

### Chat / Detailed request

```
[system]  CHAT_PROMPT (or DETAILED_ANSWER_PROMPT)
          ---
          SESSION_SUMMARY:
          {rolling bullets}

          TRANSCRIPT_CONTEXT:
          {windowed or full transcript}

          SELECTED_SUGGESTION:        ← detailed mode only
          type: {type}
          title: {title}
          preview: {preview}
          reasoning: {reasoning}
[user]    history[-12].content
[assistant] history[-11].content
  ... (last 12 messages)
[user]    current message
```

### Rolling Summary request

```
[system]  SUMMARY_SYSTEM_PROMPT (internal)
[user]    PREVIOUS_SUMMARY:
          {existing summary, if any}

          FULL_TRANSCRIPT:
          {full session transcript}
```

---

## Latency

### Targets

| Path | Target | Notes |
|------|--------|-------|
| Cold reload → first suggestions rendered | ~32s | 30s to fill first audio chunk + ~2s transcribe + generate |
| Manual refresh → new batch | ~4–6s | Flush + wait for transcribe (~1–2s) + generate (~1–3s) |
| Chat send → first token | <1s | Groq streaming TTFT is consistently sub-second in practice |
| Suggestion click → first token | <1s | Same streaming path as chat |
| 30-second chunk → transcript row filled | ~1–2s | Whisper Large V3 cold call |

### Architectural choices that contribute

- **No unnecessary waits** — transcription posts fire asynchronously per chunk; suggestion generation fires as soon as the interval ticks
- **Streaming for chat** — `ReadableStream` from `/api/chat` sends tokens the instant Groq produces them
- **Empty assistant bubble on send** — the UI paints a bubble with a pulsing cursor *before* the first token lands, reducing perceived latency to zero
- **Skip guard on auto-refresh** — tick fires only when transcript has grown, avoiding wasted calls during silence
- **History capped at 12 messages** — keeps prompt tokens bounded; summary handles long-range context

### Measured numbers

Measure in your deployed environment and fill in below. The dev build includes HMR overhead and is not representative.

| Metric | Your measured value |
|--------|---------------------|
| Cold reload → first suggestions | _fill after deploy_ |
| Chat send → first token | _fill after deploy_ |
| Suggestion click → first token | _fill after deploy_ |

---

## Settings

Click the gear icon. All fields persist to `localStorage` (versioned, migratable).

| Field | Default | Notes |
|-------|---------|-------|
| Groq API key | _empty_ | Required. Stored only in your browser. |
| Live suggestions prompt | tuned default | Fully editable; rewrite at will |
| Detailed answer prompt | tuned default | Used when a suggestion card is clicked |
| Chat prompt | tuned default | Used for free-form chat |
| Live suggestions context window | **90** sec | Transcript slice fed to the suggestions call |
| Expanded answer context window | **0** sec | `0` = full transcript; any positive value windows it |
| Refresh interval | **30** sec | Auto-refresh frequency (5-second floor enforced) |

**Reset to defaults** restores all prompts and numbers without touching the API key.

---

## Export

Click the download icon in the header (disabled when the session is empty). Two formats:

### JSON

Machine-readable dump. Useful for reviewers, regression testing, and downstream analysis.

```jsonc
{
  "app": "TwinMind Live Suggestions",
  "exportedAt": "2026-04-21T22:14:05.321Z",
  "session": { "startedAt": "...", "chunkCount": 8, ... },
  "transcript": [ { "id", "startedAt", "endedAt", "status", "text" }, ... ],
  "suggestionBatches": [ { "id", "createdAt", "status", "suggestions": [...] }, ... ],
  "chat": [ { "id", "role", "content", "createdAt", "sourceSuggestionId?" }, ... ],
  "sessionSummary": "• ..."
}
```

### Plain text

Human-readable fallback with sections for transcript, suggestion batches, and chat, all timestamped.

### Filename

`twinmind-session-YYYY-MM-DD-HHmm.{json|txt}`

---

## Tradeoffs & known limitations

Deliberate scope choices, documented in code comments:

1. **No cross-chunk audio overlap.** The `MediaRecorder` restart pattern loses ~50–150 ms at each 30-second boundary. True overlap requires two parallel staggered recorders — deferred because empirical word loss in testing was low.
2. **Suggestions are not streamed.** The entire 3-card batch arrives together; streaming JSON mid-parse adds complexity without meaningfully improving UX since cards render as a group.
3. **No markdown in chat.** Assistant messages render as `whitespace-pre-wrap` plain text. Prompts explicitly request light formatting. A streaming-safe markdown renderer could be added, but the current UX is clean.
4. **History capped at 12 chat messages.** Very long chat threads drop the earliest turns from prompt context. The rolling session summary covers meeting content, so quality degradation should be minimal.
5. **New chat send aborts any in-flight response.** Deliberate — queueing felt like over-engineering for a sidebar chat.
6. **Session summary isn't surfaced in the UI.** It powers every subsequent suggestion and chat call, and it's included in the export, but there's no collapsible "session summary" widget. Could be added if users want to see what the model is seeing.
7. **Safari untested.** The MIME-type fallback picks `audio/mp4` when WebM/Opus isn't supported, but this path hasn't been empirically verified.
8. **No telemetry.** No measurement pipeline beyond manual inspection. Production would add OpenTelemetry around the four API routes.

---

## Deploying to Vercel

The fastest path — takes ~2 minutes end to end.

### Option A: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel              # preview
vercel --prod       # production
```

### Option B: GitHub + Vercel dashboard

1. `git init && git add . && git commit -m "Initial commit"`
2. Create an empty repo on GitHub, push your code
3. Go to [vercel.com/new](https://vercel.com/new), import the repo
4. **No environment variables needed** — just click Deploy
5. Wait ~40 seconds. Your URL will be `https://<project-name>.vercel.app`

### Post-deploy checklist

- [ ] Open the deployed URL in a fresh browser
- [ ] Settings → paste Groq key → Save
- [ ] Click Start mic → grant permission
- [ ] Wait 30s → transcript chunk appears → first suggestions land
- [ ] Click a suggestion card → chat streams a detailed answer
- [ ] Type a question → chat streams a response
- [ ] Click Export → JSON downloads with all session data
- [ ] Measure and fill in the latency table above

---

## Development logs

The app was built in 5 focused stages, each documented with goals, decisions, files changed, verification, and snags learned:

- [docs/planning.md](./docs/planning.md) — the 5-stage plan
- [docs/stage1.md](./docs/stage1.md) — Foundation & Settings
- [docs/stage2.md](./docs/stage2.md) — Audio Capture + Whisper Transcription
- [docs/stage3.md](./docs/stage3.md) — Live Suggestions Engine (the core)
- [docs/stage4.md](./docs/stage4.md) — Chat Panel + Streaming Answers
- [docs/stage5.md](./docs/stage5.md) — Export, Polish, README, Deploy

---

## License

MIT. Assignment submission.
