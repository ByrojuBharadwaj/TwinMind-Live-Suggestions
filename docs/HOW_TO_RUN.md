# How to Run the TwinMind Live Suggestions App

A step-by-step guide to cloning, installing, configuring, and running the app
locally — plus troubleshooting, deployment, and what to expect the first time
you hit **Start mic**.

---

## TL;DR

```bash
cd twinmind-live-suggestions
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000), click the **gear
icon** (top-right), paste your Groq API key, save, and hit **Start mic**.

No `.env` file. No Docker. No backend to deploy. That's it.

---

## 1. Prerequisites

You need **all three** before the app will work.

### 1.1 Node.js 18.17 or newer

Next.js 14 requires Node 18.17+. Node 20 LTS is recommended.

Check your version:

```bash
node --version
```

If the number printed is lower than `v18.17.0`, install a newer version:

- **Windows / macOS**: download from [nodejs.org](https://nodejs.org/) (pick the LTS)
- **Or use `nvm`** (recommended if you juggle Node versions):
  ```bash
  nvm install 20
  nvm use 20
  ```

### 1.2 A modern Chromium-based browser

The app uses the `MediaRecorder` API, which is most reliable on:

- Google Chrome 90+
- Microsoft Edge 90+
- Firefox 100+

> Safari works but has historically had quirky `MediaRecorder` behavior with
> WebM. If something breaks on Safari, try Chrome first before filing it as a
> bug.

### 1.3 A Groq API key

The app is BYOK (bring-your-own-key). It does **not** ship with a key, and no
key is stored on any server.

1. Go to [console.groq.com](https://console.groq.com/keys).
2. Sign up (free) and create a new API key.
3. Copy it. You'll paste it into the app in a moment.

---

## 2. Install

From the repository root:

```bash
cd twinmind-live-suggestions
npm install
```

This installs:

- `next@14.2.35`, `react@18`, `react-dom@18`
- `zustand@5` (state), `lucide-react` (icons), `clsx` (class helpers)
- `tailwindcss@3.4` + `typescript@5` (dev)

Expect ~30-60 seconds on a warm npm cache.

---

## 3. Run the dev server

```bash
npm run dev
```

You'll see:

```
▲ Next.js 14.2.35
- Local:        http://localhost:3000
✓ Ready in ~1s
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 4. Configure your Groq key (one time)

When you first load the app, the header shows a yellow banner:
**"Add your Groq API key in Settings to start."**

1. Click the **gear icon** in the top-right.
2. Paste your Groq API key into the **Groq API Key** field.
3. (Optional) Tweak the three prompts or the numeric parameters.
4. Click **Save**.

The key is stored in your browser's `localStorage` under the key
`twinmind-settings`. It never leaves your machine except as a `Bearer` header
on requests to `/api/*` — which proxy straight to Groq. The Next.js server
does not persist it.

---

## 5. Start a session

1. Click **Start mic** (top-right).
2. Your browser asks for microphone permission → click **Allow**.
3. Speak naturally. The **Transcript** panel fills in as 30-second chunks
   are transcribed by Whisper Large V3.
4. The **Live Suggestions** panel auto-refreshes with 3 contextual cards as
   the conversation progresses.
5. Click any suggestion card → its expanded answer streams into the **Chat**
   panel on the right.
6. Ask free-form follow-up questions in the chat input. Responses stream
   token-by-token; hit **Stop** to cancel mid-stream.
7. Click **Stop mic** to end the session.
8. Export your session via the **download icon** (JSON or plain text).

---

## 6. What happens when you click Start mic

This is worth knowing so nothing feels mysterious:

1. **Pre-flight gate** (Stage 5.1 addition) — the app instantly checks:
   - Does your browser support `MediaRecorder` + `getUserMedia`?
   - Is the connection secure (HTTPS or localhost)?
   - Is a mic plugged in?
   - Is your Groq API key valid? (one quick ping to Groq's `/v1/models`)

   If any check fails, a red banner shows an actionable message and the mic
   never turns on. You won't wait 30 seconds to discover a typo in your key.

2. **Chunked recording** begins. Every 30 seconds, a closed WebM blob is
   POSTed to `/api/transcribe`, which forwards it to Groq's Whisper endpoint.

3. **Suggestions loop** runs after the first chunk lands, then every time new
   transcript text arrives (debounced). It calls `/api/suggestions`, which
   asks `openai/gpt-oss-120b` for three structured suggestion cards.

4. **Rolling summary** regenerates every 3rd suggestion batch so the model
   keeps long-range context without re-ingesting the full transcript each
   call.

---

## 7. Build and run for production

```bash
npm run build
npm run start
```

`npm run build` compiles TypeScript, runs ESLint, and produces an optimized
build under `.next/`. `npm run start` serves it on port 3000.

For a quick smoke test of the build without starting the server:

```bash
npm run build
```

Exit code 0 + 10/10 static pages generated = you're good.

---

## 8. Deploy to Vercel

The app is a vanilla Next.js 14 App Router project with zero server-side
environment variables, which makes it ideal for Vercel's free tier.

1. Push the `twinmind-live-suggestions/` folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. **Do not** add any environment variables.
4. Click **Deploy**.
5. Once live, open the Vercel URL, click the gear icon, paste your Groq key,
   and start using the app.

The key still lives only in the end user's browser. Different users on the
same deployment each use their own key.

---

## 9. Troubleshooting

### "Your Groq API key is invalid or expired."
Your key is wrong, expired, or revoked. Generate a fresh one at
[console.groq.com/keys](https://console.groq.com/keys) and paste it in Settings.

### "No microphone detected on this device."
No audio input device is visible to the browser. Plug in a mic / enable your
system's internal mic, then click **Start mic** again.

### "Microphone access requires a secure connection."
You're on plain HTTP. Either run on `localhost` (dev) or serve the app over
HTTPS (Vercel does this automatically).

### "This browser doesn't support audio recording."
You're on an old browser or a niche one without `MediaRecorder`. Switch to
Chrome, Edge, or Firefox.

### Transcript panel is empty but recording is on
Wait 30 seconds — the first chunk doesn't close until then by design. If
it's still empty after 45 seconds, check the browser devtools Network tab for
a failed `/api/transcribe` call and read the error payload.

### Suggestions never appear
They need transcript text first. Check that transcription is working (above),
then wait for at least one chunk to land — the first suggestions batch fires
shortly after.

### Chat replies never start streaming
Open devtools → Network → `/api/chat`. If you see a 4xx, check your key; if
you see a 5xx, Groq is rate-limiting you or the model is temporarily
unavailable — wait a minute and try again.

### Port 3000 is already in use
Run on a different port: `npm run dev -- -p 3001`.

### Build fails with a type error after editing code
`npm run build` runs strict TypeScript + ESLint checks. Read the first error
in the trace — subsequent ones are usually downstream. Fix it and rerun.

---

## 10. What you do not need

For clarity, none of these are required:

- ❌ A `.env` file (Groq key is a user setting, not a server secret)
- ❌ A database (sessions live in browser memory; export to download)
- ❌ Docker
- ❌ A separate backend service
- ❌ Any OpenAI / Anthropic / ElevenLabs keys (Groq only)
- ❌ `OPENAI_API_KEY` or any other environment variable

---

## 11. File structure cheat-sheet

If you want to poke around the code:

```
twinmind-live-suggestions/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           # streaming chat proxy (SSE)
│   │   ├── suggestions/route.ts    # live suggestions (JSON mode)
│   │   ├── summary/route.ts        # rolling session summary
│   │   ├── transcribe/route.ts     # Whisper audio proxy
│   │   └── validate-key/route.ts   # pre-flight key check
│   ├── page.tsx                    # main three-panel layout
│   ├── layout.tsx
│   └── globals.css
├── components/                     # Header, TranscriptPanel, SuggestionsPanel, ChatPanel, SettingsModal
├── config/
│   ├── defaults.ts                 # numeric defaults
│   └── prompts.ts                  # full LLM prompts (editable via Settings UI)
├── lib/
│   ├── recorder.ts                 # ChunkedRecorder (30s MediaRecorder loop)
│   ├── preflight.ts                # pre-flight checks
│   ├── groq.ts                     # shared Groq helpers + model IDs
│   ├── useRecordingController.ts
│   ├── useSuggestionsController.ts
│   ├── useChatController.ts
│   ├── export.ts                   # JSON + text export
│   └── time.ts
├── store/                          # Zustand stores (session, settings, suggestions, chat)
├── types/index.ts                  # shared interfaces
└── docs/                           # planning.md + stage1..5.md + this file
```

Reading order for a reviewer: `types/` → `store/` → `lib/` → `components/` →
`app/api/`. The data flow is top-down in that order.

---

## 12. Quick sanity check

If everything is set up correctly, this five-step test should pass:

1. `node --version` → 18.17+ ✓
2. `npm run dev` → boots without errors ✓
3. Open `localhost:3000` → three-panel UI renders ✓
4. Paste Groq key in Settings → yellow banner disappears ✓
5. Click **Start mic**, speak for 35 seconds → transcript appears, then suggestions ✓

If any step fails, check the matching section in **Troubleshooting** above.

---

Happy recording.
