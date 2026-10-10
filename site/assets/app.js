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
};
let D, GEO, HOSP, STATE, chart, map, geoLayer, hospLayer, pending = [];

async function api(method, path, body) {
  try {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw 0;
    return await r.json();
  } catch { return null; }
}
// Falls back to this browser's storage when the API is not reachable (static hosting).
const emptyState = () => ({ lab: [], ili: [], clusters: [], beds: [], stamp: null });
async function loadState() {
  STATE = (await api("GET", `/api/state?mode=${MODE}`)) || JSON.parse(localStorage.getItem("fs_" + MODE) || "null") || emptyState();
}
async function saveUpload(type, rows) {
  const s = await api("POST", `/api/state?mode=${MODE}`, { type, rows });
  if (s) STATE = s;
  else { STATE[type] = type === "beds" ? rows : STATE[type].concat(rows); STATE.stamp = new Date().toISOString(); localStorage.setItem("fs_" + MODE, JSON.stringify(STATE)); }
}
async function resetState() {
  STATE = (await api("DELETE", `/api/state?mode=${MODE}`)) || emptyState();
  localStorage.removeItem("fs_" + MODE);
  render();
}

function context() {
  const base = REPLAY ? D.series.slice(0, D.replay_cut_index + 1) : D.series;
  const series = base.concat(STATE.lab.map((r) => ({ ...r, uploaded: true })));
  const lag = Math.max(0, D.pub_lag - STATE.lab.length);
  const a = M.assess(series, D.models[REPLAY ? "replay" : "current"], D, D.thresholds, lag);
  const today = nextWeek(base[base.length - 1], D.pub_lag);
  return { base, series, lag, a, today, th: D.thresholds, uploaded: STATE.lab.length > 0 };
}

function figures(c) {
  const a = c.a;
  return {
    headline: LEVELS[a.level].head, alert_level: a.level,
    newest_data_week: wk(a.last), newest_positivity_percent: +f1(a.pLast),
    positivity_two_weeks_earlier_percent: +f1(a.p2),
    weeks_data_is_behind_today: c.lag,
    highest_expected_in_next_weeks_percent: +f1(Math.max(...a.ahead)),
    watch_line_percent: +f1(c.th.yellow), alert_line_percent: +f1(c.th.orange),
    wave_type: a.wave, wave_type_share_percent: Math.round(a.waveShare * 100),
    phase: a.phase, data_warning: a.dataWarning,
    based_on_uploaded_unverified_data: c.uploaded,
    proposed_action: ACTIONS[a.level][0][0],
  };
}
function template(fg) {
  const src = fg.based_on_uploaded_unverified_data ? " (based on uploaded, unverified data)" : "";
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
  const r = await api("POST", "/api/summary", fg);
  if (r && r.en && r.bm && numbersOk(r.en + " " + r.bm, fg) && JSON.stringify(figures(context())) === JSON.stringify(fg)) {
    $("sumEn").textContent = r.en; $("sumBm").textContent = r.bm; $("sumChip").textContent = `AI-written (${r.model}) from the figures on this page`;
  }
}

function renderAlert(c) {
  const a = c.a, L = LEVELS[a.level], th = c.th;
  const why = [];
  why.push(`Newest data (${wk(a.last)}): ${f1(a.pLast)}% of sentinel samples positive, ${a.phase} from ${f1(a.p2)}% two weeks earlier.`);
  why.push(c.lag > 0 ? `That data is ${c.lag} week${c.lag > 1 ? "s" : ""} behind today, so today's level is projected, not observed.` : `Data is current to this week, so the level is observed.`);
  why.push(`Highest level expected over the coming weeks: ${f1(Math.max(...a.ahead))}%. Watch line ${f1(th.yellow)}%, alert line ${f1(th.orange)}%.`);
  why.push(a.wave === "Mixed" ? "No single virus type dominates the last four weeks." : `${a.wave} makes up ${Math.round(a.waveShare * 100)}% of typed positives in the last four weeks.`);
  if (a.dataWarning) why.push(`Only ${a.last.n} samples were tested in the newest week, under half the usual ${a.medN}. Check the data before acting.`);
  $("alertCard").innerHTML = `
    <div class="level ${a.level}"><div class="dot"></div><div><h1>${L.head}</h1><div class="sub">${L.sub}</div></div></div>
    <div class="cats"><span class="cat">Level: <b>${a.level.toUpperCase()}</b></span><span class="cat">Type: <b>${a.wave}</b></span>
      <span class="cat">Phase: <b>${a.phase}</b></span>${a.dataWarning ? '<span class="cat warn">Data warning</span>' : ""}
      ${c.uploaded ? '<span class="chip unv">Uses uploaded, unverified data</span>' : '<span class="chip real">Public data only</span>'}</div>
    <h3>Why this level</h3><ul class="why">${why.map((w) => `<li>${w}</li>`).join("")}</ul>
    <p class="note">The level is set by a fixed rule tested on past data. Thresholds are project thresholds, not the Ministry of Health's.</p>`;
  $("action").innerHTML = `<table><tr><th>Action</th><th>Who acts</th></tr>${ACTIONS[a.level].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table>
    <p class="note">Proposed actions for discussion with a health professional; not official guidance.</p>`;
}

function renderStamp(c) {
  const b = c.base[c.base.length - 1];
  let h = `Public data through <b>${wk(b)}</b> (WHO FluNet). Today is about <b>${wk(c.today)}</b>, so public data is ${D.pub_lag} weeks behind.`;
  if (STATE.stamp) h += ` &nbsp;|&nbsp; <b class="unv">Uploaded, not verified</b>: ${STATE.lab.length} lab week(s), ${STATE.ili.length} ILI, ${STATE.clusters.length} cluster rows, ${STATE.beds.length} bed rows, last at ${new Date(STATE.stamp).toLocaleString()} <button id="reset">Reset to public data</button>`;
  $("stamp").innerHTML = h;
  if ($("reset")) $("reset").onclick = resetState;
  $("replayBar").hidden = !REPLAY;
  if (REPLAY) $("replayBar").innerHTML = `<b>Replay of real data.</b> The site is shown as it would have looked with public data through ${wk(b)}. Upload <a href="templates/demo_real_replay_2025_W38_W41.csv" download>the real weeks that followed</a> to see the alert change. <a href="./">Leave replay</a>`;
}

function renderChart(c) {
  const hist = c.series.slice(-60), a = c.a, last = a.last, H = Math.min(8, c.lag + 4);
  const labels = hist.map(wk), n = hist.length;
  for (let h = 1; h <= H; h++) labels.push(wk(nextWeek(last, h)) + (h === c.lag ? " (today)" : ""));
  const pad = (arr) => arr.concat(Array(H).fill(null));
  const fut = (fn) => Array(n - 1).fill(null).concat([a.pLast]).concat(Array.from({ length: H }, (_, i) => fn(a.fc[i + 1])));
  const line = (v) => labels.map(() => v);
  const ds = [
    { label: "Published (public)", data: pad(hist.map((s) => (s.uploaded ? null : M.pct(s)))), borderColor: "#16202a", backgroundColor: "#16202a", pointRadius: 0, borderWidth: 2 },
    { label: "Uploaded, not verified", data: pad(hist.map((s, i) => (s.uploaded || (hist[i + 1] && hist[i + 1].uploaded) ? M.pct(s) : null))), borderColor: "#c0282d", backgroundColor: "#c0282d", pointRadius: 3, borderWidth: 2 },
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
    return { name: f.properties.name, pop: f.properties.pop_thousand, share: f.properties.pop_thousand / tot, c: [c.lat, c.lng], cases: f.properties.published_cases_w42_2025 }; });
}
function renderMap(c) {
  if (!map) { map = L.map("map", { scrollWheelZoom: false }).setView([3.2, 101.45], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map); }
  if (geoLayer) geoLayer.remove(); if (hospLayer) hospLayer.remove();
  const ds = districts(), cl = {};
  if (STATE.clusters.length) { const lw = STATE.clusters[STATE.clusters.length - 1];
    STATE.clusters.filter((r) => r.year === lw.year && r.week === lw.week).forEach((r) => (cl[r.district] = (cl[r.district] || 0) + r.clusters)); }
  const useCl = Object.keys(cl).length > 0, mx = useCl ? Math.max(...Object.values(cl), 1) : Math.max(...ds.map((d) => d.share));
  $("mapChip").className = "chip " + (useCl ? "unv" : "exp"); $("mapChip").textContent = useCl ? "Uploaded, not verified" : "Exploratory";
  $("mapNote").textContent = useCl ? "Shading shows uploaded cluster counts for the newest uploaded week."
    : "Shading shows each district's share of Selangor's population: an exposure proxy, not a forecast of district cases. No public district-level influenza series exists. The one public check: the four districts with the most reported cases to week 42 of 2025 are also the four most populous.";
  geoLayer = L.geoJSON(GEO, { style: (f) => { const d = ds.find((x) => x.name === f.properties.name); const v = (useCl ? cl[d.name] || 0 : d.share) / mx;
      return { color: "#555", weight: 1, fillColor: useCl ? "#c0282d" : "#6d3a9c", fillOpacity: 0.08 + 0.55 * v }; },
    onEachFeature: (f, layer) => { const d = ds.find((x) => x.name === f.properties.name);
      const near = HOSP.map((h) => ({ h, km: hav(d.c, [h.lat, h.lon]) })).sort((a, b) => a.km - b.km).slice(0, 3);
      layer.bindPopup(`<b>${d.name}</b><br>Population ${Math.round(d.pop)} thousand (${Math.round(d.share * 100)}% of Selangor) <i>Real data</i>` +
        (d.cases ? `<br>${d.cases} influenza cases reported to week 42/2025 <i>Real data, state assembly answer</i>` : "") +
        (useCl ? `<br>${cl[d.name] || 0} clusters <i>Uploaded, not verified</i>` : "") +
        `<br><b>Nearest hospitals</b> <i>(straight-line, approximate)</i><br>${near.map((x) => `${x.h.name}: ${Math.round(x.km)} km`).join("<br>")}`); } }).addTo(map);
  hospLayer = L.layerGroup(HOSP.map((h) => L.circleMarker([h.lat, h.lon], { radius: 6, color: "#0b6e6e", fillOpacity: 0.9 }).bindPopup(`<b>${h.name}</b><br>Location: OpenStreetMap <i>Real data</i>`))).addTo(map);
}
function renderPlan(c) {
  const adm = +$("adm").value, share = +$("share").value / 100, a = c.a;
  $("admV").textContent = adm; $("shareV").textContent = Math.round(share * 100) + "%";
  const est = c.lag === 0 ? a.pLast : a.fc[c.lag].model;
  const mult = Math.min(4, Math.max(0.3, est / c.th.median));
  const up = Object.fromEntries(STATE.beds.map((r) => [r.hospital, r.beds]));
  const real = STATE.beds.length > 0;
  $("bedChip").className = "chip " + (real ? "unv" : "sim"); $("bedChip").textContent = real ? "Beds uploaded, not verified" : "Simulated";
  const cap = HOSP.map((h) => ({ ...h, left: Math.floor((up[h.name] ?? h.beds_simulated) * share) }));
  const ds = districts().map((d) => ({ ...d, need: Math.round(adm * mult * d.share) })).sort((x, y) => y.need - x.need);
  let unmet = 0, overflowNearest = 0;
  const naive = Object.fromEntries(cap.map((h) => [h.name, 0]));
  const rows = ds.map((d) => { const near = cap.map((h) => ({ h, km: hav(d.c, [h.lat, h.lon]) })).sort((x, y) => x.km - y.km);
    naive[near[0].h.name] += d.need; let need = d.need; const got = [];
    for (const x of near) { if (!need) break; const take = Math.min(need, x.h.left); if (take > 0) { x.h.left -= take; need -= take; got.push(`${x.h.name.replace("Hospital ", "")} ${take} (${Math.round(x.km)} km)`); } }
    unmet += need;
    return `<tr><td>${d.name}</td><td class="num">${d.need}</td><td>${got.join(", ") || "none"}</td><td class="num">${need || ""}</td></tr>`; });
  cap.forEach((h) => { if (naive[h.name] > Math.floor((up[h.name] ?? h.beds_simulated) * share)) overflowNearest++; });
  $("planNote").innerHTML = `Demand = ${adm} baseline admissions × ${f1(mult)} (today's positivity ${f1(est)}% ÷ usual ${f1(c.th.median)}%), split by population. Assumes admissions scale with positivity. Distances are straight-line and approximate.`;
  $("plan").innerHTML = `<table><tr><th>District</th><th class="num">Need</th><th>Nearest hospitals with assumed space</th><th class="num">Unmet</th></tr>${rows.join("")}</table>
    <p class="note"><b>${unmet}</b> admissions unplaced under this scenario. If every district simply used its nearest hospital, <b>${overflowNearest}</b> hospital(s) would be over their assumed capacity.</p>`;
}

function renderProof() {
  const v = D.validation, a4 = v.alerts.find((x) => x.lag === 4), a0 = v.alerts.find((x) => x.lag === 0), s4 = a4.surges[0], s0 = a0.surges[0];
  const passed = v.per_horizon.filter((h) => h.passed).length;
  $("proofBody").innerHTML = `
  <p class="note">Rules were frozen with git tag <code>freeze-v1</code> before the unseen weeks were scored, and the test was scored once. Train: 2022 to ${v.train_end}. Test: ${v.test_start} to ${v.test_end} (${v.per_horizon[0].n} weeks). Split by date.</p>
  <div class="kpis">
    <div class="kpi"><b>${s0.lead_weeks === 0 ? "Same week" : s0.lead_weeks + " weeks ahead"}</b><span>With current (uploaded) data, the alert fired in the week the October 2025 surge crossed the alert line.</span></div>
    <div class="kpi"><b>${-s4.lead_weeks} weeks late</b><span>with public data alone, because it runs ${D.pub_lag} weeks behind. Uploading buys ${s0.lead_weeks - s4.lead_weeks} weeks.</span></div>
    <div class="kpi"><b>${a0.false_alarm_episodes} false alarms</b><span>in ${a0.weeks_scored} unseen weeks; ${a0.surges.length} of ${a0.surges.length} surge caught. One surge only, so these are counts, not rates.</span></div>
    <div class="kpi"><b class="${passed ? "pass" : "fail"}">${passed} of 8 passed</b><span>forecast horizons where the model beat the simple baselines under the frozen rule.</span></div>
  </div>
  <h3>Forecast accuracy on unseen weeks <span class="chip real">Measured</span></h3>
  <table><tr><th>Weeks ahead</th><th class="num">Model error</th><th class="num">Last-value error</th><th class="num">Same-week-average error</th><th class="num">80% range covered</th><th>Result</th></tr>
  ${v.per_horizon.map((h) => `<tr><td>${h.h}</td><td class="num">${f1(h.mae_model)}</td><td class="num">${f1(h.mae_persist)}</td><td class="num">${f1(h.mae_seasonal)}</td><td class="num">${Math.round(h.coverage80 * 100)}%</td><td class="${h.passed ? "pass" : "fail"}">${h.passed ? "PASS" : "FAIL"}</td></tr>`).join("")}</table>
  <p class="note">Errors are mean absolute error in percentage points of positivity. The model beat the same-week average at every horizon, lost to "last value carried forward" at 1 to 4 weeks and only matched it beyond that, and its ranges were too narrow. So the site shows the baseline as the main forecast and uses the model only inside the alert rule, which was tested separately above.</p>
  <h3>Stress test: does the alert survive bad data? <span class="chip real">Measured</span></h3>
  <table><tr><th>Damage applied to the data</th><th class="num">High-alert decisions unchanged</th><th class="num">Worst of ${v.stress[0].runs} runs</th></tr>
  ${v.stress.map((s) => `<tr><td>${s.test}</td><td class="num">${f1(s.high_alert_agreement * 100)}%</td><td class="num">${f1(s.worst_run * 100)}%</td></tr>`).join("")}</table>
  <p class="note">Looked at after scoring, not a frozen result: with current data the level first left Green in ${v.descriptive_after_scoring.first_non_green_week_before_2025_surge}, ${v.descriptive_after_scoring.weeks_before_orange_crossing} weeks before the alert line was crossed.</p>
  <h3>What this cannot tell you</h3>
  <ul class="why"><li>District-level influenza activity. No public data exists for it.</li><li>Real hospital capacity, unless a planner uploads it.</li><li>Case counts. Positivity is a share of tested samples.</li><li>Whether uploaded figures are correct. They are marked unverified.</li></ul>`;
}

function render() { const c = context(); renderStamp(c); renderAlert(c); renderChart(c); renderMap(c); renderPlan(c); renderSummary(c); }

// ---------- upload ----------
function manualInputs() { const t = $("utype").value;
  $("manual").innerHTML = SCHEMA[t].cols.map((k) => `<input ${["district", "hospital"].includes(k) ? 'type="text"' : 'type="number" step="any"'} placeholder="${k}" data-k="${k}">`).join("");
  $("tpl").href = "templates/" + SCHEMA[t].tpl; $("tpl").textContent = SCHEMA[t].tpl; pending = []; drawPreview(); }
function drawPreview() { const t = $("utype").value, cols = SCHEMA[t].cols;
  $("preview").innerHTML = pending.length ? `<p class="note">Check what was read. Edit any cell before confirming.</p><table><tr>${cols.map((k) => `<th>${k}</th>`).join("")}</tr>${pending.map((r, i) => `<tr>${cols.map((k) => `<td><input data-i="${i}" data-k="${k}" value="${r[k] ?? ""}"></td>`).join("")}</tr>`).join("")}</table>` : "";
  $("confirm").disabled = !pending.length; $("uerr").textContent = ""; }
function validate(t, raw) {
  const errs = [], out = [], num = (v) => (v === "" || v == null ? NaN : Number(v)), c = context();
  let prev = c.series[c.series.length - 1];
  raw.forEach((r, i) => { const L = `Row ${i + 1}: `;
    if (t === "lab") { const o = { year: num(r.year), week: num(r.week), n: num(r.samples_tested), pos: num(r.influenza_positive), h3: num(r.a_h3) || 0, h1: num(r.a_h1n1) || 0, b: num(r.b) || 0 };
      const nx = nextWeek(prev);
      if (![o.year, o.week, o.n, o.pos].every(Number.isFinite)) errs.push(L + "year, week, samples_tested and influenza_positive must be numbers.");
      else if (o.n <= 0 || o.pos < 0 || o.pos > o.n) errs.push(L + "influenza_positive must be between 0 and samples_tested.");
      else if (o.year !== nx.year || o.week !== nx.week) errs.push(L + `expected week ${wk(nx)} (the week after the newest data), got ${wk(o)}.`);
      else { out.push(o); prev = o; } }
    if (t === "ili") { const o = { year: num(r.year), week: num(r.week), rate: num(r.ili_rate_percent) };
      if (!(o.rate >= 0 && o.rate <= 100) || !Number.isFinite(o.year) || !(o.week >= 1 && o.week <= 53)) errs.push(L + "needs year, week 1-53 and a rate between 0 and 100."); else out.push(o); }
    if (t === "clusters") { const o = { year: num(r.year), week: num(r.week), district: String(r.district || "").trim(), clusters: num(r.clusters) };
      if (!GEO.features.some((f) => f.properties.name === o.district)) errs.push(L + `district "${o.district}" is not one of: ${GEO.features.map((f) => f.properties.name).join(", ")}.`);
      else if (!(o.clusters >= 0) || !Number.isFinite(o.year)) errs.push(L + "clusters must be 0 or more."); else out.push(o); }
    if (t === "beds") { const o = { hospital: String(r.hospital || "").trim(), beds: num(r.beds_available) };
      if (!HOSP.some((h) => h.name === o.hospital)) errs.push(L + `hospital "${o.hospital}" is not in the list (see the template).`);
      else if (!(o.beds >= 0)) errs.push(L + "beds_available must be 0 or more."); else out.push(o); } });
  return { errs, out };
}
function setupUpload() {
  $("uploadBtn").onclick = () => { $("ufile").value = ""; manualInputs(); $("dlg").showModal(); };
  $("utype").onchange = manualInputs;
  $("ufile").onchange = async (e) => { const file = e.target.files[0]; if (!file) return;
    try { const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const cols = SCHEMA[$("utype").value].cols, have = Object.keys(rows[0] || {}).map((k) => k.trim().toLowerCase());
      const miss = cols.filter((k) => !have.includes(k));
      if (!rows.length || miss.length) { pending = []; drawPreview(); $("uerr").textContent = `This file does not match the template. Missing column(s): ${miss.join(", ") || "no rows found"}.`; return; }
      pending = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v]))); drawPreview();
    } catch { $("uerr").textContent = "Could not read this file. Use the CSV template or an Excel file."; } };
  $("addRow").onclick = () => { const r = {}; $("manual").querySelectorAll("input").forEach((i) => (r[i.dataset.k] = i.value)); pending.push(r); drawPreview(); };
  $("preview").oninput = (e) => { const i = e.target.dataset.i; if (i != null) pending[i][e.target.dataset.k] = e.target.value; };
  $("confirm").onclick = async () => { const t = $("utype").value, { errs, out } = validate(t, pending);
    if (errs.length) { $("uerr").textContent = errs.join("\n"); return; }
    await saveUpload(t, out); $("dlg").close(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
}

(async function () {
  [D, GEO, HOSP] = await Promise.all(["data/site.json", "data/districts.geojson", "data/hospitals.json"].map((u) => fetch(u).then((r) => r.json())));
  await loadState(); setupUpload(); renderProof();
  $("adm").oninput = $("share").oninput = () => renderPlan(context());
  render();
})();
