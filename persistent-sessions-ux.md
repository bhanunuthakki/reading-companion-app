# Persistent Sessions — UX Design

How the companion behaves as a **persistent, resumable session** across the four content kinds — physical **book**, **Kindle**, **audiobook**, **podcast** — on both Meta Ray-Ban Display and Google Android XR. This is the design behind the `SessionManager` + `SessionStore` + `Cursor` model in [`core/`](core); terms are from [DEFINITIONS.md](DEFINITIONS.md).

## 1. The principle

A glasses interaction is a *glance*, not a session — but the **content engagement** is a session that can span weeks. So the session is not a chat you start over each time; it is **a place you return to**. Every glance attaches to the same persistent session for that title, which already knows where you are, what you've asked, what it has researched, and what you've asked it to watch for. You never re-introduce the book.

This is the inversion that makes glasses the right form factor: the *device* is glanceable, the *relationship with the content* is durable.

## 2. One model, four content kinds

A session is content-type-polymorphic. The only things that differ by kind are **how we capture context** and **what the cursor measures**:

| Kind | Capture (the "now") | Cursor | "What did they just say/show?" | Resume anchor |
|------|--------------------|--------|-------------------------------|---------------|
| **book** | camera → page-change detect → OCR | `PageCursor {pageId, paragraphIdx}` | current OCR'd page | page id |
| **kindle** | camera → OCR (same pipeline; e-ink/glare tuned) | `PageCursor` | current screen | page id / location |
| **audiobook** | rolling audio buffer (on-demand STT) | `TimeCursor {offsetSeconds}` | last N seconds, transcribed | timestamp |
| **podcast** | rolling audio buffer (on-demand STT) | `TimeCursor` | last N seconds, transcribed | timestamp |

Everything else — the dossier, research, tools, watchers, history, the three-layer reasoning (rolling/dossier/live-research) — is **identical** across kinds. `isVisualKind(kind)` is the only branch in the runtime, and it only chooses page-vs-time. (See `SessionManager.observePage` vs `advanceAudio`.)

The **dossier** is what makes audio kinds first-class without always-on transcription: on attach we fetch metadata, reviews, show-notes, and any published transcript into a `ContentDossier`, so "what's this episode about / what's the reception / what claim is this" is answerable from cache, and only "what did they *just* say" needs the rolling buffer.

## 3. Session lifecycle

```
            resolve + enrich (once per title)
   ┌──────────────────────────────────────────────┐
   ▼                                                │
 IDLE ──begin()──► READING (book/kindle)            │
                   LISTENING (audiobook/podcast)    │
                     │  ▲                            │
       user speaks   │  │ resume()                   │
       (barge-in)    ▼  │                            │
                  PAUSED_Q ──answer──► (back)        │
                                                     │
   any state ──"end"──► ENDED  (persisted; re-open resumes) ─┘
```

States are `SessionState` in the core. The interrupt edge (`PAUSED_Q`, driven by the VoiceSession's barge-in signal) is the felt differentiator: you can talk over the companion and it stops instantly. Every transition persists, so the session is always resumable from the last beat.

## 4. The three resume scopes

Locked during grilling: **glances**, **days-later (same title)**, **across-devices**. Cross-title linkage is deliberately deferred (the model leaves room: sessions are per-`ContentRef` documents that a future graph can join).

### 4.1 Glances within a sitting — "pick the glance back up"
You look up from the book to think, glance back. The session never closed; the cursor, the in-flight research, and the last answer are all still there. Mechanically this is the hot in-memory session; nothing to restore. UX: zero friction, no "welcome back," just continuity.

### 4.2 Days later, same title — "welcome back to page 184"
You open *Thinking, Fast and Slow* next Sunday. The companion recognizes the title (resolve), finds the existing session document (`SessionStore.load` by stable `sessionKey`), and greets you with continuity, not a blank slate:

> "Welcome back — you were on page 184, and you had me watching for the spotlight effect. Want the three citations I pulled last time?"

The resumed session carries: cursor, full turn history, the dossier (no re-enrichment), and all armed watchers. `SessionManager.resumed === true` drives the "welcome back" beat; a fresh session skips it.

### 4.3 Across devices — "start on the phone, finish on the glasses"
You started on the phone at lunch; you put the glasses on at home. Because both devices are thin clients of the **same Core**, they load the **same session document** by `ContentRef` — cross-device resume is automatic, no export/import. The session records `lastDeviceId` so the UX can acknowledge the move ("picking up from your phone"). The store is designed sync-ready (per-document, `updatedAt` + `deviceId`) so a future cloud `SessionStore` implements the same interface for multi-Core sync.

## 5. Attaching to content (per kind)

Attach = **resolve → enrich → begin**. The UX beat is "name it once, then forget the plumbing."

- **Book / Kindle.** Point the camera at the cover or a page. `ContentResolver` reads the cover/ISBN (or you just say the title); `OpenLibraryCatalog` canonicalizes it. First page-change fires OCR and seeds the `PageCursor`. *Beat:* a one-time "Reading *Sapiens* — got it" chip, then silence.
- **Audiobook.** From the player's metadata or "I'm listening to the *Sapiens* audiobook." `TimeCursor` starts at the reported position. *Beat:* "Following along."
- **Podcast.** From the app/RSS or "this is *Conversations with Tyler*, the Hofstadter episode." `iTunes`/feed enrichment pulls show-notes; published transcript URL if present. *Beat:* "Following along — I've got the show notes."

Enrichment runs **in the background** after `begin()`, so the session is usable instantly and gets richer a few seconds in (the dossier attaches when ready). A failed source never blocks the session (the enricher degrades; see `ContentEnricher.onError`).

## 6. Cross-device handoff flow

```
Phone (lunch)                         Glasses (home, same Core)
  open(ref) ─► session doc ───────────► open(ref) loads same doc
  cursor: time 18:30                     resumed=true, lastDeviceId="phone"
  turns: 2, watcher: "free will"         → "Picking up from your phone at 18:30.
  persist                                   Still watching for free will."
```

The hand-off is **effortless because there is nothing to hand off** — the state lives in the Core, not on a device. This matches the glasses↔phone rule from the design guide: glanceable state on glasses, the considered view (full history, citation list, the dossier) on the phone.

## 7. Standing watchers — persistent marginalia

A `Watcher` ("tell me when she revisits the spotlight effect") is armed in a session and persists across glances, days, and devices until it fires or you dismiss it. The `WatcherEngine` checks each new page (visual) or transcript segment (audio, when available) and fires a glanceable badge. This is "programmable margin notes": the book becomes interactive without writing in it, and the note survives the session being closed and reopened weeks later.

## 8. Battery shapes the feel (the escalation ladder)

Persistence must not mean "always-on camera," which kills BLE-tethered glasses in an hour. `CaptureOrchestrator` keeps the session alive at **IDLE** (mic only, video off), wakes to **ALERTED** (one still → OCR) on a page-turn cue or voice, and only reaches **ACTIVE** (low-fps video) during real engagement, decaying back on silence. The user feels a continuous companion; the hardware mostly sleeps. The *session* persists in the Core regardless of the *capture* level — they're independent, which is what lets a session span a multi-hour reading block and then days.

## 9. Per-platform display treatment

Same session, two glanceable surfaces. What renders where follows the hand-off rule.

| Moment | Meta Ray-Ban Display (600×600 web-app) | Google Android XR (Glimmer) | Phone |
|--------|----------------------------------------|------------------------------|-------|
| Welcome-back | one-line resume chip, 3 s | Title Chip + resume Card | full session history |
| Answer | answer card, ≤3 citations as text | Glimmer Card + citation list | full answer + links |
| Watcher fires | amber badge "Watching: …" | Glimmer badge chip | watcher log |
| Status | small chip (`reading`/`listening`) | Title Chip | — |
| Citations / dossier | titles only (glance) | titles only (glance) | tap to open, read, save |

Both display UIs are operated without precision input — Meta via Neural-Band-as-D-pad (arrow keys + Enter, `.focusable`), Android XR via gaze/tap with Glimmer focus outlines. No free-form text entry on glasses; questions are spoken. Long-form (reading the actual citations, browsing the dossier, editing watchers) is always pushed to the phone.

## 10. Edge cases

- **Ambiguous title.** Resolver returns a best match; if low-confidence, the companion confirms once ("the Kahneman one?") rather than guessing silently.
- **Lost the page (visual).** Page-change detector stays on the last stable `PageCursor`; a blurry/again frame doesn't move it. "I lost the page — show me again" re-captures.
- **Multiple sittings same day.** Same session, cursor advances; history accrues. No new session.
- **Switching device mid-sitting.** Last-writer persists; the other device re-loads on its next action. (Single-Core: last write wins; multi-Core sync is the deferred cloud-store path.)
- **Ending vs pausing.** "Stop" ends the session (`ENDED`, persisted); simply walking away leaves it resumable. Re-opening either way restores everything.

## 11. Deferred (designed-for, not built)

- **Cross-title reasoning** ("compare what Pinker and Graeber say") — sessions are per-title documents now; a later graph joins them.
- **Cloud sync backend** — the `SessionStore` interface is sync-ready; only the local durable + shared-Core paths ship now.
- **Spatial anchoring** of a session to a physical book on a shelf — Stage 2/3 hardware.

These map to Stage 2 in [staged-roadmap.md](staged-roadmap.md).
