# Ray-Ban Display Web App

The 600×600 additive display UI — what renders **on the glasses**. Runs in any browser: Meta maps Neural Band gestures to **arrow keys + Enter** on the page, so a 600×600 browser window IS the official preview surface.

## Try it

```bash
cd ../../../core && npm start        # Core serves this app at /glasses
# open http://localhost:4000/glasses  → size the window/viewport to 600×600
```

Standalone hosting also works (`npx http-server -p 5601 .` then `?core=ws://localhost:4000/ws`).

## Controls (Neural Band grammar)

| Browser | Neural Band | Effect |
|---|---|---|
| ← → ↓ | thumb-swipe | move focus |
| Enter | pinch | activate / open digest badge |
| ↑ | swipe up | dismiss card or badge |

Dock actions send **canned questions** as the browser stand-in for speech (on real glasses the paired DAT-Android app streams the spoken question; this surface has no mic by platform rule): **Research** → background ask (watch the status chip: on it… → researching… → digest ready → amber badge; Enter expands it to a TLDR card with ≤3 citations), **Quick** → fast-path answer card, **Watch** → arms a watcher badge.

It sends `wear worn:true` on connect (this surface is on-face by definition), so deliveries route to the glasses per the etiquette ladder; `hold`-level deliveries stay on the phone and the stage says so.

Design rules followed (from `xr-glasses-dev-guide/10-design-patterns.md`): black = transparent on the waveguide, bright high-contrast UI on near-black, bold sans, sparse layout, focus = bright outline, one thing on stage at a time, no free-form text entry, body text never renders on glasses — TLDR + citation titles only, full digest on the phone.
