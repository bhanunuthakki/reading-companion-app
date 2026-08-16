export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    keyConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
}
