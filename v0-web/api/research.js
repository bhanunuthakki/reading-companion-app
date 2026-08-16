import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_INSTRUCTION = `You are a reading companion for someone reading a physical book or article.
They've just looked at a page, asked a question, and you can see what they're reading via a photo.

Your job:
1. Briefly identify what passage or concept they're asking about (one phrase, not a quote).
2. Answer their question in plain conversational prose suitable for being read aloud.
3. Use grounded web search when the question calls for facts beyond the page.

Rules for the spoken answer:
- Maximum 50 words.
- No markdown, no lists, no asterisks, no bullet points. Your response is read aloud verbatim by text-to-speech.
- Lead with the substance. No "Great question!" or "Looking at the page..." preambles.
- Don't say "see the link below" or refer to anything visual — citations appear in the user's session log separately.
- If the photo doesn't clearly show what they're asking about, say so briefly and ask one clarifying question.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Server not configured: GEMINI_API_KEY is not set.",
    });
  }

  const { image_base64, question } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field." });
  }
  if (!image_base64 || typeof image_base64 !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'image_base64' field." });
  }

  const cleanedBase64 = image_base64.replace(/^data:image\/\w+;base64,/, "");

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
    });

    const result = await model.generateContent([
      { inlineData: { mimeType: "image/jpeg", data: cleanedBase64 } },
      { text: `Question: ${question}` },
    ]);

    const response = result.response;
    const answer = response.text().trim();

    const grounding = response.candidates?.[0]?.groundingMetadata;
    const citations = (grounding?.groundingChunks || [])
      .map((c) => c.web)
      .filter(Boolean)
      .map((w) => ({ title: w.title || w.uri, url: w.uri }))
      .filter((c) => c.url);

    const dedupedCitations = Array.from(
      new Map(citations.map((c) => [c.url, c])).values()
    ).slice(0, 6);

    return res.status(200).json({
      answer,
      citations: dedupedCitations,
      model: MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Gemini error:", err);
    return res.status(500).json({
      error: "Research call failed.",
      detail: err?.message || String(err),
    });
  }
}
