# Reading Companion interface contract

This contract owns cross-surface interaction invariants. Each client README owns its exact run command, implemented controls, and device-specific limitations.

## Primary task and hierarchy

The reader captures or references a page, asks a question, keeps reading while research runs, and receives the least disruptive useful result. The active reading/research state comes first; settings, diagnostics, and history are secondary.

## Cross-surface invariants

- Make capture, listening, research, delivery, held, failed, and offline/mock states perceptible.
- Preserve the Core's thread and delivery semantics. A client may reduce presentation for its hardware, but it may not silently change state meaning.
- Prefer one clear next action and progressive disclosure. Glasses show glanceable status, badges, TLDR, and citation titles; detailed bodies and configuration stay on phone/browser surfaces.
- Support interruption, reconnect, cancellation, and not-worn behavior without fabricating completion.
- Use high-contrast focus and state cues that do not rely on color alone. Keep touch targets usable on phone surfaces and keyboard/gesture focus explicit on glasses previews.
- Never render raw hidden prompts, credentials, uncensored captures, or nearby conversation. Quoted page content and external evidence remain distinguishable and attributable.

## Surface evidence

- Core-served phone web: run the Core, inspect `/app` at a narrow phone viewport, and run `node clients/web/smoke.mjs`.
- Meta 600×600 preview: inspect `/glasses` at exactly 600×600 and exercise keyboard mappings documented in `clients/meta-rbd/web-app/README.md`.
- Android clients: use each client's Gradle commands and distinguish JVM tests, emulator evidence, and physical-device evidence.
- Vercel prototype: use `v0-web/package.json` and its README; a local render does not prove deployment.

Record only the surfaces actually checked. Shared Core tests do not substitute for rendered or device evidence.
