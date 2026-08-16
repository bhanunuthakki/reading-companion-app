export * from "./voiceSession";
export { MockVoiceSession } from "./mock";
export { GeminiLiveSession } from "./geminiLive";
export { OpenAIRealtimeSession } from "./openaiRealtime";

import type { VoiceSession } from "./voiceSession";
import { MockVoiceSession } from "./mock";
import { GeminiLiveSession } from "./geminiLive";
import { OpenAIRealtimeSession } from "./openaiRealtime";

export type VoiceProvider = "mock" | "gemini" | "openai";

export interface VoiceEnv {
  provider: VoiceProvider;
  geminiApiKey?: string;
  geminiLiveModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
}

export function createVoiceSession(env: VoiceEnv): VoiceSession {
  switch (env.provider) {
    case "mock":
      return new MockVoiceSession();
    case "gemini":
      if (!env.geminiApiKey) throw new Error("VOICE_PROVIDER=gemini requires GEMINI_API_KEY.");
      return new GeminiLiveSession(env.geminiApiKey, env.geminiLiveModel ?? "gemini-2.5-flash-live");
    case "openai":
      if (!env.openaiApiKey) throw new Error("VOICE_PROVIDER=openai requires OPENAI_API_KEY.");
      return new OpenAIRealtimeSession(env.openaiApiKey, env.openaiModel ?? "gpt-realtime");
  }
}
