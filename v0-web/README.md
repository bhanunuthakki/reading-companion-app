# Reading Companion v0 — Browser Prototype

The minimal end-to-end loop of the [staged roadmap](../staged-roadmap.md)'s **Moment 1: "Pull the literature."** You point a phone camera at a book page, ask a question out loud, and a synthesized ~50-word answer with citations comes back over your speakers (or through paired Ray-Ban Meta open-ear speakers).

Deployed as **Vercel functions + static frontend**. No local server, no tunnel, no ngrok session timeouts. Bookmark the URL on your phone, open it, go.

## Fastest path to test on your phone (≈3 minutes one-time setup)

You'll need a free Vercel account and a Gemini API key. Then:

```bash
cd <repo-root>/v0-web

# 1. Install the Vercel CLI (one time, globally)
npm install -g vercel

# 2. Log in (opens a browser; sign in with GitHub / Google / email)
vercel login

# 3. Link & deploy (asks 4-5 questions; accept all defaults)
vercel

# 4. Add your Gemini API key as a production env var
vercel env add GEMINI_API_KEY production
# (paste the key when prompted, hit enter)

# 5. Redeploy with the env var
vercel --prod
```

The final command prints a URL like `https://reading-companion-v0-web-xxxx.vercel.app`. **That's your forever URL.** Bookmark it on your phone, open it in Chrome, grant camera + mic permissions, tap **Ask**, speak a question while pointing at a book page.

Your laptop does not need to be running. The Vercel serverless functions sit there waiting for requests.

### Subsequent code changes

```bash
vercel --prod
```

That's it. New URL is the same URL (Vercel pins your project domain).

## Testing on Ray-Ban Meta Gen 1

The glasses can't expose their camera to a browser — Meta's DAT SDK is Android-native only, no Web bindings. But they **can** play audio and capture mic over Bluetooth, which is enough for v0 if the phone holds the camera.

Setup:

1. Pair RBM Gen 1 with your Android phone via the Meta View app, as normal.
2. In Bluetooth settings, confirm audio output routes to "Ray-Ban Meta."
3. Open your Vercel URL in **Chrome on the phone**. Grant camera + mic permissions.
4. Wear the glasses, hold the phone above the book with the camera facing the page, tap **Ask**, speak.
5. The TTS response plays through the glasses' open-ear speakers. Your eyes stay on the page.

Caveats:
- The mic input still comes from the phone, not the glasses. Web browsers can't currently pick a specific Bluetooth mic over the system default. If background noise is a problem, hold the phone closer.
- Latency: expect 2-4 seconds end-to-end on Gemini Flash. Grounded search adds ~1s vs. a vanilla call.

## Local development (optional)

For iterating on the UI without redeploying every change:

```bash
cp .env.example .env.local
# edit .env.local and paste your GEMINI_API_KEY
npm install
vercel dev
```

Opens at `http://localhost:3000`. Camera access works on localhost without HTTPS. Hot reload on file save.

## What's wired up

```
v0-web/
├── api/
│   ├── research.js     # Vercel serverless function: POST { image_base64, question } → { answer, citations }
│   └── health.js       # GET /api/health → { ok, model, keyConfigured }
├── index.html          # Single screen — camera, button, log
├── app.js              # Camera init, webkitSpeechRecognition, frame capture, fetch, speechSynthesis, card rendering
├── styles.css          # Mobile-first dark mode, responsive ≥768px
├── package.json        # Just @google/generative-ai
├── vercel.json         # 30s function timeout (Hobby tier max)
├── .env.example        # GEMINI_API_KEY template (local dev only — prod uses Vercel env vars)
└── README.md
```

Loop: tap **Ask** → `SpeechRecognition` listens → silence ends recording → capture one camera frame → POST to `/api/research` → Gemini Flash with grounded search → returns text + citations → `speechSynthesis` speaks the answer → card renders.

## What's NOT in v0 (and where it lives in the roadmap)

- No parallel research agents (one Gemini call, not the fan-out architecture). → Stage 0 Moment 1 enhancement.
- No standing watchers (background topic monitoring while you read). → Stage 0 Moment 3.
- No cross-text linkage (correlating to prior reading). → Stage 0 Moment 2.
- No page-change detection. → Stage 1.
- No `VoiceSession` abstraction (direct Gemini call). → Stage 1, when adding Gemini Live for true streaming.
- No session log persistence. → Stage 1.

See [staged-roadmap.md](../staged-roadmap.md) for the full progression and the beautiful moments at each hardware unlock.

## Cost ballpark

Gemini 2.5 Flash with grounded search: roughly **$0.0003 per query** (a ~50KB JPEG + <50 token question + <100 token answer). 1000 queries ≈ 30¢. The free tier covers more than enough for personal prototyping.

Vercel Hobby tier is free, with 100GB-hr serverless function execution per month — also plenty.

## Swapping in Gemini 3.5 Flash

Once `gemini-3.5-flash` (announced at I/O 2026) hits the public API:

```bash
vercel env add GEMINI_MODEL production
# enter: gemini-3.5-flash
vercel --prod
```

The roadmap addendum projects ~4× speedup and <50% cost. No code changes needed.

## Swapping in a different model entirely

Pull `api/research.js`'s Gemini logic into a `lib/researchProvider.js` module with a `research({ imageBase64, question }) → { answer, citations }` signature. Then write an alternate provider (Anthropic Claude with web search tool, or TML-Interaction-Small when that preview opens). The browser side doesn't change. This is the v1 step — see the `VoiceSession` interface sketch in [architecture.md](../architecture.md).

## Fallback: local server + tunnel (if you don't want to deploy)

If you'd rather keep everything local and just expose your laptop's port over an HTTPS tunnel:

```bash
# Install cloudflared (one time): winget install cloudflare.cloudflared
# Or: scoop install cloudflared

vercel dev   # in one terminal
cloudflared tunnel --url http://localhost:3000   # in another
```

Cloudflared prints a temporary `https://*.trycloudflare.com` URL — no signup needed. Open that on your phone.

Vs. ngrok: no account, no session timeout, just works. Vs. Vercel deploy: laptop must stay on, URL changes each restart. Vercel is still simpler unless you're actively editing code.
