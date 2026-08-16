import { describe, it, expect } from "vitest";
import { MockVoiceSession } from "../src/voice/mock";
import { createVoiceSession } from "../src/voice/index";
import { GeminiLiveSession } from "../src/voice/geminiLive";
import type { ToolCallRequest, ToolCallResult } from "../src/voice/voiceSession";

describe("MockVoiceSession (VoiceSession contract)", () => {
  it("records injected page text after start", async () => {
    const v = new MockVoiceSession();
    await v.start({ systemPrompt: "be brief", tools: [] });
    await v.pushPageText("a paragraph");
    expect(v.lastPageText).toBe("a paragraph");
  });

  it("throws if used before start", () => {
    const v = new MockVoiceSession();
    expect(() => v.pushMicAudio("AAA")).toThrow();
  });

  it("throws after end", async () => {
    const v = new MockVoiceSession();
    await v.start({ systemPrompt: "x", tools: [] });
    await v.end();
    expect(() => v.pushCameraFrame("AAA")).toThrow();
  });

  it("delivers barge-in to onUserSpeechStart", async () => {
    const v = new MockVoiceSession();
    await v.start({ systemPrompt: "x", tools: [] });
    let bargedIn = false;
    v.onUserSpeechStart(() => {
      bargedIn = true;
    });
    v.simulateUserSpeechStart();
    expect(bargedIn).toBe(true);
  });

  it("delivers audio and transcripts to handlers", async () => {
    const v = new MockVoiceSession();
    await v.start({ systemPrompt: "x", tools: [] });
    const audio: string[] = [];
    const transcripts: string[] = [];
    v.onAudioOut((data) => audio.push(data));
    v.onTranscript((role, text) => transcripts.push(`${role}:${text}`));
    v.simulateModelAudio("CHUNK");
    v.simulateTranscript("model", "Hello.");
    expect(audio).toEqual(["CHUNK"]);
    expect(transcripts).toEqual(["model:Hello."]);
  });

  it("routes tool calls to the registered handler and returns its result", async () => {
    const v = new MockVoiceSession();
    await v.start({ systemPrompt: "x", tools: [] });
    v.onToolCall(async (call: ToolCallRequest): Promise<ToolCallResult> => ({
      id: call.id,
      name: call.name,
      result: { echoed: call.args },
    }));
    const result = await v.simulateToolCall({ id: "1", name: "define", args: { word: "inchoate" } });
    expect(result.result).toEqual({ echoed: { word: "inchoate" } });
  });
});

describe("createVoiceSession factory", () => {
  it("returns the mock provider", () => {
    expect(createVoiceSession({ provider: "mock" })).toBeInstanceOf(MockVoiceSession);
  });

  it("returns Gemini Live when a key is present (without connecting)", () => {
    const v = createVoiceSession({ provider: "gemini", geminiApiKey: "test-key" });
    expect(v).toBeInstanceOf(GeminiLiveSession);
  });

  it("refuses Gemini without a key", () => {
    expect(() => createVoiceSession({ provider: "gemini" })).toThrow();
  });
});
