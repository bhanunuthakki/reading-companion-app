# Thought Partner — phone web client (M1)

The "felt vertical slice, phone-only" from [thought-partner-spec.md §10](../../thought-partner-spec.md): a phone-shaped single-page client for the Core's WS v2 + REST contract ([core/README.md](../../core/README.md)). Vanilla HTML/CSS/JS, **no build step, no npm package** — same conventions as `v0-web/`. The Core serves it statically at `/app`.

## Run

```bash
cd core
npm install
npm start            # http://localhost:4000
# open http://localhost:4000/app
```

Everything works **offline** (no `GEMINI_API_KEY`): fast asks return the canned answer, background asks return a mock digest after ~2.5 s (`MOCK_DIGEST_DELAY_MS`) — that delay is the "background work" feel.

## What's on screen

- **Glasses simulator strip** (top) — a wear toggle (sends `{type:"wear"}`; the Core defaults to *not worn*, so leaving it off routes every delivery to the phone at `hold`), the amber badge surface, and a log of each delivery labeled with its etiquette level (`hold | badge | earcon | speak`). `earcon` plays a WebAudio tone; `speak` reads the tldr aloud; `hold` shows nothing here — the digest waits in its thread with a "delivered to phone" note.
- **Thread rail** — newest-first from `GET /api/threads`, plus "+ new". The active thread shows turns, live job-status chips (`job_update`), and digests: tldr prominent, body/citations/followups expandable.
- **Politeness ceiling** — per-thread `deliveryCeiling` selector, `PATCH /api/threads/:id`. Set it to `hold` and watch the next delivery clamp.
- **Memory search** — `GET /api/memory/search`, hits link to their threads.
- **Ask bar** — text + Enter, hold-to-talk mic (Web Speech API; hidden when unsupported), and capture: camera preview → snap (≤1024px JPEG) or file upload → `{type:"capture"}`; the stored capture chip attaches to your next ask. Questions with markers like *literature / compare / sources / find papers* route background ("On it — I'll come back"); short definitional ones answer fast and are spoken.

The WS reconnects with backoff and re-sends wear state; REST is the source of truth, so reloads lose nothing. Offline capture extracts render as "extraction unavailable (offline)", never as content.

## Smoke test

With the Core running (`npm start` in `core/`):

```bash
node clients/web/smoke.mjs   # PASS: capture → ask → badge deliver → PATCH hold → held deliver
```

## Files

`index.html` · `styles.css` · `app.js` (orchestration) · `net.js` (WS + REST) · `media.js` (camera/mic/TTS/earcon) · `smoke.mjs`
