const M = window.FluModel;
const $ = (id) => document.getElementById(id);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const wk = (s) => `${s.year}-W${String(s.week).padStart(2, "0")}`;
const nextWeek = (s, k = 1) => { let y = s.year, w = s.week + k; while (w > 52) { w -= 52; y++; } return { year: y, week: w }; };
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (ch) => "&#" + ch.charCodeAt(0) + ";"); // uploaded text is never trusted as HTML
const REPLAY = new URLSearchParams(location.search).get("replay") === "1";
const MODE = REPLAY ? "replay" : "live";
const LEVELS = {
  green: { head: "No outbreak trend", sub: "Routine surveillance" },
  yellow: { head: "Possible outbreak trend: watch", sub: "Above the watch line, or expected to cross it" },
  orange: { head: "Outbreak trend detected", sub: "At, or expected to reach, the alert line within four weeks" },
  red: { head: "Outbreak trend detected: surge under way", sub: "Latest data is already above the alert line" },
};
const ACTIONS = {
  green: [["Continue routine sentinel surveillance", "State health department"]],
  yellow: [["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"],
           ["Check influenza vaccine and antiviral stock", "State health department"]],
  orange: [["Start school-cluster response and vaccination outreach", "State and district health offices"],
           ["Hospitals put surge rosters and respiratory ward plans into effect", "Hospital directors"]],
  red: [["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"],
        ["Issue a public advisory through official channels", "State health department"],
        ["Continue school-cluster response in all districts", "District health offices"]],
};
// Early-warning ladder. Clear, Watch and Warning come from the rapid-rise classifier (a national signal); Outbreak
// comes from the alert rule on the data. The step shown is the higher of the two. Watch asks only for free checks,
// Warning for preparation; the costly response starts at Outbreak.
const STEPS = ["clear", "watch", "warning", "outbreak"];
const STEP = {
  clear: { name: "Clear", head: "Clear: no sign of a rapid rise", say: "No rapid rise is expected in the next four weeks.", bm: "Normal: tiada tanda peningkatan mendadak" },
  watch: { name: "Watch", head: "Watch: a rapid rise is possible", say: "A rapid rise in the next four weeks is possible. Keep watching and do the free checks.", bm: "Waspada: peningkatan mendadak mungkin berlaku" },
  warning: { name: "Warning", head: "Warning: prepare for a rapid rise", say: "A rapid rise in the next four weeks is likely. Prepare; the response itself waits for Outbreak.", bm: "Amaran: bersedia menghadapi peningkatan mendadak" },
  outbreak: { name: "Outbreak", say: "Positivity is at, or expected to reach, the alert line. Respond." },
};
const STEP_ACTIONS = {
  clear: [["Continue routine sentinel surveillance", "State health department"]],
  watch: [["Check that sentinel sites are reporting on time", "State health department"],
          ["Check influenza vaccine and antiviral stock", "State health department"]],
  warning: [["Draft the school advisory and hold it for release", "State health department"],
            ["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"],
            ["Ask hospitals to review surge rosters and respiratory ward plans", "Hospital directors"]],
};
const RULE_RANK = { green: 0, yellow: 2, orange: 3, red: 3 };
const RULE_WORDS = { green: "below both lines", yellow: "at the watch line", orange: "at the alert line", red: "above the alert line and not easing" };
function stepOf(c) {
  const band = c.rise.off ? null : c.rise.band, cl = band ? STEPS.indexOf(band) : 0, ru = RULE_RANK[c.a.level];
  return { key: STEPS[Math.max(cl, ru)], band, cl, ru };
}
// Headline and sub-line for the step. When the alert rule set the step (or the classifier is off), the words are the rule's.
const RULE_TEXT = { clear: { head: "No outbreak trend", sub: "Routine surveillance", bm: "Normal: tiada trend wabak" },
  warning: { head: "Warning: positivity is at the watch line", sub: "Positivity is above the watch line, or the rule's projection expects it to cross. Prepare; the response itself waits for Outbreak.", bm: "Amaran: kadar positif melepasi garis pantau" } };
function headOf(c) {
  const st = stepOf(c), byRule = st.ru > st.cl || c.rise.off;
  if (st.key === "outbreak") return { ...LEVELS[c.a.level], byRule: true, bm: { orange: "Wabak: trend wabak dikesan", red: "Wabak: lonjakan sedang berlaku" }[c.a.level] };
  return byRule ? { ...RULE_TEXT[st.key === "warning" ? "warning" : "clear"], byRule } : { head: STEP[st.key].head, sub: STEP[st.key].say, bm: STEP[st.key].bm, byRule };
}
const stepActions = (c) => (stepOf(c).key === "outbreak" ? ACTIONS[c.a.level === "red" ? "red" : "orange"] : STEP_ACTIONS[stepOf(c).key]);
// Under a data warning the only proposed action is to check the figure; the step's own actions wait for that.
const actionsOf = (c) => (c.a.dataWarning ? [["Confirm the newest week's sample count with the lab before acting", "Whoever uploaded the figures"]] : stepActions(c));
const SCHEMA = {
  lab: { cols: ["year", "week", "samples_tested", "influenza_positive", "a_h3", "a_h1n1", "b"], tpl: "template_lab_counts.csv" },
  ili: { cols: ["year", "week", "ili_rate_percent"], tpl: "template_ili_rate.csv" },
  clusters: { cols: ["year", "week", "district", "clusters"], tpl: "template_clusters.csv" },
  beds: { cols: ["hospital", "beds_available"], tpl: "template_beds.csv" },
  clusterlist: { cols: ["name", "district", "cases", "setting", "lat", "lon"], tpl: "template_cluster_list.csv" },
};
let D, GEO, HOSP, HOSPMETA, FAC, DENGUE, STATES, STATE, chart, map, geoLayer, hospLayer, facDone = false, pending = [];
// What-if simulator. Factor effects are the team's own assumptions (percentage points of weekly growth), not estimates.
const SIM = { on: false, week: 0, base: 15, weeks: 5, school: true, strain: 50, vax: 10, travel: false, rain: false };
const SIM_EFFECT = { schoolIn: 8, schoolOut: -8, strainPerPoint: 0.2, vaxPerPoint: -0.25, travel: 6, rain: 3 };
function simGrowth() {
  const g = SIM.base + (SIM.school ? SIM_EFFECT.schoolIn : SIM_EFFECT.schoolOut) + SIM.strain * SIM_EFFECT.strainPerPoint + SIM.vax * SIM_EFFECT.vaxPerPoint + (SIM.travel ? SIM_EFFECT.travel : 0) + (SIM.rain ? SIM_EFFECT.rain : 0);
  return Math.max(-30, Math.min(80, g)) / 100;
}
// Invented weeks that continue the real series: grow for SIM.weeks, then ease by 15% a week.
function simRows(real) {
  const last = real[real.length - 1], g = simGrowth(), typed = last.h3 + last.h1 + last.b || 1;
  const ns = real.slice(-26).map((r) => r.n).sort((a, b) => a - b), n = ns[Math.floor(ns.length / 2)];
  let p = M.pct(last) / 100, prev = last; const rows = [];
  for (let k = 1; k <= SIM.weeks + 6; k++) {
    p = k <= SIM.weeks ? Math.min(0.6, p * (1 + g)) : p * 0.85;
    const w = nextWeek(prev), pos = Math.round(p * n);
    prev = { year: w.year, week: w.week, n, pos, h3: Math.round((pos * last.h3) / typed), h1: Math.round((pos * last.h1) / typed), b: Math.round((pos * last.b) / typed), simulated: true };
    rows.push(prev);
  }
  return rows;
}
// Which map layers are switched on (the switches sit above the map).
const LAYERS = { state: true, shade: true, heat: true, hot: true, government: true, private: true, clinic: true };
let heatLayer;
const FACG = {};
let SERVER = true; // false on static hosting: uploads then stay in this browser only

// The server, when present, keeps an upload history with passcode roles. On static hosting the same
// history lives in this browser only, and there are no passcodes.
const PASS = () => sessionStorage.getItem("fs_pass") || "";
async function api(method, path, body) {
  if (!SERVER) return { ok: false, status: 0, data: null };
  try {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-passcode": PASS() }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}
// The server stores what it is sent. Rows are checked again here before anything is drawn from them.
function tidy(d) {
  const num = Number.isFinite, names = GEO ? new Set(GEO.features.map((f) => f.properties.name)) : null, ok = (r) => r && typeof r === "object";
  d.lab = (d.lab || []).filter((r) => ok(r) && [r.year, r.week, r.n, r.pos].every(num) && r.n > 0);
  d.ili = (d.ili || []).filter((r) => ok(r) && [r.year, r.week, r.rate].every(num));
  d.clusters = (d.clusters || []).filter((r) => ok(r) && [r.year, r.week, r.clusters].every(num) && (!names || names.has(r.district)));
  d.clusterlist = (d.clusterlist || []).filter((r) => ok(r) && num(r.cases) && (!names || names.has(r.district)));
  d.beds = (d.beds || []).filter((r) => ok(r) && typeof r.hospital === "string" && num(r.beds));
  return d;
}
const emptyState = () => ({ lab: [], ili: [], clusters: [], beds: [], clusterlist: [], own: false, stamp: null, log: [], auth: { required: false, role: "admin" } });
const localLog = () => JSON.parse(localStorage.getItem("fs_log_" + MODE) || "[]");
function useLocal(log) {
  localStorage.setItem("fs_log_" + MODE, JSON.stringify(log));
  STATE = tidy({ ...emptyState(), ...M.reduceLog(log), log: log.map(({ rows, ...e }) => ({ ...e, n: (rows || []).length })) });
}
async function loadState() {
  const r = await api("GET", `/api/state?mode=${MODE}`);
  if (r.ok) STATE = tidy({ ...emptyState(), ...r.data }); else { SERVER = false; useLocal(localLog()); }
}
const denied = (r) => (r.status === 401 ? "That passcode does not allow this." : r.status === 429 ? "Too many wrong passcodes. Wait ten minutes." : "The server did not accept that.");
// Returns an error message, or "" when saved.
async function saveUpload(type, rows, own) {
  const by = localStorage.getItem("fs_by") || "";
  if (!SERVER) { useLocal(localLog().concat([{ id: Date.now() + "-" + Math.random().toString(16).slice(2, 8), at: new Date().toISOString(), by: by || "this browser", role: "local", type, own: !!own, rows }])); return ""; }
  const r = await api("POST", `/api/state?mode=${MODE}`, { type, rows, own: !!own, by });
  if (r.ok) { STATE = tidy({ ...emptyState(), ...r.data }); return ""; }
  return denied(r);
}
async function setUndone(id, undone) {
  let msg = "";
  if (!SERVER) useLocal(localLog().map((e) => (e.id === id ? { ...e, undone } : e)));
  else { const r = await api("POST", `/api/undo?mode=${MODE}`, { id, restore: !undone }); if (r.ok) STATE = tidy({ ...emptyState(), ...r.data }); else msg = denied(r); }
  planMsg = ""; render(); $("histMsg").textContent = msg;
}
// Alert lines for an uploaded own-network series: the same formula as the national ones, from the uploader's
// own weeks (leaving out the newest four). Under a year of history, the national lines are used and flagged.
const OWN_MIN_WEEKS = 52;
function ownThresholds(rows) {
  if (rows.length < OWN_MIN_WEEKS) return { ...D.thresholds, calibrated: false, weeks: rows.length };
  const p = rows.slice(0, -4).map(M.pct).sort((a, b) => a - b), med = p[Math.floor(p.length / 2)];
  const dev = p.map((v) => Math.abs(v - med)).sort((a, b) => a - b), sd = 1.4826 * dev[Math.floor(dev.length / 2)];
  return { median: med, robust_sd: sd, yellow: med + sd, orange: med + 2 * sd, calibrated: true, weeks: rows.length };
}
// Reset marks every upload as undone. Nothing is erased, so it can be seen and restored in the history.
async function resetState() {
  let msg = "";
  if (!SERVER) useLocal(localLog().map((e) => ({ ...e, undone: true })));
  else { const r = await api("DELETE", `/api/state?mode=${MODE}`); if (r.ok) STATE = tidy({ ...emptyState(), ...r.data }); else msg = r.status === 401 ? "Resetting everything needs the admin passcode. Single uploads can still be undone below." : denied(r); }
  planMsg = ""; barMsg = msg; render(); $("histMsg").textContent = msg;
}

function context(k) {
  const own = !!(STATE.own && STATE.lab.length);
  const base = own ? STATE.lab.map((r) => ({ ...r, uploaded: true })) : REPLAY ? D.series.slice(0, D.replay_cut_index + 1) : D.series;
  const real = own ? base : base.concat(STATE.lab.map((r) => ({ ...r, uploaded: true })));
  const th = own ? ownThresholds(base) : D.thresholds;
  const nSim = SIM.on ? (k ?? SIM.week) : 0;
  const series = nSim ? real.concat(simRows(real).slice(0, nSim)) : real;
  const extra = (own ? 0 : STATE.lab.length) + nSim, lagBase = own ? 0 : D.pub_lag;
  const lag = Math.max(0, lagBase - extra);
  const a = M.assess(series, D.models[REPLAY ? "replay" : "current"], D, th, lag);
  // "Today" is the public week plus the reporting delay, unless newer weeks already run past it.
  const today = extra > lagBase || own ? series[series.length - 1] : nextWeek(base[base.length - 1], D.pub_lag);
  // The classifier is off for an uploaded own series: its first input is the size of the national network (see Why trust it).
  // The replay uses the classifier as trained up to its date, but the same frozen cut-offs as the live page, so the bands and their record match.
  const cls = D.rise[REPLAY ? "replay" : "current"], tiers = D.rise.current.tiers || { watch: 0.5, warning: 0.5 }, r0 = own ? null : M.riseSignal(series, cls);
  const rise = own ? { off: true, prob: null, yes: false, band: null, parts: [], tiers } : { ...r0, tiers, band: r0.prob >= tiers.warning ? "warning" : r0.prob >= tiers.watch ? "watch" : "clear" };
  return { base, real, series, lag, a, today, rise, th, own, uploaded: STATE.lab.length > 0, sim: nSim > 0, nSim };
}

function figures(c) {
  const a = c.a, st = stepOf(c);
  return {
    headline: a.dataWarning ? "Data warning: check the newest week before acting" : headOf(c).head, headline_malay: headOf(c).bm, alert_level: a.level,
    early_warning_step: st.key, classifier_band: st.band || "off",
    newest_data_week: wk(a.last), newest_positivity_percent: +f1(a.pLast),
    positivity_two_weeks_earlier_percent: +f1(a.p2),
    weeks_data_is_behind_today: c.lag,
    highest_expected_in_next_weeks_percent: +f1(Math.max(...a.ahead)),
    watch_line_percent: +f1(c.th.yellow), alert_line_percent: +f1(c.th.orange),
    wave_type: a.wave, wave_type_share_percent: Math.round(a.waveShare * 100),
    phase: a.phase, data_warning: a.dataWarning,
    based_on_uploaded_unverified_data: c.uploaded, simulated_scenario: c.sim, own_series: c.own,
    proposed_action: actionsOf(c)[0][0],
  };
}
function template(fg) {
  const src = fg.simulated_scenario ? " (simulated scenario, not real data)" : fg.based_on_uploaded_unverified_data ? " (based on uploaded, unverified data)" : "";
  const en = `${fg.headline}${src}. ${fg.own_series ? "Positivity in your series" : "Sentinel positivity"} is ${fg.newest_positivity_percent}% in ${fg.newest_data_week}, ${fg.phase} from ${fg.positivity_two_weeks_earlier_percent}% two weeks earlier; the alert line is ${fg.alert_line_percent}%. ` +
    (fg.classifier_band === "off" ? "" : `The rapid-rise classifier reads ${STEP[fg.classifier_band].name}. `) + (fg.wave_type === "Mixed" ? "No single virus type dominates. " : `${fg.wave_type} makes up ${fg.wave_type_share_percent}% of typed positives. `) + `Proposed action: ${fg.proposed_action}.`;
  const lv = fg.headline_malay;
  const srcBm = fg.simulated_scenario ? " (senario simulasi, bukan data sebenar)" : fg.based_on_uploaded_unverified_data ? " (berdasarkan data yang dimuat naik, belum disahkan)" : "";
  const bm = `${fg.data_warning ? "Amaran data: semak minggu terbaharu sebelum bertindak" : lv}${srcBm}. ${fg.own_series ? "Kadar positif dalam siri anda" : "Kadar positif sentinel"} ialah ${fg.newest_positivity_percent}% pada ${fg.newest_data_week}, berbanding ${fg.positivity_two_weeks_earlier_percent}% dua minggu sebelumnya; ambang wabak ialah ${fg.alert_line_percent}%.`;
  return { en, bm };
}
// The AI text is shown only if every number in it appears in the figures it was given.
function numbersOk(text, fg) {
  const allowed = new Set();
  JSON.stringify(fg).replace(/\d+(\.\d+)?/g, (m) => { allowed.add(String(+m)); return m; });
  return (text.match(/\d+(\.\d+)?/g) || []).every((m) => allowed.has(String(+m)));
}
async function renderSummary(c) {
  const fg = figures(c), t = template(fg);
  $("sumEn").textContent = t.en; $("sumBm").textContent = t.bm; $("sumChip").textContent = "Template";
  if (c.sim || !$("aiOn").checked) return; // simulated figures are never sent; AI wording is opt-in
  $("sumChip").textContent = "Template (asking the AI service...)";
  const r = (await api("POST", "/api/summary", fg)).data;
  // Only the English is ever reworded; the Malay stays the fixed template.
  if (r && r.en && numbersOk(r.en, fg) && JSON.stringify(figures(context())) === JSON.stringify(fg)) {
    $("sumEn").textContent = r.en; $("sumChip").textContent = `English reworded by AI (${r.model}${r.tried && r.tried.length ? ", a fallback model" : ""}) from the figures on this page; Malay is the template`;
  } else $("sumChip").textContent = r && r.en ? "Template (AI text rejected: it used a number not in the figures)" : `Template (AI wording unavailable: ${aiWhy(r && r.error)})`;
}

// Six-year counts at the cut-offs in use, worked out from the weekly scores (each from a model trained only on
// earlier years), so the bands on the alert card and their record always agree.
let EVS;
function evStats() {
  if (EVS !== undefined) return EVS;
  const t = D.rise.current.tiers; if (!EVID || !EVID.weeks || !t) return (EVS = null);
  const W = EVID.weeks, day = (w) => Date.parse(w.start), WEEK = 6048e5, isW = (w) => w.score >= t.watch, isN = (w) => w.score >= t.warning;
  const cm = (rows, on) => { const m = { tp: 0, fp: 0, tn: 0, fn: 0 }; rows.forEach((w) => m[on(w) ? (w.rise_follows ? "tp" : "fp") : w.rise_follows ? "fn" : "tn"]++); return m; };
  const band = (rows, f) => { const x = rows.filter(f); return { weeks: x.length, rises: x.filter((w) => w.rise_follows).length }; };
  const bands = (rows) => ({ clear: band(rows, (w) => !isW(w)), watch: band(rows, (w) => isW(w) && !isN(w)), warning: band(rows, isN) });
  // quiet: no rapid rise in that week or in the three weeks before it
  const quiet = W.filter((w, i) => !w.rise_now && ![1, 2, 3].some((k) => W[i - k] && day(w) - day(W[i - k]) === k * WEEK && W[i - k].rise_now));
  const periods = (on) => { let n = 0, dry = 0, hit = false, open = false;
    W.forEach((w, i) => { const adj = i && day(w) - day(W[i - 1]) === WEEK;
      if (open && (!on(w) || !adj)) { if (!hit) dry++; open = false; }
      if (on(w)) { if (!open) { open = true; hit = false; n++; } hit = hit || w.rise_follows; } });
    if (open && !hit) dry++; return { n, dry }; };
  const years = [...new Set(W.map((w) => w.year))].map((y) => { const x = W.filter((w) => w.year === y), ps = x.map((w) => w.positives).sort((a, b) => a - b);
    return { year: y, weeks: x.length, rises: x.filter((w) => w.rise_follows).length, typical: ps[Math.floor(ps.length / 2)], ...bands(x) }; });
  return (EVS = { t, N: W.length, R: W.filter((w) => w.rise_follows).length, bands: bands(W), watch: cm(W, isW), warning: cm(W, isN),
    onset: { weeks: quiet.length, onsets: quiet.filter((w) => w.rise_follows).length, watch: cm(quiet, isW), warning: cm(quiet, isN) }, per: { watch: periods(isW), warning: periods(isN) }, years });
}
// What pushed the classifier's score up or down this week, in plain words. Exact: the model is a sum of one-input steps.
function riseReasons(c) {
  const s = c.series, i = s.length - 1, pos = (k) => s[k].pos, pc = (a, b) => (b ? Math.round((100 * (a - b)) / b) : 0), sg = (v) => (v > 0 ? "+" : "") + v;
  let a8 = 0; for (let k = i - 7; k <= i; k++) a8 += pos(k) / 8;
  const d8 = a8 ? Math.round(100 * (pos(i) / a8 - 1)) : 0; // what is printed: this week against the plain average of the last eight
  const say = (key, up) => { const dir = up ? "raises" : "lowers";
    if (/season/.test(key)) return `the time of year ${dir} the score`;
    if (/level/.test(key)) return `the number of positives this week (${pos(i)}) ${dir} the score`;
    if (/8|aver|mean/.test(key)) return `positives are ${Math.abs(d8)}% ${d8 >= 0 ? "above" : "below"} their eight-week average, which ${dir} the score`;
    if (/prev/.test(key)) return `the change the week before (${sg(pc(pos(i - 1), pos(i - 2)))}%) ${dir} the score`;
    if (/3/.test(key)) return `the change over three weeks (${sg(pc(pos(i), pos(i - 3)))}%) ${dir} the score`;
    if (/1/.test(key)) return `the change since last week (${sg(pc(pos(i), pos(i - 1)))}%) ${dir} the score`;
    return `${key.replace(/_/g, " ")} ${dir} the score`; };
  return (c.rise.parts || []).filter((x) => Math.abs(x.value) > 1e-9).slice(0, 3).map((x) => say(x.key, x.value > 0));
}
function renderAlert(c) {
  const a = c.a, th = c.th, st = stepOf(c), E = D.rise.evidence, ES = evStats(), B = ES ? ES.bands : {};
  const H = headOf(c), byRule = H.byRule; // byRule: the step shown comes from the alert rule, not from the classifier
  const head = a.dataWarning ? "Data warning: check the newest week before acting" : H.head;
  // The classifier speaks about the four weeks after the newest data week. On public data those weeks have already happened but are not published.
  const span = c.lag > 0 ? `the four weeks after the newest data (${wk(nextWeek(a.last, 1))} to ${wk(nextWeek(a.last, 4))}, not published yet)` : "the next four weeks";
  let subline = a.dataWarning ? `Step on this data: ${STEP[st.key].name}` : H.sub.replace("the next four weeks", span);
  if (!a.dataWarning && a.level === "orange" && a.pLast > th.orange) subline = `Latest data (${f1(a.pLast)}%) is above the alert line (${f1(th.orange)}%). The projection expects it to ease, so the rule says Orange, not Red.`;
  if (c.own && !th.calibrated && !a.dataWarning) subline = "Uncalibrated: these alert lines were not learned from your data. Treat the step with caution.";
  const ladder = STEPS.map((k) => `<div class="step ${k}${k === st.key ? (a.dataWarning ? " on unconfirmed" : " on") : ""}"><b>${STEP[k].name}</b><small>${k === st.key && a.dataWarning ? "unconfirmed: check the newest week" : k === "outbreak" || (k === st.key && byRule) ? "set by the alert rule" : c.rise.off ? "classifier off" : B[k] ? `a rise followed ${B[k].rises} of ${B[k].weeks} weeks` : "classifier band"}</small></div>`).join("");
  const why = [];
  if (c.rise.off) why.push(`The rapid-rise classifier is <b>switched off for your own series</b>. One of its inputs is the size of the national sentinel network${E && E.scale_test ? `: in a test at a tenth of that volume, ${E.scale_test.changed_at_a_tenth} of ${E.scale_test.weeks} of its calls changed` : ""}. The step shown comes from the alert rule alone.`);
  else { const rs = riseReasons(c), b = c.rise.band;
    why.push(`Rapid-rise classifier (machine learning, national signal): <b>${STEP[b].name}</b>.${B[b] ? ` In six past years a rapid rise followed ${B[b].rises} of ${B[b].weeks} ${STEP[b].name} weeks.` : ""}${rs.length ? ` This week: ${rs.join("; ")}.` : ""} It speaks about ${span}${c.lag > 0 ? ": on public data it fills the reporting gap, and with current data it looks ahead" : ""}.`); }
  why.push(`Alert rule: <b>${RULE_WORDS[a.level]}</b> (rule level ${a.level}). Newest data (${wk(a.last)}): ${f1(a.pLast)}% of ${c.own ? "your" : "sentinel"} samples positive, ${a.phase} from ${f1(a.p2)}% two weeks earlier. Watch line ${f1(th.yellow)}%, alert line ${f1(th.orange)}%; highest level in the projection the rule uses ${f1(Math.max(...a.ahead))}% (as a forecast that projection was no better than "same as last week").`);
  why.push(c.lag > 0 ? `That data is ${c.lag} week${c.lag > 1 ? "s" : ""} behind today, so today's level is projected, not observed.` : `Data is current to this week, so the level is observed.`);
  why.push(a.wave === "Mixed" ? "No single virus type dominates the last four weeks." : `${a.wave} makes up ${Math.round(a.waveShare * 100)}% of typed positives in the last four weeks.`);
  if (c.own) why.push(th.calibrated ? `Alert lines are computed from your own ${th.weeks} weeks, by the same formula as the national ones.` : `Alert lines are the national ones and may not fit your lab network: ${OWN_MIN_WEEKS} weeks of your own history are needed to compute yours, and you have ${th.weeks}.`);
  if (a.dataWarning) why.push(`Only ${a.last.n} samples were tested in the newest week, under half the usual ${a.medN}. Check the data before acting.`);
  $("alertCard").innerHTML = `
    <div class="level ${a.dataWarning ? "unconfirmed" : st.key}"><div class="dot"></div><div><h1>${head}</h1><div class="sub">${subline}</div></div></div>
    <div class="ladder">${ladder}</div>
    <div class="cats"><span class="cat">Classifier: <b>${c.rise.off ? "off" : STEP[c.rise.band].name}</b></span><span class="cat">Alert rule: <b>${RULE_WORDS[a.level]}</b></span><span class="cat">Type: <b>${a.wave}</b></span>
      <span class="cat">Phase: <b>${a.phase}</b></span>${a.dataWarning ? '<span class="cat warn">Data warning</span>' : ""}
      ${c.own ? `<span class="chip ${th.calibrated ? "est" : "exp"}">Thresholds ${th.calibrated ? "calibrated to your data" : "uncalibrated"}</span>` : ""}
      ${c.sim ? '<span class="chip sim">Simulated scenario: not real data</span>' : c.own ? '<span class="chip unv">Your own series, uploaded, not verified</span>' : c.uploaded ? '<span class="chip unv">Uses uploaded, unverified data</span>' : '<span class="chip real">Public data only</span>'}</div>
    <h3>Why this step</h3><ul class="why">${why.map((w) => `<li>${w}</li>`).join("")}</ul>
    <p class="note">${c.own ? "The step comes from the alert rule on your own series; the classifier is off." : "The step is the higher of two things: the classifier's band and the alert rule. Crossing the watch line gives Warning; crossing the alert line gives Outbreak. Both read the national sentinel series, so this is a national signal."}${c.rise.off ? "" : ` Classifier score ${c.rise.prob.toFixed(2)} (Watch from ${c.rise.tiers.watch}, Warning from ${c.rise.tiers.warning}); the score is not a probability.`}${c.rise.off ? "" : " The counts under Clear, Watch and Warning are how often each classifier band was followed by a rapid rise in six past years (see Why trust it)."} Thresholds are project thresholds, not the Ministry of Health's.</p>`;
  $("action").innerHTML = `<table><tr><th>Action at this step</th><th>Who acts</th></tr>${actionsOf(c).map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table>
    ${a.dataWarning ? `<p class="note"><b>If the figure is confirmed</b>, the actions at this step would be: ${stepActions(c).map((r) => r[0]).join("; ")}.</p>` : ""}
    <p class="note">Proposed actions for discussion with a health professional; not official guidance. They are the public-health actions the signal points to: a planner outside the Ministry would raise them with the body named. Watch asks only for free checks and Warning for preparation; the costly response starts at Outbreak.</p>`;
  renderPlanBox(c);
}

// Why an AI call came back without text, in words a presenter can read at a glance.
const AI_WHY = { passcode: "AI wording needs the uploader passcode", bad_request: "the figures were not accepted", no_key: "no AI key is set on this server", guard: "the AI text failed the checks", timeout: "the AI service took too long", network: "the AI service could not be reached", rate_limited: "the hourly limit for AI calls is used up", blocked: "the AI service declined to answer", empty: "the AI service sent nothing back", bad_reply: "the AI service sent something unreadable", simulated: "simulated figures are never sent" };
const aiWhy = (code) => AI_WHY[code] || (String(code || "").startsWith("gemini_") ? `the AI service refused the request (status ${String(code).slice(7)})` : "the AI service did not answer");
// ---------- action plan: a fixed template, or an AI draft that stays a draft until a named person approves it ----------
let PLAN = null, planMsg = "", barMsg = "";
const PLAN_WHEN = { clear: "ongoing", watch: "this week", warning: "within 3 days", outbreak: "today" };
function planInputs(c) { const st = stepOf(c);
  return { figures: figures(c), level: c.a.level, band: st.band || "off", step: st.key, actions: actionsOf(c).map(([action, who]) => ({ action, who })) }; }
const templatePlan = (inp) => inp.actions.map((x) => ({ what: x.action, who: x.who.split(",")[0].trim(), when: inp.figures.data_warning ? "today" : PLAN_WHEN[inp.step] }));
function renderPlanBox(c) {
  const inp = planInputs(c), key = JSON.stringify(inp), ap = STATE.plan;
  if (!PLAN || PLAN.key !== key) { PLAN = { key, source: "template", steps: templatePlan(inp) }; planMsg = ""; }
  const table = (steps) => `<table><tr><th>#</th><th>Task</th><th>Who</th><th>By when</th></tr>${steps.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.what)}</td><td>${esc(x.who)}</td><td>${esc(x.when)}</td></tr>`).join("")}</table>`;
  const ai = PLAN.source === "ai" || PLAN.source === "cache", why = !SERVER ? "Drafting with AI and approving need the local server." : c.sim ? "Simulated figures are never sent to the AI service, and a simulated plan cannot be approved." : "";
  // Stale: any upload, undo or restore of data after the approval was made.
  const stale = ap && (STATE.log || []).some((e) => e.type !== "plan" && new Date(e.changedAt || e.at) > new Date(ap.at)), same = ap && !stale && JSON.stringify(ap.steps) === JSON.stringify(PLAN.steps);
  $("planBox").innerHTML = `<div class="planbox">
    <b>Step-by-step plan</b> <span class="chip ${same ? "real" : ai ? "ai" : "exp"}">${ai ? `AI draft${PLAN.model ? ` (${esc(PLAN.model)})` : ""}` : "Fixed template"}: ${same ? "approved" : "not approved"}</span>
    ${table(PLAN.steps)}
    <p class="note">${ai ? "Drafted by a language model from the proposed actions and the computed figures on this page. Checked on the server before it was shown: every number is one of those figures, and each role and deadline comes from a fixed list. It cannot change the step or the actions." : "One line per proposed action, from a fixed template."} A plan counts only after a named person approves it.</p>
    <button type="button" id="planAI" ${why ? "disabled" : ""}>Draft with AI</button><button type="button" id="planOK" ${why ? "disabled" : ""}>Approve this plan</button>
    <span class="note" id="planMsg">${esc(why || planMsg)}</span>
    ${ap ? `<p style="margin:10px 0 4px"><b>Approved plan</b> <span class="chip real">Approved by ${esc(ap.by)}${ap.role ? ` (${esc(ap.role)})` : ""}, ${new Date(ap.at).toLocaleString()}</span> <span class="chip ${ap.source === "template" ? "exp" : "ai"}">${ap.source === "template" ? "from the template" : "from an AI draft"}</span></p>${table(ap.steps)}
      <p class="note">${stale ? "<b>The data has changed since this was approved.</b> It may no longer fit the step above: approve a new plan, or undo this one. " : ""}It can be undone in Uploads, roles and history.</p>` : ""}</div>`;
  if (why) return;
  const by = () => localStorage.getItem("fs_by") || "";
  $("planAI").onclick = async () => { $("planMsg").textContent = "Asking the AI service..."; $("planAI").disabled = true;
    const r = await api("POST", `/api/plan?mode=${MODE}`, { ...inp, by: by() }), d = r.data || {};
    if (r.ok && Array.isArray(d.steps) && d.steps.length) { PLAN = { key, source: d.source, steps: d.steps, model: d.model }; planMsg = d.source === "cache" ? "This draft was made earlier for the same figures." : d.tried && d.tried.length ? `Answered by a fallback model, ${d.model}, after ${d.tried.join("; ")}.` : ""; }
    else planMsg = r.status === 401 ? "Drafting needs the uploader passcode (see Uploads, roles and history)." : r.status === 429 ? "Too many wrong passcodes. Wait ten minutes." : r.status === 400 ? `The request was not accepted${d.detail ? ": " + d.detail : ""}.` : `The fixed template is shown: ${aiWhy(d.reason)}${d.detail ? " (" + d.detail + ")" : ""}.`;
    renderPlanBox(context()); };
  $("planOK").onclick = async () => {
    if (!by()) { $("planMsg").textContent = "Enter your name or role under Uploads, roles and history first: an approval needs a name."; return; }
    const r = await api("POST", `/api/plan/approve?mode=${MODE}`, { ...inp, steps: PLAN.steps, source: ai ? "ai" : "template", by: by() });
    if (r.ok) { STATE = tidy({ ...emptyState(), ...r.data }); planMsg = "Approved."; render(); }
    else { planMsg = r.status === 401 ? "Approving needs the uploader passcode (see Uploads, roles and history)." : r.status === 429 ? "Too many wrong passcodes. Wait ten minutes." : `The server did not accept this plan${r.data && r.data.detail ? ": " + r.data.detail : ""}.`; renderPlanBox(context()); } };
}

function renderStamp(c) {
  const b = c.base[c.base.length - 1], past = STATE.lab.length > D.pub_lag;
  let h = c.own ? `Showing <b>your own uploaded series</b>: ${c.base.length} weeks, ${wk(c.base[0])} to ${wk(b)}. The national data is not mixed in. Alert lines: <b>${c.th.calibrated ? "calibrated to your data" : `uncalibrated (${OWN_MIN_WEEKS} weeks needed, ${c.base.length} given)`}</b>.`
    : `Public data through <b>${wk(b)}</b> (WHO FluNet). ` + (c.sim ? `The scenario runs to <b>${wk(c.series[c.series.length - 1])}</b>.` : past ? `Uploaded data now runs to <b>${wk(c.today)}</b>.` : `Today is about <b>${wk(c.today)}</b>, assuming the usual delay of ${D.pub_lag} weeks.`);
  if (STATE.stamp) h += ` &nbsp;|&nbsp; <b class="unv">Uploaded, not verified</b> (${SERVER ? "shared on this server" : "kept in this browser only"}): ${STATE.lab.length} lab week(s), ${STATE.ili.length} ILI, ${STATE.clusters.length} cluster rows, ${STATE.clusterlist.length} listed clusters, ${STATE.beds.length} bed rows, last at ${new Date(STATE.stamp).toLocaleString()} <button id="reset">Reset to public data</button>`;
  if (c.sim) h = `<b class="simflag">SIMULATION ON: the newest ${c.nSim} week(s) are invented, not data.</b> <button id="simOff">Exit simulation</button> &nbsp;|&nbsp; ` + h;
  if (barMsg) h += ` &nbsp;|&nbsp; <b class="unv">${esc(barMsg)}</b>`;
  $("stamp").innerHTML = h;
  if ($("reset")) $("reset").onclick = resetState;
  if ($("simOff")) $("simOff").onclick = () => { SIM.on = false; $("simOn").checked = false; render(); };
  $("replayBar").hidden = c.own; $("hero").hidden = REPLAY || c.own;
  $("replayBar").innerHTML = REPLAY
    ? `<b>Replay of real data.</b> The alert, the chart and the classifier are shown as they would have stood if public data ended at ${wk(b)}, using the figures as published in October 2026 and today's cut-offs; the map and the timeline show figures published later. The four weeks you can load are the real national figures and stand in for a planner's own lab feed. ` + (STATE.lab.length ? `Newer weeks are loaded. Press Reset above to run it again.` : `Drop in <a href="templates/demo_real_replay_2025_W38_W41.csv" download>the four real weeks that followed</a>, or <button id="playNext">Load those four weeks</button>.`) + ` <a href="./">Leave replay</a>`
    : `<b>New here?</b> <a href="?replay=1">Run the replay of the October 2025 surge</a> to see the alert change as newer data arrives.`;
  if ($("playNext")) $("playNext").onclick = async () => {
    const wb = XLSX.read(await (await fetch("templates/demo_real_replay_2025_W38_W41.csv")).text(), { type: "string" });
    const { errs, out } = validate("lab", XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }), false);
    barMsg = errs.length ? errs[0] : await saveUpload("lab", out); render();
  };
}

function renderChart(c) {
  const hist = c.series.slice(-60), a = c.a, last = a.last, H = Math.min(8, c.lag + 4);
  const labels = hist.map(wk), n = hist.length;
  for (let h = 1; h <= H; h++) labels.push(wk(nextWeek(last, h)) + (h === c.lag ? " (today)" : ""));
  const pad = (arr) => arr.concat(Array(H).fill(null));
  const fut = (fn) => Array(n - 1).fill(null).concat([a.pLast]).concat(Array.from({ length: H }, (_, i) => fn(a.fc[i + 1])));
  const line = (v) => labels.map(() => v);
  const ds = [
    { label: "Published (public)", data: pad(hist.map((s) => (s.uploaded || s.simulated ? null : M.pct(s)))), borderColor: "#16202a", backgroundColor: "#16202a", pointRadius: 0, borderWidth: 2 },
    { label: "Uploaded, not verified", data: pad(hist.map((s, i) => (s.uploaded || (hist[i + 1] && hist[i + 1].uploaded) ? M.pct(s) : null))), borderColor: "#c0282d", backgroundColor: "#c0282d", pointRadius: 3, borderWidth: 2 },
    { label: c.sim ? "Simulated scenario (invented)" : "", data: pad(hist.map((s, i) => (s.simulated || (hist[i + 1] && hist[i + 1].simulated) ? M.pct(s) : null))), borderColor: "#7b2cbf", backgroundColor: "#7b2cbf", borderDash: [4, 3], pointRadius: 3, borderWidth: 2 },
    { label: "Last value carried forward (baseline)", data: fut((f) => f.baseline), borderColor: "#2a5aa8", borderDash: [2, 3], pointRadius: 0, borderWidth: 2 },
    { label: "Projection the alert rule uses (not a forecast: see below)", data: fut((f) => f.model), borderColor: "#8a96a3", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
    { label: "Usual range around the baseline (80% of changes in the training weeks)", data: fut((f) => f.hi), borderColor: "transparent", backgroundColor: "rgba(42,90,168,.12)", pointRadius: 0, fill: "+1" },
    { label: "", data: fut((f) => f.lo), borderColor: "transparent", pointRadius: 0 },
    { label: "Watch line (crossing it gives Warning)", data: line(c.th.yellow), borderColor: "#d9660b", borderWidth: 1, pointRadius: 0 },
    { label: "Alert line (crossing it gives Outbreak)", data: line(c.th.orange), borderColor: "#c0282d", borderWidth: 1, pointRadius: 0 },
  ];
  if (chart) chart.destroy();
  chart = new Chart($("chart"), { type: "line", data: { labels, datasets: ds }, options: { maintainAspectRatio: false, animation: false, spanGaps: false,
    plugins: { legend: { labels: { filter: (i) => i.text } } },
    scales: { y: { beginAtZero: true, title: { display: true, text: "% of sentinel samples positive" } }, x: { ticks: { maxTicksLimit: 14 } } } } });
  const sig = [];
  if (STATE.ili.length) { const r = STATE.ili.slice(-2); const d = r.length > 1 ? r[1].rate - r[0].rate : 0;
    sig.push(`<div class="signal"><b>ILI clinic rate</b> <span class="chip unv">Uploaded</span><br>${f1(r[r.length - 1].rate)}% in ${wk(r[r.length - 1])} ${d > 0 ? "▲ rising" : d < 0 ? "▼ falling" : ""}<br><span class="note">Supporting signal. Does not change the alert level.</span></div>`); }
  if (STATE.clusters.length) { const lw = STATE.clusters[STATE.clusters.length - 1]; const tot = STATE.clusters.filter((r) => r.year === lw.year && r.week === lw.week).reduce((s, r) => s + r.clusters, 0);
    sig.push(`<div class="signal"><b>Clusters reported</b> <span class="chip unv">Uploaded</span><br>${tot} in ${wk(lw)}<br><span class="note">Supporting signal. Shown on the map.</span></div>`); }
  $("signals").innerHTML = sig.join("") || `<span class="note">Read the blue baseline as the forecast. The grey projection is drawn only because the alert rule uses it: as a forecast it was no better than "same as last week" in testing (see Every result, pass or fail).</span>`;
}

const hav = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function districts() {
  const tot = GEO.features.reduce((s, f) => s + f.properties.pop_thousand, 0);
  return GEO.features.map((f) => { const c = L.geoJSON(f).getBounds().getCenter();
    return { name: f.properties.name, pop: f.properties.pop_thousand, share: f.properties.pop_thousand / tot, c: [c.lat, c.lng], published: f.properties.published_cases_w42_2025, schools: f.properties.schools, pupils: f.properties.pupils }; });
}
// Hotspot source, best available first: an uploaded cluster list, uploaded district counts, then the published 2025 district totals.
function hotspotData() {
  const ds = districts().map((d) => ({ ...d, value: 0, cases: 0, has: false }));
  const by = Object.fromEntries(ds.map((d) => [d.name, d]));
  const rate = (d) => (d.value / (d.pop * 1000)) * 1e5;
  if (STATE.clusterlist.length) {
    STATE.clusterlist.forEach((r) => { const d = by[r.district]; d.value++; d.cases += r.cases; });
    ds.forEach((d) => { d.has = true; d.rate = rate(d); });
    return { kind: "list", unit: "clusters", chip: ["unv", "Uploaded, not verified"], ds, points: STATE.clusterlist,
      note: "The heat layer glows where uploaded clusters are large and close together. Each circle is one cluster, sized by its cases; the largest is labelled. District shading is clusters per 100,000 people." };
  }
  if (STATE.clusters.length) {
    const lw = STATE.clusters[STATE.clusters.length - 1];
    STATE.clusters.filter((r) => r.year === lw.year && r.week === lw.week).forEach((r) => (by[r.district].value += r.clusters));
    ds.forEach((d) => { d.has = true; d.rate = rate(d); });
    return { kind: "counts", unit: "clusters", chip: ["unv", "Uploaded, not verified"], ds, points: [],
      note: `Circles show uploaded cluster counts per district for ${wk(lw)}. Shading is clusters per 100,000 people. Upload a cluster list to see individual clusters and which is largest.` };
  }
  ds.forEach((d) => { if (d.published) { d.value = d.published; d.has = true; d.rate = rate(d); } });
  return { kind: "published", unit: "cases", chip: ["real", "Real data"], ds, points: [],
    note: "Reported influenza cases to week 42 of 2025, from the Selangor State Assembly answer. Only four districts were published; the other five are grey, which means not published, not zero. These are case totals, not cluster locations: no public source gives where clusters were." };
}
// ---------- one map: every state, then Selangor's districts and every registered facility when zoomed in ----------
const DETAIL_ZOOM = 7; // from this zoom level the map also draws districts, hotspots, hospitals and clinics
const ST = { disease: "flu", view: "weekly", on: {}, national: true, year: null, measure: "sum", playing: null };
const HEATSTEPS = ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#8c2d04"];
// Influenza measures for state shading: how to read the value from a state's row, its unit, its period and the menu text.
const FLU_MEASURE = {
  sum: [(r) => (r.w43 == null ? null : r.w43 + r.w44 + r.w45), "clusters", "weeks 43 to 45 of 2025", "Clusters, weeks 43 to 45 of 2025 together"],
  w45: [(r) => r.w45, "clusters", "week 45 of 2025", "Clusters in week 45 of 2025"],
  w44: [(r) => r.w44, "clusters", "week 44 of 2025", "Clusters in week 44 of 2025"],
  w43: [(r) => r.w43, "clusters", "week 43 of 2025", "Clusters in week 43 of 2025"],
  cum: [(r) => r.cumulative_w45, "clusters", "running total to week 45 of 2025", "Clusters, running total to week 45 of 2025"],
  w40: [(r) => r.w40, "clusters", "week 40 of 2025", "Clusters in week 40 of 2025 (five states named)"],
  ili: [(r) => r.ili_w40, "% ILI consultation rate", "week 40 of 2025", "ILI consultation rate, week 40 of 2025 (five states named)"] };
let detail = false, stateLayer, STGEO, FACMETA;
const boundsOf = (g) => L.geoJSON(g).getBounds();
const zoomTo = (b) => map.setView(b.getCenter(), Math.min(11, Math.max(DETAIL_ZOOM, map.getBoundsZoom(b))));
const viewAll = () => (STGEO ? map.fitBounds(boundsOf(STGEO), { padding: [4, 4] }) : map.setView([3.2, 101.45], 9));
// One value per state shape for the chosen disease, measure and year; null means no published figure.
function stateValues() {
  const out = {}, tip = {}, named = {};
  if (ST.disease === "flu") { const [get, unit, when] = FLU_MEASURE[ST.measure];
    for (const nm in STATES.flu.states) { const v = get(STATES.flu.states[nm]); named[nm] = v;
      nm.split(" and ").forEach((part) => { out[part] = v; if (part !== nm) tip[part] = `Counted together as ${nm}`; }); }
    return { out, tip, named, unit, when, max: Math.max(...Object.values(out).filter((v) => v != null), 1) }; }
  const Y = STATES.dengue.yearly, val = (nm, i) => { const cs = Y.states[nm][i], pp = Y.population_thousand[nm][i]; return cs == null ? null : ST.measure === "cases" ? cs : pp ? (cs / (pp * 1000)) * 1e5 : null; };
  let max = 1; for (const nm in Y.states) Y.labels.forEach((_, i) => { const v = val(nm, i); if (v != null && v > max) max = v; });
  for (const nm in Y.states) named[nm] = out[nm] = val(nm, ST.year);
  out.Putrajaya = out["Kuala Lumpur"]; tip.Putrajaya = tip["Kuala Lumpur"] = "Kuala Lumpur and Putrajaya are counted together";
  return { out, tip, named, max, unit: ST.measure === "cases" ? "cases" : "cases per 100,000 people", when: String(Y.labels[ST.year]) };
}
// State shading only. It has its own pane, so the year slider can redraw it without touching the other layers.
function drawStates() {
  if (stateLayer) { stateLayer.remove(); stateLayer = null; }
  if (!STGEO || !STATES) { $("stLegend").textContent = ""; $("stSrc").textContent = ""; return; }
  const flu = ST.disease === "flu", Y = STATES.dengue.yearly;
  if (ST.year == null) ST.year = Y.labels.length - 1;
  $("stYearRow").hidden = $("stPlay").hidden = flu; $("mapModeRow").hidden = !flu;
  $("stYear").max = Y.labels.length - 1; $("stYear").value = ST.year; $("stYearV").textContent = Y.labels[ST.year];
  $("stSrc").textContent = flu ? `States: influenza clusters from Ministry of Health statements. ${STATES.flu.note}` : `States: reported dengue cases for the chosen year. ${Y.note}`;
  const V = stateValues(), fmt = (v) => (v >= 100 ? Math.round(v).toLocaleString() : Number.isInteger(v) ? String(v) : f1(v));
  const colour = (v) => (v == null ? "#d5dbe1" : HEATSTEPS[Math.min(HEATSTEPS.length - 1, Math.floor(Math.sqrt(Math.max(0, v) / V.max) * HEATSTEPS.length))]);
  // Zoomed in on influenza, Selangor's own districts carry the shading, so the state fill steps aside.
  const hollow = (nm) => nm === "Selangor" && detail && flu && LAYERS.shade;
  if (LAYERS.state) stateLayer = L.geoJSON(STGEO, { pane: "states", style: (f) => ({ color: "#555", weight: 1, fillColor: colour(V.out[f.properties.name]), fillOpacity: hollow(f.properties.name) ? 0 : detail ? 0.55 : 0.85 }),
    onEachFeature: (f, layer) => { const nm = f.properties.name, v = V.out[nm];
      layer.bindTooltip(`<b>${nm}</b><br>${v == null ? "No figure published" : fmt(v) + " " + (v === 1 ? V.unit.replace(/s$/, "") : V.unit)}<br>${V.when}` + (V.tip[nm] ? `<br><i>${V.tip[nm]}</i>` : "") + (detail ? "" : "<br><i>Click to zoom in</i>"), { sticky: true });
      layer.on("click", () => { if (!detail) zoomTo(boundsOf(f)); }); } }).addTo(map);
  const ranked = Object.entries(V.named).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]), last = ranked[ranked.length - 1];
  $("stLegend").innerHTML = `<b>State shading:</b> <span class="lgbar">${HEATSTEPS.map((c) => `<i style="background:${c}"></i>`).join("")}</span> <span>0 to ${fmt(V.max)} ${V.unit}</span> <span class="lgna"><i></i> no figure published</span>` +
    (ranked.length ? `<br><b>Highest, ${V.when}:</b> ${ranked.slice(0, 3).map(([nm, v]) => `${nm} (${fmt(v)})`).join(", ")}.` + (flu ? "" : ` <b>Lowest:</b> ${last[0]} (${fmt(last[1])}).`) : "") +
    (flu ? "" : ` <span class="note">Colours use one fixed scale across all years, so years can be compared.</span>`);
}
function renderMap(c) {
  if (!map) { map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
    map.attributionControl.addAttribution("State boundaries: geoBoundaries");
    // Fixed drawing order, bottom to top. The cluster heat layer sits between districts and hotspot circles (Leaflet's own overlay pane, 400).
    [["states", 350], ["districts", 360], ["hot", 410], ["fac_clinic", 420], ["fac_private", 430], ["fac_government", 440]].forEach(([p, z]) => (map.createPane(p).style.zIndex = z));
    viewAll(); detail = map.getZoom() >= DETAIL_ZOOM;
    map.on("zoomend", () => { const d = map.getZoom() >= DETAIL_ZOOM; if (d !== detail) { detail = d; renderMap(context()); } });
    map.on("resize", () => { if (!detail) viewAll(); }); } // keep the whole country in frame when the window changes size
  if (geoLayer) geoLayer.remove(); if (hospLayer) hospLayer.remove(); if (heatLayer) { heatLayer.remove(); heatLayer = null; }
  drawStates();
  const flu = ST.disease === "flu", sel = detail && flu; // Selangor's influenza layers are drawn only when zoomed in on influenza
  const hot = $("mapMode").value === "hot", H = hotspotData(), ds = H.ds;
  for (const k of ["shade", "heat", "hot"]) $("ly_" + k).closest("label").classList.toggle("idle", !sel);
  for (const k of ["government", "private", "clinic"]) $("ly_" + k).closest("label").classList.toggle("idle", !detail);
  $("mapHint").textContent = !detail ? "Zoomed out: state shading only. Click a state, or press Zoom to Selangor, to see hospitals and clinics" + (flu ? ", and Selangor's districts and cluster hotspots." : ".")
    : flu ? "Zoomed in: hospitals and clinics are drawn for every state. District shading, cluster heat and hotspot circles exist for Selangor only."
    : "Zoomed in: hospitals and clinics are drawn for every state. Selangor's district shading and hotspots are influenza figures, so they are hidden while the map shows dengue.";
  const near3 = (d) => HOSP.map((h) => ({ h, km: hav(d.c, [h.lat, h.lon]) })).sort((a, b) => a.km - b.km).slice(0, 3).map((x) => `${x.h.name}: ${Math.round(x.km)} km`).join("<br>");
  const school = (d) => `Government schools: ${d.schools}; pupils: ${d.pupils.toLocaleString()} <i>Real data, 2025</i>`;
  if (!hot) {
    const byPupils = $("mapMode").value === "pupils", val = (d) => (byPupils ? d.pupils : d.pop), mx = Math.max(...ds.map(val)), tot = ds.reduce((a, d) => a + val(d), 0);
    $("mapChip").className = "chip exp"; $("mapChip").textContent = "Selangor districts: exploratory";
    $("mapNote").textContent = "Selangor districts: " + (byPupils
      ? "shading shows each district's share of Selangor's government-school pupils (Ministry of Education records, 30 June 2025). Most clusters in the 2025 surge were in schools, so this is a second exposure proxy. It is real data about schools, not a forecast of district cases."
      : "shading shows each district's share of Selangor's population: an exposure proxy, not a forecast of district cases. No public district-level influenza series exists.");
    geoLayer = L.geoJSON(GEO, { pane: "districts", style: (f) => ({ color: "#555", weight: 1, fillColor: byPupils ? "#1d6fa5" : "#6d3a9c", fillOpacity: LAYERS.shade ? 0.08 + 0.55 * (val(ds.find((x) => x.name === f.properties.name)) / mx) : 0 }),
      onEachFeature: (f, layer) => { const d = ds.find((x) => x.name === f.properties.name);
        layer.bindPopup(`<b>${d.name}</b><br>Population ${Math.round(d.pop)} thousand (${Math.round(d.share * 100)}% of Selangor) <i>Real data</i><br>${school(d)}<br><b>Nearest hospitals</b> <i>(straight-line, approximate)</i><br>${near3(d)}`); } });
    if (sel) geoLayer.addTo(map);
    const rank = [...ds].sort((a, b) => val(b) - val(a));
    $("hotRank").innerHTML = `<h3>Districts by ${byPupils ? "pupils" : "population"} <span class="chip real">Real data</span></h3><table><tr><th>District</th><th class="num">Population (thousand)</th><th class="num">Schools</th><th class="num">Pupils</th><th class="num">Share</th></tr>${rank.map((d) => `<tr><td>${d.name}</td><td class="num">${Math.round(d.pop)}</td><td class="num">${d.schools}</td><td class="num">${d.pupils.toLocaleString()}</td><td class="num">${Math.round((100 * val(d)) / tot)}%</td></tr>`).join("")}</table>`;
    return facilityLayers();
  }
  const have = ds.filter((d) => d.has), mxRate = Math.max(...have.map((d) => d.rate), 1e-9), mxVal = Math.max(...have.map((d) => d.value), 1);
  $("mapChip").className = "chip " + H.chip[0]; $("mapChip").textContent = "Selangor districts: " + H.chip[1].toLowerCase(); $("mapNote").textContent = "Selangor districts: " + H.note;
  geoLayer = L.geoJSON(GEO, { pane: "districts", style: (f) => { const d = ds.find((x) => x.name === f.properties.name);
      if (!LAYERS.shade) return { color: "#555", weight: 1, fillOpacity: 0 };
      return d.has ? { color: "#555", weight: 1, fillColor: "#c0282d", fillOpacity: (0.06 + 0.6 * (d.rate / mxRate)) * (H.kind === "list" && LAYERS.heat ? 0.4 : 1) } : { color: "#777", weight: 1, dashArray: "4", fillColor: "#9aa7b3", fillOpacity: 0.25 }; },
    onEachFeature: (f, layer) => { const d = ds.find((x) => x.name === f.properties.name);
      layer.bindPopup(`<b>${d.name}</b><br>Population ${Math.round(d.pop)} thousand<br>${school(d)}<br>` + (d.has ? `${d.value} ${H.unit}${H.kind === "list" ? `, ${d.cases} cases` : ""}; <b>${f1(d.rate)} per 100,000 people</b>` : "No figure published for this district") + `<br><b>Nearest hospitals</b> <i>(straight-line, approximate)</i><br>${near3(d)}`); } });
  if (sel) geoLayer.addTo(map);
  const marks = [], pts = H.points.filter((r) => r.lat != null && r.lon != null).sort((a, b) => b.cases - a.cases);
  if (H.kind === "list") {
    pts.forEach((r, i) => { const m = L.circleMarker([r.lat, r.lon], { pane: "hot", radius: 4 + 2.2 * Math.sqrt(r.cases), color: i === 0 ? "#111" : "#8f1d21", weight: i === 0 ? 3 : 1, fillColor: "#e0393f", fillOpacity: LAYERS.heat ? 0.1 : 0.55 })
      .bindPopup(`<b>${esc(r.name)}</b><br>${esc(r.district)}${r.setting ? ", " + esc(r.setting) : ""}<br><b>${esc(r.cases)} cases</b><br><i>Uploaded, not verified</i>`);
      if (i === 0) m.bindTooltip(`Largest: ${esc(r.name)} (${esc(r.cases)})`, { permanent: true, direction: "top" }); marks.push(m); });
  } else {
    have.forEach((d) => marks.push(L.circleMarker(d.c, { pane: "hot", radius: 6 + 26 * Math.sqrt(d.value / mxVal), color: "#8f1d21", weight: 1, fillColor: "#e0393f", fillOpacity: 0.5 })
      .bindTooltip(`${d.name}: ${d.value}`, { permanent: true, direction: "center", className: "hotlabel" })));
  }
  // Heat layer: glows where clusters are large and close together. Only drawn from real cluster positions.
  if (sel && H.kind === "list" && pts.length && LAYERS.heat) { const top = Math.max(...pts.map((r) => r.cases));
    heatLayer = L.heatLayer(pts.map((r) => [r.lat, r.lon, Math.max(0.2, r.cases / top)]), { radius: 34, blur: 26, minOpacity: 0.35, maxZoom: 11, gradient: { 0.3: "#ffe08a", 0.55: "#fd8d3c", 0.8: "#e31a1c", 1: "#7a0010" } }).addTo(map); }
  hospLayer = L.layerGroup(marks); if (sel && LAYERS.hot) hospLayer.addTo(map);
  const byRate = [...have].sort((a, b) => b.rate - a.rate), byVal = [...have].sort((a, b) => b.value - a.value);
  const noCoord = H.points.length - pts.length;
  $("hotRank").innerHTML = (have.length ? `<p><b>Most ${H.unit}:</b> ${byVal[0].name} (${byVal[0].value}). <b>Highest density:</b> ${byRate[0].name} (${f1(byRate[0].rate)} per 100,000 people).</p>` : "") +
    (H.kind === "list" && pts.length ? `<h3>Largest clusters <span class="chip unv">Uploaded</span></h3><table><tr><th>Cluster</th><th>District</th><th>Setting</th><th class="num">Cases</th></tr>${[...H.points].sort((a, b) => b.cases - a.cases).slice(0, 5).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.district)}</td><td>${esc(r.setting || "")}</td><td class="num">${esc(r.cases)}</td></tr>`).join("")}</table>` : "") +
    `<h3>Districts by density <span class="chip ${H.chip[0]}">${H.chip[1]}</span></h3><table><tr><th>District</th><th class="num">${H.unit === "cases" ? "Cases" : "Clusters"}</th>${H.kind === "list" ? '<th class="num">Cases</th>' : ""}<th class="num">Per 100,000 people</th></tr>${byRate.map((d) => `<tr><td>${d.name}</td><td class="num">${d.value}</td>${H.kind === "list" ? `<td class="num">${d.cases}</td>` : ""}<td class="num">${f1(d.rate)}</td></tr>`).join("")}${ds.filter((d) => !d.has).map((d) => `<tr><td>${d.name}</td><td class="num" colspan="2">not published</td></tr>`).join("")}</table>` +
    (H.kind !== "list" ? `<p class="note">The heat layer needs individual cluster positions. Upload a cluster list to see it; <a href="templates/demo_SIMULATED_cluster_list.csv" download>a simulated example</a> is provided.</p>` : "") +
    (noCoord ? `<p class="note">${noCoord} listed cluster(s) had no coordinates, so they count toward their district but are not drawn.</p>` : "");
  facilityLayers();
}
// Hospitals and clinics for every state. Built once; shown only when zoomed in, each kind in its own pane so hospitals stay on top.
function facilityLayers() {
  const KIND = { clinic: ["Government health clinic", "#e07a00", 3.5, 1], private: ["Private hospital licensed under Act 586", "#b5179e", 5.5, 2], government: ["Public hospital", "#0b6e6e", 6.5, 2] };
  const where = (f) => f.pos || (f.approximate ? "Approximate position: placed at its town, not the building" : f.osm ? "Position from OpenStreetMap: the registry's coordinates for this facility were wrong" : FACMETA ? "Position from the Ministry of Health registry" : "Position from OpenStreetMap");
  if (!facDone) { facDone = true;
    for (const k in KIND) { const [label, col, rad, wt] = KIND[k], list = FAC.filter((f) => f.kind === k);
      FACG[k] = L.layerGroup(list.map((f) => L.circleMarker([f.lat, f.lon], { pane: "fac_" + k, radius: rad, color: f.approximate ? col : "#fff", weight: f.approximate ? 2 : wt * 0.5, fillColor: col, fillOpacity: f.approximate ? 0.15 : 0.9, dashArray: f.approximate ? "3" : null })
        .bindPopup(() => `<b>${f.name}</b><br>${f.type || label}<br>${[f.district, f.state].filter(Boolean).join(", ")}${f.address ? "<br>" + f.address : ""}` +
          (f.beds ? `<br><b>${f.beds.toLocaleString()} beds</b>${f.icu ? `, ${f.icu} ICU beds` : ""}${f.vent ? `, ${f.vent} ventilators` : ""}${f.occ != null ? `; ${Math.round(f.occ)}% of beds in use` : ""} <i>(${f.beds_note || "Ministry bed file, " + FACMETA.beds.updated})</i>` : "") + `<br><i>${where(f)}</i>`)));
      $("n_" + k).textContent = list.length.toLocaleString(); }
    const n = (k) => FAC.filter((f) => f.kind === k).length, M = FACMETA, P = M && M.private, moved = M ? M.registry_coordinates_wrong_repositioned : [], off = M ? M.registry_coordinates_wrong_left_off : [];
    $("facNote").innerHTML = !M ? `${FAC.length} facilities are plotted.` :
      `<b>${FAC.length.toLocaleString()}</b> facilities across Malaysia are plotted; zoom in on any state to see them. <b>${n("government")}</b> public hospitals and <b>${n("clinic").toLocaleString()}</b> government health clinics come from the Ministry of Health's own facility registry, as registered on ${M.as_at}, at the Ministry's coordinates. ` +
      (P && P.listed ? `<b>${n("private")}</b> private hospitals licensed under Act 586 come from ${P.source}. ${P.note} ` : "Private hospitals are not plotted: the Ministry's list of hospitals licensed under Act 586 could not be obtained in a usable form. ") +
      `Rural clinics (Klinik Desa), dental clinics and private GP clinics are not plotted.` +
      (moved.length || off.length ? ` ${moved.length + off.length} registry rows had coordinates far outside their state: ${moved.length} were placed by name from OpenStreetMap instead${off.length ? `, and ${off.length} could not be placed and are left off (${off.join("; ")})` : ""}.` : "") +
      (M.beds ? ` Click a public hospital to see its beds, ICU beds and ventilators: ${M.beds.hospitals_with_beds} of them have figures in the Ministry's bed file (last updated ${M.beds.updated}).` : "") + ` The capacity table uses twelve Selangor government hospitals.`; }
  for (const k in KIND) { const want = LAYERS[k] && detail; if (want !== map.hasLayer(FACG[k])) want ? FACG[k].addTo(map) : FACG[k].remove(); }
}
function setupLayers() {
  const sync = () => { for (const k in LAYERS) $("ly_" + k).checked = LAYERS[k]; renderMap(context()); };
  for (const k in LAYERS) $("ly_" + k).onchange = (e) => { LAYERS[k] = e.target.checked; sync(); };
  $("lyAll").onclick = () => { for (const k in LAYERS) LAYERS[k] = true; sync(); };
  $("lyNone").onclick = () => { for (const k in LAYERS) LAYERS[k] = false; sync(); };
}
function renderPlan(c) {
  const adm = +$("adm").value, share = +$("share").value / 100, occA = +$("occ").value / 100, a = c.a;
  $("admV").textContent = adm; $("shareV").textContent = Math.round(share * 100) + "%"; $("occV").textContent = Math.round(occA * 100) + "%";
  const est = a.pLast; // the newest value: carried forward, it was the better forecast in testing
  const mult = Math.min(4, Math.max(0.3, est / c.th.median));
  const up = Object.fromEntries(STATE.beds.map((r) => [r.hospital, r.beds]));
  const uploaded = STATE.beds.length > 0, M = HOSPMETA || { counts: { estimated: 0 }, occupancy_reported: [], note: "" }, n = M.counts, allOcc = HOSP.every((h) => h.occ != null), short = (nm) => nm.replace("Hospital ", "");
  $("bedChip").className = "chip " + (uploaded ? "unv" : "est");
  $("bedChip").className = "chip " + (uploaded ? "unv" : n.estimated || !allOcc ? "est" : "real");
  $("bedChip").textContent = uploaded ? "Beds uploaded, not verified" : n.estimated ? `Bed totals: ${HOSP.length - n.estimated} real, ${n.estimated} estimated` : allOcc ? "Real beds, 2024 occupancy" : "Real bed totals, occupancy partly assumed";
  $("occRow").hidden = allOcc; // the slider only matters for hospitals with no reported occupancy
  // Room for flu = total beds x (1 - occupancy) x share. Occupancy is the reported figure where the Ministry file has one, else the slider.
  // An uploaded figure is taken as the number of beds available and replaces the calculation for that hospital.
  const cap = HOSP.map((h) => { const occ = h.occ != null ? Math.min(100, h.occ) / 100 : occA, room = up[h.name] ?? Math.floor(Math.round(h.beds * (1 - occ)) * share);
    return { ...h, occUsed: occ, room, left: room }; });
  const ds = districts().map((d) => ({ ...d, need: Math.round(adm * mult * d.share) })).sort((x, y) => y.need - x.need);
  let unmet = 0, overflowNearest = 0;
  const naive = Object.fromEntries(cap.map((h) => [h.name, 0]));
  // Each district first uses hospitals inside it, then the nearest ones within MAXKM. What is left is unplaced, not sent further.
  const MAXKM = 40, R = ds.map((d) => ({ d, need: d.need, got: [], near: cap.map((h) => ({ h, km: hav(d.c, [h.lat, h.lon]) })).sort((x, y) => x.km - y.km) }));
  const take = (r, x) => { const t = Math.min(r.need, x.h.left); if (t > 0) { x.h.left -= t; r.need -= t; r.got.push({ ...x, t }); } };
  R.forEach((r) => { naive[r.near[0].h.name] += r.d.need; r.near.filter((x) => x.h.district === r.d.name).forEach((x) => take(r, x)); });
  R.forEach((r) => r.near.filter((x) => x.km <= MAXKM).forEach((x) => take(r, x)));
  const rows = R.map((r) => { unmet += r.need;
    return `<tr><td>${r.d.name}</td><td class="num">${r.d.need}</td><td>${r.got.sort((x, y) => x.km - y.km).map((x) => `${short(x.h.name)} ${x.t} (${Math.round(x.km)} km)`).join(", ") || "none within 40 km"}</td><td class="num">${r.need || ""}</td></tr>`; });
  cap.forEach((h) => { if (naive[h.name] > h.room) overflowNearest++; });
  $("planNote").innerHTML = `Demand = ${adm} baseline admissions × ${mult.toFixed(2)} (newest positivity ${f1(est)}% ÷ usual ${f1(c.th.median)}%; about ${ds.reduce((x, d) => x + d.need, 0)} admissions), split by population. A district first uses hospitals inside it, then the nearest within 40 km; the rest is shown as unplaced. Room for flu at each hospital = beds × (1 − occupancy) × the share usable for flu. ${M.note}Assumes admissions scale with positivity. This is an illustration, not a recommended allocation. Distances are straight-line.`;
  const from = (h) => (h.beds_src === "estimated" ? `<span class="fail">Estimated</span>` : h.src_url ? `<a href="${h.src_url}" target="_blank" rel="noopener">${h.src}</a>` : h.src);
  $("plan").innerHTML = `<table><tr><th>District</th><th class="num">Need</th><th>Hospitals with room within 40 km</th><th class="num">Unmet</th></tr>${rows.join("")}</table>
    <p class="note"><b>${unmet}</b> admissions unplaced under this scenario (no room within 40 km). If every district simply used its nearest hospital, <b>${overflowNearest}</b> hospital(s) would be over the room worked out for them.</p>
    <h3>Hospitals in this scenario</h3>
    <table><tr><th>Hospital</th><th class="num">Beds</th><th>Beds from</th><th class="num">Occupancy</th><th class="num">Room for flu</th><th class="num">Used</th></tr>
    ${cap.map((h) => `<tr><td>${short(h.name)}</td><td class="num">${h.beds.toLocaleString()}</td><td>${from(h)}</td><td class="num">${Math.round(h.occ != null ? h.occ : h.occUsed * 100)}% ${h.occ != null ? "reported" : "assumed"}</td><td class="num">${h.room}${up[h.name] != null ? " (uploaded)" : ""}</td><td class="num">${h.room - h.left}</td></tr>`).join("")}</table>
    <p class="note">${n.estimated ? `"Estimated" totals are the middle value for a hospital of the same type in the Ministry file, used where no published figure was found. ` : ""}Occupancy above 100% means the hospital ran over its beds in operation, so it has no room here. Upload today's free beds (Upload newest data, Hospital beds) to replace the calculation for any hospital.</p>`;
}

// ---------- why trust it: six past years of the classifier's calls, with their counts ----------
let evChart, EVID, STRESS, dengueChartObj;
function renderTrust() {
  const E = D.rise.evidence, S = evStats(); if (!E || !S) { $("trust").hidden = true; return; }
  const B = S.bands, O = S.onset, T = S, N = S.N, R = S.R, quiet = N - R, pc = (a, b) => (b ? Math.round((100 * a) / b) : 0), t = S.t;
  const base = (re) => (E.baselines || []).find((b) => re.test(b.name)) || {}, simple = base(/simple|already/i), season = base(/season/i), growth = base(/growth/i);
  const tier = (name, m, extra = "") => { const on = m.tp + m.fp; return `<tr><td>${name}</td><td class="num">${m.tp} of ${R} (${pc(m.tp, R)}%)</td><td class="num">${m.tp} of ${on} (${pc(m.tp, on)}%)</td><td class="num">${on} of ${N} (${pc(on, N)}%)</td><td class="num">${m.fp} of ${quiet} (${pc(m.fp, quiet)}%)</td><td class="num">${extra}</td></tr>`; };
  const per = (x) => `${x.n}, ${x.dry} with no rise`, bcell = (b) => `${b.rises} of ${b.weeks}`;
  // Alert-line crossings in the public series, and how long the classifier had already been at Warning before each.
  const kw = (y, w) => y + "-" + w, byWeek = Object.fromEntries(EVID.weeks.map((w) => [kw(w.year, w.week), w])), Ser = D.series, pcts = Ser.map(M.pct), al = D.thresholds.orange, at = (k) => byWeek[kw(Ser[k].year, Ser[k].week)];
  const cross = []; Ser.forEach((x, i) => { if (i < 8 || pcts[i] <= al || !pcts.slice(i - 8, i).every((v) => v <= al)) return;
    let nWarn = 0, nAny = 0, run = true, cutW = false, cutA = false; for (let k = i - 1; k >= 0; k--) { const w = at(k); if (!w) { cutA = true; cutW = run; break; } if (w.score < t.watch) break; nAny++; if (run && w.score >= t.warning) nWarn++; else run = false; }
    cross.push({ week: wk(x), p: pcts[i], nWarn: nWarn + (cutW ? " or more" : ""), nAny: nAny + (cutA ? " or more" : "") }); });
  // The reverse: separate Warning periods in the same years, and how many had a week above the alert line during them or within eight weeks after.
  let runs = 0, hits = 0, recent = 0; for (let i = 0; i < Ser.length; i++) { const w = at(i); if (!w || w.score < t.warning || (i && at(i - 1) && at(i - 1).score >= t.warning)) continue;
    let j = i; while (j + 1 < Ser.length && at(j + 1) && at(j + 1).score >= t.warning) j++;
    if (j + 8 >= Ser.length) { recent++; continue; } // fewer than eight weeks have passed since it ended: too recent to judge
    runs++; if (pcts.slice(i, j + 9).some((v) => v > al)) hits++; }
  const C = E.candidate, nested = E.tiers && E.tiers.watch, worst = [...S.years].filter((y) => y.warning.weeks >= 10).sort((a, b) => a.warning.rises / a.warning.weeks - b.warning.rises / b.warning.weeks)[0];
  $("trustBody").innerHTML = `
  <p class="note">The rapid-rise classifier is the machine-learning part that sets Clear, Watch and Warning. A week counts as "followed by a rapid rise" when, in one of the next four weeks, positives are at least 1.5 times the level four weeks before that week (for example 150 positives when there were 100 four weeks earlier). That includes a rise already under way that holds, which is why the quiet-weeks table below matters. All counts are weeks, not separate outbreaks, over six years: 2019 and 2022 to August 2026. Each week's score comes from a model trained only on earlier years; the counts use the cut-offs now in use (Watch from ${t.watch}, Warning from ${t.warning}).</p>
  <div class="kpis">
    <div class="kpi"><b>${T.watch.tp} of ${R}</b><span>weeks that were followed by a rapid rise were in Watch or Warning (${pc(T.watch.tp, R)}%). Warning alone: ${T.warning.tp} (${pc(T.warning.tp, R)}%).</span></div>
    <div class="kpi"><b>${B.clear.rises} of ${B.clear.weeks}</b><span>Clear weeks were followed by a rapid rise (${pc(B.clear.rises, B.clear.weeks)}%). Clear is the most reliable state, though uneven by year.</span></div>
    <div class="kpi"><b>${O.watch.tp} of ${O.onsets}</b><span>quiet weeks that were followed by a rapid rise were already in Watch or Warning; ${O.warning.tp} were in Warning.</span></div>
    <div class="kpi"><b>${pc(T.watch.tp + T.watch.fp, N)}% of weeks</b><span>are Watch or higher, so it is a risk band, not an alarm. Warning alone is on in ${pc(T.warning.tp + T.warning.fp, N)}% of weeks.</span></div>
  </div>
  <h3>Six years of weekly positives, and what the classifier said each week <span class="chip real">Real data</span></h3>
  <div class="chartbox evchart"><canvas id="evChart"></canvas></div>
  <p class="note">Line: weekly influenza positives, Malaysia; red where a rapid rise was under way. Strip along the bottom: the band that week (grey Clear, yellow Watch, orange Warning). A coloured strip ahead of a red stretch is a warning that came first; colour with no red after it is a false warning, and those are left in. 2020 and 2021 have no usable weekly counts.</p>
  <div class="grid2">
    <div>
      <h3>How often each band was followed by a rapid rise</h3>
      <table><tr><th>Band</th><th class="num">Weeks</th><th class="num">A rapid rise followed</th></tr>
      ${["clear", "watch", "warning"].map((k) => `<tr><td>${STEP[k].name}</td><td class="num">${B[k].weeks}</td><td class="num">${B[k].rises} (${pc(B[k].rises, B[k].weeks)}%)</td></tr>`).join("")}
      <tr><th>All weeks</th><th class="num">${N}</th><th class="num">${R} (${pc(R, N)}%)</th></tr></table>
    </div>
    <div>
      <h3>Before a rise meets the definition</h3>
      <p class="note">${O.weeks} quiet weeks: no rapid rise in that week or the three before it. A rapid rise followed within four weeks after ${O.onsets} of them. These weeks had not yet met the 1.5-times definition, so this is the closest check of early warning.</p>
      <table><tr><th>Tier</th><th class="num">Of those ${O.onsets} weeks, flagged</th><th class="num">Right when on</th></tr>
      <tr><td>Watch or higher</td><td class="num">${O.watch.tp} of ${O.onsets}</td><td class="num">${O.watch.tp} of ${O.watch.tp + O.watch.fp} (${pc(O.watch.tp, O.watch.tp + O.watch.fp)}%)</td></tr>
      <tr><td>Warning</td><td class="num">${O.warning.tp} of ${O.onsets}</td><td class="num">${O.warning.tp} of ${O.warning.tp + O.warning.fp} (${pc(O.warning.tp, O.warning.tp + O.warning.fp)}%)</td></tr>
      <tr><td>Flagging every quiet week</td><td class="num">${O.onsets} of ${O.onsets}</td><td class="num">${O.onsets} of ${O.weeks} (${pc(O.onsets, O.weeks)}%)</td></tr></table>
    </div>
  </div>
  ${cross.length ? `<h3>Before each time positivity crossed the alert line <span class="chip real">Real data, ${Ser[0].year} onward</span></h3>
  <table><tr><th>Crossed the alert line in</th><th class="num">Positivity that week</th><th class="num">Weeks in a row already at Warning</th><th class="num">Weeks in a row already at Watch or higher</th></tr>
  ${cross.map((x) => `<tr><td>${x.week}</td><td class="num">${f1(x.p)}%</td><td class="num">${x.nWarn}</td><td class="num">${x.nAny}</td></tr>`).join("")}</table>
  <p class="note">The alert line is the costly event: above it the rule calls Outbreak. There were ${cross.length} crossings, so these are ${cross.length} cases, not a rate. "Or more" means the count runs back to the first week the classifier was scored that year. The reverse does not hold: of ${runs} separate Warning periods in the same years, ${hits} had a week above the alert line during the period or within eight weeks after it${recent ? ` (${recent} more ${recent > 1 ? "are" : "is"} too recent to judge)` : ""}. Warning means a rapid rise in counts is likely; most rapid rises stop short of the alert line.</p>` : ""}
  <h3>Against simple alternatives, same weeks</h3>
  <table><tr><th>Method</th><th class="num">Rise weeks flagged</th><th class="num">Right when on</th><th class="num">Switched on</th><th class="num">On in weeks with no rise after</th><th class="num">Separate periods</th></tr>
  ${tier("Watch or higher", T.watch, per(S.per.watch))}${tier("Warning", T.warning, per(S.per.warning))}
  ${simple.tp != null ? tier("Simple rule: a rise is already under way", simple) : ""}
  ${tier("Flagging every week", { tp: R, fp: quiet })}</table>
  <p class="note">Ranking score, which needs no cut-off (0.5 is chance, 1 is perfect): the classifier ${E.skill.auc.toFixed(2)}${growth.auc ? `; three-week growth alone ${growth.auc.toFixed(2)}` : ""}${season.auc ? `; time of year alone ${season.auc.toFixed(2)}` : ""}. The skill is real and modest.</p>
  ${STRESS ? `<h3>Does the classifier survive bad data? <span class="chip real">Measured</span></h3>
  <table><tr><th>Damage applied to the weekly counts</th><th class="num">Weekly bands unchanged</th><th class="num">A Warning still Watch or higher</th><th class="num">A Clear still Clear</th><th class="num">Rise weeks still flagged, of ${STRESS.rise_weeks}</th></tr>
  <tr><td>None (clean data)</td><td class="num">100%</td><td class="num">100%</td><td class="num">100%</td><td class="num">${STRESS.clean.rise_weeks_flagged}</td></tr>
  ${STRESS.tests.map((x) => `<tr><td>${x.test}</td><td class="num">${pc(x.band_unchanged, 1)}% (worst run ${pc(x.band_unchanged_worst, 1)}%)</td><td class="num">${pc(x.warning_still_watch_or_higher, 1)}%</td><td class="num">${pc(x.clear_still_clear, 1)}%</td><td class="num">about ${Math.round(x.rise_weeks_flagged_mean)} (worst run ${x.rise_weeks_flagged_worst})</td></tr>`).join("")}</table>
  <p class="note">The same models were given damaged counts for each test year, ${STRESS.tests[0].runs} times per kind of damage, and their bands compared with the bands on clean counts. Under the heaviest damage about ${100 - pc(Math.min(...STRESS.tests.map((x) => x.band_unchanged)), 1)}% of weekly bands change, in both directions. A Warning dropped all the way to Clear in at most ${100 - pc(Math.min(...STRESS.tests.map((x) => x.warning_still_watch_or_higher)), 1)}% of cases, and on average ${Math.round(Math.min(...STRESS.tests.map((x) => x.rise_weeks_flagged_mean)))} to ${Math.round(Math.max(...STRESS.tests.map((x) => x.rise_weeks_flagged_mean)))} of the ${STRESS.rise_weeks} weeks followed by a rise stayed flagged (worst run ${Math.min(...STRESS.tests.map((x) => x.rise_weeks_flagged_worst))}). The classifier is less steady than the alert rule, whose own stress test is under Every result, pass or fail.</p>` : ""}
  <h3>Year by year</h3>
  <table><tr><th>Year tested</th><th class="num">Weeks</th><th class="num">Followed by a rapid rise</th><th class="num">Clear: rise followed</th><th class="num">Watch: rise followed</th><th class="num">Warning: rise followed</th><th class="num">Typical weekly positives</th></tr>
  ${S.years.map((y) => `<tr><td>${y.year}</td><td class="num">${y.weeks}</td><td class="num">${y.rises}</td><td class="num">${bcell(y.clear)}</td><td class="num">${bcell(y.watch)}</td><td class="num">${bcell(y.warning)}</td><td class="num">${y.typical}</td></tr>`).join("")}</table>
  <p class="note">The years are uneven.${(() => { const cy = S.years.filter((y) => y.clear.weeks >= 5), bad = [...cy].sort((a, b) => b.clear.rises / b.clear.weeks - a.clear.rises / a.clear.weeks).slice(0, 2), big = [...S.years].sort((a, b) => b.clear.weeks - a.clear.weeks).slice(0, 2);
    return bad.length === 2 ? ` Clear was uneven too: ${bad.map((y) => `${y.clear.rises} of ${y.clear.weeks} Clear weeks in ${y.year}`).join(" and ")} were followed by a rise, and ${big[0].clear.weeks + big[1].clear.weeks} of the ${B.clear.weeks} Clear weeks come from ${Math.min(big[0].year, big[1].year)} and ${Math.max(big[0].year, big[1].year)}.` : ""; })()}${worst ? ` The weakest is ${worst.year}, when a rapid rise followed only ${worst.warning.rises} of ${worst.warning.weeks} Warning weeks.` : ""} In 2019 the lab counts were small (about ${S.years[0].typical} positives a week), where a 1.5-times change is often noise.</p>
  <h3>What this does not show</h3>
  <ul class="why">
    <li>This is a description of past years, not a test fixed in advance. The six-year run was made after earlier results were known, and the Watch cut-off of ${t.watch} was chosen with these years in view: it is the highest cut-off, in steps of 0.05, that still flagged at least 90% of the weeks followed by a rise. ${nested ? `Picking the Watch cut-off each year from earlier years only gave ${nested.tp} of ${R} flagged with ${nested.fp} false-warning weeks, and that figure moves by several points with how the pick is made.` : ""} The cut-offs are frozen from ${t.frozen || "11 October 2026"}; only the Track record below is a test on unseen weeks.</li>
    <li>The score is not a probability, so the page shows bands with counts, not a percentage.</li>
    ${E.scale_test ? `<li>It does not transfer to a smaller lab network: with the counts divided by ten, ${E.scale_test.changed_at_a_tenth} of ${E.scale_test.weeks} calls changed. It is switched off for an uploaded own series.</li>` : ""}
    <li>It reads one national series. It says nothing about which state or district.</li>
    <li>Much of what it catches is a rise in its first weeks, not a rise from nothing. On quiet weeks a Warning was right ${O.warning.tp} times in ${O.warning.tp + O.warning.fp}, against ${O.onsets} in ${O.weeks} for flagging every quiet week.</li>
    <li>On public data the "next four weeks" are the four weeks after the newest published week, which have already happened. It fills the reporting gap; it looks ahead only when given current data.</li>
    ${C ? `<li>A version without the time-of-year inputs looks better on these six years (ranking score ${C.auc.toFixed(2)}; at 0.5, right ${C.warning.tp} of ${C.warning.tp + C.warning.fp} times). We have not switched to it, because choosing a model after seeing its test results is how results get inflated. It is scored beside the live model in the Track record, and future weeks will decide.</li>` : ""}
  </ul>
  <p class="note"><b>Second disease: the forecast worked, the classifier did not.</b> ${DENGUE && (DENGUE.forecast_measured || DENGUE.forecast) ? `On weekly dengue counts the best model beat "same as last week" by ${(DENGUE.forecast_measured || DENGUE.forecast).map((f) => Math.round((1 - f.mae[f.best] / f.mae.last_value) * 100) + "%").join(", ")} at one to four weeks ahead (${[...new Set((DENGUE.forecast_measured || DENGUE.forecast).map((f) => f.n_test))].sort().join(" to ")} measured weeks; the best of two models is taken at each horizon). ` : ""}${(() => { const o = DENGUE && (DENGUE.outbreak || []).find((x) => x.definition === "rising"), g = o && o.models.gradient_boosted; return g ? `The same kind of rapid-rise classifier flagged only ${g.tp} of ${g.tp + g.fn} dengue rise weeks, so dengue supports the forecasting method, not the classifier. ` : ""; })()}For influenza it is the other way round: forecasting the exact level did not beat that simple guess, so it is not shown as a forecast; the alert rule still reads that projection in three places, and it never decided a high alert in testing. Both are under <a href="#proof">Every result, pass or fail</a> and <a href="#dengue">Second disease: dengue</a>.</p>`;
  // leave a visible break wherever the weeks are not consecutive (2020 and 2021 are missing)
  const W = []; EVID.weeks.forEach((w, i) => { if (i && new Date(w.start) - new Date(EVID.weeks[i - 1].start) > 30 * 864e5) for (let k = 0; k < 6; k++) W.push(null); W.push(w); });
  const COL = { clear: "#c3ccd5", watch: "#e2b100", warning: "#d9660b" }, bandOf = (w) => (w.score >= S.t.warning ? "warning" : w.score >= S.t.watch ? "watch" : "clear");
  if (evChart) evChart.destroy();
  evChart = new Chart($("evChart"), { type: "line", data: { labels: W.map((w) => (w ? w.start : "")), datasets: [
    { label: "Weekly positives", data: W.map((w) => (w ? w.positives : null)), borderColor: "#16202a", borderWidth: 1.5, pointRadius: 0, spanGaps: false, segment: { borderColor: (x) => (W[x.p1DataIndex] && W[x.p1DataIndex].rise_now ? "#c0282d" : "#16202a"), borderWidth: (x) => (W[x.p1DataIndex] && W[x.p1DataIndex].rise_now ? 2.5 : 1.5) } },
    { label: "Classifier band that week", data: W.map((w) => (w ? 0 : null)), showLine: false, pointStyle: "rect", pointRadius: 3.5, pointHoverRadius: 5, pointBackgroundColor: W.map((w) => (w ? COL[bandOf(w)] : "transparent")), pointBorderColor: W.map((w) => (w ? COL[bandOf(w)] : "transparent")), clip: false } ] },
    options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (t) => { const w = W[t.dataIndex]; return w ? (t.datasetIndex ? `Band: ${STEP[bandOf(w)].name}${w.rise_follows ? "; a rapid rise followed within four weeks" : "; no rapid rise followed"}` : `${w.positives} positives${w.rise_now ? " (rapid rise under way)" : ""}`) : ""; } } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "Weekly influenza positives" } }, x: { ticks: { maxTicksLimit: 12, callback: function (v) { const l = this.getLabelForValue(v); return l ? l.slice(0, 7) : ""; } } } } } });
}

// ---------- track record: what the system said before the figures were published ----------
function renderTrack() {
  const P = D.prospective || [], short = (h) => (h ? String(h).slice(0, 10) : ""), cap = (b) => (STEP[b] ? STEP[b].name : b || "");
  const due = (r) => { const d = new Date(r.made_on); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10); };
  const said = (r) => [r.rapid_rise_band ? `Band: <b>${cap(r.rapid_rise_band)}</b> (score ${(+r.rapid_rise_probability).toFixed(2)})` : `Rapid-rise score ${(+r.rapid_rise_probability).toFixed(2)}, before the bands were frozen`, r.claim_band || r.claim_rise || "", r.claim_alert || ""].filter(Boolean).join("<br>");
  const cand = (r) => (r.candidate ? `${cap(r.candidate.band)} (score ${(+r.candidate.probability).toFixed(2)})` : "not recorded");
  const res = (r) => (r.status === "scored" ? `Alert ${r.alert_correct ? "right" : "wrong"}; rise call ${r.rise_call_correct ? "right" : "wrong"}` : `Awaiting data, due about ${due(r)}`);
  const prints = (r) => (r.data_sha256 ? `commit <code>${esc(short(r.git_commit))}</code>${r.git_dirty ? " plus uncommitted changes" : ""}<br>data <code>${short(r.data_sha256)}</code><br>model <code>${short(r.classifier_sha256)}</code>` : "made before fingerprints and bands were added");
  const pol = (P.find((r) => r.policy) || {}).policy || "No claim is made from a single scored record.";
  $("trackBody").innerHTML = `
  <p class="note">Public data runs about four weeks behind, so the weeks a record speaks about have already happened but cannot be seen yet. Each record is saved and committed on the day it is made, with fingerprints of the data file and the model, and will be marked right or wrong when those weeks are published. A person runs this each week. So far there is one claim, written down on two days, and nothing has been scored. The repository is private, so an outsider cannot yet check the commit times. When it has run for a while, this will be the only test here on weeks nobody had seen.</p>
  <table><tr><th>Made on</th><th>Newest data then</th><th>What the system said</th><th>Candidate model, in shadow</th><th>Fingerprints</th><th>Result</th></tr>
  ${P.map((r) => `<tr><td>${r.made_on}</td><td>${r.newest_published_week} (${r.newest_positivity_percent}%)</td><td>${said(r)}</td><td>${cand(r)}</td><td>${prints(r)}</td><td>${res(r)}</td></tr>`).join("") || '<tr><td colspan="6">No records yet.</td></tr>'}</table>
  <p class="note">${pol} ${P.length > 1 ? "Records made on different days about the same unpublished weeks count once. " : ""}Each week: <code>py archive.py score &lt;new FluNet file&gt;</code>, then <code>py archive.py record &lt;new FluNet file&gt;</code>, then commit and push. ${P.filter((r) => r.status === "scored").length} of ${P.length} records scored so far. One quiet period cannot separate the classifier from a simple rule; that needs records across a rise.</p>`;
}

function renderProof() {
  const v = D.validation, a4 = v.alerts.find((x) => x.lag === 4), a0 = v.alerts.find((x) => x.lag === 0), s4 = a4.surges[0], s0 = a0.surges[0];
  const passed = v.per_horizon.filter((h) => h.passed).length, R = D.rise.test, G = R.models.gradient_boosted, S = R.models.already_in_outbreak_now;
  const cmRow = (name, m) => `<tr><td>${name}</td><td class="num">${m.tp}</td><td class="num">${m.fp}</td><td class="num">${m.tn}</td><td class="num">${m.fn}</td><td class="num">${Math.round(m.recall * 100)}%</td><td class="num">${Math.round(m.precision * 100)}%</td></tr>`;
  const cmHead = `<tr><th>Method</th><th class="num">TP</th><th class="num">FP</th><th class="num">TN</th><th class="num">FN</th><th class="num">Recall</th><th class="num">Precision</th></tr>`;
  const w0 = v.week_level.find((x) => x.lag === 0), w4 = v.week_level.find((x) => x.lag !== 0), W = D.rise.walk;
  $("proofBody").innerHTML = `
  <p class="note">The alert rule and the level forecast were tested on ${v.per_horizon[0].n} unseen weeks (${v.test_start} to ${v.test_end}), with models learned from 2022 to ${v.train_end} and settings frozen with git tags before scoring. The classifier also learns from 2017 to 2019 and has its own tests, described in sections 1 and 1b; its year-by-year test was run after the first results were known.</p>
  <div class="kpis">
    <div class="kpi"><b>${Math.round((W ? W.pooled.gradient_boosted : G).recall * 100)}% recall, ${Math.round((W ? W.pooled.gradient_boosted : G).precision * 100)}% precision</b><span>Rapid-rise classifier${W ? ", tested year by year" : ""}, against ${Math.round((W ? W.pooled.already_in_outbreak_now : S).recall * 100)}% and ${Math.round((W ? W.pooled.already_in_outbreak_now : S).precision * 100)}% for the simple rule.</span></div>
    <div class="kpi"><b>${s0.lead_weeks === 0 ? "Same week" : s0.lead_weeks + " weeks ahead"}</b><span>With current data, the alert fired in the week the October 2025 surge crossed the alert line.</span></div>
    <div class="kpi"><b>${-s4.lead_weeks}-week delay removed</b><span>With public data alone the same alert fired ${-s4.lead_weeks} weeks later, because public data runs ${D.pub_lag} weeks behind.</span></div>
    <div class="kpi"><b class="${passed ? "pass" : "nb"}">${passed} of 8 better</b><span>Forecasts of the exact level: none beat "same as last week", so none is shown as a forecast. The alert rule still reads one projection in three places.</span></div>
  </div>

  <h3>What is learned, what is a rule, what is assumed</h3>
  <table><tr><th>Learned from data</th><th>Fixed rules we wrote</th><th>Assumed, for illustration</th></tr>
  <tr><td>Rapid-rise classifier (gradient-boosted).<br>Forecast of the level (tested, did not beat the baseline).</td><td>Alert level and its two lines (statistics of training weeks).<br>Wave type, phase, data warning.<br>Proposed action for each level.</td><td>Hospital demand and the share of beds usable for flu.<br>Drill (what-if) factor effects.<br>Population and school shading on the map.</td></tr></table>

  <h3>1. The predictive model: rapid-rise classifier <span class="chip real">Measured</span></h3>
  <p class="note">Question it answers: will weekly positives be at least 50% higher than four weeks earlier, at any point in the next four weeks? A gradient-boosted classifier (150 one-split trees) on recent level, recent changes and time of year. ${R.test_outbreak_weeks} of ${R.n_test} unseen weeks were followed by such a rise.</p>
  <table>${cmHead}${cmRow("Simple rule: already rising now", S)}${cmRow("Logistic regression", R.models.logistic_regression)}${cmRow("Gradient-boosted classifier (used on this site)", G)}</table>
  <p class="note"><b>The other definition we fixed in advance went against the classifier.</b> Under "above the usual level for that week" it flagged 5 of 11 such weeks on these test weeks against 7 of 11 for the simple rule, and 0 of 29 against 20 of 29 on the longer split that includes 2017 to 2019. We use the rapid-rise definition, where it did better, and say so here.</p>
  <p class="note"><b>Read this with care.</b> The event is common (over half of these weeks), the result is retrospective, and these same weeks had already been scored for other models (list below). We call it a lead signal, not proven early warning.</p>

  ${W ? `<h3>1b. The same classifier, tested year by year <span class="chip real">Measured, run afterwards</span></h3>
  <p class="note">A second check, added after the result above was known and with no setting changed: each year is tested by a classifier trained only on earlier years (${W.n_test} weeks in all, ${W.rises} followed by a rapid rise).</p>
  <table>${cmHead}${cmRow("Simple rule: already rising now", W.pooled.already_in_outbreak_now)}${cmRow("Logistic regression", W.pooled.logistic_regression)}${cmRow("Gradient-boosted classifier", W.pooled.gradient_boosted)}</table>
  <table><tr><th>Year tested</th><th class="num">Weeks</th><th class="num">Rises</th><th class="num">Caught</th><th class="num">False alarms</th><th class="num">Simple rule caught</th><th class="num">Simple rule false alarms</th></tr>
  ${W.folds.map((f) => `<tr><td>${f.year}</td><td class="num">${f.n_test}</td><td class="num">${f.rises}</td><td class="num">${f.models.gradient_boosted.tp}</td><td class="num">${f.models.gradient_boosted.fp}</td><td class="num">${f.models.already_in_outbreak_now.tp}</td><td class="num">${f.models.already_in_outbreak_now.fp}</td></tr>`).join("")}</table>
  <p class="note">Across all years the classifier catches about twice as many rises as the simple rule, but with more false alarms: its precision here is ${Math.round(W.pooled.gradient_boosted.precision * 100)}%, lower than the ${Math.round(G.precision * 100)}% in the single split above. The year-by-year figure is the more cautious one to quote.</p>` : ""}

  <h3>2. The alert rule: current data against public data <span class="chip real">Measured</span></h3>
  <p class="note">Each unseen week: was the alert high (Orange or Red), and was positivity really above the alert line? One surge occurred (October 2025), so these are counts from a single event, not rates.</p>
  <table>${cmHead}${cmRow("With current data (what an upload provides)", w0)}${cmRow(`With public data only (${D.pub_lag} weeks old)`, w4)}</table>
  <p class="note">With current data the alert mostly reports that this week's figure is already above the line, so a perfect score here shows the rule works as designed, not that it predicts ahead. The rule also uses the level projection in three places (an early Yellow, an early Orange, and Red against Orange); that projection never decided a high alert in this test. The finding is the gap between the two rows: the same rule on ${D.pub_lag}-week-old data misses the first four surge weeks and stays on four weeks too long. ${a0.false_alarm_episodes} false-alarm episodes in ${a0.weeks_scored} weeks.</p>

  <h3>3. Forecasting the exact level: no better than a simple guess, so we do not use it <span class="chip real">Measured</span></h3>
  <table><tr><th>Weeks ahead</th><th class="num">Model error</th><th class="num">Last-value error</th><th class="num">Same-week-average error</th><th class="num">80% range covered</th><th>Result</th></tr>
  ${v.per_horizon.map((h) => `<tr><td>${h.h}</td><td class="num">${f1(h.mae_model)}</td><td class="num">${f1(h.mae_persist)}</td><td class="num">${f1(h.mae_seasonal)}</td><td class="num">${Math.round(h.coverage80 * 100)}%</td><td class="${h.passed ? "pass" : "nb"}">${h.passed ? "Better" : "Not better"}</td></tr>`).join("")}</table>
  <p class="note">Ridge regression, errors in percentage points of positivity. It beat the same-week average everywhere, lost to "last value carried forward" at 1 to 4 weeks, only matched it beyond that, and its ranges were too narrow. A gradient-boosted forecast and forecasts of weekly counts (with and without 2017 to 2019 data) did no better. The chart therefore shows the simple baseline as the main forecast.</p>

  <p class="note"><b>How our alert lines compare with published practice.</b> The World Health Organization's guidance for assessing influenza severity describes setting thresholds from past seasons, for example with the moving epidemic method, and the Ministry of Health's epidemiology bulletin plots its own baseline, alert and action lines. Ours are a simpler rule in the same spirit: the middle value of the training weeks plus one and two units of their usual spread. They are not the Ministry's lines and not that method.</p>

  <h3>4. Stress test: does the alert survive bad data? <span class="chip real">Measured</span></h3>
  <table><tr><th>Damage applied to the data</th><th class="num">Weekly decisions unchanged (74 weeks, 5 of them high alert)</th><th class="num">Worst of ${v.stress[0].runs} runs</th></tr>
  ${v.stress.map((s) => `<tr><td>${s.test}</td><td class="num">${f1(s.high_alert_agreement * 100)}%</td><td class="num">${f1(s.worst_run * 100)}%</td></tr>`).join("")}</table>

  <p class="note">Most of these weeks are quiet, so never alerting at all would score 93%. This test covers the alert rule only; the classifier's own stress test is under Why trust it.</p>

  <h3>5. How many times were the unseen weeks scored?</h3>
  <ul class="why"><li>Ridge forecast: once (tag <code>freeze-v1</code>).</li><li>Gradient-boosted forecast: once (<code>freeze-v2</code>).</li><li>Count forecasts and the outbreak classifiers: three runs defined in advance (<code>freeze-flucases-v1</code>).</li>
  <li>The alert tables above and this note were computed afterwards from the frozen rule: with current data the level first left Green in ${v.descriptive_after_scoring.first_non_green_week_before_2025_surge}, ${v.descriptive_after_scoring.weeks_before_orange_crossing} weeks before the alert line was crossed.</li></ul>
  <p class="note">Repeated scoring weakens every later result. The fix is a record made in advance: the Track record.</p>

  <h3>6. Record made in advance</h3>
  <p class="note">Moved to its own section: see <a href="#track">Track record</a>.</p>

  <h3>What this cannot tell you</h3>
  <ul class="why"><li>District-level influenza activity. No public data exists for it.</li><li>Whether the thresholds fit your own data. They were learned from the national sentinel series; an uploaded series from another lab network is uncalibrated.</li><li>Today's free beds, unless a planner uploads them. The capacity table uses beds in operation and each hospital's average occupancy for 2024.</li><li>Which state or district. The classifier and the alert rule both read the national series.</li><li>Case counts. Positivity is a share of tested samples.</li><li>Whether uploaded figures are correct. They are marked unverified.</li></ul>`;
}

// ---------- trend chart: one switchable line per state, plus a national layer ----------
function stMeasureOptions() {
  $("stMeasure").innerHTML = ST.disease === "flu" ? Object.entries(FLU_MEASURE).map(([k, m]) => `<option value="${k}">${m[3]}</option>`).join("")
    : '<option value="rate">Cases per 100,000 people</option><option value="cases">Total cases</option>';
  ST.measure = $("stMeasure").value;
}
const ST_COL = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf", "#393b79", "#ad494a", "#637939", "#7b4173", "#3182bd", "#e6550d"];
let stChart;
// What the chart draws for the chosen disease and view: labels, one series per state, the national layer and the axis titles.
function stSeries() {
  const S = STATES;
  if (ST.disease === "flu") { const N = S.flu.clusters_national || {}, wks = [39, 40, 41, 42, 43, 44, 45];
    return { kind: "flu", labels: wks.map((w) => `Week ${w}, 2025`), states: Object.fromEntries(Object.entries(S.flu.states).map(([nm, r]) => [nm, wks.map((w) => r["w" + w] ?? null)])),
      national: wks.map((w) => N["w" + w] ?? null), natLabel: "Malaysia (all clusters reported that week)", yTitle: "Influenza clusters reported that week", dots: 3,
      note: `Source: ${S.flu.source}. ${S.flu.note} Weeks 41 and 42 are blank: no state breakdown was found for them.` }; }
  const src = S.dengue[ST.view], per = { weekly: "week", monthly: "month", yearly: "year" }[ST.view];
  let labels = src.labels.map(String), states = src.states, national = src.national;
  if (ST.view === "weekly") { // leave a visible break where the weekly files stop in 2015 and start again in 2019
    const at = labels.findIndex((d, i) => i && new Date(d) - new Date(labels[i - 1]) > 30 * 864e5), gap = Array(14).fill(null), ins = (a) => (at < 0 ? a : a.slice(0, at).concat(gap, a.slice(at)));
    states = Object.fromEntries(Object.entries(states).map(([k, a]) => [k, ins(a)])); national = ins(national);
    if (at >= 0) labels = labels.slice(0, at).concat(gap.map((_, i) => (i === 7 ? "no weekly data" : "")), labels.slice(at)); }
  return { kind: ST.view, labels, states, national, natLabel: src.national_label, yTitle: `Reported dengue cases per ${per}`, dots: ST.view === "yearly" ? 3 : 0,
    note: `Source: ${S.dengue.source}. ${src.note}` };
}
function renderStates() {
  const S = STATES; if (!S) { $("trendBox").hidden = true; return; }
  const flu = ST.disease === "flu", G = stSeries(), monthly = G.kind === "monthly", names = Object.keys(G.states);
  names.forEach((n) => { if (!(n in ST.on)) ST.on[n] = true; });
  $("stViewRow").hidden = flu; $("stNote").textContent = G.note;
  $("stToggles").innerHTML = names.map((n, i) => `<label class="tog"><input type="checkbox" data-st="${n}" ${ST.on[n] ? "checked" : ""}><span class="sw"></span><i class="dot" style="background:${ST_COL[i % ST_COL.length]}"></i><span>${n}</span></label>`).join("") +
    `<label class="tog"><input type="checkbox" data-st="__nat" ${ST.national ? "checked" : ""}><span class="sw"></span><i class="dot" style="background:#111"></i><span><b>${G.natLabel}</b></span></label>` +
    `<button type="button" data-all="1">All states on</button><button type="button" data-all="0">All states off</button>`;
  const models = monthly ? Object.fromEntries(S.dengue.models.map((m) => [m.state, m])) : {};
  const extra = monthly ? ["2011-01", "2011-02", "2011-03"] : [];
  const labels = G.labels.concat(extra), n = G.labels.length, pad = (a) => a.concat(extra.map(() => null));
  const ds = [];
  names.forEach((nm, i) => { if (!ST.on[nm]) return; const col = ST_COL[i % ST_COL.length];
    ds.push({ label: nm, data: pad(G.states[nm]), borderColor: col, backgroundColor: col, borderWidth: 1.5, pointRadius: G.dots, yAxisID: "y", spanGaps: false });
    if (models[nm]) ds.push({ label: "", data: Array(n - 1).fill(null).concat([G.states[nm][n - 1]], models[nm].projection), borderColor: col, borderDash: [4, 3], borderWidth: 1.5, pointRadius: 2, yAxisID: "y" }); });
  if (ST.national) { ds.push({ label: G.natLabel, data: pad(G.national), borderColor: "#111", backgroundColor: "#111", borderWidth: 2.5, pointRadius: G.dots, yAxisID: "y", spanGaps: false });
    const all = models["All ten states together"]; if (all) ds.push({ label: "", data: Array(n - 1).fill(null).concat([G.national[n - 1]], all.projection), borderColor: "#111", borderDash: [4, 3], borderWidth: 2, pointRadius: 2, yAxisID: "y" }); }
  if (stChart) stChart.destroy();
  const scales = { x: { ticks: { maxTicksLimit: 14 } }, y: { beginAtZero: true, title: { display: true, text: G.yTitle } } }; // states and the national line share one axis
  stChart = new Chart($("stChart"), { type: "line", data: { labels, datasets: ds }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { filter: (t) => t.dataset.label !== "" } }, scales } });

  if (flu) { const N = S.flu.clusters_national || {}, tot = Object.values(S.flu.states).reduce((a, r) => a + (r.cumulative_w45 || 0), 0);
    $("stBody").innerHTML = `<h3>Influenza clusters by state, 2025 surge <span class="chip real">Real data</span></h3>
    <p class="note">From Ministry of Health statements of 9 October, 7 November and 14 November 2025. Weeks 43 to 45 list every state, and the state counts add up to the national totals the Ministry gave (${N.w43}, ${N.w44} and ${N.w45}). For week 40 the statement named only the five highest states for each measure, so a blank there means "not among the five named", not zero. The running total is as the Ministry stated it; we could not confirm which week it counts from.</p>
    <table><tr><th>State</th><th class="num">Week 40</th><th class="num">Week 43</th><th class="num">Week 44</th><th class="num">Week 45</th><th class="num">Running total to week 45</th><th class="num">ILI consultation rate, week 40</th></tr>
    ${Object.entries(S.flu.states).map(([nm, r]) => `<tr><td>${nm}</td>${["w40", "w43", "w44", "w45", "cumulative_w45"].map((k) => `<td class="num">${r[k] ?? ""}</td>`).join("")}<td class="num">${r.ili_w40 == null ? "" : r.ili_w40 + "%"}</td></tr>`).join("")}
    <tr><th>Malaysia</th>${["w40", "w43", "w44", "w45"].map((k) => `<th class="num">${N[k] ?? ""}</th>`).join("")}<th class="num">${tot}</th><th></th></tr></table>
    <p class="note">A handful of scattered weeks cannot train or test a state model for influenza. The national model and its results are under Why trust it.</p>`; return; }
  if (G.kind === "yearly") { $("stBody").innerHTML = `<p class="note">Yearly figures are too few to model (${G.labels.length} points per state). Switch to the weekly or monthly view for the state models.</p>`; return; }
  const gain = (r, unit) => (r.best === "last_value" ? `<td class="fail">No model beat last ${unit}</td>` : `<td class="pass">${r.best.replace(/_/g, " ")}, ${r.gain_vs_last_value_pct}% lower error</td>`);
  const none = (list) => { const z = list.filter((m) => m.results.every((r) => r.best === "last_value")).map((m) => m.state); return z.length ? ` No model beat it at any horizon in ${z.join(", ")}.` : ""; };
  if (G.kind === "weekly") { const W = S.dengue.weekly_models, done = W.filter((m) => m.results), wins = (k) => done.filter((m) => m.results[k].best !== "last_value").length;
    $("stBody").innerHTML = `<h3>The same weekly models, state by state <span class="chip real">Measured</span></h3>
    <p class="note">For each state the earliest 70% of weeks train the four methods used for the national dengue model and the latest 30% test them, split by date, with the same fixed settings; nothing was tuned per state. Each cell names the method with the lowest average error and how far it beat "same as last week".</p>
    <table><tr><th>State</th><th class="num">Weeks</th><th>Test period</th><th>1 week ahead</th><th>2 weeks ahead</th><th>3 weeks ahead</th><th>4 weeks ahead</th></tr>
    ${W.map((m) => (m.results ? `<tr><td>${m.state}</td><td class="num">${m.weeks}</td><td>${m.test_start} to ${m.test_end}</td>${m.results.map((r) => gain(r, "week")).join("")}</tr>` : `<tr><td>${m.state}</td><td class="num">${m.weeks}</td><td colspan="5">Not modelled: ${m.skipped}</td></tr>`)).join("")}</table>
    <p class="note">A model beat "same as last week" in ${wins(0)} of ${done.length} states one week ahead, ${wins(1)} two weeks ahead, ${wins(2)} three weeks ahead and ${wins(3)} four weeks ahead.${none(done)} Several of the gains are only a few percent. These runs were made after the files were found, so they are extra evidence, not results fixed in advance, and the weekly files themselves carry no stated source or licence.</p>`; return; }
  const Mo = S.dengue.models, st = Mo.filter((m) => m.state !== "All ten states together"), wins = (k) => st.filter((m) => m.results[k].best !== "last_value").length;
  const skipped = Object.keys(S.dengue.monthly.states).filter((nm) => !st.some((m) => m.state === nm));
  $("stBody").innerHTML = `<h3>The same model comparison, state by state <span class="chip real">Measured</span></h3>
    <p class="note">For each state: the earliest 70% of months train the models, the latest 30% test them. Each cell names the method with the lowest error and how much it beat "same as last month". Settings are the ones used for the weekly models; nothing was tuned per state. Dashed lines on the chart project three months past the data (early 2011) and cannot be checked.</p>
    <table><tr><th>State</th><th>Months</th><th>Test period</th><th>1 month ahead</th><th>2 months ahead</th><th>3 months ahead</th></tr>
    ${Mo.map((m) => `<tr><td>${m.state}</td><td>${m.months}</td><td>${m.test_start} to ${m.test_end}</td>${m.results.map((r) => gain(r, "month")).join("")}</tr>`).join("")}</table>
    <p class="note">A model beat "same as last month" in ${wins(0)} of ${st.length} states one month ahead, ${wins(1)} two months ahead and ${wins(2)} three months ahead.${none(st)}${skipped.length ? ` ${skipped.join(", ")} have gaps in their monthly series and were not modelled.` : ""} This data ends in 2010, so it shows the method working on other states, not anything about dengue today.</p>`;
}
function setupAtlas() {
  const stop = () => { clearInterval(ST.playing); ST.playing = null; $("stPlay").textContent = "Play years"; };
  $("stYear").oninput = (e) => { ST.year = +e.target.value; drawStates(); };
  $("stMeasure").onchange = (e) => { ST.measure = e.target.value; drawStates(); };
  $("stPlay").onclick = () => { if (ST.playing) return stop(); const n = STATES.dengue.yearly.labels.length; if (ST.year >= n - 1) ST.year = -1;
    $("stPlay").textContent = "Pause"; ST.playing = setInterval(() => { ST.year++; drawStates(); if (ST.year >= n - 1) stop(); }, 600); };
  $("stDisease").onchange = (e) => { ST.disease = e.target.value; ST.on = {}; stop(); stMeasureOptions(); renderStates(); renderMap(context()); };
  $("viewAll").onclick = viewAll; $("viewSel").onclick = () => zoomTo(boundsOf(GEO));
  $("stView").onchange = (e) => { ST.view = e.target.value; ST.on = {}; renderStates(); };
  $("stToggles").onchange = (e) => { const k = e.target.dataset.st; if (!k) return; if (k === "__nat") ST.national = e.target.checked; else ST.on[k] = e.target.checked; renderStates(); };
  $("stToggles").onclick = (e) => { const b = e.target.closest("button[data-all]"); if (!b) return; for (const k in ST.on) ST.on[k] = b.dataset.all === "1"; renderStates(); };
  if (!STATES || !STGEO) { $("stCtl").hidden = true; $("ly_state").closest("label").hidden = true; $("viewAll").hidden = true; }
}

function renderDengue() {
  const d = DENGUE; if (!d) { $("dengue").hidden = true; return; }
  const n = d.series.length, k = d.split_index, ex = d.extrapolation, st = d.status || [], comp = d.composition;
  const labels = d.series.map((r) => r[0]).concat(ex.map((e) => e.start));
  const vals = d.series.map((r) => r[1]), est = (i) => st[i] === "estimated";
  $("dengueNote").innerHTML = `Weekly reported dengue cases, Malaysia, ${d.series[0][0]} to ${d.series[n - 1][0]} (${n} weeks). Source: ${d.source}.` +
    (comp ? ` No dataset exists for 2023 onward, so those ${comp.reported + comp.derived + comp.estimated} weeks were rebuilt from the sentences in WHO's fortnightly reports: <b>${comp.reported}</b> weeks are stated in a report, <b>${comp.derived}</b> follow exactly from the running totals, and <b>${comp.estimated}</b> are estimated, because WHO published only a combined total for several weeks, which we spread across them. Missing: ${d.missing_weeks}. Nothing was read from charts.` : "");
  if (dengueChartObj) dengueChartObj.destroy();
  dengueChartObj = new Chart($("dengueChart"), { type: "line", data: { labels, datasets: [
    { label: "Training weeks (earliest 70%)", data: vals.map((v, i) => (i < k ? v : null)), borderColor: "#16202a", pointRadius: 0, borderWidth: 1.5 },
    { label: "Test weeks (latest 30%)", data: vals.map((v, i) => (i >= k - 1 ? v : null)), borderColor: "#2a5aa8", pointRadius: 0, borderWidth: 1.5 },
    { label: "Estimated weeks (a published total spread over several weeks)", data: vals.map((v, i) => (est(i) ? v : null)), borderColor: "#e07a00", backgroundColor: "#e07a00", showLine: false, pointRadius: 2.5 },
    { label: "Extrapolation, 1 to 4 weeks past the data", data: Array(n - 1).fill(null).concat([vals[n - 1]], ex.map((e) => e.cases)), borderColor: "#c0282d", borderDash: [5, 3], pointRadius: 2, borderWidth: 2 } ] },
    options: { maintainAspectRatio: false, animation: false, scales: { y: { beginAtZero: true, title: { display: true, text: "Reported cases per week" } }, x: { ticks: { maxTicksLimit: 13 } } } } });
  const pct = (a, b) => Math.round((1 - a / b) * 100);
  const cm = (m) => (m ? `<td class="num">${m.tp}</td><td class="num">${m.fp}</td><td class="num">${m.tn}</td><td class="num">${m.fn}</td><td class="num">${m.recall == null ? "n/a" : Math.round(m.recall * 100) + "%"}</td><td class="num">${m.precision == null ? "n/a" : Math.round(m.precision * 100) + "%"}</td>` : "");
  const NAMES = { already_in_outbreak_now: "Simple rule: already in outbreak now", logistic_regression: "Logistic regression", gradient_boosted: "Gradient-boosted classifier" };
  const table = (F) => `<table><tr><th>Weeks ahead</th><th class="num">Test weeks</th><th class="num">Same as last week</th><th class="num">Same-week average</th><th class="num">Ridge regression</th><th class="num">Gradient-boosted</th><th>Best</th><th class="num">Best vs last week</th></tr>
  ${F.map((f) => `<tr><td>${f.weeks_ahead}</td><td class="num">${f.n_test}</td><td class="num">${f.mae.last_value}</td><td class="num">${f.mae.same_week_average}</td><td class="num">${f.mae.ridge}</td><td class="num">${f.mae.gradient_boosted}</td><td>${f.best.replace(/_/g, " ")}</td><td class="num ${f.best === "last_value" ? "fail" : "pass"}">${f.best === "last_value" ? "no gain" : pct(f.mae[f.best], f.mae.last_value) + "% lower error"}</td></tr>`).join("")}</table>`;
  $("dengueBody").innerHTML = `
  <h3>Forecast accuracy on the unseen 30% <span class="chip real">Measured</span></h3>
  <p class="note">Train to ${d.train_end}, test ${d.test_start} to ${d.test_end}, split by date, same settings as before. Errors are average misses in cases per week.${d.forecast_measured ? " This table scores only test weeks whose real value is known (stated by WHO or exact from its totals). Estimated weeks are left out because they are smooth by construction and would flatter any model." : ""}</p>
  ${table(d.forecast_measured || d.forecast)}
  ${d.forecast_measured ? `<p class="note">For comparison, scored on every test week including the estimated ones:</p>${table(d.forecast)}<p class="note">${d.earlier_result} This extended run was done afterwards and is extra evidence, not a result fixed in advance.</p>` : ""}
  ${(d.notes || []).length ? `<p class="note"><b>Where the reports disagreed:</b> ${d.notes.join(" ")}</p>` : ""}
  <h3>Extrapolation past the end of the data <span class="chip est">Estimated</span></h3>
  <p class="note">${ex.map((e) => `Week of ${e.start}: ${e.cases} cases`).join(" · ")}. These weeks had not been published by WHO when this was built, so they cannot be checked yet.</p>
  <h3>Outbreak within the next four weeks: yes or no <span class="chip real">Measured</span></h3>
  <p class="note">These tables include the estimated weeks, so read them as indicative.</p>
  ${d.outbreak.map((o) => `<p class="note"><b>${o.definition === "usual" ? "Definition A: cases above the usual level for that week (training-year average plus two standard deviations)" : "Definition B: cases at least 50% higher than four weeks earlier"}.</b> ${o.train_outbreak_weeks} of ${o.n_train} training weeks and ${o.test_outbreak_weeks} of ${o.n_test} test weeks were followed by an outbreak. ${o.note || ""}</p>
  <table><tr><th>Method</th><th class="num">TP</th><th class="num">FP</th><th class="num">TN</th><th class="num">FN</th><th class="num">Recall</th><th class="num">Precision</th></tr>${Object.keys(o.models).map((m) => `<tr><td>${NAMES[m]}</td>${cm(o.models[m])}</tr>`).join("")}</table>`).join("")}`;
}

function renderSim(c) {
  const g = simGrowth(), total = SIM.weeks + 6;
  $("simBaseV").textContent = SIM.base + "%"; $("simWeeksV").textContent = SIM.weeks; $("simStrainV").textContent = SIM.strain; $("simVaxV").textContent = SIM.vax + "%";
  $("simWeek").max = total; $("simWeek").value = Math.min(SIM.week, total); $("simWeekV").textContent = SIM.on ? `+${SIM.week}` : "off";
  $("simGrowth").innerHTML = `Weekly growth used: <b>${Math.round(g * 100)}%</b> for ${SIM.weeks} week(s), then easing by 15% a week. = ${SIM.base} base ${SIM.school ? "+" + SIM_EFFECT.schoolIn + " schools in session" : SIM_EFFECT.schoolOut + " school holiday"} +${Math.round(SIM.strain * SIM_EFFECT.strainPerPoint)} new strain ${Math.round(SIM.vax * SIM_EFFECT.vaxPerPoint)} vaccination${SIM.travel ? " +" + SIM_EFFECT.travel + " festive travel" : ""}${SIM.rain ? " +" + SIM_EFFECT.rain + " rainy season" : ""} (percentage points, assumed).`;
  if (!SIM.on) { $("simOut").innerHTML = `<p class="note">Switch the simulation on, then drag "Weeks from now" to play the scenario forward.</p>`; return; }
  const rows = []; let firstYellow = null, firstOrange = null, firstRise = null;
  for (let k = 0; k <= total; k++) { const x = context(k), hi = x.a.level === "orange" || x.a.level === "red";
    if (firstYellow == null && x.a.level !== "green") firstYellow = k; if (firstOrange == null && hi) firstOrange = k; if (firstRise == null && x.rise.band === "warning") firstRise = k;
    rows.push(`<tr class="${k === SIM.week ? "cur" : ""}"><td>${k ? "+" + k : "now"}</td><td class="num">${f1(x.a.pLast)}%</td><td><span class="lv ${x.a.level}">${x.a.level}</span></td><td>${x.rise.off ? "off" : STEP[x.rise.band].name}</td></tr>`); }
  const say = (v) => (v == null ? "never in this scenario" : v === 0 ? "already now" : `week +${v}`);
  $("simOut").innerHTML = `<p><b>In this scenario:</b> ${c.rise.off ? "" : `the classifier first reads Warning at <b>${say(firstRise)}</b>; `}the level first leaves Green at <b>${say(firstYellow)}</b> and reaches Orange at <b>${say(firstOrange)}</b>.</p>
    <table class="simtab"><tr><th>Week</th><th class="num">Positivity</th><th>Alert level</th><th>Classifier band</th></tr>${rows.join("")}</table>
    <p class="note">Everything on this page now follows the invented weeks up to the highlighted row. Nothing here is a forecast.</p>`;
}
function setupSim() {
  const bind = (id, key, kind) => ($(id).oninput = (e) => { SIM[key] = kind === "check" ? e.target.checked : +e.target.value; if (key !== "week" && key !== "on") SIM.week = Math.min(SIM.week, SIM.weeks + 6); if (key === "on" && SIM.on && !SIM.week) SIM.week = 1; if (key === "week" && !SIM.on) { SIM.on = true; $("simOn").checked = true; } render(); });
  bind("simOn", "on", "check"); bind("simWeek", "week"); bind("simBase", "base"); bind("simWeeks", "weeks"); bind("simStrain", "strain"); bind("simVax", "vax");
  bind("simSchool", "school", "check"); bind("simTravel", "travel", "check"); bind("simRain", "rain", "check");
}

const TYPE_LABEL = { plan: "Approved action plan", lab: "Lab counts", ili: "ILI rate", clusters: "District cluster counts", clusterlist: "Cluster list", beds: "Hospital beds" };
function renderHistory() {
  const a = STATE.auth || {}, log = [...(STATE.log || [])].reverse();
  $("roleChip").textContent = !SERVER ? "Kept in this browser only" : !a.required ? "Open mode: no passcode set" : `Your role: ${a.role}`;
  $("histNote").textContent = !SERVER ? "This hosted copy has no server, so uploads and this history stay in your browser. Undo and restore work the same way."
    : a.required ? "Anyone can view. Uploading or undoing an upload needs the uploader passcode; restoring or resetting everything needs the admin passcode. Nothing is ever erased: an undone upload stays in this list."
    : "No passcode is set on this server, so anyone who can reach it can upload. Set passcodes in .env.local before sharing it. Nothing is ever erased: an undone upload stays in this list.";
  $("passRow").hidden = !(SERVER && a.required);
  $("byIn").value = localStorage.getItem("fs_by") || "";
  $("histBody").innerHTML = log.length ? `<table><tr><th>When</th><th>Who</th><th>What</th><th class="num">Rows</th><th>Status</th><th></th></tr>${log.map((e) => `<tr class="${e.undone ? "undone" : ""}"><td>${new Date(e.at).toLocaleString()}</td><td>${esc(e.by)}${e.role && e.role !== "local" ? ` (${e.role})` : ""}</td><td>${TYPE_LABEL[e.type] || e.type}${e.own ? ", own lab network" : ""}</td><td class="num">${e.n}</td><td>${e.undone ? "Undone" : "In use"}</td><td><button data-id="${e.id}" data-undo="${e.undone ? 0 : 1}">${e.undone ? "Restore" : "Undo"}</button></td></tr>`).join("")}</table>` : '<p class="note">No uploads yet.</p>';
}
function setupHistory() {
  $("histBody").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) setUndone(b.dataset.id, b.dataset.undo === "1"); };
  $("byIn").onchange = (e) => localStorage.setItem("fs_by", e.target.value.trim().slice(0, 60));
  $("passBtn").onclick = async () => { sessionStorage.setItem("fs_pass", $("passIn").value); $("passIn").value = ""; planMsg = ""; barMsg = ""; await loadState(); render(); $("histMsg").textContent = STATE.auth.role === "viewer" ? "That passcode was not recognised." : ""; };
}

function render() { const c = context(); renderStamp(c); renderHistory(); renderSim(c); renderAlert(c); renderChart(c); renderMap(c); renderPlan(c); renderSummary(c); }

// ---------- upload ----------
function manualInputs() { const t = $("utype").value;
  $("manual").innerHTML = SCHEMA[t].cols.map((k) => `<input ${["district", "hospital", "name", "setting"].includes(k) ? 'type="text"' : 'type="number" step="any"'} placeholder="${k}" data-k="${k}">`).join("");
  $("ownRow").hidden = t !== "lab"; if (t !== "lab") $("ownSeries").checked = false;
  $("tpl").href = "templates/" + SCHEMA[t].tpl; $("tpl").textContent = SCHEMA[t].tpl; pending = []; drawPreview(); }
function drawPreview() { const t = $("utype").value, cols = SCHEMA[t].cols;
  $("preview").innerHTML = pending.length ? `<p class="note">Check what was read. Edit any cell before confirming.</p><table><tr>${cols.map((k) => `<th>${k}</th>`).join("")}</tr>${pending.map((r, i) => `<tr>${cols.map((k) => `<td><input data-i="${i}" data-k="${k}" value="${esc(r[k])}"></td>`).join("")}</tr>`).join("")}</table>` : "";
  $("confirm").disabled = !pending.length; $("uerr").textContent = ""; }
function validate(t, raw, own) {
  const errs = [], out = [], warns = [], num = (v) => (v === "" || v == null ? NaN : Number(v)), c = context(0);
  const ns = c.series.slice(-26).map((r) => r.n).sort((a, b) => a - b), usualN = ns[Math.floor(ns.length / 2)];
  const ownNew = t === "lab" && (own ?? $("ownSeries").checked);
  let prev = ownNew ? null : c.series[c.series.length - 1];
  raw.forEach((r, i) => { const L = `Row ${i + 1}: `;
    if (t === "lab") { const o = { year: num(r.year), week: num(r.week), n: num(r.samples_tested), pos: num(r.influenza_positive), h3: num(r.a_h3) || 0, h1: num(r.a_h1n1) || 0, b: num(r.b) || 0 };
      const nx = prev ? nextWeek(prev) : o;
      if (![o.year, o.week, o.n, o.pos].every(Number.isFinite)) errs.push(L + "year, week, samples_tested and influenza_positive must be numbers.");
      else if (o.n <= 0 || o.pos < 0 || o.pos > o.n) errs.push(L + "influenza_positive must be between 0 and samples_tested.");
      else if (o.year !== nx.year || o.week !== nx.week) errs.push(L + `expected week ${wk(nx)} (the week after the ${ownNew ? "previous row" : "newest data"}), got ${wk(o)}.`);
      else { const pp = prev ? M.pct(prev) : M.pct(o), po = M.pct(o);
        if (Math.abs(po - pp) > 5 && (po > 2.5 * pp || po < 0.33 * pp)) warns.push(L + `positivity goes from ${f1(pp)}% to ${f1(po)}% in one week, a bigger jump than any week in the real series.`);
        if (o.n < 0.5 * usualN || o.n > 2 * usualN) warns.push(L + `${o.n} samples tested, against about ${usualN} in a usual week.`);
        out.push(o); prev = o; } }
    if (t === "ili") { const o = { year: num(r.year), week: num(r.week), rate: num(r.ili_rate_percent) };
      if (!(o.rate >= 0 && o.rate <= 100) || !Number.isFinite(o.year) || !(o.week >= 1 && o.week <= 53)) errs.push(L + "needs year, week 1-53 and a rate between 0 and 100."); else out.push(o); }
    if (t === "clusters") { const o = { year: num(r.year), week: num(r.week), district: String(r.district || "").trim(), clusters: num(r.clusters) };
      if (!GEO.features.some((f) => f.properties.name === o.district)) errs.push(L + `district "${o.district}" is not one of: ${GEO.features.map((f) => f.properties.name).join(", ")}.`);
      else if (!(o.clusters >= 0) || !Number.isFinite(o.year)) errs.push(L + "clusters must be 0 or more."); else out.push(o); }
    if (t === "clusterlist") { const blank = (v) => v === "" || v == null;
      const o = { name: String(r.name || "").trim() || `Cluster ${i + 1}`, district: String(r.district || "").trim(), cases: num(r.cases), setting: String(r.setting || "").trim(), lat: blank(r.lat) ? null : num(r.lat), lon: blank(r.lon) ? null : num(r.lon) };
      if (!GEO.features.some((f) => f.properties.name === o.district)) errs.push(L + `district "${o.district}" is not one of: ${GEO.features.map((f) => f.properties.name).join(", ")}.`);
      else if (!(o.cases >= 1)) errs.push(L + "cases must be 1 or more.");
      else if ((o.lat == null) !== (o.lon == null)) errs.push(L + "give both lat and lon, or leave both empty.");
      else if (o.lat != null && !(o.lat > 2.4 && o.lat < 4 && o.lon > 100.6 && o.lon < 102.1)) errs.push(L + "lat and lon are outside Selangor.");
      else out.push(o); }
    if (t === "beds") { const o = { hospital: String(r.hospital || "").trim(), beds: num(r.beds_available) };
      if (!HOSP.some((h) => h.name === o.hospital)) errs.push(L + `hospital "${o.hospital}" is not in the list (see the template).`);
      else if (!(o.beds >= 0)) errs.push(L + "beds_available must be 0 or more."); else out.push(o); } });
  if (ownNew && !errs.length && out.length < 12) errs.push(`An own-network series needs at least 12 weeks in a row; this has ${out.length}.`);
  return { errs, out, warns };
}
function setupUpload() {
  $("uploadBtn").onclick = () => { $("upNote").textContent = SERVER ? 'Uploads are saved on this server, shared with everyone using it, and marked "Uploaded, not verified".' : 'Uploads stay in this browser only, are marked "Uploaded, not verified", and can be cleared with Reset.'; $("ufile").value = ""; $("ownSeries").checked = false; $("dropName").textContent = ""; $("dropInfo").textContent = ""; manualInputs(); $("dlg").showModal(); };
  $("utype").onchange = manualInputs;
  $("dlgForm").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault(); }); // Enter in a cell used to close the window and lose the rows
  // One file at a time goes through the confirm table; extra dropped files wait in a queue.
  let queue = [];
  const showQueue = () => ($("dropInfo").textContent = queue.length ? `${queue.length} more file(s) waiting: ${queue.map((f) => f.name).join(", ")}` : "");
  async function handleFile(file) {
    $("dropName").textContent = file.name;
    try { const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const have = Object.keys(rows[0] || {}).map((k) => k.trim().toLowerCase());
      // The data type is recognised from the column names, so a dropped file needs no manual choice.
      const found = Object.keys(SCHEMA).find((t) => SCHEMA[t].cols.every((k) => have.includes(k)));
      if (found && found !== $("utype").value) { $("utype").value = found; manualInputs(); }
      const cols = SCHEMA[$("utype").value].cols, miss = cols.filter((k) => !have.includes(k));
      if (!rows.length || miss.length) { pending = []; drawPreview(); $("uerr").textContent = `"${file.name}" does not match any template. Missing column(s) for the selected type: ${miss.join(", ") || "no rows found"}.`; return; }
      pending = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v]))); drawPreview();
    } catch { $("uerr").textContent = `Could not read "${file.name}". Use a CSV template or an Excel file.`; } }
  const nextFile = () => { const f = queue.shift(); showQueue(); if (f) handleFile(f); return !!f; };
  const takeFiles = (files) => { queue = files.filter((f) => /\.(csv|xlsx|xls)$/i.test(f.name));
    if (!queue.length) { $("uerr").textContent = "No CSV or Excel files found in what was dropped."; return; }
    if (!$("dlg").open) { manualInputs(); $("dlg").showModal(); }
    nextFile(); };
  // Reads dropped items, walking into folders.
  async function droppedFiles(dt) {
    const out = [], walk = async (entry) => {
      if (entry.isFile) out.push(await new Promise((res) => entry.file(res)));
      else if (entry.isDirectory) { const rd = entry.createReader(); let batch;
        do { batch = await new Promise((res) => rd.readEntries(res)); for (const e of batch) await walk(e); } while (batch.length); } };
    const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e); return out; }
    return [...dt.files];
  }
  const dz = $("drop");
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); document.body.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || !e.relatedTarget) { dz.classList.remove("over"); document.body.classList.remove("dragging"); } }));
  document.addEventListener("drop", async (e) => takeFiles(await droppedFiles(e.dataTransfer)));
  dz.onclick = () => $("ufile").click();
  $("ufile").onchange = (e) => { takeFiles([...e.target.files]); e.target.value = ""; };
  setupUpload.nextFile = nextFile;
  $("addRow").onclick = () => { const r = {}; $("manual").querySelectorAll("input").forEach((i) => (r[i.dataset.k] = i.value)); pending.push(r); drawPreview(); };
  $("preview").oninput = (e) => { const i = e.target.dataset.i; if (i != null) pending[i][e.target.dataset.k] = e.target.value; };
  $("confirm").onclick = async () => { const t = $("utype").value, { errs, out, warns } = validate(t, pending);
    if (errs.length) { $("uerr").textContent = errs.join("\n"); return; }
    const key = JSON.stringify(pending);
    if (warns.length && setupUpload.ack !== key) { setupUpload.ack = key; $("uerr").textContent = "Please check these unusual values:\n" + warns.join("\n") + "\nIf they are right, press Confirm again."; return; }
    setupUpload.ack = null; const ownNew = t === "lab" && $("ownSeries").checked;
    const failed = await saveUpload(t, out, ownNew);
    if (failed) { $("uerr").textContent = failed + " Enter a passcode under Uploads, roles and history."; return; }
    render(); if (t === "clusters" || t === "clusterlist") zoomTo(boundsOf(GEO));
    if (setupUpload.nextFile()) return;
    $("dlg").close(); window.scrollTo({ top: 0, behavior: "smooth" }); };
}

(async function () {
  [D, GEO, HOSP] = await Promise.all(["data/site.json", "data/districts.geojson", "data/hospitals.json"].map((u) => fetch(u).then((r) => r.json())));
  HOSPMETA = HOSP.meta; HOSP = HOSP.rows || HOSP;
  const fj = await fetch("data/facilities.json").then((r) => r.json()).catch(() => null);
  FAC = fj ? fj.rows || fj : HOSP.map((h) => ({ ...h, kind: "government" })); FACMETA = fj && fj.meta;
  DENGUE = await fetch("data/dengue.json").then((r) => r.json()).catch(() => null);
  STATES = await fetch("data/states.json").then((r) => r.json()).catch(() => null);
  STGEO = await fetch("data/states_map.geojson").then((r) => r.json()).catch(() => null);
  EVID = await fetch("data/evidence.json").then((r) => r.json()).catch(() => null);
  STRESS = await fetch("data/stress_rise.json").then((r) => r.json()).catch(() => null);
  await loadState(); setupUpload(); setupSim(); setupLayers(); setupHistory(); setupAtlas(); if (STATES) stMeasureOptions(); renderStates();
  // Folded sections: a link to one opens it, and charts inside are sized when it opens.
  const openHash = () => { const el = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el && el.tagName === "DETAILS") { el.open = true; el.scrollIntoView(); } };
  document.querySelectorAll("details.fold").forEach((d) => d.addEventListener("toggle", () => { if (d.open) [chart, stChart, dengueChartObj, evChart].forEach((ch) => ch && ch.resize()); }));
  window.addEventListener("hashchange", openHash);
  $("adm").oninput = $("share").oninput = $("occ").oninput = () => renderPlan(context());
  $("mapMode").onchange = () => renderMap(context());
  $("aiOn").disabled = !SERVER; $("aiOn").onchange = () => renderSummary(context());
  if (!SERVER) $("aiNote").textContent = "AI wording needs the local server; this hosted copy shows the template.";
  render();
  for (const [fn, id] of [[renderProof, "proof"], [renderDengue, "dengue"], [renderTrust, "trust"], [renderTrack, "track"]]) {
    try { fn(); } catch (e) { console.error(id, e); $(id).hidden = true; } }
  openHash();
})();
