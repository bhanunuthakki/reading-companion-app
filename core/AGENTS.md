# Reading Companion Core instructions

The repository root owns product semantics, capture consent, privacy, state authority and delivery
claims. `README.md` here owns protocol details, persistence variables and recovery behavior.

Node ≥20, ESM, strict TypeScript; one WebSocket per live Session plus Express REST. Run from `core/`:
`npm install`, then `npm run typecheck` and `npm test` (Vitest). No linter is configured. `npm start`
uses `tsx` with `PORT` default 4000; `npm run dev` watches. No-key mocks support local voice/research
work, but no-key enrichment may still call public services; no API key is not evidence of no egress.
Use the existing fakes for offline tests and isolate store directories when testing state.

Validate external/structured data with Zod. The installed model SDK is `@google/genai`; provider
mechanics stay behind the existing voice/research/capture seams. Keep new network error paths behind
`src/redact.ts`. Core test success does not establish browser, emulator, device or deployment success;
read the affected client's README for its own verification.
