import { describe, it, expect } from "vitest";
import { SessionManager } from "../src/sessionManager";
import { InMemorySessionStore } from "../src/sessionStore";
import { ToolDispatcher } from "../src/research/tools";
import { MockResearchProvider } from "../src/research/dispatcher";
import type { ContentRef } from "../src/types";

const bookRef: ContentRef = { kind: "book", title: "Sapiens", author: "Harari" };

async function dispatcher(): Promise<{ tools: ToolDispatcher; manager: SessionManager }> {
  const manager = await SessionManager.open(bookRef, new InMemorySessionStore());
  return { tools: new ToolDispatcher(manager, new MockResearchProvider()), manager };
}

describe("ToolDispatcher", () => {
  it("arms a watcher via the watch tool", async () => {
    const { tools, manager } = await dispatcher();
    const result = await tools.handle({ id: "1", name: "watch", args: { topic: "spotlight effect" } });
    expect(result.result).toMatchObject({ armed: true, topic: "spotlight effect" });
    expect(manager.current.watchers[0]?.topic).toBe("spotlight effect");
  });

  it("answers a definition via the research provider", async () => {
    const { tools } = await dispatcher();
    const result = await tools.handle({ id: "2", name: "define", args: { word: "inchoate" } });
    expect(String(result.result.definition)).toContain("inchoate");
  });

  it("records a bookmark turn at the current location", async () => {
    const { tools, manager } = await dispatcher();
    manager.observePage({ pageNumber: 88, confidence: 1, paragraphs: [{ text: "x", isHeading: false, isDialogue: false }] });
    const result = await tools.handle({ id: "3", name: "bookmark", args: { label: "great line" } });
    expect(result.result).toMatchObject({ saved: true, location: "page p88", label: "great line" });
    expect(manager.current.turns.at(-1)?.question).toBe("(bookmark)");
  });

  it("rejects an unknown tool name", async () => {
    const { tools } = await dispatcher();
    await expect(tools.handle({ id: "4", name: "nonsense", args: {} })).rejects.toThrow();
  });
});
