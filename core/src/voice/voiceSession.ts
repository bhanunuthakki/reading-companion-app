/**
 * VoiceSession — the vendor-neutral streaming voice interface.
 *
 * The whole point of this seam is that the app talks to ONE interface and we can
 * swap the realtime model (Gemini Live today; OpenAI Realtime; Thinking Machines
 * TML-Interaction-Small when its preview opens) without rewriting anything above.
 *
 * Hot paths (camera frames, mic audio) are fire-and-forget `void`. Context
 * injection (OCR'd page / dossier) and lifecycle are async.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the function arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  result: Record<string, unknown>;
}

export type AudioOutHandler = (audioBase64: string, mimeType: string) => void;
export type UserSpeechStartHandler = () => void;
export type ToolCallHandler = (call: ToolCallRequest) => Promise<ToolCallResult>;
export type TranscriptRole = "user" | "model";
export type TranscriptHandler = (role: TranscriptRole, text: string) => void;

export interface VoiceSessionConfig {
  systemPrompt: string;
  tools: ToolSpec[];
  /** Optional preferred TTS voice name (provider-specific). */
  voiceName?: string;
}

export interface VoiceSession {
  start(config: VoiceSessionConfig): Promise<void>;
  /** Inject context the model should consider (an OCR'd page, a dossier brief). */
  pushPageText(text: string): Promise<void>;
  /** Hot path: a camera frame for visual-cue awareness. */
  pushCameraFrame(jpegBase64: string): void;
  /** Hot path: a chunk of mic audio (PCM 16k base64). */
  pushMicAudio(pcmBase64: string): void;
  onAudioOut(handler: AudioOutHandler): void;
  /** Barge-in: the user started speaking over the model. */
  onUserSpeechStart(handler: UserSpeechStartHandler): void;
  onToolCall(handler: ToolCallHandler): void;
  onTranscript(handler: TranscriptHandler): void;
  end(): Promise<void>;
}

/**
 * Shared handler bookkeeping, composed by each VoiceSession implementation so the
 * registration/emit boilerplate lives in exactly one place.
 */
export class VoiceHandlers {
  private audioOut: AudioOutHandler[] = [];
  private userSpeechStart: UserSpeechStartHandler[] = [];
  private transcript: TranscriptHandler[] = [];
  private toolCall: ToolCallHandler | null = null;

  onAudioOut(handler: AudioOutHandler): void {
    this.audioOut.push(handler);
  }
  onUserSpeechStart(handler: UserSpeechStartHandler): void {
    this.userSpeechStart.push(handler);
  }
  onTranscript(handler: TranscriptHandler): void {
    this.transcript.push(handler);
  }
  onToolCall(handler: ToolCallHandler): void {
    this.toolCall = handler;
  }

  emitAudioOut(audioBase64: string, mimeType: string): void {
    for (const h of this.audioOut) h(audioBase64, mimeType);
  }
  emitUserSpeechStart(): void {
    for (const h of this.userSpeechStart) h();
  }
  emitTranscript(role: TranscriptRole, text: string): void {
    for (const h of this.transcript) h(role, text);
  }
  async dispatchToolCall(call: ToolCallRequest): Promise<ToolCallResult> {
    if (!this.toolCall) throw new Error("No tool-call handler registered on this VoiceSession.");
    return this.toolCall(call);
  }
}
