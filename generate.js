// Vercel serverless function: keeps your API key private on the server.
const hits = new Map(); // best-effort rate limit (per server instance)
const LIMIT = 10, WINDOW = 60 * 60 * 1000; // 10 requests per IP per hour

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

  const content = images.map(d => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } }));
  content.push({ type: "text", text: prompt });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 2500, messages: [{ role: "user", content }] })
    });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: "upstream error" });
    const j = await r.json();
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "server error" });
  }
};
