# Stage 2 — Audio Capture + Whisper Transcription

**Status:** Complete
**Duration:** ~Days 2–3 of 10
**Goal:** Reliable 30-second transcript chunks stream into the left column from a live microphone, via Groq Whisper Large V3.

---

## Objective

Wire the app to the real world: capture microphone audio, chunk it at 30-second boundaries, ship each chunk to Groq's Whisper Large V3 endpoint, and populate the left-column transcript panel in real time with per-chunk status (pending / done / error). This unlocks all downstream stages — Stage 3's suggestions and Stage 4's chat both consume the transcript produced here.

**Exit criteria (all met):**
- [x] `/api/transcribe` route forwards multipart audio to Groq with the user's key
- [x] Microphone captures via `MediaRecorder` with graceful MIME-type fallback
- [x] 30-second chunks produced as standalone, self-contained WebM/Opus files
- [x] Per-chunk status lifecycle: `transcribing` → `done` | `error`
- [x] Exponential backoff retry on 429 / 5xx responses
- [x] Recording timer in header ticks every second
- [x] Transcript panel auto-scrolls, pauses when user scrolls up
- [x] Mic permission denial surfaces a clear error without zombie state
- [x] Build, type-check, and lint all clean

---

## Technical Decisions (locked before coding)

| Question | Decision | Reasoning |
|----------|----------|-----------|
| **Chunking strategy** | Restart `MediaRecorder` every 30s | Each chunk is a complete, self-contained WebM file — Whisper ingests directly. The alternative (single recorder with `start(30000)` timeslice) produces headerless continuation blobs that require server-side stitching, which is fragile. |
| **Overlap buffer** | Skip for Stage 2, document tradeoff | True audio overlap requires two parallel `MediaRecorder` instances staggered by ~3s. That's real complexity for ~50–150ms of recovered audio. Revisitable in Stage 5 if dogfooding shows meaningful word loss. |
| **Groq call routing** | Proxy through `/api/transcribe` server route | Consistent pattern with the streaming chat endpoint coming in Stage 4. Also gives us a clean seam for future logging/telemetry without touching client code. Key flows as `Authorization: Bearer <key>` header from client → server → Groq. |
| **Retry policy** | 3 attempts, exponential backoff: 300ms → 1.2s → 4.8s | Only retry on 429 (rate-limited) or 5xx (transient). 4xx client errors fail fast. Max total wait ~6.3s — stays under the 30s before the next chunk lands. |
| **Chunk status surface** | Inline per-chunk badge (spinner / error icon) | More informative than a global toast; the user sees exactly which 30-second window failed. |
| **Session state persistence** | **Not** persisted (in-memory only) | Settings persist across reloads; meetings do not. Matches assignment note ("no data persistence needed when reloading"). |

---

## Steps Performed

### 1. `/api/transcribe` route — Groq Whisper proxy

Created `app/api/transcribe/route.ts`:

- Runtime: `nodejs`, `maxDuration: 60` (some chunks near the limit after backoff)
- Expects `multipart/form-data` with `file` + optional `language`
- Requires `Authorization: Bearer <key>` header; returns **401** if absent (clear actionable error rather than a generic Groq 401 later)
- Rebuilds the multipart body for Groq with:
  - `file` → renamed `chunk.webm` (for content-type sniffing)
  - `model` → `whisper-large-v3`
  - `response_format` → `json`
  - `temperature` → `0` (deterministic transcription)
- Maps Groq failure paths to structured JSON:
  - 400 for malformed body
  - Groq's own status passthrough for API errors (with first 500 chars of detail)
  - 502 for network errors to Groq
- Returns `{ text: string }` on success

### 2. `lib/recorder.ts` — `ChunkedRecorder` class

Encapsulates the 30s-restart pattern so UI code never touches `MediaRecorder` directly.

- **MIME type negotiation:** tries in order — `audio/webm;codecs=opus` → `audio/webm` → `audio/ogg;codecs=opus` → `audio/mp4` — picks the first supported by the browser (so Safari falls back to `mp4`)
- **`start()`** — requests mic with `echoCancellation`, `noiseSuppression`, mono channel; starts first recorder; sets an interval to rotate every `chunkMs`
- **`stop()`** — clears interval, stops current recorder, releases tracks, nulls stream. Idempotent and safe to call repeatedly
- **`rotateChunk()`** — calls `recorder.stop()`; the `onstop` handler then bundles chunks into a `Blob`, emits it via `onChunk(blob, startedAt, endedAt)`, and — if we're not shutting down — immediately starts a fresh `MediaRecorder` on the same stream
- **Error paths** — `getUserMedia` failures mapped to human-readable messages ("Microphone permission denied." vs "Could not access microphone."); `MediaRecorder` errors forwarded via `onError` without crashing the session
- **`stopping` flag** ensures the final `onstop` doesn't spawn a zombie recorder after shutdown

### 3. `lib/useRecordingController.ts` — React orchestration hook

The glue between the recorder, the session store, and the API. Not a component — a hook.

Responsibilities:
- Reads the Groq API key from the settings store **lazily at start time** (so changes in Settings take effect on the next recording without re-mounting the hook)
- On `start()`: calls `reset()` to clear any prior session, sets `isRecording: true`, spins up a `ChunkedRecorder`
- On each chunk: generates a `crypto.randomUUID()`, inserts a `transcribing` placeholder into the session store, fires `transcribeWithRetry()` asynchronously (no `await` — later chunks don't block on earlier ones)
- On `stop()`: halts the recorder, flips `isRecording: false`
- `useEffect` cleanup tears down the recorder if the component unmounts mid-session

**`transcribeWithRetry()`** — 3 attempts with exponential backoff `[300, 1200, 4800]` ms. Distinguishes retriable (429/5xx) from terminal (4xx) failures. On exhaustion calls `failChunk(id, message)` so the specific chunk row in the UI shows the error without affecting siblings.

### 4. `lib/time.ts` — formatting helpers

- `formatElapsed(ms)` → `"0:42"` / `"12:05"` for the recording timer
- `formatClock(timestamp)` → `"14:08:30"` for transcript + export stamps

Small enough to inline, but centralizing now means Stage 5's export uses identical formatting for free.

### 5. `store/useSessionStore.ts` — in-memory session state

New Zustand store (no `persist` middleware — this state is intentionally ephemeral).

Exposes:
- **State:** `isRecording`, `startedAt`, `chunks: TranscriptChunkWithStatus[]`
- **Mutations:** `setRecording`, `addPendingChunk`, `resolveChunk`, `failChunk`, `reset`
- **Selectors used by later stages:**
  - `fullTranscriptText()` — concatenates all `done` chunks (Stage 4 chat grounding)
  - `recentTranscriptText(seconds)` — time-windowed slice (Stage 3 live suggestions)

The chunk status type (`"transcribing" | "done" | "error"`) is what powers the inline badges in the transcript UI.

### 6. Header wiring + live timer

Updated `components/Header.tsx`:

- Mic button now triggers the passed-in `onToggleRecording` handler (wired to the controller in `page.tsx`)
- Added a **`RecordingTimer`** subcomponent — reads `startedAt` from the session store, keeps a local `now` state updated every second via `setInterval`, renders `formatElapsed(now - startedAt)` in monospace with `tabular-nums` so digits don't jiggle
- Timer renders only while recording

### 7. Transcript panel wiring

Rewrote `components/TranscriptPanel.tsx`:

- Subscribes to `chunks` + `isRecording` from the session store
- Renders each chunk with its wall-clock timestamp + status icon:
  - `transcribing` → purple spinner, italicized "…" body
  - `done` → plain text (or `(silence)` if the chunk is empty)
  - `error` → red alert icon + italic red error message
- **Smart auto-scroll:** by default pinned to bottom; if the user scrolls up more than 40px, auto-scroll pauses; scrolling back near the bottom re-enables it
- Empty state now context-aware — different copy for "not started" vs "listening (first chunk pending)"

### 8. `app/page.tsx` — controller integration

- Replaces the local `isRecording` state with values from `useRecordingController()`
- New `onToggleRecording` is `async` — `await start()` bubbles mic-permission / API-key errors up to a **dismissible red error bar** between the header and the panels
- TranscriptPanel no longer receives props — it reads from the session store directly, keeping the page component thin

---

## Files Added / Modified

### Added
| Path | Purpose |
|------|---------|
| `app/api/transcribe/route.ts` | Multipart proxy → Groq Whisper Large V3 |
| `lib/recorder.ts` | `ChunkedRecorder` with MIME fallback + restart pattern |
| `lib/useRecordingController.ts` | Orchestration hook: recorder ↔ store ↔ API + retry |
| `lib/time.ts` | `formatElapsed` + `formatClock` helpers |
| `store/useSessionStore.ts` | In-memory chunks, recording state, selectors |

### Modified
| Path | Change |
|------|--------|
| `app/page.tsx` | Wired controller; added dismissible error bar |
| `components/Header.tsx` | Real start/stop + live elapsed timer |
| `components/TranscriptPanel.tsx` | Chunk rendering, status badges, smart auto-scroll |

No Stage 1 files were removed.

---

## Verification

| Check | Result |
|-------|--------|
| `ReadLints` on full project | No errors |
| `npm run build` | Compiled successfully; `/api/transcribe` registered as dynamic (`ƒ`) route |
| `npm run dev` + HTTP smoke test | 200 OK |
| Manual UI walkthrough | Timer ticks, chunks appear every 30s with spinner → text, auto-scroll respects manual scroll-up |

---

## Known Tradeoffs (documented in code)

1. **No cross-chunk overlap** — ~50–150ms of audio is lost at each 30s boundary during the stop/start handoff. Stage 5 can add dual staggered recorders if dogfooding reveals meaningful word loss.
2. **Last partial chunk on stop** — if the user stops at 0:47, the final ~17s snippet is still bundled and transcribed. Correct behavior; mentioned for completeness.
3. **Safari untested** — MIME fallback to `audio/mp4` is coded but not empirically verified. Chrome/Edge/Firefox prefer webm/opus which we test against.
4. **Retry ceiling ~6.3s** — slower than the 30s chunk interval, so at worst a backed-off retry finishes before the next chunk's transcription call kicks off. Fine in practice; a sustained outage would show `error` badges on consecutive chunks without blocking the mic.

---

## Snags & Learnings

1. **`MediaRecorder` timeslice vs restart** — the first thing I tried mentally was `start(30000)` with an interval that reads `dataavailable`. Burned 5 minutes before remembering that continuation blobs in WebM lack the EBML header. Restart is the clean answer; the added stop/start gap is an acceptable cost.
2. **Route handler runtime** — Next.js App Router defaults to `edge` runtime for `api/*`, which lacks the full `FormData` + `Blob` → fetch-with-multipart story. Explicit `export const runtime = "nodejs"` prevents silent breakage.
3. **Lazy API key read** — reading `useSettingsStore.getState().groqApiKey` inside `start()` rather than at hook mount means the user can paste a key, close settings, and immediately hit Start without a re-render dance.
4. **Smart scroll threshold** — 40px feels right. Too small (like 5px) and jitter near the bottom flickers auto-scroll on/off.

---

## Deliverables Checklist

- [x] Working mic capture, 30s chunking, Whisper transcription end-to-end
- [x] Graceful error handling at every layer (permission, API, network)
- [x] Clean separation: recorder ≠ controller ≠ store ≠ UI
- [x] Type-safe throughout — no `any`, no `@ts-ignore`
- [x] Selectors in place (`fullTranscriptText`, `recentTranscriptText`) that Stage 3 and Stage 4 will consume without refactors

### Deferred to later stages (by design)

- Suggestion generation → **Stage 3**
- Chat streaming → **Stage 4**
- Cross-chunk audio overlap → **Stage 5** (if dogfooding demands)
- Telemetry around chunk latency → **Stage 5**

---

## Next Up — Stage 3

**Live Suggestions Engine (the core of the grade).** Build the 3-cards-every-30s generator:
- Suggestion types, strict JSON output, diversity rules, anti-repetition across batches
- Rolling session summary to keep long meetings coherent
- Tight prompt for preview-must-stand-alone value
- Cards panel with new-batch-on-top behavior + skeleton loaders

This is where the grade actually lives — budget the full stage on prompt iteration against recorded sample conversations.
