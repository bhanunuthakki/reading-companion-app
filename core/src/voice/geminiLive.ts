/**
 * GeminiLiveSession — the default realtime backbone (lowest published turn-taking
 * latency, native video-in during a voice session). Built on @google/genai's
 * bidirectional Live API.
 *
 * Mapping to the VoiceSession seam:
 *   pushPageText   → session.sendClientContent (ordered context injection)
 *   pushCameraFrame→ session.sendRealtimeInput({ video })
 *   pushMicAudio   → session.sendRealtimeInput({ audio })   (server VAD + barge-in)
 *   onAudioOut     ← serverContent.modelTurn.parts[].inlineData
 *   onUserSpeechStart ← serverContent.interrupted   (the barge-in signal)
 *   onToolCall     ← toolCall.functionCalls → sendToolResponse
 *   onTranscript   ← serverContent.input/outputTranscription
 *
 * This is I/O and only exercised with a real key; the VoiceSession contract is
 * unit-tested via MockVoiceSession.
 */
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session as GenAiLiveSession,
} from "@google/genai";
import {
  type VoiceSession,
  type VoiceSessionConfig,
  type ToolCallRequest,
  type ToolCallResult,
  type TranscriptRole,
  VoiceHandlers,
} from "./voiceSession";

const DEFAULT_OUTPUT_AUDIO_MIME = "audio/pcm;rate=24000";

export class GeminiLiveSession implements VoiceSession {
  private readonly ai: GoogleGenAI;
  private readonly handlers = new VoiceHandlers();
  private session: GenAiLiveSession | null = null;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async start(config: VoiceSessionConfig): Promise<void> {
    this.session = await this.ai.live.connect({
      model: this.model,
      callbacks: {
        onmessage: (message: LiveServerMessage) => this.handleMessage(message),
        onerror: (e: ErrorEvent) => console.error("Gemini Live error:", e.message),
        onclose: () => {
          this.session = null;
        },
      },
      config: {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        systemInstruction: config.systemPrompt,
        tools: [
          {
            functionDeclarations: config.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  }

  async pushPageText(text: string): Promise<void> {
    this.requireSession().sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: false,
    });
  }

  pushCameraFrame(jpegBase64: string): void {
    this.requireSession().sendRealtimeInput({ video: { data: jpegBase64, mimeType: "image/jpeg" } });
  }

  pushMicAudio(pcmBase64: string): void {
    this.requireSession().sendRealtimeInput({ audio: { data: pcmBase64, mimeType: "audio/pcm;rate=16000" } });
  }

  onAudioOut(handler: (audioBase64: string, mimeType: string) => void): void {
    this.handlers.onAudioOut(handler);
  }
  onUserSpeechStart(handler: () => void): void {
    this.handlers.onUserSpeechStart(handler);
  }
  onToolCall(handler: (call: ToolCallRequest) => Promise<ToolCallResult>): void {
    this.handlers.onToolCall(handler);
  }
  onTranscript(handler: (role: TranscriptRole, text: string) => void): void {
    this.handlers.onTranscript(handler);
  }

  async end(): Promise<void> {
    this.session?.close();
    this.session = null;
  }

  private handleMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    if (content?.interrupted) this.handlers.emitUserSpeechStart();

    for (const part of content?.modelTurn?.parts ?? []) {
      const inline = part.inlineData;
      if (inline?.data) {
        this.handlers.emitAudioOut(inline.data, inline.mimeType ?? DEFAULT_OUTPUT_AUDIO_MIME);
      }
    }

    if (content?.inputTranscription?.text) {
      this.handlers.emitTranscript("user", content.inputTranscription.text);
    }
    if (content?.outputTranscription?.text) {
      this.handlers.emitTranscript("model", content.outputTranscription.text);
    }

    if (message.toolCall?.functionCalls?.length) {
      void this.resolveToolCalls(message.toolCall.functionCalls);
    }
  }

  private async resolveToolCalls(
    functionCalls: NonNullable<NonNullable<LiveServerMessage["toolCall"]>["functionCalls"]>,
  ): Promise<void> {
    const responses = [];
    for (const fc of functionCalls) {
      const result = await this.handlers.dispatchToolCall({
        id: fc.id ?? "",
        name: fc.name ?? "",
        args: fc.args ?? {},
      });
      responses.push({ id: result.id, name: result.name, response: result.result });
    }
    this.requireSession().sendToolResponse({ functionResponses: responses });
  }

  private requireSession(): GenAiLiveSession {
    if (!this.session) throw new Error("GeminiLiveSession not started; call start() first.");
    return this.session;
  }
}
