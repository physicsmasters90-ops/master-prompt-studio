// Netlify function (FREE version using Google Gemini API free tier).
// Your key stays private on the server (set GEMINI_API_KEY in Netlify).
const hits = new Map(); // best-effort rate limit (per server instance)
const LIMIT = 10, WINDOW = 60 * 60 * 1000; // 10 requests per IP per hour
const BASE = "https://generativelanguage.googleapis.com/v1beta/";
const send = (statusCode, obj) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

function gemini(model, parts) {
  return fetch(BASE + "models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 3000 } })
  });
}

exports.handler = async (event) => {
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

  // Diagnostics: /api/generate?test=1 (tests your model) or ?test=models (lists model names)
  if (event.httpMethod === "GET") {
    const t = event.queryStringParameters && event.queryStringParameters.test;
    if (!t) return send(405, { error: "POST only" });
    if (!process.env.GEMINI_API_KEY) return send(200, { problem: "GEMINI_API_KEY is missing in Netlify" });
    try {
      if (t === "models") {
        const r = await fetch(BASE + "models?pageSize=100", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } });
        const j = await r.json();
        if (!r.ok) return send(200, { status: r.status, error: j.error && j.error.message });
        return send(200, {
          models: (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map(m => m.name.replace("models/", "")).filter(n => /gemini/.test(n))
        });
      }
      const r = await gemini(model, [{ text: "Say hello in five words." }]);
      const j = await r.json();
      return send(200, {
        model_used: model, status: r.status,
        error: j.error && j.error.message,
        reply: ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join(" ")
      });
    } catch (e) { return send(200, { problem: String(e) }); }
  }

  if (event.httpMethod !== "POST") return send(405, { error: "POST only" });

  const h = event.headers || {};
  const ip = (h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (recent.length >= LIMIT) return send(429, { error: "rate limited" });
  recent.push(now); hits.set(ip, recent);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return send(400, { error: "bad request" }); }
  const { prompt, images = [] } = body;
  if (typeof prompt !== "string" || prompt.length > 10000 || !Array.isArray(images) || images.length > 6)
    return send(400, { error: "bad request" });

  const parts = images.map(d => ({ inline_data: { mime_type: "image/jpeg", data: d } }));
  parts.push({ text: prompt });

  try {
    const r = await gemini(model, parts);
    if (!r.ok) {
      const txt = await r.text();
      console.error("Gemini error", r.status, txt);
      return send(r.status === 429 ? 429 : 502, { error: "upstream error", detail: txt.slice(0, 300) });
    }
    const j = await r.json();
    const text = ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
    if (!text) return send(502, { error: "empty response" });
    return send(200, { text });
  } catch (e) {
    console.error(e);
    return send(500, { error: "server error" });
  }
};
