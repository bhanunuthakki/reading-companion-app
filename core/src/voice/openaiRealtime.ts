/**
 * OpenAIRealtimeSession — the documented second implementation, proving the
 * VoiceSession seam is genuinely vendor-neutral. Left as a loud stub rather than
 * a half-built integration: when you want it, implement against the OpenAI
 * Realtime API per architecture.md, mapping:
 *
 *   start()         → client.realtime.connect({ model }) + session.update({
 *                       modalities:["audio","text"], turn_detection:{type:"server_vad",
 *                       interrupt_response:true}, tools, instructions })
 *   pushPageText    → conversation.item.create (input_text) + response.create
 *   pushCameraFrame → conversation.item.create (input_image)
 *   pushMicAudio    → input_audio_buffer.append
 *   onAudioOut      ← response.audio.delta
 *   onUserSpeechStart ← input_audio_buffer.speech_started   (barge-in)
 *   onToolCall      ← response.function_call_arguments.done → tool output
 */
import {
  type VoiceSession,
  type VoiceSessionConfig,
  type ToolCallRequest,
  type ToolCallResult,
  type TranscriptRole,
  VoiceHandlers,
} from "./voiceSession";

const NOT_IMPLEMENTED =
  "OpenAIRealtimeSession is a documented stub. Implement against the OpenAI Realtime API per architecture.md, or set VOICE_PROVIDER=gemini|mock.";

export class OpenAIRealtimeSession implements VoiceSession {
  private readonly handlers = new VoiceHandlers();

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async start(_config: VoiceSessionConfig): Promise<void> {
    void this.apiKey;
    void this.model;
    throw new Error(NOT_IMPLEMENTED);
  }
  async pushPageText(_text: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
  pushCameraFrame(_jpegBase64: string): void {
    throw new Error(NOT_IMPLEMENTED);
  }
  pushMicAudio(_pcmBase64: string): void {
    throw new Error(NOT_IMPLEMENTED);
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
    // nothing to tear down in the stub
  }
}
