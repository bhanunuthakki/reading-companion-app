# Staged Roadmap — Reading Companion as Ambient Research Partner

This supersedes the framing in [architecture.md](architecture.md). After Round 2 of grilling, the product is **not** an audiobook narrator. It's a **silent, ambient research partner** that lives alongside your reading session — eyes on the page are yours, brain on the page is yours, the model is the smart friend in the chair next to you who happens to have access to the entire academic literature and your personal library, and can dispatch research while you keep reading.

## The reframe in one paragraph

You read a serious book — Kahneman, Gladwell, Pinker, Hofstadter, whatever — physically, on a Sunday afternoon. You hit a passage that name-drops a finding. Right now you reach for your laptop, lose your place, fall down a Wikipedia hole, come back twenty minutes later having forgotten what you were reading. With this app, you tap your temple and say "tell me what the academic literature says about Gladwell's spotlight-effect citation here." The model captures the page you're looking at, says "on it — pulling recent work," dispatches a research agent in the background, and while you keep reading, comes back a minute later with: "Most-cited follow-up is Gilovich's original 2000 paper plus Epley & Whitchurch 2019 replication finding the effect is real but smaller. There's a 2024 result arguing digital natives may be less susceptible. Want full citations?" You say "save them for after," and the model files them in a session log on your phone. You never broke flow.

That is the wedge. Everything else in this doc is in service of that moment.

## Q1 follow-up — battery reality on Gen 1 Ray-Ban Meta with active-companion mode

You picked **b + c** (active companion + invited proactivity) in Q1 and **d** (continuous low-fps glances) in Q2. That combination is the most power-hungry configuration available on Gen 1 RBM. Concrete numbers:

| Mode | Mic | Video over BLE | Realistic glasses battery |
|------|-----|----------------|---------------------------|
| Idle / off | off | off | 36 hr standby |
| Voice-only sessions, manual captures | always-on (DSP-gated) | event-driven, 0.1–0.5 fps in bursts | 3.5–4 hr active |
| **Your config naively** (continuous mic + ~1 fps continuous video) | always-on | ~1 fps continuous | **1–1.5 hr active** |
| **Your config with smart escalation ladder** (recommended) | always-on | event-driven, escalates to 1 fps only during active engagement | 2.5–3.5 hr active |

The reason: BLE-streamed video is the single biggest battery sink on Ray-Ban Meta. Native on-device video recording famously drains the glasses in 30–60 min; continuous BLE streaming is in the same order of magnitude. Mic capture is cheap; the AR1 chip's DSP handles wake-word detection at low power.

### Smart-escalation ladder (mitigates the battery hit without losing the active-companion feel)

```
LEVEL 0  IDLE         mic listening, video off
            │
            │  triggers (any of):
            │   - voice activity above threshold ("hmm", reading aloud, "hey reader")
            │   - paper rustle detected (page-turn cue)
            │   - IMU tilt indicating you've raised the book
            ▼
LEVEL 1  ALERTED      single still capture → OCR → update "current page" context
            │
            │  triggers:
            │   - explicit query ("hey reader, …")
            │   - model decides it has something to interject (rare, throttled)
            ▼
LEVEL 2  ACTIVE       audio out + video bumped to 0.5–1 fps for visual cue tracking
            │
            │  decays back to LEVEL 1 after 30 s silence
            │  decays back to LEVEL 0 after 5 min total idle
            ▼
LEVEL 1  ALERTED
```

This preserves the "active companion" feeling — the model interjects when it has reason to, can see what page you're on, can react to page turns — while keeping video off ~80–90% of the time. Realistic session length: 2.5–3.5 hr on Gen 1 RBM, comfortably long for a Sunday reading block. Phone battery becomes the next bottleneck (Gemini Live + LLM streaming).

**Bottom line:** active-companion mode on Gen 1 RBM is viable if and only if you build the escalation ladder. A naive "always-on video" implementation kills the glasses in an hour, which kills the product.

## Capability matrix — what's possible today vs what needs to unlock

I'm staging this against the three classes of capability the product needs.

### A. The model layer

| Capability | Today | What's missing |
|------------|-------|----------------|
| Real-time voice in / voice out | Yes — Gemini Live (~0.57 s), OpenAI Realtime (~1.2 s) | True duplex (model listens *while* speaking) — only TML-Interaction-Small does this, closed preview |
| Multimodal vision-in during a streaming voice session | Yes — Gemini Live (native), OpenAI Realtime (image attachments) | Continuous video + voice + reasoning all at once with cheap pricing — Gemini Live can do it but the bill scales with minutes |
| Background agent dispatch (parallel research) | Yes — Anthropic Claude SDK, OpenAI Assistants, LangGraph, custom code | Foreground voice model running *while* background agents work without thrashing — needs careful state mgmt |
| Visual proactivity (model notices a page turn and reacts) | Partially — Gemini Live can do it if you keep video on; latency to reaction is bad | TML's RepCount-A / ProactiveVideoQA scores show this is the unsolved axis. ~0.5–1 yr away in GA APIs |
| Time-aware speech (model waits while you sound out a word) | Poor — every realtime API will fill silence | TML's TimeSpeak score (64.7 vs 4.3) is the unsolved axis |
| Engaging "smart friend" voice quality | Decent — Gemini Live "Aoede" or OpenAI "marin" voices are good; ElevenLabs Flash v2.5 is great with +200 ms latency | A voice that genuinely feels like a person who's interested in the book. Sesame's flagship demo is the closest existing thing |

### B. The hardware layer (your Gen 1 Ray-Ban Meta)

| Capability | Today | What's missing |
|------------|-------|----------------|
| Camera capture on demand | Yes via DAT | Higher frame rate over BLE without battery hit |
| Continuous low-fps video | Yes via DAT, 720p/30 cap, BLE-throttled | Power-efficient video pipeline — needs hardware change |
| Audio in (mic) | Yes, 5-mic array with beamforming | Wake-word reservation: "Hey Meta" is taken. You need a different invocation mechanic |
| Audio out (speakers) | Yes, open-ear directional | Higher fidelity for engaging voice — Gen 1 is adequate not great |
| Display | **No** — Gen 1 has no display | All output is auditory. Big constraint on parallel agent UX |
| Persistent context | None on glasses — all state lives on the phone | n/a, this is fine |
| Battery | 3–4 hr active in this app | More — your reading sessions are longer than the battery |
| Invocation mechanic | Temple long-press (via DAT) or push-to-talk through phone | A bridge gesture: "Hey Reader" wake word requires you to listen to mic stream yourself and detect it — feasible but adds latency and false-positive risk |

### C. The corpus layer (the books/papers/your library)

| Capability | Today | What's missing |
|------------|-------|----------------|
| OCR from camera | Excellent — Gemini 2.5 Flash, Claude vision, ML Kit on-device | Continuous low-error OCR on partial pages, fingers, low light — improving but not solved |
| Public web research | Excellent — Tavily, Brave, Perplexity Search API, Anthropic web tool | n/a |
| Academic search | Decent — Semantic Scholar API, arXiv API, OpenAlex, CORE; Google Scholar still no API | Direct PDF retrieval for paywalled work — usually impossible without institutional access |
| Personal library cross-reference | DIY — you build it. Embed your own Kindle highlights / EPUB collection / Readwise export | A "bring your reading history" import standard would help; Readwise is the closest |
| Author back-catalog reasoning | Decent — LLMs know most published authors and books | Lesser-known authors require fetching their work on demand |

## The three stages

### Stage 0 — today, your Gen 1 RBM + phone

What runs:
- Phone (Android) hosts the companion app. Gemini Live session + Anthropic Claude for research agents.
- Gen 1 RBM connected via DAT (Android Kotlin).
- Escalation ladder above governs camera/mic duty.
- Invocation: temple long-press (DAT API supports this) OR a custom wake-word detector running on the phone over the streaming mic ("Hey Reader") — accept ~300 ms detection latency.
- Output: voice only.
- Personal corpus: Readwise export + a folder of your EPUBs/PDFs indexed into a local vector DB on your phone or on a cheap VPS you control.

The four beautiful moments to build first (in priority order):

**Moment 1 — "Pull the literature."** Your wedge case. Tap, ask, model captures the page, dispatches research, returns 30–90 s later with synthesized academic context while you keep reading.

> *Why it's beautiful:* you get a research librarian who works on your timeline, not on your context-switch tax. Most readers of serious nonfiction have wanted this for two decades and it's now actually buildable.

**Moment 2 — "What was she saying about this earlier?"** Cross-text linkage against your personal library. You're reading Kahneman; you say "didn't Gigerenzer disagree with this somewhere?"; model checks your Gigerenzer EPUBs and Readwise highlights, returns the rebuttal passage in audio.

> *Why it's beautiful:* the books you've already read become a queryable second brain. You stop forgetting books five minutes after you finish them.

**Moment 3 — "Tell me when she revisits this."** Standing watcher. "Alert me when Gladwell brings up the spotlight effect again later in the book." Watcher persists across captures. When a future page-OCR hits a match, the model lights up: "She's coming back to it — page 184."

> *Why it's beautiful:* it's a kind of programmable margin note. The book becomes interactive without writing in it.

**Moment 4 — "Read this back to me one more time."** Rare on-demand TTS for a passage worth re-reading. The opposite of an audiobook — used sparingly, when the prose itself is the point.

> *Why it's beautiful:* it inverts the audiobook frame. You're the reader. The model just amplifies your favorite passages.

**Niche PMF audience for Stage 0:**
- Academics writing literature reviews while reading source books.
- Podcast hosts who reference dense nonfiction (Tyler Cowen, Sean Carroll, Lex Fridman audience-style).
- Book-club facilitators preparing for sessions.
- PhD students drowning in citations.
- Highly engaged knowledge workers reading "thinking books" (Kahneman, Pinker, Mitchell, Hofstadter).
- People who buy more books than they finish and want to be smarter about the ones they do finish.

This is small but they'll pay. $10–20/mo for the right people. Estimated TAM at Stage 0: tens of thousands of users globally if the product is genuinely good. Not a venture business yet; a beachhead.

**v0 scope (the prototype to build first):**
- Web app + Android companion. Phone connects to Gen 1 RBM via DAT.
- Single demo path: Moment 1 ("pull the literature").
- The escalation ladder collapsed to "manual capture only" (no continuous video). User taps temple, model captures one frame, OCRs, asks "what would you like to know about this page?", dispatches research agent, returns with synthesized answer in voice.
- One research agent dispatch only (no concurrent multi-agent yet).
- Session log to phone screen — see citations in the app after the session ends.
- Personal library: skip. Add in v0.5.

What we explicitly defer: continuous video, multi-agent dispatch, watchers, cross-text linkage, TTS read-back, on-glasses display. These all wait until Moment 1 is delightful.

### Stage 1 — late 2026 / early 2027

What unlocks:
- **Android XR AI glasses ship** (Samsung + Warby Parker + Gentle Monster). Native Glimmer UI + Projected runtime. You get a small additive display for the first time outside of Ray-Ban Display.
- **Ray-Ban Display SDK opens** to general publishing (currently closed preview).
- **Meta Wearables Device Access Toolkit** opens production publishing (currently 100-tester cap).
- **TML-Interaction-Small** opens a research preview to selected partners.
- **Gemini 3.x Live** and **OpenAI gpt-realtime-3** push price/min down ~3–5×, latency under 0.3 s.

What's now possible:
- **Glanceable citation cards.** A research agent returns three papers; their titles + authors + one-sentence summary float on the display for two seconds, dismissed by a glance. The auditory channel becomes optional for short results.
- **Visible watcher badges.** A tiny chip on the display when a standing watcher fires.
- **Cheaper continuous video.** With improved BLE-Audio + LE Audio Auracast streaming and on-glasses low-power CV chips (rumored on Ray-Ban Gen 3), continuous low-fps video stops being a battery killer.

The beautiful moments at Stage 1:

**Moment 5 — "Read while I read."** When you turn a page (detected visually now, not just by capture-on-tap), the model has already pre-fetched the references in that section and shows you a tiny "3 things to know" pill on the display. You glance, dismiss, keep reading.

> *Why it's beautiful:* it's the platonic ideal of marginalia — context appears where you can use it, vanishes when you don't.

**Moment 6 — "Show me the citation tree."** Ask "how does this section relate to the broader literature" — get a tiny visual tree of cited papers and influences floating beside the book. Reachable with a Neural Band pinch to expand any node.

> *Why it's beautiful:* the entire scholarly conversation around a passage becomes physically present.

**Moment 7 — "Backchannel companion."** With TML-Interaction-Small (if accepted into preview), the model can softly say "mm — that's the framing from his 2009 talk" while you're reading aloud, without interrupting. True ambient presence.

> *Why it's beautiful:* the model finally feels like a friend who's read the book before you and is enjoying watching you discover it.

**Stage 1 PMF audience expands to:**
- Visual learners (the display unlocks them).
- Language learners (translations / pronunciation overlays on the display).
- Lawyers reading case law with citation tracking.
- Doctors reading clinical research with related-trial overlays.
- Hobbyist deep-readers (the larger market — wine, history, philosophy).

### Stage 2 — 2027–2028

What unlocks:
- **TML-Interaction-Small GA** with cheap pricing. True duplex + visual proactivity becomes table-stakes.
- **Higher-fidelity displays** — wider FoV (~40°), brighter, lower power. Multiple text strips visible.
- **On-device CV at <1 W.** Continuous reading-position tracking via on-glasses neural accelerators (rumored AR1 Gen 3+ class).
- **Improved Neural Band** with raw-EMG access for accessibility carve-outs (per Meta's CMU partnership) — maybe broader.
- **Spatial anchors on consumer AR glasses** (Orion-class hardware enters consumer pricing).

What's now possible:
- **Continuous all-day session** — the companion lives in your glasses, not in a session you launch.
- **Spatial annotation** — your past reading is anchored to physical books on your shelf. Walk past a book, see your prior questions and the answers anchored to its spine.
- **Cross-book conversations** — "Compare what Pinker says about violence with what Graeber says" — multi-perspective synthesis where multiple agents reason about multiple texts in your library in parallel, results stream in.
- **Time-aware reading partner** — "Quiz me on what I read last week"; the model has been there, knows what you read, can ask sharp questions.

The beautiful moments at Stage 2:

**Moment 8 — "The book opens up."** You pick up a book you read three years ago. The model remembers everything you asked it. As you re-read, your past annotations and the research it pulled appear in the margins of the display.

> *Why it's beautiful:* books become a personal archive, not a one-time experience. The third re-read of a book is the deepest, not the shallowest.

**Moment 9 — "Argue with me."** Socratic discussion mode — the model challenges your interpretations in real time. "You said earlier you thought Kahneman was making a normative claim here. But isn't his framing closer to descriptive?" — based on your prior voiced reactions across multiple reading sessions.

> *Why it's beautiful:* every book becomes a seminar with one other very smart attendee. Not a tutor, not a search engine — an interlocutor.

**Moment 10 — "Reading in public."** Two people in the same room each with glasses, both with reading companions. They can share annotations across glasses. A book club becomes a real-time literature-graph collaboration.

> *Why it's beautiful:* reading stops being lonely without losing its solitude.

**Stage 2 PMF audience:**
- Mainstream curious readers. The product crosses from niche to broad.
- Education — middle-school through PhD.
- Professional CE (continuing education) — doctors, lawyers, scientists, software engineers.

### Stage 3 — 2028+

Orion-class consumer glasses. Spatial AR over physical pages. Marginalia anchored in 3D. Cross-book graphs floating in the air. This is the "future Steve Jobs would have shipped" stage; speculate sparingly, build for Stage 0–1.

## What we should build right now

**v0 — Stage 0 prototype, two-week scope.**

Build *only* Moment 1 ("pull the literature") and *only* the manual-capture variant — no continuous video, no escalation ladder yet, no watchers, no library. The point is to prove the wedge — that "ask a serious question, get serious research delivered to your ears while you keep reading" actually feels like the product we think it does.

Specifically:
1. **Android companion app** (Kotlin + Android Studio on Windows). DAT integration with Gen 1 RBM. Single screen: a "session" toggle.
2. **Temple long-press → mic open** for 5 s → capture one frame from glasses camera at the moment of press.
3. **Speech → Whisper/Gemini STT → query string + page image** → Anthropic Claude Sonnet 4.7 with web tool + Semantic Scholar tool, run as a single research agent.
4. **Result → Gemini Live TTS** (or ElevenLabs Flash if we want the upgrade) → audio over Bluetooth back to glasses' open-ear speakers.
5. **Session log** rendered on the phone screen as cards with citations; user can tap a card to expand.

Total: about 8–12 hours of focused work for someone comfortable with Android + an LLM SDK. Half of that is DAT integration friction; the actual LLM/agent layer is straightforward.

**v0.5** — add Moment 3 (standing watchers) and the escalation ladder (continuous mic with voice-activity-triggered captures). This is where the product starts feeling alive.

**v1** — add Moment 2 (personal library) via a Readwise import + your own EPUB folder indexed into a local vector DB. The cross-text linkage is the second wedge after research.

**Hold on Moment 4** (read-back TTS) until v1.5. It's a cherry, not a foundation.

## Decision log (for future me re-reading this)

- The audiobook framing in [architecture.md](architecture.md) is wrong for this product. Update the doc when we get to v1.
- Gen 1 Ray-Ban Meta is a viable Stage 0 device only with the escalation ladder; naively-on continuous video kills it.
- Stage 0 niche is real (tens of thousands of users globally) and they will pay; Stage 1 broadens to hundreds of thousands; Stage 2 is the mainstream-curious-reader bet.
- The Thinking Machines TML-Interaction-Small dependency is for Stage 1+. We design the model layer behind a `VoiceSession` interface so we can swap it in without rewriting the app (see [architecture.md §"Vendor swap layer"](architecture.md#vendor-swap-layer)).
- All four "beautiful moments" at Stage 0 are buildable today on Gemini Live + Anthropic Claude + Semantic Scholar/Tavily APIs + your existing Gen 1 RBM. No hardware purchases needed.

## Addendum — Google I/O 2026 updates (May 19–20)

Full I/O coverage in [`../xr-glasses-dev-guide/12-io-2026-updates.md`](../xr-glasses-dev-guide/12-io-2026-updates.md). Concrete implications for this project:

### Acceleration

- **Gemini 3.5 Flash** shipped today: 4× faster than prior frontier models at <50% the cost. Default the v0 "heavy lift" model (research synthesis, summarization, planning) to Gemini 3.5 Flash. Claude Sonnet 4.7 stays in the architecture as an alternative for research dispatch, but for the realtime + cost path, 3.5 Flash is now the right pick. This **materially improves the per-session cost model** estimated in [architecture.md § Cost model](architecture.md#cost-model-rough-per-active-reading-hour) — expect ~30–50% lower hourly cost when migrated.
- **Gemini Omni / Omni Flash** is available today via the Gemini app for any-input-to-any-output generation. Not on the v0 path, but useful for v2+ "visualize this concept" experiments (e.g. ask the model to generate a short illustrative video while you keep reading).
- **Geospatial API + Gemini Live combo** for wired XR glasses — irrelevant indoors, but if a future "reading-while-walking" or "audiobook-with-place" mode ever emerges, Google has now hardened the substrate.

### Hardware roadmap shift for Stage 1

Stage 1 in the original roadmap assumed **Ray-Ban Display** as the primary "display in glasses" path. I/O changes the picture:

| Stage | Original hardware | Updated hardware target |
|---|---|---|
| 0 (today) | Gen 1 Ray-Ban Meta + phone | **No change** |
| 1 (late 2026 / early 2027) | Ray-Ban Display SDK opens to public + Android XR AI glasses ship | **Google audio glasses (fall 2026, no display) → then Google display glasses (timeline unspecified, likely 2027) → Ray-Ban Display as parallel option** |
| 2 (2027–2028) | TML GA + spatial anchors on consumer AR | No change |

The audio-glasses-first launch from Google means the **near-term consumer-shipping platform with Gemini-native visual understanding** is Google's, not Meta's. Reading companion fits naturally:

- Audio out: open-ear speakers (same form factor as Ray-Ban Meta).
- Camera: yes, for page capture.
- "Hey Google" wake word — same problem as "Hey Meta" (custom wake words blocked), but you can register `intent`-based handlers via the Catalyst hardware to invoke your app.
- Multi-platform compatibility: works with both Android and iOS phones, doubling the addressable user base.

**Decision:** retarget Stage 1 from "Ray-Ban Display first" to "Google audio glasses first, Ray-Ban Display in parallel." Net effect: Stage 1 ships sooner and with a Gemini-native partner.

### The Catalyst Program — apply this month

This is the actionable I/O takeaway. **Apply by June 30, 2026 (11:59 PM PDT)** to <https://developer.android.com/develop/xr/catalyst>.

What you get:
- Pre-release hardware for **XREAL Project Aura** and **intelligent eyewear** (audio + display).
- Non-recoupable grant funding (amounts on request).
- Dedicated technical support and private forums.

Why this is the right move for your project specifically:
1. The reading companion fits Google's stated selection priorities — "media, gaming, productivity, health." Productivity + media + (arguably) health (literacy / cognitive engagement) is a clean three-axis pitch.
2. Pre-release access to audio glasses lets you build the Stage 1 port **6+ months before retail**, putting your app in front of the lab-coat reviewers (TechCrunch, The Verge, podcast hosts who fit the target persona) on launch day with a polished demo.
3. Catalyst grants would fund the v1 / v1.5 build (continuous video escalation ladder, personal-library indexing) without diluting equity.
4. The TML research-preview pitch ([tml-research-preview-pitch.md](tml-research-preview-pitch.md)) and the Catalyst application are independent; submit both.

The Catalyst pitch fits in ~500 words. Suggested structure:

> **Product (1 ¶):** Ambient research partner for serious readers. Tap your glasses → ask about what you're reading → model captures the page, dispatches parallel agents to academic and web sources, returns synthesized context in your ear while you keep reading.
>
> **Why Android XR specifically (1 ¶):** Audio glasses' camera + open-ear audio + Gemini multimodal is the ideal form factor. The category itself was designed for the exact "hands-on-book, brain-on-page, model-in-ear" use case we're building. Display glasses unlock glanceable citation cards as a v1.5 enhancement.
>
> **What you'd build with the grant (1 ¶):** v0 ships in 2 weeks on existing Ray-Ban Meta Gen 1 as a proof point. Catalyst hardware unlocks the v1 port to audio glasses (3 months). Stage 1.5 with display glasses + glanceable citation cards (6 months). Personal-library indexing + standing watchers + Socratic mode (9 months).
>
> **Technical credibility (1 ¶):** [Your background. Recent shipped artifacts. Repo links.] Already working in Jetpack XR DP3; will migrate to DP4 immediately. Already integrating with Gemini Live, Anthropic Claude, Semantic Scholar APIs.

### v0 plan revisions

Two specific tweaks to the v0 build plan in [staged-roadmap.md § What we should build right now](#what-we-should-build-right-now):

1. **LLM model:** Use **Gemini 3.5 Flash** for the research-agent step instead of Claude Sonnet 4.7. Keep the model behind the vendor-swap interface so the user can A/B them. Gemini Live remains the realtime voice layer.
2. **Jetpack XR target:** Plan against **DP4 with Beta-bound libraries**. Even though v0 is a DAT-Android (Meta Wearables) app and doesn't directly use Jetpack XR yet, structure the code so the v1 Google-audio-glasses port reuses the model layer wholesale.

### What doesn't change

- Gen 1 Ray-Ban Meta is still the right Stage 0 hardware target.
- The escalation ladder is still required for active-companion mode.
- The four Stage-0 beautiful moments are unchanged.
- v0 scope is unchanged (Moment 1 only, manual-capture variant).
- Privacy + copyright concerns are unchanged.
