// Local development server. Serves site/ and a small API.
// data/store.json stands in for the database until Supabase is wired in (see README).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SITE = path.join(ROOT, "site");
// Nothing outside site/ is served, and nothing hidden inside it: no file or folder whose name starts with a dot (such as
// site/.vercel, which holds deployment settings). The real name on disk is checked as well, because Windows also answers
// to short names such as VERCEL~1.
const SITE_REAL = fs.realpathSync.native(SITE);
const hidden = (base, p) => { const rel = path.relative(base, p); return !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s.startsWith(".")); };
const STORE = process.env.STORE_PATH || path.join(ROOT, "data", "store.json"); // tests point this at a temporary file
const PORT = process.env.PORT || 5173;

// .env.local holds the passcodes and GEMINI_API_KEY (never committed, never sent to the browser).
// Tests point ENV_FILE at a missing file so that they never load the real one.
try {
  for (const line of fs.readFileSync(process.env.ENV_FILE || path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const crypto = require("crypto");
const { reduceLog } = require("./site/assets/model.js");

// Uploads are kept as a history that is never deleted; the current data is rebuilt from it.
// Approved action plans sit in the same history as entries of type "plan". They carry steps, not rows.
const UPLOADS = ["lab", "ili", "clusters", "beds", "clusterlist"];
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
// Only upload entries are reduced to data. The history lists every entry with a count (rows or steps), never the content.
const view = (store, mode, role) => { const log = logOf(store, mode), p = log.filter((e) => e.type === "plan" && !e.undone).pop();
  return { ...reduceLog(log.filter((e) => UPLOADS.includes(e.type) && Array.isArray(e.rows))),
    plan: p ? { id: p.id, at: p.at, by: p.by, role: p.role, source: p.source, steps: p.steps, key: p.key } : null,
    log: log.map(({ rows, steps, ...e }) => ({ ...e, n: (rows || steps || []).length })), auth: { required: authRequired(), role } }; };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".geojson": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml" };

const body = (req) => new Promise((res, rej) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 2e6) { rej(new Error("too large")); req.destroy(); } });
  req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } });
});
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

// AI wording, through Google Gemini's generateContent in JSON mode. The key stays on this server and only computed
// figures are sent, never an uploaded file. gemini() never throws and never logs the key or a prompt: it returns
// { data, model } or { error: a short code }. Both AI endpoints share the limit of 30 calls an hour.
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_WAIT = +process.env.GEMINI_TIMEOUT_MS || 12000;
// The first model is tried first. If it is refused, overloaded, too slow or sends nothing usable, the next ones are
// tried in order. All four were tested with a real key on 11 October 2026: the first answers in about a second, the
// others in about ten. gemini-2.5-flash is not listed: it is refused (404) for keys created after September 2026.
// GEMINI_MODEL replaces the first; GEMINI_FALLBACK_MODELS replaces the rest (comma-separated, or "none" for no fallback).
const DEFAULT_MODEL = "gemini-3.5-flash-lite", DEFAULT_FALLBACKS = "gemini-3.5-flash,gemini-3.8-flash,gemini-3.6-flash";
const cleanModel = (m) => String(m || "").trim().replace(/^models\//, "");
const MODELS = [...new Set([cleanModel(process.env.GEMINI_MODEL) || DEFAULT_MODEL].concat((process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACKS).split(",").map(cleanModel)).filter((m) => m && m !== "none"))];
const NEXT_MODEL = (code) => code === "timeout" || code === "empty" || code === "bad_reply" || /^gemini_(400|404|408|429|5\d\d)$/.test(code); // worth trying another model
let firstModel = 0; // the model that answered last time is tried first next time
const BLOCKED = ["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"];
let calls = [];
async function askModel(model, prompt, key, wait) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), wait);
  // The small model takes a low temperature for steady wording. The larger ones think before answering: they are asked to think little, and are left at their default temperature.
  const generationConfig = /lite/.test(model) ? { responseMimeType: "application/json", temperature: 0.2 } : { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } };
  try {
    const r = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: stop.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
    });
    if (!r.ok) return { error: "gemini_" + r.status };
    const j = await r.json(), c = (j.candidates || [])[0];
    if (!c) return { error: j.promptFeedback && j.promptFeedback.blockReason ? "blocked" : "empty" };
    if (BLOCKED.includes(c.finishReason)) return { error: "blocked" };
    const text = ((c.content && c.content.parts) || []).map((p) => (p && !p.thought && typeof p.text === "string" ? p.text : "")).join("").trim();
    if (!text) return { error: "empty" };
    const data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return data && typeof data === "object" ? { data, model } : { error: "bad_reply" };
  } catch (e) { return { error: stop.signal.aborted ? "timeout" : e instanceof SyntaxError ? "bad_reply" : "network" }; }
  finally { clearTimeout(timer); }
}
// Returns { data, model, tried } from the first model that answers, or { error, tried }. tried lists each model that failed
// before it, with its error code. A fallback gets twice the usual wait; the whole call is given at most four waits.
async function gemini(prompt) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return { error: "no_key" };
  const order = MODELS.slice(firstModel).concat(MODELS.slice(0, firstModel)), tried = [], end = Date.now() + 4 * GEMINI_WAIT;
  let last = "no_model";
  for (const [k, model] of order.entries()) {
    const now = Date.now(), wait = Math.min(k ? 2 * GEMINI_WAIT : GEMINI_WAIT, end - now);
    if (k && wait < GEMINI_WAIT / 4) break; // no time left for another model
    calls = calls.filter((t) => now - t < 3600e3);
    if (calls.length >= 30) { last = "rate_limited"; break; }
    calls.push(now);
    const r = await askModel(model, prompt, key, wait);
    if (!r.error) { firstModel = MODELS.indexOf(model); return { ...r, tried }; }
    last = r.error; tried.push(`${model}: ${r.error}`);
    if (!NEXT_MODEL(r.error)) break;
  }
  return { error: last, tried };
}
// Figures are single computed values under plain names: numbers, yes or no, and short text. The rows of an uploaded file
// are lists, so they can never be passed off as figures.
const figuresOk = (o) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0 && Object.keys(o).length <= 40 && JSON.stringify(o).length <= 4000 &&
  Object.entries(o).every(([k, v]) => /^[A-Za-z]\w{0,59}$/.test(k) && (v === null || typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && v.length <= 200 && !/[<>`\u0000-\u001f]/.test(v))));

// One call per set of figures: overlapping requests share it, a good reply is kept, a failure is forgotten after a minute.
const sums = new Map();
function summary(fig) {
  if (!figuresOk(fig)) return { error: "bad_request" };
  if (fig.simulated_scenario === true) return { error: "simulated" }; // simulated figures are never sent
  const ck = JSON.stringify(fig);
  if (sums.has(ck)) return sums.get(ck);
  const job = (async () => {
    const r = await gemini(`You write short situation summaries for public-health planners in Malaysia. Write in plain English only.
Use ONLY the figures in this JSON. Do not add any number that is not in it. Do not change the alert level, the step or the headline; fixed rules already decided them.
Positivity is the share of tested lab samples that were positive: never call it cases. Say "typed positives" for the virus-type share. Do not give a probability or a chance. Do not say "must" or "will".
Write 2-3 plain sentences: what the trend is, why the step is what it is, and what the stated action is.
Return JSON: {"en": "..."}
FIGURES: ${ck}`);
    if (r.error) return { error: r.error, tried: r.tried };
    const en = typeof r.data.en === "string" ? r.data.en.trim() : "";
    if (!en || en.length > 1200) return { error: "bad_reply" };
    const allowed = new Set(numbersOf(ck));
    if (!numbersOf(en).every((m) => allowed.has(m)) || MARKUP.test(en) || UNSAFE.test(en)) return { error: "guard" }; // the page checks the numbers again
    return { en, model: r.model, ...(r.tried.length ? { tried: r.tried } : {}) };
  })();
  if (sums.size >= 50) sums.delete(sums.keys().next().value);
  sums.set(ck, job);
  job.then((o) => { if (o.error) setTimeout(() => sums.get(ck) === job && sums.delete(ck), 60000).unref(); });
  return job;
}

// Action plan. Fixed rules set the alert level, the early-warning step and the actions; the model only words the
// actions as ordered steps. Every plan, drafted or sent for approval, must pass guard() before it is returned or stored.
const LEVELS = ["green", "yellow", "orange", "red"], STEPS = ["clear", "watch", "warning", "outbreak"]; // as in app.js; a band is one of the first three steps, or "off"
const WHEN = ["today", "within 24 hours", "within 3 days", "this week", "within 2 weeks", "ongoing"];
const ROLES = ["State health department", "State health planner"]; // always allowed, besides the roles in the given actions
const MARKUP = /[<>`*#\[\]{}|\\_~\u0000-\u001f]|https?:|www\./i;
const UNSAFE = /\b(prescrib\w*|oseltamivir|tamiflu|zanamivir|guarantee\w*|cure[sd]?|will (prevent|stop|eliminate))\b/i;
const numbersOf = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).map((m) => String(+m));
// The levels, steps and bands a text names. A colour, "outbreak" and "warning" count wherever they appear, except in the
// page's own terms "data warning" and "early warning". "clear" and "watch" are everyday words, so they count only when
// used as a status: in quotes, brackets or capitals, after "is", "reads", "at", "now" or "back to", or beside step, band, level or stage.
const Q = `["'“‘(\\[]? ?`; // a quote or bracket may open the name
const asStatus = (n) => new RegExp(`["'“‘(\\[] ?${n} ?["'”’)\\]]|\\b(is|was|reads?|at|now|(back|down|up|moved?|dropped|fell|returned|rose|raised|lowered|changed|set|went)( back| down| up)? to) ((now|still|back|at|on) )*${Q}${n}\\b` +
  `|\\b${n} (step|band|level|stage|status|has|is|was|will)\\b|\\b(step|band|level|stage|status|classifier)( (is|of|to|at|now|reads?))*:? ${Q}${n}\\b`, "i");
const capital = (n) => new RegExp(`[a-z0-9,;:)] ${Q}${n[0].toUpperCase()}${n.slice(1)}\\b|\\b${n.toUpperCase()}\\b`);
function named(s) {
  const t = String(s).replace(/\s+/g, " ").replace(/\b(data|early)[- ]warning\b/gi, "$1");
  return LEVELS.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(t)).concat(["warning", "outbreak"].filter((n) => new RegExp(`\\b${n}`, "i").test(t)),
    ["clear", "watch"].filter((n) => capital(n).test(t) || asStatus(n).test(t)));
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const planKey = (p) => crypto.createHash("sha256").update(JSON.stringify(canon([p.figures, p.level, p.band, p.actions]))).digest("hex").slice(0, 16);
const rolesOf = (p) => [...new Set(p.actions.flatMap((a) => [a.who, ...a.who.split(",").map((w) => w.trim())]).concat(ROLES).filter(Boolean))];
// The fixed action rows, word for word as in site/assets/app.js (ACTIONS, STEP_ACTIONS and the data-warning row). A plan
// request must carry one of these sets unchanged, so neither the browser nor the model can bring in an action or a role
// of its own. If the wording changes in app.js it must change here too; tests/plan_test.js compares the two.
const ACTION_SETS = [
  [["Continue routine sentinel surveillance", "State health department"]],
  [["Check that sentinel sites are reporting on time", "State health department"], ["Check influenza vaccine and antiviral stock", "State health department"]],
  [["Draft the school advisory and hold it for release", "State health department"], ["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"],
    ["Ask hospitals to review surge rosters and respiratory ward plans", "Hospital directors"]],
  [["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"], ["Check influenza vaccine and antiviral stock", "State health department"]],
  [["Start school-cluster response and vaccination outreach", "State and district health offices"], ["Hospitals put surge rosters and respiratory ward plans into effect", "Hospital directors"]],
  [["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"], ["Issue a public advisory through official channels", "State health department"],
    ["Continue school-cluster response in all districts", "District health offices"]],
  [["Confirm the newest week's sample count with the lab before acting", "Whoever uploaded the figures"]],
].map((set) => set.map(([action, who]) => ({ action, who })));
const BANDS = ["clear", "watch", "warning", "off"];
const NAME = /^[\p{L}\p{M}\p{N} .,'’()\/&@_:+-]{1,60}$/u; // an approver's name: plain text, nothing a page could read as markup
// The checked inputs of a plan request, or { error } with a plain sentence. The person's name is not part of them and is never sent to the model.
function planInput(b) {
  if (!b || typeof b !== "object") b = {};
  const low = (v) => String(v ?? "").trim().toLowerCase(), level = low(b.level), band = low(b.band), step = low(b.step);
  const sent = JSON.stringify(Array.isArray(b.actions) ? b.actions.map((a) => ({ action: String((a && a.action) ?? "").trim(), who: String((a && a.who) ?? "").trim() })) : null);
  const actions = ACTION_SETS.find((set) => JSON.stringify(set) === sent);
  if (!figuresOk(b.figures)) return { error: "The figures must be single values: numbers, yes or no, or short text." };
  if (!LEVELS.includes(level)) return { error: "The alert level must be green, yellow, orange or red." };
  if (!BANDS.includes(band)) return { error: "The classifier band must be clear, watch, warning or off." };
  if (step && !STEPS.includes(step)) return { error: "The early-warning step must be clear, watch, warning or outbreak." };
  if (!actions) return { error: "The actions are not one of the fixed sets of proposed actions." };
  return { figures: b.figures, level, band, step, actions };
}
// Returns { steps } with clean steps, or { error } with a plain sentence saying what was wrong. A draft has 3 to 6 steps.
// A fixed template (fixed = true) is the proposed actions themselves, one step each, in the same order.
function guard(steps, p, fixed) {
  if (!Array.isArray(steps) || (fixed ? steps.length !== p.actions.length : steps.length < 3 || steps.length > 6))
    return { error: fixed ? "A template plan has one step for each proposed action." : "A plan needs 3 to 6 steps." };
  const roles = rolesOf(p), pick = (list, v) => list.find((x) => x.toLowerCase() === String(v ?? "").trim().toLowerCase());
  const allowed = new Set(numbersOf(JSON.stringify([p.figures, p.actions]))), given = [p.level, p.band, p.step], out = [];
  for (const [i, s] of steps.entries()) {
    const n = `Step ${i + 1}`, what = s && typeof s.what === "string" ? s.what.trim() : "", who = pick(roles, s && s.who), when = pick(WHEN, s && s.when);
    if (fixed && what !== p.actions[i].action) return { error: `${n} is not the proposed action.` };
    if (!fixed && (what.length < 10 || what.length > 220)) return { error: `${n} must be 10 to 220 characters long.` };
    if (!who) return { error: `${n} names a role that is not in the proposed actions.` };
    if (!when) return { error: `${n} has a timing that is not on the fixed list.` };
    if (MARKUP.test(what)) return { error: `${n} contains markup, a symbol or a link.` };
    if (!numbersOf(what).every((m) => allowed.has(m))) return { error: `${n} uses a number that is not in the figures.` };
    const other = named(what).find((w) => !given.includes(w));
    if (other) return { error: `${n} names "${other}", which is not the current alert level, step or band.` };
    if (UNSAFE.test(what)) return { error: `${n} gives treatment advice or promises an outcome.` };
    out.push({ what, who, when });
  }
  return { steps: out };
}
const planPrompt = (p, fix) => `You help a state health planner in Selangor, Malaysia. Write in plain English only.
Fixed rules have already set the alert level and the early-warning step, and chosen the ACTIONS below. Turn the ACTIONS into 3 to 6 ordered tasks the planner can follow.
Rules:
- Use only the FIGURES given. Every number you write must appear in FIGURES. Write no other number, and do not number the tasks.
- Do not add, remove or replace an action. Every task must carry out one of the ACTIONS or prepare for it.
- Do not state or change the alert level, the early-warning step or the classifier band. Do not use the words green, yellow, orange, red, outbreak or warning, and do not use clear or watch as the name of a status.
- No medical treatment advice. No promises about outcomes.
- "what" is one plain sentence of 10 to 220 characters with no markup, links or symbols. Put timing in "when" only.
- "who" must be exactly one of: ${rolesOf(p).join("; ")}
- "when" must be exactly one of: ${WHEN.join("; ")}
Reply as JSON only: {"steps": [{"what": "...", "who": "...", "when": "..."}]}
${fix ? `Your last draft was rejected: ${fix} Correct that and keep every rule.\n` : ""}CONTEXT ONLY, do not repeat it: alert level ${p.level}; classifier band ${p.band || "not given"}; early-warning step ${p.step || "not given"}
ACTIONS: ${JSON.stringify(p.actions)}
FIGURES: ${JSON.stringify(p.figures)}`;
// Good drafts are remembered per mode, in memory and in the store file, so the same inputs never need a second call.
const drafts = {};
const draftsOf = (mode) => drafts[mode] || (drafts[mode] = { ...(readStore()[mode] || {}).drafts });
function keepDraft(mode, key, d) {
  const m = draftsOf(mode);
  delete m[key]; m[key] = d;
  for (const k of Object.keys(m).slice(0, -20)) delete m[k];
  const s = readStore(); s[mode] = { ...s[mode], log: logOf(s, mode), drafts: m }; writeStore(s);
}
async function draftPlan(mode, p) {
  const key = planKey(p), hit = draftsOf(mode)[key], old = hit && guard(hit.steps, p);
  if (old && old.steps) return { source: "cache", key, steps: old.steps, model: hit.model };
  const fallback = (reason, detail, tried) => ({ source: "template", reason, ...(detail ? { detail } : {}), ...(tried && tried.length ? { tried } : {}), key }); // the browser shows its fixed template
  if (p.figures.simulated_scenario === true) return fallback("simulated"); // simulated figures are never sent
  let why = "";
  for (let i = 0; i < 2; i++) { // one retry, and only when the draft fails the guard
    const r = await gemini(planPrompt(p, why));
    if (r.error) return fallback(r.error, "", r.tried);
    const g = guard(r.data.steps, p);
    if (g.steps) { try { keepDraft(mode, key, { steps: g.steps, model: r.model, at: new Date().toISOString() }); } catch {} return { source: "ai", key, steps: g.steps, model: r.model, ...(r.tried.length ? { tried: r.tried } : {}) }; }
    why = g.error;
  }
  return fallback("guard", why);
}

const LAN = process.env.ALLOW_LAN === "1", LOCAL = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
http.createServer(async (req, res) => {
  if (!LAN && !LOCAL.includes(req.socket.remoteAddress)) { res.writeHead(403); return res.end("This server answers only the computer it runs on. Set ALLOW_LAN=1 to open it to the network."); }
  let url; try { url = new URL(req.url, "http://x"); } catch { return send(res, 400, { error: "bad request" }); } // a request line such as "GET //" has no usable address
  try {
    if (["/api/state", "/api/undo", "/api/plan", "/api/plan/approve"].includes(url.pathname)) {
      const mode = url.searchParams.get("mode") === "replay" ? "replay" : "live";
      const store = readStore(), role = roleOf(req), log = logOf(store, mode);
      const deny = () => send(res, role === "locked" ? 429 : 401, { error: role === "locked" ? "too many wrong passcodes" : "passcode" });
      const save = () => { store[mode] = { ...store[mode], log }; writeStore(store); return send(res, 200, view(store, mode, role)); };
      if (url.pathname === "/api/state" && req.method === "GET") return send(res, 200, view(store, mode, role === "locked" ? "viewer" : role));
      if (url.pathname === "/api/state" && req.method === "POST") {
        if (role !== "uploader" && role !== "admin") return deny();
        const b = await body(req);
        if (!UPLOADS.includes(b.type) || !Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return send(res, 400, { error: "bad upload" });
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
      if (url.pathname.startsWith("/api/plan") && req.method === "POST") { // draft a plan, or record one that a named person approved
        if (role !== "uploader" && role !== "admin") return deny();
        const b = await body(req), p = planInput(b);
        if (p.error) return send(res, 400, { error: "bad plan request", detail: p.error });
        if (url.pathname === "/api/plan") return send(res, 200, await draftPlan(mode, p));
        if (!["ai", "cache", "template"].includes(b.source)) return send(res, 400, { error: "bad plan request", detail: "The plan must say whether it is an AI draft or the template." });
        const fixed = b.source === "template", g = guard(b.steps, p, fixed), key = planKey(p), by = String(b.by ?? "").trim();
        if (g.error) return send(res, 400, { error: "plan rejected", detail: g.error });
        // A draft counts only if it is, word for word, the one this server made and checked for these inputs.
        if (!fixed && JSON.stringify((draftsOf(mode)[key] || {}).steps) !== JSON.stringify(g.steps))
          return send(res, 400, { error: "plan rejected", detail: "These steps are not the draft this server made for these figures. Draft the plan again, then approve it." });
        if (p.figures.simulated_scenario === true) return send(res, 400, { error: "plan rejected", detail: "A plan for a simulated scenario cannot be approved." });
        if (!NAME.test(by)) return send(res, 400, { error: "name needed", detail: by ? "Use a plain name of up to 60 characters: letters, numbers, spaces and simple punctuation." : "Enter your name before approving a plan." });
        log.push({ id: crypto.randomUUID(), at: new Date().toISOString(), by, role, type: "plan", source: b.source, steps: g.steps, key });
        return save();
      }
    }
    if (url.pathname === "/api/summary" && req.method === "POST") { // AI wording spends the shared calls, so with passcodes set a viewer cannot ask for it
      const role = roleOf(req);
      if (role !== "uploader" && role !== "admin") return send(res, role === "locked" ? 429 : 401, { error: role === "locked" ? "too many wrong passcodes" : "passcode" });
      return send(res, 200, await summary(await body(req)));
    }
    let p = path.normalize(path.join(SITE, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (hidden(SITE, p) || !fs.existsSync(p) || fs.statSync(p).isDirectory() || hidden(SITE_REAL, fs.realpathSync.native(p))) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(p).on("error", () => res.destroy()).pipe(res);
  } catch (e) { if (res.headersSent) res.destroy(); else send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => {
  console.log(`FluSentinel running at http://localhost:${PORT}  (replay demo: /?replay=1)`);
  console.log(`  AI wording: ${(process.env.GEMINI_API_KEY || "").trim() ? `on (model ${MODELS[0]}${MODELS.length > 1 ? `, then ${MODELS.slice(1).join(", ")} if it fails` : ", no fallback"})` : "off (no GEMINI_API_KEY in .env.local)"}`);
  console.log(`  Passcodes: ${authRequired() ? "set" : "none (open mode: whoever can reach this server is admin)"}`);
  console.log(`  Reachable from: ${LAN ? "the local network (ALLOW_LAN=1)" : "this computer only"}`);
});
