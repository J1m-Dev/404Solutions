// Local development server. Serves site/ and a small API.
// data/store.json stands in for the database until Supabase is wired in (see README).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SITE = path.join(ROOT, "site");
const STORE = process.env.STORE_PATH || path.join(ROOT, "data", "store.json"); // tests point this at a temporary file
const PORT = process.env.PORT || 5173;

// .env.local holds the passcodes and GEMINI_API_KEY (never committed, never sent to the browser)
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const crypto = require("crypto");
const { reduceLog } = require("./site/assets/model.js");

// Uploads are kept as a history that is never deleted; the current data is rebuilt from it.
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } };
const writeStore = (s) => fs.writeFileSync(STORE, JSON.stringify(s, null, 1));
const logOf = (store, mode) => (store[mode] && Array.isArray(store[mode].log) ? store[mode].log : []);

// Roles: viewer (read), uploader (upload, undo one upload), admin (also restore and reset everything).
// Passcodes come from .env.local. With none set, the server is in open mode and everyone is admin.
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const authRequired = () => !!(process.env.UPLOAD_PASSCODE || process.env.ADMIN_PASSCODE);
const fails = new Map();
function roleOf(req) {
  if (!authRequired()) return "admin";
  const p = req.headers["x-passcode"] || "", ip = req.socket.remoteAddress, now = Date.now();
  const f = (fails.get(ip) || []).filter((t) => now - t < 600e3);
  if (f.length >= 10) return "locked";
  if (process.env.ADMIN_PASSCODE && same(p, process.env.ADMIN_PASSCODE)) return "admin";
  if (process.env.UPLOAD_PASSCODE && same(p, process.env.UPLOAD_PASSCODE)) return "uploader";
  if (p) { f.push(now); fails.set(ip, f); }
  return "viewer";
}
const view = (store, mode, role) => { const log = logOf(store, mode);
  return { ...reduceLog(log), log: log.map(({ rows, ...e }) => ({ ...e, n: rows.length })), auth: { required: authRequired(), role } }; };
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
    if (url.pathname === "/api/state" || url.pathname === "/api/undo") {
      const mode = url.searchParams.get("mode") === "replay" ? "replay" : "live";
      const store = readStore(), role = roleOf(req), log = logOf(store, mode);
      const deny = () => send(res, role === "locked" ? 429 : 401, { error: role === "locked" ? "too many wrong passcodes" : "passcode" });
      const save = () => { store[mode] = { log }; writeStore(store); return send(res, 200, view(store, mode, role)); };
      if (url.pathname === "/api/state" && req.method === "GET") return send(res, 200, view(store, mode, role === "locked" ? "viewer" : role));
      if (url.pathname === "/api/state" && req.method === "POST") {
        if (role !== "uploader" && role !== "admin") return deny();
        const b = await body(req);
        if (!["lab", "ili", "clusters", "beds", "clusterlist"].includes(b.type) || !Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return send(res, 400, { error: "bad upload" });
        log.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by: String(b.by || "").slice(0, 60) || "unnamed", role, type: b.type, own: !!b.own, rows: b.rows });
        return save();
      }
      if (url.pathname === "/api/undo" && req.method === "POST") {
        const b = await body(req), e = log.find((x) => x.id === b.id);
        if (!e) return send(res, 404, { error: "no such upload" });
        if (b.restore ? role !== "admin" : role !== "uploader" && role !== "admin") return deny();
        e.undone = !b.restore; e.changedAt = new Date().toISOString(); e.changedBy = role;
        return save();
      }
      if (url.pathname === "/api/state" && req.method === "DELETE") { // reset: every upload is marked undone, none is erased
        if (role !== "admin") return deny();
        log.forEach((e) => { if (!e.undone) { e.undone = true; e.changedAt = new Date().toISOString(); e.changedBy = role; } });
        return save();
      }
    }
    if (url.pathname === "/api/summary" && req.method === "POST") return send(res, 200, await summary(await body(req)));
    let p = path.normalize(path.join(SITE, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(p).pipe(res);
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`FluSentinel running at http://localhost:${PORT}  (replay demo: /?replay=1)`));
