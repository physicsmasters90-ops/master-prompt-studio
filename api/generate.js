const hits = new Map();
const LIMIT = 10, WINDOW = 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "rate limited" });
  recent.push(now); hits.set(ip, recent);

  const { prompt, images = [] } = req.body || {};
  if (typeof prompt !== "string" || prompt.length > 10000 || !Array.isArray(images) || images.length > 6)
    return res.status(400).json({ error: "bad request" });

  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const parts = images.map(d => ({ inline_data: { mime_type: "image/jpeg", data: d } }));
  parts.push({ text: prompt });

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 3000 } })
      }
    );
    if (!r.ok) {
      console.error("Gemini error", r.status, await r.text());
      return res.status(r.status === 429 ? 429 : 502).json({ error: "upstream error" });
    }
    const j = await r.json();
    const text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
    if (!text) return res.status(502).json({ error: "empty response" });
    return res.status(200).json({ text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
};
