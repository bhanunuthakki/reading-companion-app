import { describe, it, expect } from "vitest";
import { PageText } from "../src/types";

// The OCR network call itself needs an API key, so we test the output contract:
// the structured PageText that the rest of the pipeline depends on.
describe("PageText (OCR output contract)", () => {
  it("accepts a minimal page and fills paragraph + confidence defaults", () => {
    const page = PageText.parse({ paragraphs: [{ text: "Once upon a time." }] });
    expect(page.paragraphs[0]?.isHeading).toBe(false);
    expect(page.paragraphs[0]?.isDialogue).toBe(false);
    expect(page.confidence).toBe(1);
  });

  it("preserves heading and dialogue flags", () => {
    const page = PageText.parse({
      pageNumber: 12,
      confidence: 0.9,
      paragraphs: [
        { text: "Chapter Two", isHeading: true },
        { text: "“Who's there?” she asked.", isDialogue: true },
      ],
    });
    expect(page.pageNumber).toBe(12);
    expect(page.paragraphs[0]?.isHeading).toBe(true);
    expect(page.paragraphs[1]?.isDialogue).toBe(true);
  });

  it("rejects a page with no paragraphs array", () => {
    expect(() => PageText.parse({ confidence: 1 })).toThrow();
  });
});
