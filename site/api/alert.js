// DOM · POST /api/alert (Vercel serverless function, Node, CommonJS).
// Posts the early-warning step and its first action to the team's public Telegram channel, so a planner who joined the
// channel gets them on a phone without opening the dashboard. The page sends only what the app itself shows.
// Settings come from the environment, set in Vercel and never in this repository:
//   TELEGRAM_BOT_TOKEN  the bot's token (required)
//   ALERT_PASSCODE      optional: when set, a sender must give it. Without it the function still accepts only the fixed plain-text fields, from this site's own pages, one message per 10 seconds
//   TELEGRAM_CHAT_ID    the channel (optional; default "@dom_alerts_demo")
// The token is part of the address this function calls. Nothing here logs or returns that address, the token,
// or what Telegram answers.
const crypto = require("crypto");

const STEPS = ["Clear", "Watch", "Warning", "Outbreak"];
const MARKUP = /[<>`*#\[\]{}|\\_~\u0000-\u001f]|https?:|www\./i;   // the team's own rule (server.js): plain text only, no markup, no links
const MAX_BODY = 4096, GAP_MS = 10000, TIMEOUT_MS = 10000;
const FIELDS = { action: [3, 160], who: [0, 80], when: [0, 40], basis: [0, 140] };   // [fewest, most] characters
let last = 0;   // when this instance last sent a message

function reply(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// The body as an object: what the platform already parsed, or the raw stream. Anything else, or 4 KB and over, is refused.
async function readBody(req) {
  let b;
  try { b = req.body; } catch (e) { return null; }   // the platform's parser throws on broken JSON
  if (b === undefined || b === null) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size >= MAX_BODY) return null; chunks.push(Buffer.from(chunk)); }
    b = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(b)) b = b.toString("utf8");
  if (typeof b === "string") { if (Buffer.byteLength(b) >= MAX_BODY) return null; try { b = JSON.parse(b); } catch (e) { return null; } }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  let text; try { text = JSON.stringify(b); } catch (e) { return null; }
  return Buffer.byteLength(text) < MAX_BODY ? b : null;
}

// Equal-length buffers for the comparison, whatever was typed: both sides are hashed first.
function samePasscode(given, expected) {
  if (typeof given !== "string" || !given) return false;
  const h = (s) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

// The four text fields, trimmed, or null when one of them is not plain text of the right length.
function clean(body) {
  if (typeof body.step !== "string" || !STEPS.includes(body.step)) return null;
  const out = { step: body.step };
  for (const [key, [min, max]] of Object.entries(FIELDS)) {
    const v = body[key] === undefined || body[key] === null ? "" : body[key];
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (t.length < min || t.length > max || MARKUP.test(t)) return null;
    out[key] = t;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return reply(res, 405, { error: "method" }); }
  // a browser on another site may not send through this function
  const origin = req.headers.origin;
  if (origin) { let host = null; try { host = new URL(origin).host; } catch (e) {} if (!host || host !== req.headers.host) return reply(res, 403, { error: "origin" }); }

  const token = process.env.TELEGRAM_BOT_TOKEN, passcode = process.env.ALERT_PASSCODE, chat = process.env.TELEGRAM_CHAT_ID || "@dom_alerts_demo";
  if (!token) return reply(res, 503, { error: "no_bot" });

  if (Number(req.headers["content-length"]) >= MAX_BODY) return reply(res, 400, { error: "bad_request" });
  let body; try { body = await readBody(req); } catch (e) { body = null; }
  if (!body) return reply(res, 400, { error: "bad_request" });
  if (passcode && !samePasscode(body.passcode, passcode)) return reply(res, 401, { error: "passcode" });
  const m = clean(body);
  if (!m) return reply(res, 400, { error: "bad_request" });

  const now = Date.now();
  if (now - last < GAP_MS) return reply(res, 429, { error: "wait" });
  last = now;

  const by = [m.who, m.when].filter(Boolean).join(" · ");
  const text = [`DOM · ${m.step}`, `Do first: ${m.action}`, by && `By: ${by}`, m.basis, "Decision support for planners, not medical advice."].filter(Boolean).join("\n");
  let sent = false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await r.json();
    sent = r.ok && !!data && data.ok === true;
  } catch (e) { sent = false; }   // a timeout, no network, or an answer that is not JSON; the error may hold the address, so it is not logged
  return sent ? reply(res, 200, { ok: true }) : reply(res, 502, { error: "telegram" });
};
