/**
 * MockVoiceSession — an offline, deterministic VoiceSession.
 *
 * Two jobs:
 *   1. Let the whole core run and be tested with NO API key (the default
 *      VOICE_PROVIDER), so `npm test` is green on any machine.
 *   2. Be a scriptable test double: tests call the `simulate*` methods to drive
 *      barge-in, audio-out, transcripts, and tool calls through the same handler
 *      wiring a real provider uses.
 */
import {
  type VoiceSession,
  type VoiceSessionConfig,
  type ToolCallRequest,
  type ToolCallResult,
  type TranscriptRole,
  VoiceHandlers,
} from "./voiceSession";

type Lifecycle = "new" | "started" | "ended";

export class MockVoiceSession implements VoiceSession {
  private readonly handlers = new VoiceHandlers();
  private lifecycle: Lifecycle = "new";

  // Observable state for assertions / debugging.
  config: VoiceSessionConfig | null = null;
  lastPageText: string | null = null;
  micChunks = 0;
  cameraFrames = 0;

  async start(config: VoiceSessionConfig): Promise<void> {
    this.config = config;
    this.lifecycle = "started";
  }

  async pushPageText(text: string): Promise<void> {
    this.requireStarted();
    this.lastPageText = text;
  }

  pushCameraFrame(_jpegBase64: string): void {
    this.requireStarted();
    this.cameraFrames++;
  }

  pushMicAudio(_pcmBase64: string): void {
    this.requireStarted();
    this.micChunks++;
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
    this.lifecycle = "ended";
  }

  // ── Test/dev drivers ──────────────────────────────────────────────────────

  simulateUserSpeechStart(): void {
    this.handlers.emitUserSpeechStart();
  }
  simulateModelAudio(audioBase64: string, mimeType = "audio/pcm;rate=24000"): void {
    this.handlers.emitAudioOut(audioBase64, mimeType);
  }
  simulateTranscript(role: TranscriptRole, text: string): void {
    this.handlers.emitTranscript(role, text);
  }
  simulateToolCall(call: ToolCallRequest): Promise<ToolCallResult> {
    return this.handlers.dispatchToolCall(call);
  }

  private requireStarted(): void {
    if (this.lifecycle !== "started") {
      throw new Error(`VoiceSession is "${this.lifecycle}", expected "started".`);
    }
  }
}
