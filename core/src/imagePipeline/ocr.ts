/**
 * OCR: a sharp page Frame in, structured PageText out.
 *
 * The PageChangeDetector decides *when* a page is worth reading; this turns that
 * one Frame into verbatim, structured text. We mark headings and dialogue so the
 * voice layer can modulate tone and the cursor can track paragraph position.
 *
 * The call is I/O against Gemini Flash and only runs with an API key. The output
 * is Zod-validated, so a malformed model response fails loudly rather than
 * feeding garbage into the session.
 */
import { GoogleGenAI } from "@google/genai";
import { PageText } from "../types";

const OCR_PROMPT = `Extract the readable text from this page image for a reading companion.
Preserve paragraph order and breaks. For each paragraph, decide if it is a heading and if it is dialogue.
Respond with ONLY a JSON object of this exact shape (no prose, no markdown):
{
  "pageNumber": <integer page number if visible, else omit>,
  "confidence": <0..1 how legible the page was>,
  "paragraphs": [ { "text": "<verbatim paragraph>", "isHeading": <bool>, "isDialogue": <bool> } ]
}`;

export interface OcrClient {
  ocrPage(imageBase64: string, mimeType?: string): Promise<PageText>;
}

export class GeminiOcrClient implements OcrClient {
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async ocrPage(imageBase64: string, mimeType = "image/jpeg"): Promise<PageText> {
    const data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data } }, { text: OCR_PROMPT }],
        },
      ],
      config: { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("OCR returned an empty response.");
    return PageText.parse(JSON.parse(text));
  }
}
