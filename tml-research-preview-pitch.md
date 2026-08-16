# Research Preview Application — Thinking Machines Lab

A template you can customize and submit. The whole point is to be concrete, brief, and to show your application surfaces the capabilities Thinking Machines specifically built TML-Interaction-Small to demonstrate — not capabilities every realtime API already offers. The blog post explicitly invites the community to "develop new interactivity measurement frameworks," so framing your app as both a product **and** a benchmark contribution is the strongest play.

The pitch is structured as three parts: a 400-word email pitch, a one-paragraph benchmark proposal, and a short builder bio. Adjust to taste before sending.

---

## Part 1 — The email (≈400 words, ready to paste)

**Subject:** Interaction Models research-preview interest — patient, learner-paced reading companion + benchmark proposal

Hi Thinking Machines team,

I read the [Interaction Models post](https://thinkingmachines.ai/blog/interaction-models/) the day it went up and I think TML-Interaction-Small is the first model architecturally suited to a use case I've been trying (and so far failing) to build on top of conventional realtime APIs: a **conversational reading companion** for people who learn by reading aloud — kids working through chapter books, adult literacy learners, language learners reading in a non-native language, and dyslexic readers.

The user points a phone or AR-glasses camera at a physical page. The model reads it aloud expressively, while watching what the user is doing. The user can interrupt at any time — "what does that word mean," "go back a paragraph," "say it again slower" — and the model picks up exactly where it stopped. When the user turns the page, the model notices visually and keeps going.

Four of the capabilities you highlighted are exactly the four that other realtime APIs cannot do well today, and they're each load-bearing for this use case:

1. **TimeSpeak / patient pacing.** Learners need the model to wait — sometimes for 10 seconds — while they sound out a word. Existing realtime APIs default to filling silence ("Did you have a question?") which kills the learning loop. TML-Interaction-Small's 64.7 macro-accuracy on TimeSpeak (vs 4.3 on GPT-realtime-2.0) is the difference between a usable product and an unusable one.
2. **CueSpeak / verbal cue timing.** "Continue," "back up," "slower" should not have to be wrapped in explicit commands. Reading is a high-cue conversational context — sighs, repeats, "uhh" — and CueSpeak at 81.7 vs 2.9 implies the model can actually use those cues.
3. **Visual proactivity / RepCount-A + ProactiveVideoQA.** Page turns, finger-tracking, and "the user pointed at this word" are all visual events the model should react to without verbal prompting. This is the differentiating capability vs Gemini Live and GPT-realtime.
4. **Background model for tool use.** Definitions, translations, summaries-so-far should stream in **while the model is still reading**, not interrupt the reading. The two-model architecture is the cleanest published approach to this pattern.

I'd love a slot in the limited preview to build this against TML-Interaction-Small directly. I'm happy to share weekly build notes, an early test corpus, and prerelease feedback under whatever NDA you require. I'm also prepared to contribute back a benchmark — see below.

Thanks for considering. Whatever timeline works for you, I'll keep building on the closest analog I can (Gemini Live, today) and slot TML in the moment the API opens.

— [Your name]
[Your email] · [Your GitHub] · [Your project repo if public]

---

## Part 2 — Proposed benchmark contribution

You can include this inline in the email or as a separate paragraph. Thinking Machines' blog explicitly invites benchmark proposals — leading with one signals you understand what they care about.

> **Proposed benchmark: ReadAloud-Bench v0 — interruption-tolerant assistive reading.**
>
> A 200-item corpus drawn from open-text passages spanning three genres (children's chapter fiction, technical exposition, second-language reader). Each item includes:
> - the page image (camera angle, lighting, hand-occlusion variants),
> - a ground-truth verbatim transcript,
> - a scripted set of learner interruptions at marked positions (mid-word, mid-sentence, mid-paragraph),
> - reference responses for each interruption,
> - a resume-from-position ground truth.
>
> Scored on: verbatim fidelity, interruption-recovery accuracy (does the model resume from the right word?), patience score (does the model wait when the learner is sounding-out vs filling silence?), visual-cue responsiveness (page-turn detection latency), and tool-use timing (does the model fetch a definition while still narrating, or after stopping?).
>
> I'd contribute v0 as an open dataset under CC-BY-SA if it would help measure TML-Interaction-Small's lead in this category.

---

## Part 3 — Builder bio (1 paragraph)

Adapt to your actual background — the goal is to show you can ship.

> I'm a [your role] based in [city], with [N] years building [shipping mobile apps / web apps / multimodal systems / etc.]. Recent work: [one or two concrete shipped artifacts, ideally with links]. I've already built a v0 of the reading companion on Gemini Live and Anthropic Claude in a Windows dev environment, and I'm currently scoping the Android XR Glimmer port for when those glasses ship later this year. My GitHub is at [URL] and a short demo video of the v0 is at [URL] (if you have one — otherwise omit).

---

## How to send it

1. Find the contact form / interest form on [thinkingmachines.ai](https://thinkingmachines.ai/) (the blog post linked one in its footer). If they request a separate email, address it to whatever public-facing inbox they list.
2. Send the email above as-is, with Part 2's benchmark paragraph inserted between paragraphs 4 and 5.
3. If they have a structured form, paste the email into the longest free-text field and answer the form's specific questions matter-of-factly.

## Things that will raise your odds

- **A demo video.** 30–60 seconds, screen-captured, showing your v0 working on Gemini Live. They can scan it in a minute.
- **A measurable claim.** "Gemini Live's barge-in misfires 1 in 4 times during quiet reading sessions; here's the recording" beats abstract description.
- **A working prototype repo.** Public if possible; private with read access if the licensing is sensitive.
- **A specific user.** "I'm building this with a literacy non-profit in [city]; here's their letter of intent" beats "people would like this."

## Things that will lower your odds

- Vague enthusiasm without concrete plan. Thinking Machines is technical; vague pitches read as marketing.
- Asking for free API credits or pricing concessions. Don't.
- Cross-posting the same pitch to every AI lab. They'll know.
- Promising distribution numbers you can't back up.

## If they say no (or take months to reply)

Build on Gemini Live or OpenAI Realtime in the meantime, per the [architecture doc](architecture.md). The `VoiceSession` interface lets you swap implementations without rewriting the app. Ship the v1 — if it's good, you can re-apply with a real product and real users, which is a much stronger second pitch.

---

## Source for the benchmark numbers cited

[Thinking Machines Lab — Interaction Models blog](https://thinkingmachines.ai/blog/interaction-models/). Numbers (TimeSpeak, CueSpeak, RepCount-A, FD-bench v1.5) are taken verbatim from that post.
