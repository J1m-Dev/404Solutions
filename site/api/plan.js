// DOM · Draft with AI. A Vercel serverless function (Node, CommonJS): the hosted twin of POST /api/plan in the team's
// local server (server.js). The app's own "Draft with AI" button calls it through assets/pages/planai.js.
// Fixed rules set the alert level, the early-warning step and the actions; the model (through OpenRouter) only words the
// actions as ordered steps, and every draft must pass guard() below before it is returned. Nothing is stored here, so a
// plan cannot be approved through this function: approval needs the team's own server, which keeps the signed record.
// The key is read from the environment (OPENROUTER_API_KEY, set in Vercel). It is never logged or returned, and neither
// is the prompt or the model's raw reply. This file must not require server.js: that file starts a server when loaded.
"use strict";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const MAX_BODY = 16 * 1024;
const TIMEOUT_MS = 12000;

// ==== BEGIN: copied word for word from server.js (the team's local server). These rules must stay IDENTICAL to that
// ==== file: the page tells the reader "Checked on the server before it was shown: every number is one of those figures,
// ==== and each role and deadline comes from a fixed list. It cannot change the step or the actions." If server.js
// ==== changes, copy the change here; do not reword, reorder or loosen anything between BEGIN and END.
// Figures are single computed values under plain names: numbers, yes or no, and short text. The rows of an uploaded file
// are lists, so they can never be passed off as figures.
const figuresOk = (o) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0 && Object.keys(o).length <= 40 && JSON.stringify(o).length <= 4000 &&
  Object.entries(o).every(([k, v]) => /^[A-Za-z]\w{0,59}$/.test(k) && (v === null || typeof v === "boolean" || typeof v === "number" || (typeof v === "string" && v.length <= 200 && !/[<>`\u0000-\u001f]/.test(v))));
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
// ==== END: copied word for word from server.js. Left out on purpose: canon, planKey, the drafts cache and the store
// ==== (nothing is kept here), and NAME (an approver's name is only checked when a plan is approved).

// The model's reply as an object, or null. A fenced block is unwrapped, as in server.js; text around the object is cut off.
function parseReply(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), z = t.lastIndexOf("}");
  if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch (e) {} }
  return null;
}
// One call to OpenRouter. Never throws and never logs: returns { data } or { error: a short code }.
async function callOnce(key, model, prompt, extra) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, { method: "POST", signal: stop.signal,
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Title": "DOM" },
      body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: "user", content: prompt }], ...extra }) });
    if (!r.ok) return { error: "http_" + r.status };
    const j = await r.json(), c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === "string" ? x.text : "")).join("") : "";
    if (!text.trim()) return { error: "empty" };
    const data = parseReply(text);
    return data && typeof data === "object" ? { data } : { error: "bad_reply" };
  } catch (e) { return { error: stop.signal.aborted ? "timeout" : "network" }; }
  finally { clearTimeout(timer); }
}
// JSON mode and a low temperature for steady wording. If the service refuses the request outright (status 400), the
// same prompt is sent once more without those two options; the guard checks the reply either way.
async function askModel(key, model, prompt) {
  const r = await callOnce(key, model, prompt, { temperature: 0.2, response_format: { type: "json_object" } });
  return r.error === "http_400" ? callOnce(key, model, prompt, {}) : r;
}

// As draftPlan in server.js, without the cache and the store: { source: "ai", steps, model } when a draft passes the
// guard, otherwise { source: "template", reason } and the page shows its own fixed template.
async function draftPlan(p, key) {
  const fallback = (reason, detail) => ({ source: "template", reason, ...(detail ? { detail } : {}) });
  if (p.figures.simulated_scenario === true) return fallback("simulated"); // simulated figures are never sent
  if (!key) return fallback("no_key");
  const model = String(process.env.PLAN_MODEL || "").trim() || DEFAULT_MODEL;
  let why = "";
  for (let i = 0; i < 2; i++) { // one retry, and only when the draft fails the guard
    const r = await askModel(key, model, planPrompt(p, why));
    if (r.error) return fallback("upstream");
    const g = guard(r.data.steps, p);
    if (g.steps) return { source: "ai", steps: g.steps, model };
    why = g.error;
  }
  return fallback("guard", why);
}

function readStream(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; } parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}
// The request body as sent: an object when it could be read, null when it is missing or malformed (planInput then
// answers with its own sentence), or TOO_LARGE.
const TOO_LARGE = Symbol("too large");
async function readBody(req) {
  let raw;
  try { raw = req.body; } catch (e) { return null; } // Vercel's own parser throws on malformed JSON
  try {
    if (raw === undefined || raw === null) raw = await readStream(req);
    if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
    if (typeof raw === "string") { if (Buffer.byteLength(raw) > MAX_BODY) return TOO_LARGE; raw = raw ? JSON.parse(raw) : null; }
    if (raw && typeof raw === "object" && Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY) return TOO_LARGE;
    return raw;
  } catch (e) { return e && e.message === "too large" ? TOO_LARGE : null; }
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(obj)); };
  try {
    const key = String(process.env.OPENROUTER_API_KEY || "").trim();
    // GET: the page asks once whether drafting is switched on here, before it enables the button
    if (req.method === "GET") return send(200, { ok: true, ai: Boolean(key) });
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return send(405, { error: "method" }); }
    // a browser on another site may not use this function: when an Origin is sent, its host must be this host
    const origin = req.headers && req.headers.origin, host = req.headers && req.headers.host;
    if (origin) { let oh = ""; try { oh = new URL(String(origin)).host; } catch (e) {} if (!oh || !host || oh.toLowerCase() !== String(host).toLowerCase()) return send(403, { error: "origin" }); }
    if (Number(req.headers && req.headers["content-length"]) > MAX_BODY) return send(413, { error: "too large" });
    const b = await readBody(req);
    if (b === TOO_LARGE) return send(413, { error: "too large" });
    const p = planInput(b); // the person's name ("by") is not part of the checked inputs and is never sent to the model
    if (p.error) return send(400, { error: "bad plan request", detail: p.error });
    return send(200, await draftPlan(p, key));
  } catch (e) { return send(500, { error: "server" }); }
};
