import { describe, it, expect } from "vitest";
import { ContentResolver, type ContentCatalog } from "../src/content/resolver";
import { ContentEnricher, type EnrichmentSource, type DossierContribution } from "../src/content/enricher";
import type { ContentRef } from "../src/types";

function source(name: string, contribution: Omit<DossierContribution, "sourceName">): EnrichmentSource {
  return {
    name,
    contribute: async (): Promise<DossierContribution> => ({ sourceName: name, ...contribution }),
  };
}

function failingSource(name: string): EnrichmentSource {
  return {
    name,
    contribute: async (): Promise<DossierContribution> => {
      throw new Error("source down");
    },
  };
}

describe("ContentResolver", () => {
  it("resolves a ref from a stated title without a catalog", async () => {
    const resolver = new ContentResolver();
    const ref = await resolver.resolve({ kind: "book", statedTitle: "Sapiens", statedAuthor: "Harari" });
    expect(ref).toMatchObject({ kind: "book", title: "Sapiens", author: "Harari" });
  });

  it("guesses the title from cover OCR when none is stated", async () => {
    const resolver = new ContentResolver();
    const ref = await resolver.resolve({ kind: "book", coverText: "  \nThinking, Fast and Slow\nDaniel Kahneman" });
    expect(ref.title).toBe("Thinking, Fast and Slow");
  });

  it("prefers a catalog's canonical ref", async () => {
    const catalog: ContentCatalog = {
      lookup: async (): Promise<ContentRef | null> => ({
        kind: "book",
        title: "Thinking, Fast and Slow",
        author: "Daniel Kahneman",
        isbn: "9780374533557",
      }),
    };
    const resolver = new ContentResolver(catalog);
    const ref = await resolver.resolve({ kind: "book", statedTitle: "thinking fast n slow" });
    expect(ref.isbn).toBe("9780374533557");
    expect(ref.title).toBe("Thinking, Fast and Slow");
  });

  it("throws when no title can be derived", async () => {
    const resolver = new ContentResolver();
    await expect(resolver.resolve({ kind: "podcast" })).rejects.toThrow();
  });
});

const podcastRef: ContentRef = { kind: "podcast", title: "Conversations with Tyler", episodeGuid: "ep-42" };

describe("ContentEnricher", () => {
  it("merges contributions from multiple sources into one dossier", async () => {
    const enricher = new ContentEnricher([
      source("meta", { summary: "An economics interview show.", themes: ["economics", "culture"] }),
      source("reviews", {
        summary: "A long, detailed, much longer summary of the show's reception and style overall.",
        themes: ["culture", "ideas"],
        reviews: [{ source: "The Atlantic", summary: "Sharp and wide-ranging." }],
      }),
    ]);

    const dossier = await enricher.build(podcastRef);
    // Longest summary wins.
    expect(dossier.summary).toContain("reception");
    // Themes are unioned and de-duplicated (culture appears once).
    expect(dossier.themes).toEqual(["economics", "culture", "ideas"]);
    expect(dossier.reviews).toHaveLength(1);
    expect(dossier.sources).toContain("meta");
    expect(dossier.sources).toContain("reviews");
    expect(dossier.builtAt).toBeTruthy();
  });

  it("survives a failing source and reports it", async () => {
    const errors: string[] = [];
    const enricher = new ContentEnricher(
      [source("ok", { summary: "Fine." }), failingSource("broken")],
      (name) => errors.push(name),
    );

    const dossier = await enricher.build(podcastRef);
    expect(dossier.summary).toBe("Fine.");
    expect(dossier.sources).toEqual(["ok"]);
    expect(errors).toEqual(["broken"]);
  });

  it("falls back to a title-based summary when no source has one", async () => {
    const enricher = new ContentEnricher([source("empty", {})]);
    const dossier = await enricher.build({ kind: "book", title: "Dune", author: "Herbert" });
    expect(dossier.summary).toBe("Dune by Herbert");
  });
});
