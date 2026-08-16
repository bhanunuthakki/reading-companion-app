/**
 * Capture handling — one contextual grab in, a classified Capture out.
 *
 * The CaptureExtractor is the provider seam: GeminiCaptureExtractor classifies
 * the CaptureKind and extracts text/description in one structured vision call
 * (kind "page" routes through the existing PageText OCR so the reading pipeline
 * is unchanged); OfflineCaptureExtractor never fabricates content — with no key
 * the extract is the explicit OFFLINE_EXTRACTION_MARKER and the hinted (or
 * "scene") kind is stored as-is.
 *
 * Privacy (thought-partner-spec.md §9): the image is used for the single
 * extraction call and then discarded. The Capture schema has no image field,
 * so image bytes can never reach the CaptureStore.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { Capture, CaptureKind } from "./types";
import { GeminiOcrClient } from "./imagePipeline/ocr";
import { FileDocStore, MemoryDocStore, type DocStore } from "./docStore";

/**
 * The explicit fail-loud extract used when no vision model is available.
 * Never index or research over this marker — it is an absence, not content.
 */
export const OFFLINE_EXTRACTION_MARKER = "[extraction unavailable offline — set GEMINI_API_KEY]";

export interface CaptureExtraction {
  kind: CaptureKind;
  extract: string;
}

export interface CaptureExtractor {
  /** Classify + extract. The imageBase64 is consumed by this one call and then discarded. */
  extract(imageBase64: string, hintKind?: CaptureKind): Promise<CaptureExtraction>;
}

/** Offline: store the hinted (or "scene") kind with the explicit marker — no fabricated content, ever. */
export class OfflineCaptureExtractor implements CaptureExtractor {
  async extract(_imageBase64: string, hintKind?: CaptureKind): Promise<CaptureExtraction> {
    return { kind: hintKind ?? "scene", extract: OFFLINE_EXTRACTION_MARKER };
  }
}

const CAPTURE_PROMPT = `Classify this image for a background research partner and extract its useful content.
"kind" is exactly one of: page (a book or e-reader page), document, whiteboard, screen, scene, object.
"extract" is the readable text verbatim when the image contains text, otherwise a concise factual description of what is shown.
Describe any people generically (e.g. "a person at a desk"); never identify, name, or infer the identity of anyone.
Respond with ONLY a JSON object of this exact shape (no prose, no markdown):
{ "kind": "<kind>", "extract": "<text or description>" }`;

const CaptureModelResponse = z.object({ kind: CaptureKind, extract: z.string() });

export class GeminiCaptureExtractor implements CaptureExtractor {
  private readonly ai: GoogleGenAI;
  private readonly ocr: GeminiOcrClient;

  constructor(apiKey: string, private readonly model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.ocr = new GeminiOcrClient(apiKey, this.model);
  }

  async extract(imageBase64: string, hintKind?: CaptureKind): Promise<CaptureExtraction> {
    if (hintKind === "page") return this.extractPage(imageBase64);
    const data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data } }, { text: CAPTURE_PROMPT }],
        },
      ],
      config: { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Capture extraction returned an empty response.");
    const parsed = CaptureModelResponse.parse(JSON.parse(text));
    // A classified page still goes through the canonical PageText OCR path.
    if (parsed.kind === "page") return this.extractPage(imageBase64);
    return parsed;
  }

  private async extractPage(imageBase64: string): Promise<CaptureExtraction> {
    const pageText = await this.ocr.ocrPage(imageBase64);
    return { kind: "page", extract: pageText.paragraphs.map((p) => p.text).join("\n") };
  }
}

// ── CaptureStore ────────────────────────────────────────────────────────────

export interface CaptureStore {
  /** The capture with this id, or null if none exists. */
  load(id: string): Promise<Capture | null>;
  /** Validate + persist. Only the extract persists — the schema has no image field. */
  save(capture: Capture): Promise<Capture>;
  /** Every capture, newest first (MemoryIndex seeding). */
  list(): Promise<Capture[]>;
  /** Forget a capture. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

class DocCaptureStore implements CaptureStore {
  constructor(private readonly docs: DocStore<Capture>) {}

  load(id: string): Promise<Capture | null> {
    return this.docs.load(id);
  }

  save(capture: Capture): Promise<Capture> {
    return this.docs.save(capture);
  }

  async list(): Promise<Capture[]> {
    const captures = await this.docs.list();
    captures.sort((a, b) => b.ts.localeCompare(a.ts));
    return captures;
  }

  remove(id: string): Promise<void> {
    return this.docs.remove(id);
  }
}

export class FileCaptureStore extends DocCaptureStore {
  constructor(dir: string) {
    super(new FileDocStore(dir, Capture));
  }
}

export class InMemoryCaptureStore extends DocCaptureStore {
  constructor() {
    super(new MemoryDocStore(Capture));
  }
}
