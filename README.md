# Reading Companion

An ambient research companion for smart glasses and serious readers. Tap the glasses or
ask about a concept on the page you are reading; the system captures page context,
dispatches background research, and whispers answers in your ear while you keep reading.

## Architecture

- **`core/`**: Shared Node.js / TypeScript service (`reading-companion-core`). Strict TypeScript,
  Express REST API + WebSocket per active reading session. Boots with zero API keys using
  mock voice and research providers; upgrades to Gemini Live / OCR when keys are configured.
- **`v0-web/`**: Static HTML/CSS/JS web demo client for testing the Core service in a browser.
- **Design & Platform Specs**: Comprehensive architecture docs, platform trade-offs, and
  sensor integration guides for Meta Ray-Ban Display and Android XR (Google Glimmer).

## Quick Start (Core Service)

```bash
cd core
npm install
npm run dev
```

Runs the REST + WebSocket server on port 4000.

Run checks:
```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest suite
```

## Privacy & Device Constraints

- Capture is gesture-driven: cameras and microphones only activate on explicit request.
- No raw images or audio are stored permanently; only minimal derived session context is kept.
