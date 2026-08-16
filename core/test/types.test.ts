import { describe, it, expect } from "vitest";
import { sessionKey, isVisualKind, initialCursor, newSession, type ContentRef } from "../src/types";

describe("sessionKey", () => {
  it("is stable for the same ref", () => {
    const ref: ContentRef = { kind: "book", title: "Sapiens", author: "Yuval Noah Harari" };
    expect(sessionKey(ref)).toBe(sessionKey({ ...ref }));
  });

  it("normalizes title casing and whitespace so resume matches", () => {
    const a = sessionKey({ kind: "book", title: "Thinking, Fast and Slow", author: "Kahneman" });
    const b = sessionKey({ kind: "book", title: "  thinking   fast  and slow ", author: "kahneman" });
    expect(a).toBe(b);
  });

  it("distinguishes the same title across content kinds", () => {
    expect(sessionKey({ kind: "book", title: "Dune" })).not.toBe(
      sessionKey({ kind: "audiobook", title: "Dune" }),
    );
  });
});

describe("isVisualKind", () => {
  it("treats book and kindle as visual", () => {
    expect(isVisualKind("book")).toBe(true);
    expect(isVisualKind("kindle")).toBe(true);
  });

  it("treats audiobook and podcast as non-visual", () => {
    expect(isVisualKind("audiobook")).toBe(false);
    expect(isVisualKind("podcast")).toBe(false);
  });
});

describe("initialCursor / newSession", () => {
  it("uses a page cursor for visual kinds", () => {
    expect(initialCursor("book").type).toBe("page");
    expect(newSession({ kind: "kindle", title: "X" }).cursor.type).toBe("page");
  });

  it("uses a time cursor for audio kinds", () => {
    expect(initialCursor("podcast").type).toBe("time");
    expect(newSession({ kind: "audiobook", title: "Y" }).cursor.type).toBe("time");
  });

  it("derives the session key from the ref", () => {
    const ref: ContentRef = { kind: "podcast", title: "Conversations with Tyler", episodeGuid: "ep-42" };
    expect(newSession(ref).key).toBe(sessionKey(ref));
  });
});
