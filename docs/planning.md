# TwinMind Live Suggestions — 5-Stage Development Plan

A pragmatic, dependency-ordered plan for building the TwinMind Live Suggestions assignment in 10 days. Each stage ends with something testable so risk doesn't stack up at the end.

---

## Stage 1 — Foundation & Settings (Day 1)

**Goal:** Skeleton app deployed with API key flow working end-to-end.

### Stack choices
- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS (dark theme, matching the prototype)
- **State:** Zustand (lightweight, no boilerplate)
- **Hosting:** Vercel (single deploy, serverless API routes)
- **Backend pattern:** Next.js API routes act as a thin proxy to Groq — keeps streaming clean and avoids exposing raw requests.

### Layout
- Three-column shell: **Transcript | Suggestions | Chat**
- Responsive, dark theme, matches the reference prototype
- Header with app title, mic status indicator, settings gear, export button

### Settings modal
- **Groq API key** input (stored in `localStorage`, never committed to repo)
- **Editable prompts:**
  - `liveSuggestionsPrompt`
  - `detailedAnswerPrompt`
  - `chatPrompt`
- **Editable numbers:**
  - `suggestionContextWindowSec` (default: 90)
  - `expandedAnswerContextWindowSec` (default: full transcript)
  - `refreshIntervalSec` (default: 30)
- **Reset to defaults** button
- All defaults live in a single `config/defaults.ts` file for easy tuning

### Deploy
- Push to GitHub, connect Vercel, verify public URL loads
- Set up `.env.example` and document that no server-side keys are used

### Exit criteria
Deployed URL opens, API key paste persists across reloads, settings modal round-trips values correctly.

---

## Stage 2 — Audio Capture + Transcription (Days 2–3)

**Goal:** Reliable 30-second transcript chunks stream into the left column.

### Mic capture
- Use `MediaRecorder` with `audio/webm;codecs=opus` (best Chrome support, small payloads)
- Start/stop button with clear states: idle, requesting permission, recording, stopping
- Graceful handling of permission-denied and no-mic scenarios

### Chunking strategy
- `MediaRecorder.start(30000)` — emits a blob every 30s via `ondataavailable`
- Each blob → `POST /api/transcribe` → Groq Whisper Large V3
- **Overlap buffer:** keep a 2–3s tail overlap between chunks to avoid clipping words at boundaries; server-side dedupe on the overlap region

### Transcript store
- Zustand store of `{ id, text, startedAt, endedAt }[]`
- Auto-scroll container with sticky "follow latest" behavior (pauses auto-scroll if user scrolls up manually)
- Visible "transcribing…" indicator per pending chunk

### Resilience
- Retry with exponential backoff on 429 / 5xx errors
- Toast notifications for transcription failures
- Recover from temporary mic interruptions without losing session

### Exit criteria
Speak for 2 minutes → see clean appended transcript with timestamps, no word loss at chunk boundaries.

---

## Stage 3 — Live Suggestions Engine (Days 4–6) — **THE CORE**

**Goal:** 3 genuinely useful, varied cards every 30 seconds. This is the single most important stage — it's what the assignment is judged on most heavily.

### Trigger logic
- Interval timer fires every `refreshIntervalSec`
- Manual refresh button forces an immediate transcribe-then-suggest cycle
- On each trigger: slice last `suggestionContextWindowSec` of transcript + running session summary

### Prompt design (the hard part)

**System prompt defines 5 suggestion types:**
| Type | When to use |
|------|-------------|
| `question_to_ask` | A natural follow-up would deepen the conversation |
| `talking_point` | A relevant angle the speaker hasn't raised |
| `answer_to_recent_question` | Someone asked something unanswered in the last ~20s |
| `fact_check` | A claim was made that's verifiable and worth checking |
| `clarifier` | A term, acronym, or concept needs quick context |

**Output format:** strict JSON via Groq's `response_format: json_object`:
```json
{
  "suggestions": [
    { "type": "...", "title": "...", "preview": "...", "reasoning": "..." }
  ]
}
```

**Key prompt rules:**
- **Preview standalone value:** "Preview must stand alone as useful — treat it like a tweet that delivers value without a click."
- **Diversity:** No two cards of the same type unless context strongly demands it.
- **Recency bias:** Weight the last ~20s heaviest.
- **Anti-repetition:** Pass the last 2 batches' titles with "do not repeat or rephrase these."
- **Concise previews:** Hard cap at ~120 characters.

### Rolling session summary
- After each batch, fire a cheap background call that compresses older transcript into bullet context
- Keeps long meetings coherent without blowing the context window
- Stored in app state and prepended to every suggestion/chat prompt

### UI
- New batch inserts at top with timestamp divider (e.g. "12:04:30")
- Older batches fade slightly (reduced opacity) but remain clickable
- Skeleton loaders during generation
- Each card shows: type badge, title, preview, subtle click affordance

### Exit criteria
Run through a sample meeting recording → suggestions visibly track context shifts, feel useful, and show good variety across types.

---

## Stage 4 — Chat Panel + Expanded Answers (Days 7–8)

**Goal:** Clicking a card or typing produces fast, grounded answers with streaming.

### Click → chat flow
- Clicking a suggestion pushes it as a user message (e.g. `"Expand: {title}"`)
- Fires a *separate* prompt using:
  - `expandedAnswerContextWindowSec` of transcript
  - The suggestion's `reasoning` field as grounding
  - The rolling session summary
- Longer-form, more detailed output than the live suggestion preview

### Free-form input
- Textarea with Enter-to-send, Shift+Enter for newline
- Sends to same chat endpoint
- Accesses full transcript + session summary + chat history

### Streaming
- Server-Sent Events from `/api/chat` using Groq streaming
- **Target:** TTFT (time to first token) < 1s
- Stop-generation button during streaming

### Context composition (document this in README)
```
[System prompt]
+ [Rolling session summary]
+ [Recent transcript window]
+ [Chat history]
+ [Current user message]
```

### UI
- Message bubbles (user right, assistant left)
- Copy button per assistant message
- Auto-scroll to latest
- Loading indicator → streams in place

### Exit criteria
Click a card → detailed answer streams in under 2s. Free typing works. Full session chat stays coherent across 10+ turns.

---

## Stage 5 — Export, Polish, Latency, README (Days 9–10)

**Goal:** Submission-ready.

### Export button
- Download full session as JSON:
  ```json
  {
    "sessionStart": "...",
    "transcript": [{ "text", "startedAt", "endedAt" }],
    "suggestionBatches": [{ "timestamp", "suggestions": [...] }],
    "chat": [{ "role", "content", "timestamp" }]
  }
  ```
- Also provide a plain-text view for easy reviewer skimming
- All items timestamped

### Latency audit
Measure and trim:
- **Cold reload → first suggestion rendered** (target < 35s: 30s chunk + fast suggestion call)
- **Chat send → first token** (target < 1s)
- **Parallelize:** transcript POST with UI update
- **Eager trigger:** start suggestions call as soon as a chunk lands if a manual refresh was requested — don't wait for next interval tick

### Error states
- Missing API key → banner with link to settings
- Mic denied → clear fallback message and retry button
- Groq errors → toast with retry action
- Network offline → persistent indicator

### Code hygiene
- Remove dead code, unused imports
- Extract Groq client to single module with typed methods
- Shared types for all API contracts in `types/api.ts`
- One `prompts/` folder with named exports per prompt
- Consistent error handling pattern

### README must cover
- **Setup:** clone, install, run locally, where to paste API key
- **Stack choices:** why Next.js + Vercel + Groq proxying
- **Prompt strategy:** actual prompts shown, reasoning for structure, context-window decisions
- **Architecture diagram:** data flow from mic → transcript → suggestions → chat
- **Tradeoffs:** what you skipped and why
- **Known limitations:** Safari quirks, long-session memory, etc.
- **Latency numbers:** measured values, not estimates

### Dogfood
Run the app during a real 15-minute call (or podcast playback), note the top 3 annoyances, fix them.

### Exit criteria
Fresh browser → paste key → start mic → useful suggestions within 30s → clean export downloads. Submit URL + repo.

---

## Risks to Watch

| Risk | Mitigation |
|------|------------|
| **Prompt quality is the whole assignment** | Don't let Stage 3 slip. Budget real iteration time — plan a full day of prompt tuning against recorded samples. |
| **Audio chunking edge cases** (permissions, tab backgrounding, Safari) | Test early in Stage 2. Document browser support in README. |
| **API key handling** | Proxy through API routes so keys flow via header passthrough, not exposed in client Network tab payloads. Document the choice. |
| **Long-session context blowup** | Rolling summary from Stage 3 is the escape hatch — build it, don't skip it. |
| **Over-engineering** | Assignment explicitly warns against this. Ship the 80% that judges will actually evaluate. |

---

## Evaluation Mapping

Cross-check each stage against the assignment's stated evaluation priorities:

| Evaluation criterion | Primary stage |
|----------------------|---------------|
| 1. Quality of live suggestions | Stage 3 |
| 2. Quality of detailed chat answers | Stage 4 |
| 3. Prompt engineering | Stages 3 + 4 |
| 4. Full-stack engineering | Stages 1 + 2 |
| 5. Code quality | Stage 5 (ongoing) |
| 6. Latency | Stage 5 audit, architected in 1–4 |
| 7. Overall experience | Stage 5 dogfooding |
