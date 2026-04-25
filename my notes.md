# My Notes — Live Suggestions Copilot Build

---

## Sample Prompts I Developed and Tuned

### 1. Live Suggestions Prompt (the core one)

The hardest prompt to get right. Early drafts produced three `question_to_ask` cards every time — no variety, no context-awareness. The breakthrough was making the model **declare its reasoning before committing to a type**, and giving each type an explicit "use when" condition.

```
You are a real-time AI meeting copilot listening to a live conversation alongside the user.

You will receive:
  • SESSION_SUMMARY — bullet-point gist of the meeting so far.
  • RECENT_TRANSCRIPT — the last N seconds verbatim. Most important input.
  • RECENT_TITLES — titles from the previous batches. NEVER repeat or paraphrase any.

Output EXACTLY 3 suggestions. Choose a DIVERSE mix of types:

  • question_to_ask     → use when a topic is underexplored or next steps are unclear
  • talking_point       → use when conversation needs a new angle or fact
  • answer_to_recent_question → use when a question was just asked but not answered well
  • fact_check          → use when a specific, falsifiable claim (number, date, name) was stated
  • clarifier           → use when jargon or a named entity appeared that a listener might not know

RULE: "preview" MUST stand alone as useful content. Treat it like a tweet the user screenshots.
Do NOT write "Click to learn more." Say the actual thing.

OUTPUT: strict JSON, nothing else.
{ "suggestions": [{ "type", "title", "preview", "reasoning" }] }
```

What made the difference: the hard rule that `preview` must deliver standalone value. Earlier versions were teaser previews ("Click to see how X works"). Changing one sentence in the prompt transformed the output quality.

---

### 2. Rolling Session Summary Prompt (internal, not user-visible)

Runs every 3rd batch against the full transcript. Keeps long meetings coherent without blowing the 90-second live-suggestion window.

```
You compress meeting transcripts into a tight running summary for an AI copilot's context.

Return 4–8 bullet points:
  • Main topics discussed (in order)
  • Key decisions, claims, or numbers stated
  • People, companies, projects named
  • Open questions or unresolved threads

Rules:
  • Plain bullets, "• " prefix, no markdown headers
  • Each bullet ≤ 140 characters
  • Neutral, factual. Do not speculate or invent.
```

The insight here: rather than passing the full transcript to every suggestion call (token-expensive, slow), I compress it into bullets and pass those instead. The 90-second recent window handles recency; the summary handles continuity.

---

### 3. Detailed Answer Prompt (on suggestion click)

```
You are the in-meeting deep-dive assistant. A user just clicked a suggestion card during a live conversation.

You will receive the original suggestion (type, title, preview) + transcript context.

  • Lead with the direct answer. No throat-clearing.
  • 2–5 short paragraphs or a tight bulleted list.
  • Cite specific transcript moments when grounding a claim.
  • If the suggestion was a question_to_ask, draft the actual wording the user could say out loud.
  • If fact_check, separate what is verifiable from what is uncertain.
  • Never invent transcript content. If unsure, say so.
```

Key decision: passing the original suggestion object back into the prompt (type, title, preview, reasoning). This lets the model know *why* the card was surfaced and respond to that specific frame — not just answer the question generically.

---

## Full-Stack Engineering Concepts I Find Most Interesting

### Streaming as a UX primitive

The `/api/chat` route sends tokens as they arrive from Groq over a `ReadableStream` (SSE). The UI renders an empty assistant bubble with a pulsing cursor *before the first token lands* — so perceived latency is near-zero even when Groq's actual TTFT is 800ms. This is a pattern I find genuinely elegant: optimistic rendering applied to stream-in-progress content.

### Thin API routes as proxy seams

Each Next.js route (`/api/transcribe`, `/api/suggestions`, `/api/chat`, `/api/summary`) is a deliberate one-layer proxy. It validates the API key, constructs the Groq request, and returns the response — nothing more. This means: no business logic leaks into the routes, the model can be swapped by changing one constant in `lib/groq.ts`, and the server/client split is clean.

### Separating controllers from components

Every stateful operation lives in a controller hook (`useRecordingController`, `useSuggestionsController`, `useChatController`) that only talks to stores and API routes — no direct store writes from components. Components are pure consumers. This separation makes it easy to reason about: "what does this UI component actually own?" The answer is always "nothing except local UI state."

### Rolling summaries for long-context coherence

The 90-second transcript window keeps token counts low and suggestion latency fast. But without memory beyond 90 seconds, the model forgets meeting context. The rolling summary (4–8 bullets, updated every 3 batches) bridges the two: cheap to pass, rich enough to anchor long-range context. A pattern I'd generalize to any real-time AI product — sliding window + compressed memory.

### Zustand's persist middleware for selective persistence

Settings (API key, prompts, context windows) persist to localStorage via `persist` middleware. Session state (transcript chunks, batches, chat) is ephemeral — intentionally wiped on reload per the assignment spec. Selecting exactly what persists, rather than serializing all state, keeps the app's restart behavior predictable.

---

## How I Maintained Code Quality

**1. One concern per file.**
Controllers orchestrate. Stores hold state. API routes are proxies. Components render. Nothing bleeds across these roles. When something feels hard to place, that's a signal the abstraction is wrong.

**2. TypeScript strict mode with no `any`.**
Every API boundary has an explicit interface. The `normalize()` function in the suggestions route treats the model's output as `unknown` and validates it field-by-field — this caught a real bug where the model returned `reasoning: null` instead of omitting it.

**3. Defense in depth on model output.**
The suggestions route: parse JSON → fallback regex extraction → validate types → hard-trim lengths → reject if not exactly 3. Malformed output never reaches store state. Each failure path returns a specific HTTP code and a readable error message.

**4. Dead code stays dead — meaning it gets deleted.**
No commented-out blocks, no `_unused` variables, no `// TODO: remove this` left in production paths. If it's not needed now, it's gone.

**5. Component size as a proxy for clarity.**
Any component over ~150 lines gets decomposed into named sub-components (`BatchBlock`, `SuggestionCard`, `BatchSkeleton` in SuggestionsPanel). Named sub-components are self-documenting and independently testable if tests are added later.

**6. Verifying the build, not just the dev server.**
`npm run build` runs the TypeScript compiler in full strict mode. A passing dev server with type errors in the console is not acceptable. Every iteration ended with a clean build.

---

## Ensuring Low Latency and Efficient Execution

**Async transcription, not sequential.**
Each 30-second audio blob is posted to `/api/transcribe` immediately when it's ready. The suggestion engine does not wait for the transcription to complete before starting its own timer — both pipelines run in parallel. A slow Whisper call does not delay the next suggestion batch.

**Skip guard on auto-refresh.**
The 30-second suggestion interval checks whether the transcript has actually grown since the last batch. If the user has been silent, no Groq call fires. This avoids burning tokens and quota on identical context.

**Chat history capped at 12 messages.**
Every chat call passes at most the last 12 messages. Earlier turns are covered by the rolling session summary. This bounds prompt token count regardless of session length — O(1) tokens per call, not O(n).

**Streaming for perceived latency.**
The chat route streams tokens as they arrive. `ReadableStream` + `TextDecoder` on the client appends to the message character-by-character. Users read the first sentence before the full response is generated. Actual TTFT: ~800ms. Perceived TTFT: the moment the bubble appears (~0ms after send).

**Single Groq fetch per operation.**
No retry loops, no polling. Each API route fires one fetch, validates the response, and returns. Retries are left to the next interval tick — simpler, and avoids cascading failures under quota pressure.

**Batches rendered without re-sorting.**
The `batches` array is prepended (not sorted) on every new batch — `O(1)` insert, rendered in natural order. No sort pass runs on every render tick.
