// Plan test: starts a local stand-in for the Gemini endpoint, and the server on free ports with temporary stores.
// Checks the draft, the guard, the cache, approval, undo and every fallback. No real key and no real network.
const { spawn } = require("child_process");
const http = require("http"), net = require("net"), crypto = require("crypto"), path = require("path"), fs = require("fs"), os = require("os");

const root = process.argv[2] || path.join(__dirname, "..");
const UP = crypto.randomBytes(8).toString("hex"), AD = crypto.randomBytes(8).toString("hex");
const results = [], servers = [], files = [];
const check = (name, got, want) => results.push(`${got === want ? "PASS" : "FAIL"}  ${name}: got ${got}, expected ${want}`);
const tmp = () => { const f = path.join(os.tmpdir(), `flusentinel-plan-store-${crypto.randomBytes(4).toString("hex")}.json`); files.push(f); return f; };
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

// The stand-in model: replies with whatever the test queued, and records what the server sent it.
let queue = [], seen = [];
const reply = (text) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], modelVersion: "test-model" });
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    let sent = {}; try { sent = JSON.parse(b); } catch {}
    seen.push({ url: req.url, key: req.headers["x-goog-api-key"], sent, prompt: String((((sent.contents || [])[0] || {}).parts || [{}])[0].text || "") });
    const q = queue.shift() || {};
    setTimeout(() => { res.writeHead(q.status || 200, { "Content-Type": "application/json" }); res.end(q.raw !== undefined ? q.raw : JSON.stringify(q.json || reply(q.text === undefined ? "{}" : q.text))); }, q.wait || 0);
  });
});

// Each server gets its own port and store, a missing env file, and none of the developer's own Gemini settings or passcodes.
async function start(store, env) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^(GEMINI_|UPLOAD_PASSCODE$|ADMIN_PASSCODE$)/i.test(k)) delete base[k];
  const PORT = String(await freePort());
  servers.push(spawn("node", [path.join(root, "server.js")], { env: { ...base, PORT, STORE_PATH: store, ENV_FILE: store + ".none", UPLOAD_PASSCODE: UP, ADMIN_PASSCODE: AD, ...env }, stdio: "ignore" }));
  const B = `http://localhost:${PORT}/api`;
  for (let i = 0; i < 40; i++) { try { await fetch(B + "/state?mode=live"); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  return async (method, url, pass, body) => {
    const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json", ...(pass ? { "x-passcode": pass } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch {}
    return { s: r.status, d };
  };
}

// The five states the page can be in, with the action rows of site/assets/app.js, and the page's fixed template.
const STATES = {
  clear: { level: "green", band: "clear", step: "clear", rows: [["Continue routine sentinel surveillance", "State health department"]] },
  watch: { level: "green", band: "watch", step: "watch", rows: [["Check that sentinel sites are reporting on time", "State health department"], ["Check influenza vaccine and antiviral stock", "State health department"]] },
  warning: { level: "yellow", band: "watch", step: "warning", rows: [["Draft the school advisory and hold it for release", "State health department"],
    ["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"], ["Ask hospitals to review surge rosters and respiratory ward plans", "Hospital directors"]] },
  "outbreak (orange)": { level: "orange", band: "warning", step: "outbreak", rows: [["Start school-cluster response and vaccination outreach", "State and district health offices"], ["Hospitals put surge rosters and respiratory ward plans into effect", "Hospital directors"]] },
  "outbreak (red)": { level: "red", band: "off", step: "outbreak", rows: [["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"],
    ["Issue a public advisory through official channels", "State health department"], ["Continue school-cluster response in all districts", "District health offices"]] },
};
const PLAN_WHEN = { clear: "ongoing", watch: "this week", warning: "within 3 days", outbreak: "today" };
const figures = { headline: "Outbreak trend detected", alert_level: "orange", early_warning_step: "outbreak", classifier_band: "warning", newest_data_week: "2026-W38",
  newest_positivity_percent: 14.2, positivity_two_weeks_earlier_percent: 9.8, weeks_data_is_behind_today: 2, highest_expected_in_next_weeks_percent: 18.5,
  watch_line_percent: 8.1, alert_line_percent: 12.4, wave_type: "A(H3)", wave_type_share_percent: 71, phase: "rising", data_warning: false,
  based_on_uploaded_unverified_data: false, simulated_scenario: false, proposed_action: STATES["outbreak (orange)"].rows[0][0] };
const inputs = (name, fig) => { const s = STATES[name];
  return { figures: { ...figures, alert_level: s.level, early_warning_step: s.step, classifier_band: s.band, ...fig }, level: s.level, band: s.band, step: s.step, actions: s.rows.map(([action, who]) => ({ action, who })), by: "Test Planner" }; };
const templateOf = (inp) => inp.actions.map((x) => ({ what: x.action, who: x.who.split(",")[0].trim(), when: PLAN_WHEN[inp.step] }));
// A request at Outbreak (orange); a different n gives different figures, so a different cache entry.
const ask = (n, over) => ({ ...inputs("outbreak (orange)", { weeks_data_is_behind_today: n }), ...over });
const good = { steps: [
  { what: "Tell the district health offices that sentinel positivity is 14.2% in week 38, above the alert line of 12.4%", who: "State and district health offices", when: "today" },
  { what: "Start the school-cluster response in the districts with the most clusters", who: "State and district health offices", when: "within 3 days" },
  { what: "Begin vaccination outreach in the same districts", who: "state and district health offices", when: "This week" },
  { what: "Put surge rosters and respiratory ward plans into effect", who: "Hospital directors", when: "within 3 days" }] };
const withStep = (i, s) => ({ steps: good.steps.map((x, k) => (k === i ? { ...x, ...s } : x)) });
const text = (o) => ({ text: JSON.stringify(o) });
const lab = { type: "lab", rows: [{ year: 2026, week: 37, n: 120, pos: 14, h3: 9, h1: 3, b: 2 }, { year: 2026, week: 38, n: 127, pos: 18, h3: 12, h1: 4, b: 2 }], by: "tester" };
const stop = () => { servers.forEach((s) => s.kill()); files.forEach((f) => { try { fs.unlinkSync(f); } catch {} }); };

(async () => {
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const MOCK = `http://127.0.0.1:${mock.address().port}`, AI = { GEMINI_API_KEY: "test", GEMINI_MODEL: "test-model", GEMINI_FALLBACK_MODELS: "none", GEMINI_BASE_URL: MOCK, GEMINI_TIMEOUT_MS: "700" };
  const store = tmp();
  let api = await start(store, AI), r, n, t;
  const plan = (pass, b) => api("POST", "/plan?mode=live", pass, b), approve = (pass, b) => api("POST", "/plan/approve?mode=live", pass, b);

  check("viewer cannot ask for a plan", (await plan(null, ask(2))).s, 401);
  check("a viewer's request never reaches the model", seen.length, 0);
  r = await api("POST", "/state?mode=live", UP, lab);
  const labAt = r.d.stamp; check("lab upload is in use", r.d.lab.length, 2); check("no plan before one is approved", r.d.plan, null);

  // A good draft, and what was sent to get it.
  queue = [text(good)];
  r = await plan(UP, ask(2)); const draft = r.d;
  check("good draft is returned", r.s + "/" + r.d.source, "200/ai"); check("good draft has its steps", r.d.steps.length, 4); check("the model is named", r.d.model, "test-model");
  check("role spelling is made exact", r.d.steps[2].who, "State and district health offices"); check("timing spelling is made exact", r.d.steps[2].when, "this week");
  check("the model was called once", seen.length, 1); check("endpoint path", seen[0].url, "/v1beta/models/test-model:generateContent");
  check("the key goes in the header", seen[0].key, "test"); check("a JSON reply is asked for", seen[0].sent.generationConfig.responseMimeType, "application/json");
  check("the figures are in the prompt", seen[0].prompt.includes("14.2"), true); check("the person's name is not sent", seen[0].prompt.includes("Test Planner"), false);
  check("the passcode is not sent", JSON.stringify(seen[0]).includes(UP), false);

  // Cache.
  r = await plan(AD, ask(2));
  check("the same request again comes from the cache", r.d.source, "cache"); check("the cache did not call the model", seen.length, 1);
  check("cached steps are the same", JSON.stringify(r.d.steps) === JSON.stringify(draft.steps), true);
  r = await plan(UP, ask(2, { figures: Object.fromEntries(Object.entries(ask(2).figures).reverse()) }));
  check("field order does not change the cache entry", r.d.source + "/" + r.d.key, "cache/" + draft.key);

  // Guard on drafts.
  const badNumber = withStep(1, { what: "Start the school-cluster response in 500 schools" });
  queue = [text(badNumber), text(badNumber)]; n = seen.length;
  r = await plan(UP, ask(3));
  check("a number not in the figures falls back to the template", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/guard");
  check("one retry after a rejected draft", seen.length - n, 2); check("the retry says what was wrong", seen[n + 1].prompt.includes("uses a number that is not in the figures"), true);
  check("a rejected draft is not returned", "steps" in r.d, false); check("the fallback says why in plain words", r.d.detail, "Step 2 uses a number that is not in the figures.");
  queue = [text(badNumber), text(good)];
  check("a good second draft is used", (await plan(UP, ask(4))).d.source, "ai");
  queue = [text(withStep(3, { who: "Ministry of Education" })), text(withStep(3, { who: "Ministry of Education" }))];
  r = await plan(UP, ask(5));
  check("a role that was not given falls back to the template", r.d.source + "/" + r.d.reason, "template/guard");

  // Replies that cannot be used.
  n = seen.length;
  queue = [{ text: "Sure, here is the plan: step one" }]; r = await plan(UP, ask(6));
  check("text that is not JSON is handled", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/bad_reply"); check("no retry for a reply that is not JSON", seen.length - n, 1);
  queue = [{ raw: "<html>not json</html>" }]; r = await plan(UP, ask(7)); check("a body that is not JSON is handled", r.d.source + "/" + r.d.reason, "template/bad_reply");
  queue = [{ status: 500, raw: '{"error":{"message":"boom"}}' }]; r = await plan(UP, ask(8)); check("an HTTP error is handled", r.d.source + "/" + r.d.reason, "template/gemini_500");
  queue = [{ json: { promptFeedback: { blockReason: "SAFETY" } } }]; r = await plan(UP, ask(9)); check("a blocked prompt is handled", r.d.source + "/" + r.d.reason, "template/blocked");
  queue = [{ json: { candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: JSON.stringify(good) }] } }] } }]; r = await plan(UP, ask(10)); check("a blocked reply is handled", r.d.source + "/" + r.d.reason, "template/blocked");
  queue = [{ json: { candidates: [{ finishReason: "STOP", content: { parts: [] } }] } }]; r = await plan(UP, ask(11)); check("an empty reply is handled", r.d.source + "/" + r.d.reason, "template/empty");
  queue = [{ json: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "working it out", thought: true }, { text: JSON.stringify(good) }] } }] } }];
  check("thinking notes in a reply are skipped", (await plan(UP, ask(12))).d.source, "ai");
  queue = [{ text: "```json\n" + JSON.stringify(good) + "\n```" }]; check("a fenced JSON reply is read", (await plan(UP, ask(13))).d.source, "ai");
  queue = [{ ...text(good), wait: 2500 }]; t = Date.now(); r = await plan(UP, ask(14));
  check("a slow reply times out into the template", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/timeout"); check("the time-out does not wait for the model", Date.now() - t < 2000, true);
  check("a bad request is refused", (await plan(UP, ask(15, { level: "purple" }))).s, 400);
  n = seen.length; r = await plan(UP, ask(16, { figures: { ...figures, simulated_scenario: true } }));
  check("simulated figures are never sent", r.d.source + "/" + r.d.reason + "/" + (seen.length - n), "template/simulated/0");

  // Approval of an AI draft.
  const sign = (over) => ({ ...ask(2), steps: draft.steps, source: "ai", ...over });
  check("viewer cannot approve", (await approve(null, sign())).s, 401); check("wrong passcode cannot approve", (await approve("nope", sign())).s, 401);
  r = await approve(UP, sign());
  check("uploader can approve", r.s, 200); check("the approved plan is in the state", r.d.plan.steps.length, 4);
  check("approval records who", r.d.plan.by + "/" + r.d.plan.role + "/" + r.d.plan.source, "Test Planner/uploader/ai"); check("approval is tied to its inputs", r.d.plan.key, draft.key);
  const id = r.d.plan.id, entry = r.d.log.find((e) => e.id === id);
  check("the history lists the plan", entry.type + "/" + entry.n, "plan/4"); check("the history carries no steps and no rows", r.d.log.some((e) => "steps" in e || "rows" in e), false);
  check("lab data is unchanged by a plan", r.d.lab.length + "/" + r.d.lab[1].pos, "2/18"); check("the upload time is unchanged by a plan", r.d.stamp, labAt);
  check("a viewer can read the approved plan", (await api("GET", "/state?mode=live")).d.plan.id, id);
  const tampered = {
    "a number that is not in the figures": withStep(0, { what: "Tell the district health offices that positivity is 41.7%" }).steps,
    "another alert level": withStep(0, { what: "Tell every district that the state is now on red alert" }).steps,
    "another early-warning step": withStep(0, { what: "Tell every district that the state has dropped back to Watch" }).steps,
    "another band": withStep(0, { what: "Tell every district that the classifier band is clear" }).steps,
    "markup": withStep(0, { what: "<b>Start</b> the school-cluster response" }).steps,
    "a role that was not given": withStep(0, { who: "Ministry of Education" }).steps,
    "a timing that is not on the list": withStep(0, { when: "tomorrow" }).steps,
    "treatment advice": withStep(0, { what: "Prescribe antivirals to every pupil with symptoms" }).steps,
    "text that is too short": withStep(0, { what: "Go" }).steps,
    "too few steps": good.steps.slice(0, 2), "too many steps": [...good.steps, ...good.steps], "steps that are not a list": "all of it",
  };
  for (const [name, steps] of Object.entries(tampered)) check(`approval rejects ${name}`, (await approve(UP, sign({ steps }))).s, 400);
  check("approval needs a name", (await approve(UP, sign({ by: " " }))).s, 400); check("approval rejects an unknown source", (await approve(UP, sign({ source: "human" }))).s, 400);
  check("a plan for a simulated scenario cannot be approved", (await approve(UP, sign({ figures: { ...ask(2).figures, simulated_scenario: true } }))).s, 400);
  r = await api("GET", "/state?mode=live");
  check("rejected plans are not stored", r.d.plan.id + "/" + r.d.log.length, id + "/2");
  r = await approve(UP, sign({ steps: withStep(0, { what: "Watch for late reports and name the current step, Outbreak, in the weekly note" }).steps }));
  check("everyday words and the current step are allowed", r.s, 200);
  await api("POST", "/undo?mode=live", UP, { id: r.d.plan.id });

  // Approval of the page's fixed template: one step for each proposed action, nothing else.
  for (const name of Object.keys(STATES)) check(`the fixed template can be approved at ${name}`, (await approve(UP, { ...inputs(name), steps: templateOf(inputs(name)), source: "template" })).s, 200);
  r = await api("GET", "/state?mode=live"); const tid = r.d.plan.id;
  check("the newest approved plan is the current one", r.d.plan.source + "/" + r.d.plan.steps.length + "/" + r.d.log.length, "template/3/8");
  check("a template with reworded text is rejected", (await approve(UP, { ...ask(2), steps: templateOf(ask(2)).map((x) => ({ ...x, what: x.what + " at once" })), source: "template" })).s, 400);
  check("a template with an added step is rejected", (await approve(UP, { ...ask(2), steps: [...templateOf(ask(2)), good.steps[0]], source: "template" })).s, 400);
  check("a draft cannot be passed off as a template", (await approve(UP, sign({ source: "template" }))).s, 400);
  check("a template cannot be passed off as a draft", (await approve(UP, { ...ask(2), steps: templateOf(ask(2)), source: "ai" })).s, 400);

  // Undo, restore and reset.
  for (const e of r.d.log) if (e.type === "plan" && !e.undone && e.id !== id && e.id !== tid) await api("POST", "/undo?mode=live", UP, { id: e.id });
  check("undoing the newest plan shows the one before", (await api("POST", "/undo?mode=live", UP, { id: tid })).d.plan.id, id);
  r = await api("POST", "/undo?mode=live", UP, { id });
  check("uploader can undo a plan", r.s, 200); check("an undone plan leaves the state", r.d.plan, null); check("an undone plan stays in the history", r.d.log.length, 8);
  check("undoing a plan leaves lab data alone", r.d.lab.length, 2);
  check("uploader cannot restore a plan", (await api("POST", "/undo?mode=live", UP, { id, restore: true })).s, 401);
  check("admin can restore a plan", (await api("POST", "/undo?mode=live", AD, { id, restore: true })).d.plan.id, id);
  r = await api("DELETE", "/state?mode=live", AD);
  check("reset clears the plan", r.d.plan, null); check("reset clears lab data", r.d.lab.length, 0); check("reset keeps the history", r.d.log.length, 8);
  check("replay mode has its own plan", (await api("GET", "/state?mode=replay")).d.plan, null);

  // Summary.
  queue = [text({ en: "Positivity is 14.2% in week 38.", bm: "Kadar positif ialah 14.2%." })]; n = seen.length;
  r = await api("POST", "/summary", null, figures);
  check("the summary reply is English only", Object.keys(r.d).sort().join(","), "en,model"); check("the summary prompt asks for English only", /bahasa|melayu|"bm"/i.test(seen[n].prompt), false);
  queue = [{ text: "not json" }]; check("the summary handles a reply that is not JSON", (await api("POST", "/summary", null, { ...figures, phase: "falling" })).d.error, "bad_reply");
  n = seen.length; r = await api("POST", "/summary", null, { ...figures, simulated_scenario: true });
  check("the summary never sends simulated figures", r.d.error + "/" + (seen.length - n), "simulated/0");

  // Restart on the same store with no network: the cache still answers.
  servers[0].kill(); n = seen.length;
  api = await start(store, { ...AI, GEMINI_BASE_URL: `http://127.0.0.1:${await freePort()}` });
  check("after a restart with no network, the same request still comes from the cache", (await plan(UP, ask(2))).d.source, "cache");
  r = await plan(UP, ask(40));
  check("with no network, a new request falls back to the template", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/network"); check("the stand-in model was not reached", seen.length - n, 0);

  // No key.
  api = await start(tmp(), { GEMINI_BASE_URL: MOCK }); n = seen.length;
  r = await plan(UP, ask(2));
  check("no key: the reply is the template", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/no_key");
  check("no key: the template can still be approved", (await approve(UP, { ...ask(2), steps: templateOf(ask(2)), source: "template" })).s, 200);
  check("no key: the summary says so", (await api("POST", "/summary", null, figures)).d.error, "no_key"); check("no key: the model is never called", seen.length - n, 0);

  // No passcodes: anyone may ask. The limit of 30 calls an hour covers both AI endpoints.
  api = await start(tmp(), { ...AI, UPLOAD_PASSCODE: "", ADMIN_PASSCODE: "" });
  queue = [text(good)]; check("with no passcodes set, anyone may ask", (await plan(null, ask(2))).d.source, "ai");
  n = seen.length;
  for (let i = 0; i < 29; i++) await api("POST", "/summary", null, { ...figures, i });
  r = await plan(null, ask(50));
  check("the hourly limit covers both AI endpoints", r.s + "/" + r.d.source + "/" + r.d.reason, "200/template/rate_limited"); check("no call is made past the limit", seen.length - n, 29);

  // Fallback models: tried in order when the first is refused, overloaded, too slow or unreadable.
  const called = (from) => seen.slice(from).map((x) => (x.url.match(/models\/([^:]+)/) || [])[1]).join(",");
  api = await start(tmp(), { ...AI, GEMINI_MODEL: "model-a", GEMINI_FALLBACK_MODELS: "model-b, models/model-c" });
  n = seen.length; queue = [{ status: 404, raw: "{}" }, text(good)]; r = await plan(UP, ask(60));
  check("fallback: when the first model is refused the next one answers", r.d.source + "/" + r.d.model, "ai/model-b");
  check("fallback: the reply names the model that failed and why", JSON.stringify(r.d.tried), JSON.stringify(["model-a: gemini_404"]));
  check("fallback: the models were called in order", called(n), "model-a,model-b");
  n = seen.length; queue = [text(good)]; r = await plan(UP, ask(61));
  check("fallback: the model that answered is tried first next time", called(n) + "/" + r.d.model + "/" + ("tried" in r.d), "model-b/model-b/false");
  n = seen.length; queue = [{ status: 503, raw: "{}" }, { status: 429, raw: "{}" }, { status: 500, raw: "{}" }]; r = await plan(UP, ask(62));
  check("fallback: when every model fails the template is shown with the last reason", r.d.source + "/" + r.d.reason, "template/gemini_500");
  check("fallback: every model was tried once", called(n) + "/" + (r.d.tried || []).length, "model-b,model-c,model-a/3");
  n = seen.length; queue = [{ status: 403, raw: "{}" }]; r = await plan(UP, ask(63));
  check("fallback: a refused key is not tried on the other models", called(n) + "/" + r.d.reason, "model-b/gemini_403");
  n = seen.length; queue = [{ ...text(good), wait: 2500 }, text(good)]; r = await plan(UP, ask(64));
  check("fallback: a model that is too slow is left for the next one", r.d.source + "/" + r.d.model + "/" + JSON.stringify(r.d.tried), 'ai/model-c/["model-b: timeout"]');
  n = seen.length; queue = [{ raw: "not json at all" }, text({ en: "Sentinel positivity is 14.2% in week 38." })]; r = await api("POST", "/summary", null, { ...figures, note: "fallback" });
  check("fallback: the summary falls back too", r.d.en + "/" + r.d.model + "/" + called(n), "Sentinel positivity is 14.2% in week 38./model-a/model-c,model-a");
  n = seen.length; queue = [text({ en: "Sentinel positivity is 99% in week 38." })]; r = await api("POST", "/summary", null, { ...figures, note: "guard" });
  check("a summary with a number that is not in the figures is refused on the server", r.d.error + "/" + ("en" in r.d), "guard/false");

  stop();
  const ok = results.every((x) => x.startsWith("PASS"));
  console.log(results.join("\n"));
  console.log(ok ? "ALL PASSED" : "SOME FAILED");
  process.exit(ok ? 0 : 1);
})().catch((e) => { stop(); console.log(results.join("\n")); console.error("test crashed", e); console.log("SOME FAILED"); process.exit(1); });
