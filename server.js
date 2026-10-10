// Local development server. Serves site/ and a small API.
// data/store.json stands in for the database until Supabase is wired in (see README).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SITE = path.join(ROOT, "site");
const STORE = path.join(ROOT, "data", "store.json");
const PORT = process.env.PORT || 5173;

// .env.local holds GEMINI_API_KEY (never committed, never sent to the browser)
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const empty = () => ({ lab: [], ili: [], clusters: [], beds: [], clusterlist: [], stamp: null });
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const writeStore = (s) => fs.writeFileSync(STORE, JSON.stringify(s, null, 1));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".geojson": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml" };

const body = (req) => new Promise((res, rej) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 2e6) { rej(new Error("too large")); req.destroy(); } });
  req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } });
});
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

const cache = new Map();
let calls = [];
async function summary(fig) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "no_key" };
  const ck = JSON.stringify(fig);
  if (cache.has(ck)) return cache.get(ck);
  const now = Date.now();
  calls = calls.filter((t) => now - t < 3600e3);
  if (calls.length >= 30) return { error: "rate_limited" };
  calls.push(now);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = `You write short situation summaries for public-health planners in Malaysia.
Use ONLY the figures in this JSON. Do not add any number that is not in it. Do not change the alert level or headline; a fixed rule already decided them.
Write 2-3 plain sentences: what the trend is, why the alert is at this level, and what the stated action is.
Return JSON: {"en": "...", "bm": "..."} (English and Bahasa Melayu).
FIGURES: ${JSON.stringify(fig)}`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
  });
  if (!r.ok) return { error: "gemini_" + r.status };
  const j = await r.json();
  let out;
  try { out = { ...JSON.parse(j.candidates[0].content.parts[0].text), model }; } catch { return { error: "bad_reply" }; }
  cache.set(ck, out);
  return out;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/state") {
      const mode = url.searchParams.get("mode") === "replay" ? "replay" : "live";
      const store = readStore();
      if (req.method === "GET") return send(res, 200, store[mode] || empty());
      if (req.method === "POST") {
        const b = await body(req);
        const cur = store[mode] || empty();
        if (!["lab", "ili", "clusters", "beds", "clusterlist"].includes(b.type) || !Array.isArray(b.rows) || b.rows.length > 500) return send(res, 400, { error: "bad upload" });
        cur[b.type] = b.type === "beds" || b.type === "clusterlist" ? b.rows : (cur[b.type] || []).concat(b.rows);
        cur.stamp = new Date().toISOString();
        store[mode] = cur; writeStore(store);
        return send(res, 200, cur);
      }
      if (req.method === "DELETE") { store[mode] = empty(); writeStore(store); return send(res, 200, store[mode]); }
    }
    if (url.pathname === "/api/summary" && req.method === "POST") return send(res, 200, await summary(await body(req)));
    let p = path.normalize(path.join(SITE, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(p).pipe(res);
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`FluSentinel running at http://localhost:${PORT}  (replay demo: /?replay=1)`));
