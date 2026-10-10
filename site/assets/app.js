const M = window.FluModel;
const $ = (id) => document.getElementById(id);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const wk = (s) => `${s.year}-W${String(s.week).padStart(2, "0")}`;
const nextWeek = (s, k = 1) => { let y = s.year, w = s.week + k; while (w > 52) { w -= 52; y++; } return { year: y, week: w }; };
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
  orange: [["Start school-cluster response and vaccination outreach in the top-ranked districts", "State and district health offices"],
           ["Hospitals review surge rosters and respiratory ward plans", "Hospital directors"]],
  red: [["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"],
        ["Issue a public advisory through official channels", "State health department"],
        ["Continue school-cluster response in all districts", "District health offices"]],
};
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
const emptyState = () => ({ lab: [], ili: [], clusters: [], beds: [], clusterlist: [], own: false, stamp: null, log: [], auth: { required: false, role: "admin" } });
const localLog = () => JSON.parse(localStorage.getItem("fs_log_" + MODE) || "[]");
function useLocal(log) {
  localStorage.setItem("fs_log_" + MODE, JSON.stringify(log));
  STATE = { ...emptyState(), ...M.reduceLog(log), log: log.map(({ rows, ...e }) => ({ ...e, n: rows.length })) };
}
async function loadState() {
  const r = await api("GET", `/api/state?mode=${MODE}`);
  if (r.ok) STATE = { ...emptyState(), ...r.data }; else { SERVER = false; useLocal(localLog()); }
}
const denied = (r) => (r.status === 401 ? "That passcode does not allow this." : r.status === 429 ? "Too many wrong passcodes. Wait ten minutes." : "The server did not accept that.");
// Returns an error message, or "" when saved.
async function saveUpload(type, rows, own) {
  const by = localStorage.getItem("fs_by") || "";
  if (!SERVER) { useLocal(localLog().concat([{ id: Date.now() + "-" + Math.random().toString(16).slice(2, 8), at: new Date().toISOString(), by: by || "this browser", role: "local", type, own: !!own, rows }])); return ""; }
  const r = await api("POST", `/api/state?mode=${MODE}`, { type, rows, own: !!own, by });
  if (r.ok) { STATE = { ...emptyState(), ...r.data }; return ""; }
  return denied(r);
}
async function setUndone(id, undone) {
  let msg = "";
  if (!SERVER) useLocal(localLog().map((e) => (e.id === id ? { ...e, undone } : e)));
  else { const r = await api("POST", `/api/undo?mode=${MODE}`, { id, restore: !undone }); if (r.ok) STATE = { ...emptyState(), ...r.data }; else msg = denied(r); }
  render(); $("histMsg").textContent = msg;
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
  else { const r = await api("DELETE", `/api/state?mode=${MODE}`); if (r.ok) STATE = { ...emptyState(), ...r.data }; else msg = r.status === 401 ? "Resetting everything needs the admin passcode. Single uploads can still be undone below." : denied(r); }
  render(); $("histMsg").textContent = msg;
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
  const rise = M.riseSignal(series, D.rise[REPLAY ? "replay" : "current"]);
  return { base, real, series, lag, a, today, rise, th, own, uploaded: STATE.lab.length > 0, sim: nSim > 0, nSim };
}

function figures(c) {
  const a = c.a;
  return {
    headline: a.dataWarning ? "Data warning: check the newest week before acting" : LEVELS[a.level].head, alert_level: a.level,
    newest_data_week: wk(a.last), newest_positivity_percent: +f1(a.pLast),
    positivity_two_weeks_earlier_percent: +f1(a.p2),
    weeks_data_is_behind_today: c.lag,
    highest_expected_in_next_weeks_percent: +f1(Math.max(...a.ahead)),
    watch_line_percent: +f1(c.th.yellow), alert_line_percent: +f1(c.th.orange),
    wave_type: a.wave, wave_type_share_percent: Math.round(a.waveShare * 100),
    phase: a.phase, data_warning: a.dataWarning,
    based_on_uploaded_unverified_data: c.uploaded, simulated_scenario: c.sim,
    proposed_action: ACTIONS[a.level][0][0],
  };
}
function template(fg) {
  const src = fg.simulated_scenario ? " (simulated scenario, not real data)" : fg.based_on_uploaded_unverified_data ? " (based on uploaded, unverified data)" : "";
  const en = `${fg.headline}${src}. Sentinel positivity is ${fg.newest_positivity_percent}% in ${fg.newest_data_week}, ${fg.phase} from ${fg.positivity_two_weeks_earlier_percent}% two weeks earlier; the alert line is ${fg.alert_line_percent}%. ` +
    (fg.wave_type === "Mixed" ? "No single virus type dominates. " : `${fg.wave_type} makes up ${fg.wave_type_share_percent}% of typed positives. `) + `Proposed action: ${fg.proposed_action}.`;
  const lv = { green: "Tiada trend wabak", yellow: "Kemungkinan trend wabak: pantau", orange: "Trend wabak dikesan", red: "Trend wabak dikesan: lonjakan sedang berlaku" }[fg.alert_level];
  const bm = `${lv}. Kadar positif sentinel ialah ${fg.newest_positivity_percent}% pada ${fg.newest_data_week}, berbanding ${fg.positivity_two_weeks_earlier_percent}% dua minggu sebelumnya; garis amaran ialah ${fg.alert_line_percent}%.`;
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
  if (r && r.en && r.bm && numbersOk(r.en + " " + r.bm, fg) && JSON.stringify(figures(context())) === JSON.stringify(fg)) {
    $("sumEn").textContent = r.en; $("sumBm").textContent = r.bm; $("sumChip").textContent = `AI-written (${r.model}) from the figures on this page`;
  } else $("sumChip").textContent = r && r.en ? "Template (AI text rejected: it used a number not in the figures)" : "Template (AI wording unavailable)";
}

function renderAlert(c) {
  const RT = D.rise.walk ? D.rise.walk.pooled.gradient_boosted : D.rise.test.models.gradient_boosted;
  const a = c.a, th = c.th;
  let L = a.dataWarning ? { head: "Data warning: check the newest week before acting", sub: `Rule result on this data: ${LEVELS[a.level].head}` } : LEVELS[a.level];
  if (c.own && !th.calibrated && !a.dataWarning) L = { head: L.head, sub: "Uncalibrated: these alert lines were not learned from your data. Treat the level with caution." };
  const why = [];
  why.push(`Newest data (${wk(a.last)}): ${f1(a.pLast)}% of sentinel samples positive, ${a.phase} from ${f1(a.p2)}% two weeks earlier.`);
  why.push(c.lag > 0 ? `That data is ${c.lag} week${c.lag > 1 ? "s" : ""} behind today, so today's level is projected, not observed.` : `Data is current to this week, so the level is observed.`);
  why.push(`Highest level expected over the coming weeks: ${f1(Math.max(...a.ahead))}%. Watch line ${f1(th.yellow)}%, alert line ${f1(th.orange)}%.`);
  why.push(a.wave === "Mixed" ? "No single virus type dominates the last four weeks." : `${a.wave} makes up ${Math.round(a.waveShare * 100)}% of typed positives in the last four weeks.`);
  if (c.own) why.push(th.calibrated ? `Alert lines are computed from your own ${th.weeks} weeks, by the same formula as the national ones.` : `Alert lines are the national ones and may not fit your lab network: ${OWN_MIN_WEEKS} weeks of your own history are needed to compute yours, and you have ${th.weeks}.`);
  if (c.own) why.push("The rapid-rise classifier and the projection were trained on the national series, not on yours.");
  if (a.dataWarning) why.push(`Only ${a.last.n} samples were tested in the newest week, under half the usual ${a.medN}. Check the data before acting.`);
  $("alertCard").innerHTML = `
    <div class="level ${a.level}"><div class="dot"></div><div><h1>${L.head}</h1><div class="sub">${L.sub}</div></div></div>
    <div class="cats"><span class="cat">Level: <b>${a.level.toUpperCase()}</b></span><span class="cat">Type: <b>${a.wave}</b></span>
      <span class="cat">Phase: <b>${a.phase}</b></span>${a.dataWarning ? '<span class="cat warn">Data warning</span>' : ""}
      ${c.own ? `<span class="chip ${th.calibrated ? "est" : "exp"}">Thresholds ${th.calibrated ? "calibrated to your data" : "uncalibrated"}</span>` : ""}
      ${c.sim ? '<span class="chip sim">Simulated scenario: not real data</span>' : c.own ? '<span class="chip unv">Your own series, uploaded, not verified</span>' : c.uploaded ? '<span class="chip unv">Uses uploaded, unverified data</span>' : '<span class="chip real">Public data only</span>'}</div>
    <div class="rise ${c.rise.yes ? "on" : ""}"><b>Rapid-rise risk: ${Math.round(c.rise.prob * 100)}% (${c.rise.yes ? "likely" : "unlikely"})</b> <span class="chip est">Machine-learning classifier</span><br>
      <span class="note">Chance that weekly positives rise by half or more within the next four weeks. Tested year by year on weeks it had not seen, the classifier caught ${RT.tp} of ${RT.tp + RT.fn} such rises with ${RT.fp} false alarms (recall ${Math.round(RT.recall * 100)}%, precision ${Math.round(RT.precision * 100)}%). It is a lead signal with modest evidence and does not change the alert level.</span></div>
    <h3>Why this level</h3><ul class="why">${why.map((w) => `<li>${w}</li>`).join("")}</ul>
    <p class="note">The level is set by a fixed rule tested on ${c.own ? "the national series, not on your data" : "past data"}. Thresholds are project thresholds, not the Ministry of Health's.</p>`;
  $("action").innerHTML = `<table><tr><th>Action</th><th>Who acts</th></tr>${ACTIONS[a.level].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table>
    <p class="note">Proposed actions for discussion with a health professional; not official guidance.</p>`;
}

function renderStamp(c) {
  const b = c.base[c.base.length - 1], past = STATE.lab.length > D.pub_lag;
  let h = c.own ? `Showing <b>your own uploaded series</b>: ${c.base.length} weeks, ${wk(c.base[0])} to ${wk(b)}. The national data is not mixed in. Alert lines: <b>${c.th.calibrated ? "calibrated to your data" : `uncalibrated (${OWN_MIN_WEEKS} weeks needed, ${c.base.length} given)`}</b>.`
    : `Public data through <b>${wk(b)}</b> (WHO FluNet). ` + (past ? `Uploaded data now runs to <b>${wk(c.today)}</b>.` : `Today is about <b>${wk(c.today)}</b>, so public data is ${D.pub_lag} weeks behind.`);
  if (STATE.stamp) h += ` &nbsp;|&nbsp; <b class="unv">Uploaded, not verified</b> (${SERVER ? "shared on this server" : "kept in this browser only"}): ${STATE.lab.length} lab week(s), ${STATE.ili.length} ILI, ${STATE.clusters.length} cluster rows, ${STATE.clusterlist.length} listed clusters, ${STATE.beds.length} bed rows, last at ${new Date(STATE.stamp).toLocaleString()} <button id="reset">Reset to public data</button>`;
  if (c.sim) h = `<b class="simflag">SIMULATION ON: the newest ${c.nSim} week(s) are invented, not data.</b> <button id="simOff">Exit simulation</button> &nbsp;|&nbsp; ` + h;
  $("stamp").innerHTML = h;
  if ($("reset")) $("reset").onclick = resetState;
  if ($("simOff")) $("simOff").onclick = () => { SIM.on = false; $("simOn").checked = false; render(); };
  $("replayBar").hidden = c.own; $("hero").hidden = REPLAY || c.own;
  $("replayBar").innerHTML = REPLAY
    ? `<b>Replay of real data.</b> The site is shown as it looked with public data through ${wk(b)}. ` + (STATE.lab.length ? `Newer weeks are loaded. Press Reset above to run it again.` : `Drop in <a href="templates/demo_real_replay_2025_W38_W41.csv" download>the four real weeks that followed</a>, or <button id="playNext">Load those four weeks</button>.`) + ` <a href="./">Leave replay</a>`
    : `<b>New here?</b> <a href="?replay=1">Run the replay of the October 2025 surge</a> to see the alert change as newer data arrives.`;
  if ($("playNext")) $("playNext").onclick = async () => {
    const wb = XLSX.read(await (await fetch("templates/demo_real_replay_2025_W38_W41.csv")).text(), { type: "string" });
    const { errs, out } = validate("lab", XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }));
    if (!errs.length) { const m = await saveUpload("lab", out); render(); $("histMsg").textContent = m; }
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
    { label: "Model projection", data: fut((f) => f.model), borderColor: "#0b6e6e", borderDash: [6, 4], pointRadius: 2, borderWidth: 2 },
    { label: "80% range (baseline)", data: fut((f) => f.hi), borderColor: "transparent", backgroundColor: "rgba(42,90,168,.12)", pointRadius: 0, fill: "+1" },
    { label: "", data: fut((f) => f.lo), borderColor: "transparent", pointRadius: 0 },
    { label: "Watch line", data: line(c.th.yellow), borderColor: "#c99700", borderWidth: 1, pointRadius: 0 },
    { label: "Alert line", data: line(c.th.orange), borderColor: "#d9660b", borderWidth: 1, pointRadius: 0 },
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
  $("signals").innerHTML = sig.join("") || `<span class="note">The model's projection did not beat the simple baseline in testing (see Proof), so the baseline is shown as the main forecast.</span>`;
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
      .bindPopup(`<b>${r.name}</b><br>${r.district}${r.setting ? ", " + r.setting : ""}<br><b>${r.cases} cases</b><br><i>Uploaded, not verified</i>`);
      if (i === 0) m.bindTooltip(`Largest: ${r.name} (${r.cases})`, { permanent: true, direction: "top" }); marks.push(m); });
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
    (H.kind === "list" && pts.length ? `<h3>Largest clusters <span class="chip unv">Uploaded</span></h3><table><tr><th>Cluster</th><th>District</th><th>Setting</th><th class="num">Cases</th></tr>${[...H.points].sort((a, b) => b.cases - a.cases).slice(0, 5).map((r) => `<tr><td>${r.name}</td><td>${r.district}</td><td>${r.setting || ""}</td><td class="num">${r.cases}</td></tr>`).join("")}</table>` : "") +
    `<h3>Districts by density <span class="chip ${H.chip[0]}">${H.chip[1]}</span></h3><table><tr><th>District</th><th class="num">${H.unit === "cases" ? "Cases" : "Clusters"}</th>${H.kind === "list" ? '<th class="num">Cases</th>' : ""}<th class="num">Per 100,000 people</th></tr>${byRate.map((d) => `<tr><td>${d.name}</td><td class="num">${d.value}</td>${H.kind === "list" ? `<td class="num">${d.cases}</td>` : ""}<td class="num">${f1(d.rate)}</td></tr>`).join("")}${ds.filter((d) => !d.has).map((d) => `<tr><td>${d.name}</td><td class="num" colspan="2">not published</td></tr>`).join("")}</table>` +
    (H.kind !== "list" ? `<p class="note">The heat layer needs individual cluster positions. Upload a cluster list to see it; <a href="templates/demo_SIMULATED_cluster_list.csv" download>a simulated example</a> is provided.</p>` : "") +
    (noCoord ? `<p class="note">${noCoord} listed cluster(s) had no coordinates, so they count toward their district but are not drawn.</p>` : "");
  facilityLayers();
}
// Hospitals and clinics for every state. Built once; shown only when zoomed in, each kind in its own pane so hospitals stay on top.
function facilityLayers() {
  const KIND = { clinic: ["Government health clinic", "#e07a00", 3.5, 1], private: ["Private hospital licensed under Act 586", "#b5179e", 5.5, 2], government: ["Public hospital", "#0b6e6e", 6.5, 2] };
  const where = (f) => (f.approximate ? "Approximate position: placed at its town, not the building" : f.osm ? "Position from OpenStreetMap: the registry's coordinates for this facility were wrong" : f.pos || (FACMETA ? "Position from the Ministry of Health registry" : "Position from OpenStreetMap"));
  if (!facDone) { facDone = true;
    for (const k in KIND) { const [label, col, rad, wt] = KIND[k], list = FAC.filter((f) => f.kind === k);
      FACG[k] = L.layerGroup(list.map((f) => L.circleMarker([f.lat, f.lon], { pane: "fac_" + k, radius: rad, color: f.approximate ? col : "#fff", weight: f.approximate ? 2 : wt * 0.5, fillColor: col, fillOpacity: f.approximate ? 0.15 : 0.9, dashArray: f.approximate ? "3" : null })
        .bindPopup(() => `<b>${f.name}</b><br>${f.type || label}<br>${[f.district, f.state].filter(Boolean).join(", ")}${f.address ? "<br>" + f.address : ""}` +
          (f.beds ? `<br><b>${f.beds.toLocaleString()} beds</b>${f.icu ? `, ${f.icu} ICU beds` : ""}${f.vent ? `, ${f.vent} ventilators` : ""}${f.occ != null ? `; ${Math.round(f.occ)}% of beds in use` : ""} <i>(Ministry bed file, ${FACMETA.beds.updated})</i>` : "") + `<br><i>${where(f)}</i>`)));
      $("n_" + k).textContent = list.length.toLocaleString(); }
    const n = (k) => FAC.filter((f) => f.kind === k).length, M = FACMETA, P = M && M.private, moved = M ? M.registry_coordinates_wrong_repositioned : [], off = M ? M.registry_coordinates_wrong_left_off : [];
    $("facNote").innerHTML = !M ? `${FAC.length} facilities are plotted.` :
      `<b>${FAC.length.toLocaleString()}</b> facilities across Malaysia are plotted; zoom in on any state to see them. <b>${n("government")}</b> public hospitals and <b>${n("clinic").toLocaleString()}</b> government health clinics come from the Ministry of Health's own facility registry, as registered on ${M.as_at}, at the Ministry's coordinates. ` +
      (P && P.listed ? `<b>${n("private")}</b> private hospitals come from ${P.source}, at the Ministry's own map points, cross-checked against OpenStreetMap` + (P.approximate ? `; ${P.approximate} could only be placed approximately (hollow, dashed marker)` : "") + (P.not_located ? `; ${P.not_located} of the ${P.listed} listed could not be placed and are left off` : "") + `. ` : "Private hospitals are not plotted. ") +
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
  const est = c.lag === 0 ? a.pLast : a.fc[c.lag].model;
  const mult = Math.min(4, Math.max(0.3, est / c.th.median));
  const up = Object.fromEntries(STATE.beds.map((r) => [r.hospital, r.beds]));
  const uploaded = STATE.beds.length > 0, M = HOSPMETA || { counts: { ministry: 0, lookup: 0, estimated: 0 }, occupancy_reported: [], bed_file_updated: "" }, n = M.counts, short = (nm) => nm.replace("Hospital ", "");
  $("bedChip").className = "chip " + (uploaded ? "unv" : "est");
  $("bedChip").textContent = uploaded ? "Beds uploaded, not verified" : n.estimated ? `Bed totals: ${n.ministry + n.lookup} real, ${n.estimated} estimated` : "Real bed totals, occupancy mostly assumed";
  // Room for flu = total beds x (1 - occupancy) x share. Occupancy is the reported figure where the Ministry file has one, else the slider.
  // An uploaded figure is taken as the number of beds available and replaces the calculation for that hospital.
  const cap = HOSP.map((h) => { const occ = h.occ != null ? Math.min(100, h.occ) / 100 : occA, room = up[h.name] ?? Math.floor(Math.round(h.beds * (1 - occ)) * share);
    return { ...h, occUsed: occ, room, left: room }; });
  const ds = districts().map((d) => ({ ...d, need: Math.round(adm * mult * d.share) })).sort((x, y) => y.need - x.need);
  let unmet = 0, overflowNearest = 0;
  const naive = Object.fromEntries(cap.map((h) => [h.name, 0]));
  const rows = ds.map((d) => { const near = cap.map((h) => ({ h, km: hav(d.c, [h.lat, h.lon]) })).sort((x, y) => x.km - y.km);
    naive[near[0].h.name] += d.need; let need = d.need; const got = [];
    for (const x of near) { if (!need) break; const take = Math.min(need, x.h.left); if (take > 0) { x.h.left -= take; need -= take; got.push(`${short(x.h.name)} ${take} (${Math.round(x.km)} km)`); } }
    unmet += need;
    return `<tr><td>${d.name}</td><td class="num">${d.need}</td><td>${got.join(", ") || "none"}</td><td class="num">${need || ""}</td></tr>`; });
  cap.forEach((h) => { if (naive[h.name] > h.room) overflowNearest++; });
  const rep = M.occupancy_reported.map(short);
  $("planNote").innerHTML = `Demand = ${adm} baseline admissions × ${f1(mult)} (today's positivity ${f1(est)}% ÷ usual ${f1(c.th.median)}%), split by population. Room for flu at each hospital = total beds × (1 − occupancy) × the share usable for flu. ` +
    `Bed totals come from the Ministry of Health bed file (last updated ${M.bed_file_updated}) for ${n.ministry} hospitals` + (n.lookup ? `, from official pages for ${n.lookup}` : "") + (n.estimated ? `, and are estimated for ${n.estimated}` : "") + `. ` +
    (rep.length ? `Occupancy is the reported figure for ${rep.join(" and ")}; the others have none in the file (several show 0%, which we treat as not reported), so they use the slider. ` : "") +
    `Assumes admissions scale with positivity. This is an illustration, not a recommended allocation. Distances are straight-line.`;
  const from = (h) => (h.beds_src === "ministry" ? "Ministry bed file" : h.beds_src === "lookup" ? (h.src_url ? `<a href="${h.src_url}" target="_blank" rel="noopener">${h.src}</a>` : h.src) : `<span class="fail">Estimated</span>`);
  $("plan").innerHTML = `<table><tr><th>District</th><th class="num">Need</th><th>Nearest hospitals with room under this scenario</th><th class="num">Unmet</th></tr>${rows.join("")}</table>
    <p class="note"><b>${unmet}</b> admissions unplaced under this scenario. If every district simply used its nearest hospital, <b>${overflowNearest}</b> hospital(s) would be over the room worked out for them.</p>
    <h3>Hospitals in this scenario</h3>
    <table><tr><th>Hospital</th><th class="num">Total beds</th><th>Bed total from</th><th class="num">Occupancy</th><th class="num">Room for flu</th><th class="num">Used</th></tr>
    ${cap.map((h) => `<tr><td>${short(h.name)}</td><td class="num">${h.beds.toLocaleString()}</td><td>${from(h)}</td><td class="num">${Math.round(h.occUsed * 100)}% ${h.occ != null ? "reported" : "assumed"}</td><td class="num">${h.room}${up[h.name] != null ? " (uploaded)" : ""}</td><td class="num">${h.room - h.left}</td></tr>`).join("")}</table>
    <p class="note">"Estimated" totals are the middle value for a hospital of the same type in the Ministry file, used where no published figure was found. Upload today's free beds (Upload newest data, Hospital beds) to replace the calculation for any hospital.</p>`;
}

function renderProof() {
  const v = D.validation, a4 = v.alerts.find((x) => x.lag === 4), a0 = v.alerts.find((x) => x.lag === 0), s4 = a4.surges[0], s0 = a0.surges[0];
  const passed = v.per_horizon.filter((h) => h.passed).length, R = D.rise.test, G = R.models.gradient_boosted, S = R.models.already_in_outbreak_now;
  const cmRow = (name, m) => `<tr><td>${name}</td><td class="num">${m.tp}</td><td class="num">${m.fp}</td><td class="num">${m.tn}</td><td class="num">${m.fn}</td><td class="num">${Math.round(m.recall * 100)}%</td><td class="num">${Math.round(m.precision * 100)}%</td></tr>`;
  const cmHead = `<tr><th>Method</th><th class="num">TP</th><th class="num">FP</th><th class="num">TN</th><th class="num">FN</th><th class="num">Recall</th><th class="num">Precision</th></tr>`;
  const w0 = v.week_level.find((x) => x.lag === 0), w4 = v.week_level.find((x) => x.lag !== 0), W = D.rise.walk;
  $("proofBody").innerHTML = `
  <p class="note">All results are on ${v.per_horizon[0].n} unseen weeks (${v.test_start} to ${v.test_end}). Models learned from 2022 to ${v.train_end} only; the split is by date. Rules and settings were frozen with git tags before each scoring.</p>
  <div class="kpis">
    <div class="kpi"><b>${Math.round((W ? W.pooled.gradient_boosted : G).recall * 100)}% recall, ${Math.round((W ? W.pooled.gradient_boosted : G).precision * 100)}% precision</b><span>Rapid-rise classifier${W ? ", tested year by year" : ""}, against ${Math.round((W ? W.pooled.already_in_outbreak_now : S).recall * 100)}% and ${Math.round((W ? W.pooled.already_in_outbreak_now : S).precision * 100)}% for the simple rule.</span></div>
    <div class="kpi"><b>${s0.lead_weeks === 0 ? "Same week" : s0.lead_weeks + " weeks ahead"}</b><span>With current data, the alert fired in the week the October 2025 surge crossed the alert line.</span></div>
    <div class="kpi"><b>${-s4.lead_weeks}-week delay removed</b><span>With public data alone the same alert fired ${-s4.lead_weeks} weeks later, because public data runs ${D.pub_lag} weeks behind.</span></div>
    <div class="kpi"><b class="${passed ? "pass" : "fail"}">${passed} of 8 passed</b><span>Forecasts of the level itself: none beat "same as last week". That is why we classify instead.</span></div>
  </div>

  <h3>What is learned, what is a rule, what is assumed</h3>
  <table><tr><th>Learned from data</th><th>Fixed rules we wrote</th><th>Assumed, for illustration</th></tr>
  <tr><td>Rapid-rise classifier (gradient-boosted).<br>Forecast of the level (tested, did not beat the baseline).</td><td>Alert level and its two lines (statistics of training weeks).<br>Wave type, phase, data warning.<br>Proposed action for each level.</td><td>Hospital bed numbers and demand.<br>Simulator factor effects.<br>District shading by population.</td></tr></table>

  <h3>1. The predictive model: rapid-rise classifier <span class="chip real">Measured</span></h3>
  <p class="note">Question it answers: will weekly positives be at least 50% higher than four weeks earlier, at any point in the next four weeks? A gradient-boosted classifier (150 one-split trees) on recent level, recent changes and time of year. ${R.test_outbreak_weeks} of ${R.n_test} unseen weeks were followed by such a rise.</p>
  <table>${cmHead}${cmRow("Simple rule: already rising now", S)}${cmRow("Logistic regression", R.models.logistic_regression)}${cmRow("Gradient-boosted classifier (used on this site)", G)}</table>
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
  <p class="note">With current data the alert mostly reports that this week's figure is already above the line, so a perfect score here shows the rule works as designed, not that it predicts ahead. The finding is the gap between the two rows: the same rule on ${D.pub_lag}-week-old data misses the first four surge weeks and stays on four weeks too long. ${a0.false_alarm_episodes} false-alarm episodes in ${a0.weeks_scored} weeks.</p>

  <h3>3. Forecasting the level: tested, and it failed <span class="chip real">Measured</span></h3>
  <table><tr><th>Weeks ahead</th><th class="num">Model error</th><th class="num">Last-value error</th><th class="num">Same-week-average error</th><th class="num">80% range covered</th><th>Result</th></tr>
  ${v.per_horizon.map((h) => `<tr><td>${h.h}</td><td class="num">${f1(h.mae_model)}</td><td class="num">${f1(h.mae_persist)}</td><td class="num">${f1(h.mae_seasonal)}</td><td class="num">${Math.round(h.coverage80 * 100)}%</td><td class="${h.passed ? "pass" : "fail"}">${h.passed ? "PASS" : "FAIL"}</td></tr>`).join("")}</table>
  <p class="note">Ridge regression, errors in percentage points of positivity. It beat the same-week average everywhere, lost to "last value carried forward" at 1 to 4 weeks, only matched it beyond that, and its ranges were too narrow. A gradient-boosted forecast and forecasts of weekly counts (with and without 2017 to 2019 data) did no better. The chart therefore shows the simple baseline as the main forecast.</p>

  <p class="note"><b>How our alert lines compare with published practice.</b> The World Health Organization's guidance for assessing influenza severity describes setting thresholds from past seasons, for example with the moving epidemic method, and the Ministry of Health's epidemiology bulletin plots its own baseline, alert and action lines. Ours are a simpler rule in the same spirit: the middle value of the training weeks plus one and two units of their usual spread. They are not the Ministry's lines and not that method.</p>

  <h3>4. Stress test: does the alert survive bad data? <span class="chip real">Measured</span></h3>
  <table><tr><th>Damage applied to the data</th><th class="num">High-alert decisions unchanged</th><th class="num">Worst of ${v.stress[0].runs} runs</th></tr>
  ${v.stress.map((s) => `<tr><td>${s.test}</td><td class="num">${f1(s.high_alert_agreement * 100)}%</td><td class="num">${f1(s.worst_run * 100)}%</td></tr>`).join("")}</table>

  <h3>5. How many times were the unseen weeks scored?</h3>
  <ul class="why"><li>Ridge forecast: once (tag <code>freeze-v1</code>).</li><li>Gradient-boosted forecast: once (<code>freeze-v2</code>).</li><li>Count forecasts and the outbreak classifiers: three runs defined in advance (<code>freeze-flucases-v1</code>).</li>
  <li>The alert tables above and this note were computed afterwards from the frozen rule: with current data the level first left Green in ${v.descriptive_after_scoring.first_non_green_week_before_2025_surge}, ${v.descriptive_after_scoring.weeks_before_orange_crossing} weeks before the alert line was crossed.</li></ul>
  <p class="note">Repeated scoring weakens every later result. The fix is a record made in advance, below.</p>

  <h3>6. Record made in advance <span class="chip real">Real, awaiting data</span></h3>
  <p class="note">Public data runs about four weeks behind, so the weeks below have happened but cannot be seen yet. Each line was saved and committed on the day shown, before those figures were published, and will be marked right or wrong when they are.</p>
  <table><tr><th>Made on</th><th>Newest data then</th><th>What the system said</th><th>Result</th></tr>
  ${(D.prospective || []).map((r) => `<tr><td>${r.made_on}</td><td>${r.newest_published_week} (${r.newest_positivity_percent}%)</td><td>${r.claim_alert}<br>${r.claim_rise} (chance ${Math.round(r.rapid_rise_probability * 100)}%)</td><td>${r.status === "scored" ? `Alert ${r.alert_correct ? "right" : "wrong"}; rise call ${r.rise_call_correct ? "right" : "wrong"}` : "Awaiting data"}</td></tr>`).join("") || '<tr><td colspan="4">No records yet.</td></tr>'}</table>

  <h3>What this cannot tell you</h3>
  <ul class="why"><li>District-level influenza activity. No public data exists for it.</li><li>Whether the thresholds fit your own data. They were learned from the national sentinel series; an uploaded series from another lab network is uncalibrated.</li><li>Real hospital capacity, unless a planner uploads it.</li><li>Case counts. Positivity is a share of tested samples.</li><li>Whether uploaded figures are correct. They are marked unverified.</li></ul>`;
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
    <p class="note">A handful of scattered weeks cannot train or test a state model for influenza. The national model and its results are in the Proof section.</p>`; return; }
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
  new Chart($("dengueChart"), { type: "line", data: { labels, datasets: [
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
    if (k && firstYellow == null && x.a.level !== "green") firstYellow = k; if (k && firstOrange == null && hi) firstOrange = k; if (firstRise == null && x.rise.yes) firstRise = k;
    rows.push(`<tr class="${k === SIM.week ? "cur" : ""}"><td>${k ? "+" + k : "now"}</td><td class="num">${f1(x.a.pLast)}%</td><td><span class="lv ${x.a.level}">${x.a.level}</span></td><td class="num">${Math.round(x.rise.prob * 100)}%</td></tr>`); }
  const say = (v) => (v == null ? "never in this scenario" : v === 0 ? "already now" : `week +${v}`);
  $("simOut").innerHTML = `<p><b>In this scenario:</b> the classifier first says "likely" at <b>${say(firstRise)}</b>; the level first leaves Green at <b>${say(firstYellow)}</b> and reaches Orange at <b>${say(firstOrange)}</b>.</p>
    <table class="simtab"><tr><th>Week</th><th class="num">Positivity</th><th>Alert level</th><th class="num">Rapid-rise risk</th></tr>${rows.join("")}</table>
    <p class="note">Everything on this page now follows the invented weeks up to the highlighted row. Nothing here is a forecast.</p>`;
}
function setupSim() {
  const bind = (id, key, kind) => ($(id).oninput = (e) => { SIM[key] = kind === "check" ? e.target.checked : +e.target.value; if (key !== "week" && key !== "on") SIM.week = Math.min(SIM.week, SIM.weeks + 6); if (key === "on" && SIM.on && !SIM.week) SIM.week = 1; if (key === "week" && !SIM.on) { SIM.on = true; $("simOn").checked = true; } render(); });
  bind("simOn", "on", "check"); bind("simWeek", "week"); bind("simBase", "base"); bind("simWeeks", "weeks"); bind("simStrain", "strain"); bind("simVax", "vax");
  bind("simSchool", "school", "check"); bind("simTravel", "travel", "check"); bind("simRain", "rain", "check");
}

const TYPE_LABEL = { lab: "Lab counts", ili: "ILI rate", clusters: "District cluster counts", clusterlist: "Cluster list", beds: "Hospital beds" };
function renderHistory() {
  const a = STATE.auth || {}, log = [...(STATE.log || [])].reverse();
  $("roleChip").textContent = !SERVER ? "Kept in this browser only" : !a.required ? "Open mode: no passcode set" : `Your role: ${a.role}`;
  $("histNote").textContent = !SERVER ? "This hosted copy has no server, so uploads and this history stay in your browser. Undo and restore work the same way."
    : a.required ? "Anyone can view. Uploading or undoing an upload needs the uploader passcode; restoring or resetting everything needs the admin passcode. Nothing is ever erased: an undone upload stays in this list."
    : "No passcode is set on this server, so anyone who can reach it can upload. Set passcodes in .env.local before sharing it. Nothing is ever erased: an undone upload stays in this list.";
  $("passRow").hidden = !(SERVER && a.required);
  $("byIn").value = localStorage.getItem("fs_by") || "";
  $("histBody").innerHTML = log.length ? `<table><tr><th>When</th><th>Who</th><th>What</th><th class="num">Rows</th><th>Status</th><th></th></tr>${log.map((e) => `<tr class="${e.undone ? "undone" : ""}"><td>${new Date(e.at).toLocaleString()}</td><td>${String(e.by).replace(/[<>&]/g, "")}${e.role && e.role !== "local" ? ` (${e.role})` : ""}</td><td>${TYPE_LABEL[e.type] || e.type}${e.own ? ", own lab network" : ""}</td><td class="num">${e.n}</td><td>${e.undone ? "Undone" : "In use"}</td><td><button data-id="${e.id}" data-undo="${e.undone ? 0 : 1}">${e.undone ? "Restore" : "Undo"}</button></td></tr>`).join("")}</table>` : '<p class="note">No uploads yet.</p>';
}
function setupHistory() {
  $("histBody").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) setUndone(b.dataset.id, b.dataset.undo === "1"); };
  $("byIn").onchange = (e) => localStorage.setItem("fs_by", e.target.value.trim().slice(0, 60));
  $("passBtn").onclick = async () => { sessionStorage.setItem("fs_pass", $("passIn").value); $("passIn").value = ""; await loadState(); render(); $("histMsg").textContent = STATE.auth.role === "viewer" ? "That passcode was not recognised." : ""; };
}

function render() { const c = context(); renderStamp(c); renderHistory(); renderSim(c); renderAlert(c); renderChart(c); renderMap(c); renderPlan(c); renderSummary(c); }

// ---------- upload ----------
function manualInputs() { const t = $("utype").value;
  $("manual").innerHTML = SCHEMA[t].cols.map((k) => `<input ${["district", "hospital", "name", "setting"].includes(k) ? 'type="text"' : 'type="number" step="any"'} placeholder="${k}" data-k="${k}">`).join("");
  $("ownRow").hidden = t !== "lab"; if (t !== "lab") $("ownSeries").checked = false;
  $("tpl").href = "templates/" + SCHEMA[t].tpl; $("tpl").textContent = SCHEMA[t].tpl; pending = []; drawPreview(); }
function drawPreview() { const t = $("utype").value, cols = SCHEMA[t].cols;
  $("preview").innerHTML = pending.length ? `<p class="note">Check what was read. Edit any cell before confirming.</p><table><tr>${cols.map((k) => `<th>${k}</th>`).join("")}</tr>${pending.map((r, i) => `<tr>${cols.map((k) => `<td><input data-i="${i}" data-k="${k}" value="${r[k] ?? ""}"></td>`).join("")}</tr>`).join("")}</table>` : "";
  $("confirm").disabled = !pending.length; $("uerr").textContent = ""; }
function validate(t, raw) {
  const errs = [], out = [], warns = [], num = (v) => (v === "" || v == null ? NaN : Number(v)), c = context(0);
  const ns = c.series.slice(-26).map((r) => r.n).sort((a, b) => a - b), usualN = ns[Math.floor(ns.length / 2)];
  const ownNew = t === "lab" && $("ownSeries").checked;
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
    if (failed) { $("uerr").textContent = failed + " Enter a passcode under Upload history."; return; }
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
  await loadState(); setupUpload(); setupSim(); setupLayers(); setupHistory(); setupAtlas(); if (STATES) stMeasureOptions(); renderStates(); renderProof(); renderDengue();
  $("adm").oninput = $("share").oninput = $("occ").oninput = () => renderPlan(context());
  $("mapMode").onchange = () => renderMap(context());
  $("aiOn").disabled = !SERVER; $("aiOn").onchange = () => renderSummary(context());
  if (!SERVER) $("aiNote").textContent = "AI wording needs the local server; this hosted copy shows the template.";
  render();
})();
