# Reading-Companion App — Reference Architecture

> **Note (2026-05-19):** the audiobook framing below is **deprecated**. After Round 2 of grilling, the product is an **ambient research partner** (silent by default, dispatches parallel agents on request, lives alongside silent reading). The new framing and staged roadmap live in [staged-roadmap.md](staged-roadmap.md). Most of the *infrastructure* here — OCR pipeline, vendor-swap layer, state machine, cost model — still applies; only the "model reads aloud as the default mode" framing is wrong. The v0 build plan that actually ships first is at the bottom of the staged-roadmap doc.

A conversational reading companion. User points a camera at a book or article; the app reads it aloud expressively; the user can interrupt at any time to ask questions, get definitions, summarize, translate, or bookmark. Hands stay on the book; voice stays in the ear.

This document is the build plan you can ship on **today**, with a clear upgrade path to Thinking Machines' Interaction Models when their API opens up later in 2026.

## Product spec (1-page)

| | |
|---|---|
| **Primary user action** | Point phone (or glasses) camera at a page, then start a reading session. |
| **Default mode** | Model reads aloud at a chosen pace with expressive narration. |
| **Interrupt mode** | User speaks at any time; model pauses narration, answers, then offers to resume. |
| **Form factor (v1)** | Android phone (Windows-friendly dev). |
| **Form factor (v2)** | Ray-Ban Meta or Android XR AI glasses (companion phone runs the model). |
| **Latency target** | <800 ms first-token to audio start. <1.5 s end-of-user-speech to start-of-response. |
| **Voice quality target** | Audiobook-narrator-level expressiveness. Not "Siri." |
| **Offline mode** | No, v1 requires connectivity. (Offline later via Sesame CSM-1B + on-device OCR.) |

## Choice 1 — Which realtime model

You will wrap your model layer in a thin abstraction (see §"Vendor swap layer" below) so you can swap models without rewriting the app. But you need a default to start.

**Recommendation: Gemini Live API.** Reasons:
- **Lowest published latency** of generally-available realtime APIs: ~0.57 s turn-taking on FD-bench v1 (vs OpenAI gpt-realtime-2.0 at ~1.18 s).
- **Native multimodal video input** — you can stream the camera feed directly into the conversational model. No separate vision call.
- **First-class interruptions** — VAD + barge-in handled by the API.
- **Available on Google AI Studio + Vertex AI** with documented SDKs for Web, Android (Kotlin), Python, Node.
- **Tool use** in the streaming context (look-up word, save bookmark, translate, etc.).

**Fallback: OpenAI Realtime API (`gpt-realtime`).** Use when:
- You want a more mature ecosystem of reference components (WebRTC, agents-sdk).
- You're building primarily for iOS users (the SDK and community examples skew that way).
- You need a single vendor for chat + voice + image and don't want a Google dependency.

**Voice-quality upgrade (optional, v2):** Pipe the model's response text through **ElevenLabs Flash v2.5** or **Sesame CSM** for richer narration, accepting a +150–300 ms latency penalty. Worth it for read-aloud quality; not worth it for Q&A turns. A/B test.

## Choice 2 — End-to-end multimodal vs OCR-first hybrid

| Approach | Pros | Cons |
|---|---|---|
| **End-to-end** — stream camera + mic to Gemini Live; let the model read the page out of the live video frames. | Simple. One API. Model can react to visual cues (page turn, finger pointing). | Text fidelity is OCR-grade variable; long pages may get summarized rather than read verbatim; harder to bookmark precise positions. |
| **OCR-first hybrid (recommended)** — capture frame, OCR with Gemini Flash (vision call with structured output), feed extracted text into the conversational realtime session, keep camera channel open as context. | Verbatim text reading. Reliable position tracking. Per-page caching. Can pre-process while user gets settled. | Two model calls per page (~$0.0001–0.001/page in OCR cost). Slight extra plumbing. |

Use the hybrid. Page detection runs locally; OCR happens once per page; the realtime model gets a clean text payload + the live camera channel for visual cues.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          PHONE (or glasses + companion phone)            │
│                                                                          │
│  ┌──────────┐                                                            │
│  │ Camera   │──── video frames @ 5-15 fps ──┐                            │
│  └──────────┘                                │                            │
│                                              ▼                            │
│  ┌──────────┐                       ┌────────────────┐                   │
│  │ Mic      │──── audio chunks ────▶│ Frame buffer + │                   │
│  └──────────┘                       │ page detector  │                   │
│                                     └────────┬───────┘                   │
│                                              │ (on new page detected)    │
│                                              ▼                            │
│                                     ┌────────────────┐                   │
│                                     │ OCR call       │                   │
│                                     │ (Gemini Flash) │                   │
│                                     └────────┬───────┘                   │
│                                              │ page_text +               │
│                                              │ structure (paras, refs)   │
│                                              ▼                            │
│  ┌─────────────────────────────────────────────────────────┐             │
│  │             Reading Session Manager                      │             │
│  │  state: { reading | paused_for_question | ended }       │             │
│  │  cursor: { page_id, paragraph_idx, char_offset }         │             │
│  │  history: [conversation turns]                           │             │
│  └────────────┬──────────────────────────────┬─────────────┘             │
│               │                              │                            │
│               ▼                              ▼                            │
│  ┌────────────────────────────┐   ┌──────────────────────┐               │
│  │ Realtime model session     │   │ Tool dispatcher       │               │
│  │ (Gemini Live / OpenAI RT)  │◀─▶│ - define(word)        │               │
│  │ - text channel: page_text  │   │ - summarize_so_far()  │               │
│  │ - audio in: user mic       │   │ - translate(text)     │               │
│  │ - audio out: TTS stream    │   │ - bookmark(loc)       │               │
│  │ - video in: live camera    │   │ - lookup_context(ref) │               │
│  └────────────┬───────────────┘   └──────────────────────┘               │
│               │ audio out                                                │
│               ▼                                                          │
│  ┌──────────────────┐                                                    │
│  │ Speakers /       │                                                    │
│  │ open-ear glasses │                                                    │
│  └──────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Session state machine

```
        ┌─────────────┐
        │   IDLE      │
        └──────┬──────┘
               │ user: "start reading"
               ▼
        ┌─────────────┐
   ┌───▶│  READING    │── audio out: narration ──┐
   │    └──────┬──────┘                          │
   │           │ user speech detected             │
   │           ▼                                  │
   │    ┌─────────────┐                          │
   │    │  PAUSED_Q   │  ◀── model responds to ──┘
   │    └──────┬──────┘     question
   │           │
   │           │ user: "continue" or model auto-resumes
   └───────────┘

   on new-page-detected (any state) ──► OCR → update cursor → resume
   on user: "stop" or "end" ─────────────────────────────────► IDLE
```

The interrupt edge ("user speech detected → PAUSED_Q") is the user-experience differentiator. With Gemini Live it works out of the box via the API's barge-in handling. With OpenAI Realtime you wire it via `input_audio_buffer.speech_started` events.

## Concrete API shapes (Gemini Live, Node/TypeScript)

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { LiveSession } from "@google/generative-ai/live"; // shape illustrative

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const session = await ai.live.connect({
  model: "gemini-2.5-flash-live",                // verify exact model name
  generationConfig: {
    responseModalities: ["AUDIO", "TEXT"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
  },
  systemInstruction: READING_COMPANION_SYSTEM_PROMPT,
  tools: [{ functionDeclarations: [
    defineWord, summarizeSoFar, translate, bookmark, lookupContext,
  ]}],
});

// Push the OCR'd page text once per new page
await session.sendClientContent({
  turns: [{ role: "user", parts: [{ text:
    `New page detected. Read this aloud at a moderate pace, expressively.\n\n${pageText}` }] }],
  turnComplete: false,    // keep session open for interrupts
});

// Continuously stream camera frames + mic audio
camera.on("frame", (frame) => session.sendRealtimeInput({ mediaChunks: [frame] }));
mic.on("audio",     (buf)   => session.sendRealtimeInput({ mediaChunks: [buf] }));

// Receive narration audio
session.on("serverContent", (msg) => {
  if (msg.modelTurn?.parts) {
    for (const p of msg.modelTurn.parts) {
      if (p.inlineData?.mimeType?.startsWith("audio/")) speaker.play(p.inlineData.data);
    }
  }
});

// Handle tool calls (model wants to look something up while reading)
session.on("toolCall", async (tc) => {
  const result = await toolDispatcher.run(tc.functionCalls);
  await session.sendToolResponse({ functionResponses: result });
});
```

## Concrete API shapes (OpenAI Realtime, fallback)

```ts
import OpenAI from "openai";
const client = new OpenAI();
const rt = await client.realtime.connect({ model: "gpt-realtime" });

await rt.update({
  modalities: ["audio", "text"],
  voice: "marin",
  turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
  tools: [defineWordSpec, summarizeSoFarSpec, translateSpec, bookmarkSpec],
  instructions: READING_COMPANION_SYSTEM_PROMPT,
});

// Send OCR'd page as a user message
await rt.send({ type: "conversation.item.create", item: {
  type: "message", role: "user",
  content: [{ type: "input_text",
    text: `New page. Read this aloud expressively:\n\n${pageText}` }],
}});
await rt.send({ type: "response.create" });

// Continuously append camera image attachments (every 1-2 s for cue detection)
setInterval(async () => {
  await rt.send({ type: "conversation.item.create", item: {
    type: "message", role: "user",
    content: [{ type: "input_image", image_url: { url: await snapshot() } }],
  }});
}, 1500);

mic.on("audio", (buf) => rt.send({ type: "input_audio_buffer.append", audio: buf }));
rt.on("response.audio.delta", (e) => speaker.play(e.delta));
rt.on("input_audio_buffer.speech_started", () => session.transitionTo("PAUSED_Q"));
```

## System prompt sketch

```
You are a warm, attentive reading companion. The user is following a physical page in their hands; you are reading it aloud.

Behavior:
- When the user provides page text, read it aloud at a moderate pace with natural expression. Vary tone for dialogue. Pause briefly at paragraph breaks.
- If the user speaks while you're reading, STOP IMMEDIATELY. Listen. Respond conversationally. After answering, ask if they want to continue, and resume from where you stopped (not the start of the paragraph) when they say yes.
- If you don't understand the user's interruption, ask one short clarifying question, then continue.
- If the camera shows a new page (you'll receive new page text), finish the current sentence, then move on to the new page text.
- If the user asks for a definition, summary, translation, or context, USE THE TOOLS. Don't guess from memory.
- Never read more than you were given. If asked "what happens next," say you can only see the current page and ask the user to turn it.
- Be brief in Q&A. Long monologues are for reading, not for answering.

Voice:
- Warm. Engaged. A friend, not an assistant. No "I'd be happy to help" stock phrases.
- Match the genre: lighter for fiction, more measured for technical material.
```

## Tool definitions

| Tool | Inputs | Output | Use case |
|------|--------|--------|----------|
| `define(word)` | string | { definition, examples } | "What does 'inchoate' mean?" |
| `summarize_so_far()` | — | { summary } | "What's happened in this chapter?" |
| `translate(text, target_lang)` | string, ISO code | { translation } | "Read that line in French." |
| `bookmark(label?)` | optional string | { location, ts } | "Remember this spot." |
| `lookup_context(reference)` | string | { context } | "Who is the character they just introduced?" — pulls from prior pages in session memory. |

## Vendor swap layer

Keep your model integration thin so you can swap Gemini Live for OpenAI Realtime for TML-Interaction-Small without rewriting the app.

```ts
interface VoiceSession {
  start(systemPrompt: string, tools: ToolSpec[]): Promise<void>;
  pushPageText(text: string): Promise<void>;     // when OCR completes
  pushCameraFrame(frame: Buffer): void;          // hot path
  pushMicAudio(audio: Buffer): void;             // hot path
  onAudioOut(handler: (chunk: Buffer) => void): void;
  onUserSpeechStart(handler: () => void): void;  // for state machine
  onToolCall(handler: ToolHandler): void;
  end(): Promise<void>;
}

const session: VoiceSession =
  process.env.MODEL === "openai"   ? new OpenAIRealtimeSession() :
  process.env.MODEL === "tml"      ? new TMLInteractionSession() :   // future
                                     new GeminiLiveSession();        // default
```

When TML opens up later in 2026, you implement `TMLInteractionSession` and flip the env var.

## OCR step (Gemini Flash, structured output)

```ts
const ocrSchema = {
  type: "object",
  properties: {
    page_id_hint: { type: "string" },
    paragraphs: { type: "array", items: {
      type: "object",
      properties: {
        text: { type: "string" },
        is_heading: { type: "boolean" },
        is_dialogue: { type: "boolean" },
      },
      required: ["text"],
    }},
    page_number: { type: "integer" },
    confidence: { type: "number" },
  },
  required: ["paragraphs"],
};

async function ocrPage(imageBytes: Buffer) {
  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBytes.toString("base64") }},
        { text: "Extract the readable text from this page. Preserve paragraph breaks. Mark headings and dialogue." },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: ocrSchema,
    },
  });
  return JSON.parse(r.response.text());
}
```

The `is_dialogue` flag is what lets the reading voice modulate tone naturally.

## Page-change detection

Cheap, runs locally — no model call per frame:
1. Sample 1–2 frames/sec.
2. Compute pHash or compare a downsampled grayscale histogram against the last "stable" frame.
3. When the difference exceeds a threshold for >0.5 s AND the image is sharp (variance-of-laplacian > 100), trigger OCR.
4. Debounce so a flickering hand or motion blur doesn't fire repeated OCR calls.

On Android: use **CameraX** + **ML Kit text detection** (free, on-device) as a fast cue that there's text in frame at all. Confirm with a Gemini Flash call if your local text-region count crosses a threshold.

## Roadmap

| Phase | Scope | Stack |
|-------|-------|-------|
| **v0 (week 1)** | Web prototype. Upload a photo of a page → app reads it aloud. No interrupts. | Next.js + Gemini Live (audio-out only). |
| **v0.5 (week 2)** | Add interrupts + Q&A. Still web-based. | Same + barge-in handling. |
| **v1 (week 3-4)** | Android app. Live camera capture, page detection, expressive reading, interrupts, basic tools. | Android (Kotlin) + CameraX + Gemini Live SDK. |
| **v1.5 (week 5)** | Ray-Ban Meta integration. Phone runs the model; glasses are camera + speakers + voice input. | DAT-Android + companion app. |
| **v2 (when TML opens)** | Swap voice/vision model to TML-Interaction-Small for tighter visual reactivity (model notices page turns visually, not just by detection). | Same architecture, `TMLInteractionSession` plug-in. |
| **v2.5 (when Android XR AI glasses ship, 2026)** | Native Android XR Glimmer app, projected context for camera/audio. | Jetpack XR Glimmer + Gemini Live (later TML). |
| **v3** | Offline mode. On-device OCR + on-device CSM-1B for narration; cloud fallback for Q&A. | Sesame CSM-1B + MediaPipe/Tesseract + Gemini Flash for Q&A. |

## Cost model (rough, per active reading hour)

Assumptions: 20 pages/hour, 800 words/page, 10 Q&A interrupts/hour, each ~5 s of user speech + 10 s of model speech.

| Item | Calls/hour | Unit cost (May 2026 rough) | Hourly cost |
|------|-----------|------|------|
| OCR (Gemini 2.5 Flash, ~1500 input tokens, 800 output tokens) | 20 | ~$0.0003 input + ~$0.0008 output | **$0.022** |
| Realtime audio in (Gemini Live, ~3000s mic at $X per minute) | continuous | use vendor's audio rate | **~$0.30–1.00** |
| Realtime audio out (~3000s narration + ~100s Q&A) | continuous | use vendor's audio rate | **~$0.40–1.20** |
| Tool calls | 10 | trivial | **<$0.01** |

**Total: roughly $0.75–$2.25 per reading hour** depending on vendor and tier. For a paid app at $9.99/month with average 10 hours/month of active reading, gross margin is workable but thin. Mitigations: aggressive page-text caching, falling back to ElevenLabs TTS for narration (cheaper per audio second than realtime LLMs), batching OCR calls.

Re-cost after Thinking Machines publishes Interaction Model pricing.

## Privacy and content concerns

- **Copyright** — reading a copyrighted book aloud via your app, even to a single user, is a gray area. For v1 target public-domain texts, articles the user owns, or user-generated content. Talk to a lawyer before broad consumer launch.
- **OCR'd page text on third-party servers** — surface this in onboarding. Offer a "private mode" later (v3 offline).
- **Always-on mic** — opt-in; show clear LED/UI indicator. On Ray-Ban Meta this is hardware-enforced (see [`xr-glasses-dev-guide/04-cameras.md`](../xr-glasses-dev-guide/04-cameras.md)).

## Where to start tomorrow morning

1. `npm create next-app reading-companion` — bare web shell.
2. Add a file upload that POSTs an image to a `/api/ocr` route using Gemini Flash with the schema above.
3. Open a Gemini Live session client-side; push the returned page text; play audio chunks via Web Audio API.
4. Add a mic-on toggle; pipe `getUserMedia` chunks through the session.
5. Verify barge-in: speak while it's reading; confirm it stops and listens.

That's the smallest demo that proves the thesis. Everything in this doc is structure around that two-day prototype.

## References

- Gemini API Live docs: <https://ai.google.dev/gemini-api/docs/live>
- OpenAI Realtime API: <https://platform.openai.com/docs/guides/realtime>
- Sesame CSM-1B: <https://huggingface.co/sesame/csm-1b>
- Kyutai Moshi: <https://github.com/kyutai-labs/moshi>
- ElevenLabs Conversational AI: <https://elevenlabs.io/conversational-ai>
- Thinking Machines Interaction Models (the future upgrade): <https://thinkingmachines.ai/blog/interaction-models/>
- Companion XR guide for glasses form-factor port: [`../xr-glasses-dev-guide/`](../xr-glasses-dev-guide/)
