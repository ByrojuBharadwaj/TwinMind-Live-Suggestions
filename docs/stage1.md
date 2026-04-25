# Stage 1 — Foundation & Settings

**Status:** Complete
**Duration:** ~Day 1 of 10
**Goal:** Ship a working UI shell with persistent settings so Stages 2–5 can focus entirely on audio, prompts, and AI.

---

## Objective

Build the *empty shell* of the TwinMind Live Suggestions app — visible three-column layout, settings modal that persists across reloads, and a deploy-ready scaffold — **before** any audio capture or Groq API calls. This de-risks the boring-but-critical plumbing (routing, state management, API key storage, deployment target) so later stages can focus entirely on the parts that actually affect the grade.

**Exit criteria (all met):**
- [x] App builds without errors (`npm run build` passes)
- [x] Dev server returns HTTP 200 at http://localhost:3000
- [x] Three-column dark UI renders correctly
- [x] Settings modal opens, edits round-trip, persists across reloads
- [x] "Start mic" button stays disabled until an API key is saved
- [x] No TypeScript or ESLint errors

---

## Steps Performed

### 1. Decisions Locked Before Coding

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Framework | **Next.js 14 (App Router)** + TypeScript | Vercel deploy in one click; API routes handy for Stage 2+ proxying |
| Styling | **Tailwind CSS** | Fastest path to a polished dark UI; reviewer-friendly defaults |
| State management | **Zustand** + `persist` middleware | Minimal boilerplate; localStorage persistence out of the box |
| Icons | **lucide-react** | Clean, tree-shakeable, consistent stroke width |
| Package manager | **npm** | Windows default, no extra install |
| Folder layout | **No `src/` directory** | Shorter import paths (`@/components/...`) |
| Import alias | `@/*` | Next.js convention |

### 2. Scaffolding

Ran `create-next-app` with flags for a non-interactive, opinionated setup:

```bash
npx create-next-app@14 twinmind-live-suggestions \
  --typescript --tailwind --app --eslint \
  --no-src-dir --import-alias "@/*" --use-npm
```

**Snag encountered:** First attempt used `TwinMind-LiveSuggestions` (capital letters). npm rejected the package name (npm hasn't allowed capitals in package names for years). Recovery: switched to lowercase `twinmind-live-suggestions`.

Result: Next.js 14.2.35, TypeScript, Tailwind v3, ESLint, and a git repo initialized automatically.

### 3. Extra Dependencies

```bash
npm install zustand lucide-react clsx
```

- `zustand` — state store with `persist` middleware
- `lucide-react` — UI icons (Mic, Settings, Download, Send, etc.)
- `clsx` — conditional className joining

### 4. Files Created

#### `config/defaults.ts`
Centralized home for default prompts and tunable numeric parameters:

- `liveSuggestionsPrompt` — placeholder (finalized in Stage 3)
- `detailedAnswerPrompt` — placeholder (finalized in Stage 4)
- `chatPrompt` — placeholder (finalized in Stage 4)
- `suggestionContextWindowSec` = **90**
- `expandedAnswerContextWindowSec` = **0** (0 means "use full transcript")
- `refreshIntervalSec` = **30**

Single source of truth — both the Zustand store and the "Reset to defaults" button pull from here.

#### `types/index.ts`
Shared TypeScript contracts used across panels and future API routes:

- `Suggestion`, `SuggestionBatch`, `SuggestionType` — the 5 suggestion categories
- `TranscriptChunk` — audio-to-text chunks with timestamps
- `ChatMessage`, `ChatRole` — with optional `sourceSuggestionId` back-reference for export fidelity
- `AppSettings` — mirrors the shape of the Zustand store

#### `store/useSettingsStore.ts`
Zustand store with three responsibilities:

1. Hold the user's Groq API key and prompt/numeric settings in memory
2. Persist them to `localStorage` under key `twinmind-settings` (versioned `v1`)
3. Expose `setApiKey`, `updateSettings`, and `resetToDefaults` mutators

The API key is **never** sent to any server we control — it's stored client-side only and will be passed as a per-request header to Groq starting Stage 2.

#### `app/globals.css`
Dark theme design tokens as CSS custom properties:

- `--background: #0b0d10` — near-black canvas
- `--panel: #12151a` — slightly lifted panel surfaces
- `--panel-border: #1f242c` — subtle column dividers
- `--accent: #7c5cff` — purple brand accent (matches TwinMind vibe)
- `.scrollbar-thin` utility for consistent slim scrollbars across all panels

#### `app/layout.tsx`
- Updated metadata: title "TwinMind — Live Suggestions", proper description
- Removed scaffolded Geist font setup (system font stack renders crisply on dark and keeps the bundle lean)
- Root html gets `className="dark"` for downstream components that may hook into dark-mode variants

#### `app/page.tsx`
Client component that wires the three-column shell together:

- Holds the `settingsOpen` and `isRecording` UI state
- Renders `<Header>`, three panels in a CSS grid, and the `<SettingsModal>`
- Passes `isRecording` + toggle handler down to `Header` and `TranscriptPanel`

#### `components/Header.tsx`
- TM logo tile (gradient purple square)
- **Amber "Add Groq API key" banner** — renders only when no key is saved, clicks open the settings modal
- **Start mic / Stop button** — primary purple when idle, red with pulsing dot when recording; **disabled until an API key exists** with a helpful tooltip
- Export button (stub — icon only, wired up in Stage 5)
- Settings gear

#### `components/TranscriptPanel.tsx`
- Header with "TRANSCRIPT" label and a "recording" indicator (red pulse) when active
- Scrollable body with an empty-state icon + instructions
- Stub ready for Stage 2 to populate with `TranscriptChunk[]`

#### `components/SuggestionsPanel.tsx`
- Header with "LIVE SUGGESTIONS" label and a Refresh button (disabled in Stage 1)
- Empty state encourages starting the mic
- Stub ready for Stage 3 to populate with `SuggestionBatch[]`

#### `components/ChatPanel.tsx`
- Header, scrollable messages area, sticky composer at bottom
- Textarea + send button both disabled until a session exists
- Stub ready for Stage 4 streaming integration

#### `components/SettingsModal.tsx`
The most substantive Stage 1 component. Features:

- Click-outside-to-close backdrop with blur
- **Escape key closes** the modal
- Internal `draft` state so in-progress edits don't commit until **Save** is pressed (Cancel discards)
- **API key field** with a show/hide eyeball toggle and monospace font
- **Context windows section** — three side-by-side number inputs with hints
- **Three prompt textareas** — monospaced, resizable, ~5 rows default
- **Reset to defaults** button (bottom-left) — pulls from `config/defaults.ts`
- **Cancel / Save** button pair (bottom-right)

#### `.env.example`
Explicitly documents that **no server-side environment variables are used**. This prevents future contributors (and the interviewer reviewing the repo) from wondering why there's no `.env` setup.

#### `README.md`
Rewrote the scaffolded README to include:
- Stack explanation
- Setup commands
- Project structure overview
- 5-stage roadmap table with current progress
- Link back to `../planning.md` for the full plan

### 5. Verification

| Check | Result |
|-------|--------|
| `ReadLints` on the whole project | No errors |
| `npm run build` | Compiled successfully, 5 static pages generated, 7.07 kB page size |
| `npm run dev` | Ready in 5.7s on `http://localhost:3000` |
| HTTP smoke test | `Invoke-WebRequest http://localhost:3000` → **200** |
| Manual UI smoke test | Three columns render, settings modal opens/edits/persists, mic button correctly gated by API key presence |

---

## Final Directory Structure

```
twinmind-live-suggestions/
├── app/
│   ├── fonts/                    # scaffold leftover (harmless, unused)
│   ├── favicon.ico
│   ├── globals.css               # dark theme tokens + scrollbar utility
│   ├── layout.tsx                # root layout, metadata
│   └── page.tsx                  # three-column shell + modal wiring
├── components/
│   ├── ChatPanel.tsx
│   ├── Header.tsx
│   ├── SettingsModal.tsx
│   ├── SuggestionsPanel.tsx
│   └── TranscriptPanel.tsx
├── config/
│   └── defaults.ts               # single source of truth for defaults
├── store/
│   └── useSettingsStore.ts       # Zustand + localStorage persist
├── types/
│   └── index.ts                  # shared TS contracts
├── .env.example                  # documents no server env needed
├── .eslintrc.json
├── .gitignore
├── next-env.d.ts
├── next.config.mjs
├── package.json                  # next 14.2.35, react 18, zustand 5, lucide-react, clsx
├── package-lock.json
├── postcss.config.mjs
├── README.md
├── tailwind.config.ts
└── tsconfig.json
```

---

## Deliverables

- [x] Next.js 14 + TypeScript + Tailwind scaffold committed locally
- [x] Three-column dark UI matching the reference prototype layout
- [x] Full settings modal (API key + 3 prompts + 3 numeric params + reset)
- [x] Client-side state persistence via Zustand + localStorage
- [x] README documenting stack and progress
- [x] Type-clean, lint-clean, build-clean
- [x] Dev server runs and serves 200

### Deferred to later stages (by design)

- Actual microphone recording → **Stage 2**
- Groq Whisper transcription calls → **Stage 2**
- Suggestions engine & prompt engineering → **Stage 3**
- Streaming chat & expanded answers → **Stage 4**
- Export, latency audit, Vercel deploy, dogfooding → **Stage 5**

---

## Snags & Learnings

1. **npm package naming** — capitals are forbidden. Folder auto-naming in `create-next-app` means you need a lowercase project name from the start. Not a blocker, just a small restart.
2. **Font strategy** — the default Geist font setup loads two local `.woff` files. Stripped it out in favor of the system font stack to shave a request and keep things simple. If polish demands a custom font in Stage 5, it's a 5-minute add.
3. **State persistence pattern** — using Zustand's `persist` middleware with a `version` field means future breaking changes to the settings shape can be migrated cleanly without wiping users' saved prompts.

---

## Next Up — Stage 2

**Audio Capture + Whisper Transcription.** Wire up `MediaRecorder` with 30-second chunks + 2–3s overlap buffers, build the `/api/transcribe` route that proxies to Groq's Whisper Large V3 with the user's saved key, populate the transcript panel in real time, and handle the edge cases (permission denied, tab backgrounding, retry/backoff on 429s).
