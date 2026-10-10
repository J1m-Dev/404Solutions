// DOM control room. A fresh front end over the same data files and model code as index.html:
// data/site.json, data/dengue.json, data/districts.geojson, data/hospitals.json, data/facilities.json and assets/model.js.
// Nothing here changes a number; it only decides what to show first and how.
(function () {
  const M = window.FluModel, $ = (id) => document.getElementById(id), root = document.documentElement;
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1), clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const date = (iso) => new Date(iso + "T00:00:00Z"), dm = (iso) => date(iso).getUTCDate() + " " + MONTHS[date(iso).getUTCMonth()], dmy = (iso) => dm(iso) + " " + date(iso).getUTCFullYear();
  const plus = (iso, days) => { const d = date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const isoWeek = (iso) => { const d = date(iso), day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(), j4 = new Date(Date.UTC(y, 0, 4)); return { year: y, week: 1 + Math.round(((d - j4) / 864e5 - 3 + ((j4.getUTCDay() + 6) % 7)) / 7) }; };
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  const pct = (s) => (100 * s.pos) / s.n;
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;

  const LEVELS = {
    green: { name: "Green", col: "--green", head: "No outbreak trend.", sub: "Routine surveillance." },
    yellow: { name: "Yellow", col: "--yellow", head: "Possible outbreak trend. Watch.", sub: "Above the watch line, or expected to cross it." },
    orange: { name: "Orange", col: "--orange", head: "Outbreak trend detected.", sub: "At, or expected to reach, the alert line within four weeks." },
    red: { name: "Red", col: "--red", head: "Surge under way.", sub: "The newest data is already above the alert line." },
  };
  const ACTIONS = {
    green: [["Continue routine sentinel surveillance", "State health department"]],
    yellow: [["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"], ["Check influenza vaccine and antiviral stock", "State health department"]],
    orange: [["Start school-cluster response and vaccination outreach in the top-ranked districts", "State and district health offices"], ["Hospitals review surge rosters and respiratory ward plans", "Hospital directors"]],
    red: [["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"], ["Issue a public advisory through official channels", "State health department"], ["Continue school-cluster response in all districts", "District health offices"]],
  };
  const BM = { green: "Tiada trend wabak", yellow: "Kemungkinan trend wabak: pantau", orange: "Trend wabak dikesan", red: "Trend wabak dikesan: lonjakan sedang berlaku" };
  const REPLAY_WEEKS = 6;

  let D, GEO, HOSP, HMETA, FAC, DEN, hover = null, districts = [];
  const S = { mode: "live", added: [], disease: "flu", view: "now", bm: false };

  // ---------- the reading ----------
  function ctx() {
    const replay = S.mode === "replay", base = replay ? D.series.slice(0, D.replay_cut_index + 1) : D.series, key = replay ? "replay" : "current";
    const series = base.concat(S.added), lag = Math.max(0, D.pub_lag - S.added.length);
    return { replay, base, series, lag, th: D.thresholds, a: M.assess(series, D.models[key], D, D.thresholds, lag), rise: M.riseSignal(series, D.rise[key]) };
  }
  function roll(el, to) { const from = +el.textContent || 0, t0 = performance.now(); if (STILL) { el.textContent = to; return; } clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = to), 900);   // a hidden tab pauses the animation; the number must still land
    (function f(t) { const k = clamp((t - t0) / 700, 0, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); })(t0); }
  function ring(p, col) { const C = 2 * Math.PI * 80; $("arc").style.strokeDasharray = `${(C * clamp(p, 0, 100)) / 100} ${C}`; $("arc").style.setProperty("--c", col); roll($("pct"), Math.round(p)); }

  // ---------- Now ----------
  function renderNow() {
    if (S.disease === "dengue") return renderDengueNow();
    const c = ctx(), a = c.a, last = a.last, lastIso = c.series[c.series.length - 1].start;
    $("fresh").innerHTML = c.replay ? `<b>Replay</b> · real data to ${dmy(lastIso)}` : `Public data to <b>${dmy(c.base[c.base.length - 1].start)}</b>, about ${D.pub_lag} weeks behind` + (S.added.length ? ` · <b>${S.added.length} week${S.added.length > 1 ? "s" : ""} added by you</b>` : "");
    const L = LEVELS[a.level], acts = a.dataWarning ? [["Verify the newest week's numbers before acting", "Whoever entered them"]].concat(ACTIONS[a.level]) : ACTIONS[a.level];
    $("lvl").textContent = "Level: " + L.name; $("lvl").style.setProperty("--c", css(L.col));
    const early = !a.dataWarning && a.level === "green" && c.rise.yes;   // the alert rule is still calm, but the trained model has fired
    $("head").textContent = a.dataWarning ? "Check the newest data first." : early ? "Early sign of a rapid rise." : L.head;
    $("sub").textContent = a.dataWarning ? `Only ${last.n} samples were tested in the newest week, under half the usual ${a.medN}. The rule would say: ${L.head}` : early ? "The alert level is still Green, but the machine-learning signal says a rise is likely." : L.sub;
    const T = D.rise.test.models.gradient_boosted, p = c.rise.prob * 100;
    $("cardChance").querySelector("h2").textContent = "Chance of a rapid rise";
    ring(p, css(p >= 50 ? "--orange" : p >= 25 ? "--yellow" : "--sky-2"));
    $("chanceLine").textContent = "that flu positives rise by half within four weeks";
    $("chanceProof").textContent = `Machine-learning estimate. On ${D.rise.test.n_test} unseen weeks it caught ${T.tp} of ${T.tp + T.fn} rises, with ${T.fp} false alarms.`;
    const why = [`<b>${f1(a.pLast)}%</b> of flu tests were positive in the week of ${dm(lastIso)}, ${a.phase} from ${f1(a.p2)}% two weeks before.`,
      c.lag > 0 ? `That data is <b>${c.lag} week${c.lag > 1 ? "s" : ""} old</b>, so today's level is an estimate.` : `The data is <b>current to this week</b>, so the level is observed.`,
      `Highest level expected in the coming weeks: <b>${f1(Math.max(...a.ahead))}%</b>. Watch line ${f1(c.th.yellow)}%, alert line ${f1(c.th.orange)}%.`,
      a.wave === "Mixed" ? "No single virus type dominates." : `${a.wave} makes up ${Math.round(a.waveShare * 100)}% of typed positives.`];
    $("why").innerHTML = why.map((w) => `<li>${w}</li>`).join("");
    $("lang").hidden = false; $("lang").textContent = S.bm ? "Hide the Malay summary" : "Baca dalam Bahasa Melayu";
    $("summary").hidden = !S.bm; $("summary").textContent = `${BM[a.level]}. Kadar positif sentinel ialah ${f1(a.pLast)}% pada minggu ${dm(lastIso)}, berbanding ${f1(a.p2)}% dua minggu sebelumnya; garis amaran ialah ${f1(c.th.orange)}%.`;
    $("cardDo").querySelector("h2").textContent = "Do first";
    $("first").textContent = acts[0][0] + "."; $("who").textContent = "Who acts: " + acts[0][1];
    $("then").innerHTML = acts.slice(1).map((r) => `<li>${r[0]} <span class="quiet">(${r[1]})</span></li>`).join("") + (early ? `<li>Because the rise signal has fired, consider the Yellow step early: ${ACTIONS.yellow[1][0].toLowerCase()}.</li>` : "");
    const left = REPLAY_WEEKS - S.added.length;
    $("replay").hidden = false;
    $("replay").innerHTML = c.replay
      ? `<b>Replay of real data, autumn 2025.</b><span>${S.added.length} of ${REPLAY_WEEKS} weeks added.</span><span class="sp"></span><button class="btn sun" id="rpN" ${left ? "" : "disabled"}>Add the next real week</button><button class="btn ghost" id="rpX">Leave replay</button>`
      : `<span>See it catch last year's surge, one real week at a time.</span><span class="sp"></span><button class="btn" id="rpS">Replay October 2025</button>`;
    if ($("rpN")) $("rpN").onclick = nextWeek; if ($("rpX")) $("rpX").onclick = () => setMode("live"); if ($("rpS")) $("rpS").onclick = () => setMode("replay");
  }
  // Dengue scores: only test weeks whose real value is known, and whichever model the data file names as best.
  const denF = () => DEN.forecast_measured || DEN.forecast, denGain = (f) => (f.best === "last_value" ? 0 : Math.round((1 - f.mae[f.best] / f.mae.last_value) * 100)), nice = (k) => k.replace(/_/g, " ");
  const weeksBehind = (iso) => Math.max(0, Math.round((date(D.generated) - date(iso)) / 6048e5));
  function renderDengueNow() {
    const F = denF(), f4 = F[F.length - 1], lastW = DEN.series[DEN.series.length - 1], ex = DEN.extrapolation, far = ex[ex.length - 1], ch = (far.cases / lastW[1] - 1) * 100, comp = DEN.composition;
    const rising = DEN.outbreak.find((o) => o.definition === "rising"), G = rising && rising.models.gradient_boosted;
    $("fresh").innerHTML = `Dengue data to <b>${dmy(lastW[0])}</b>, about ${weeksBehind(lastW[0])} weeks behind`;
    $("lvl").textContent = "No alert level yet"; $("lvl").style.setProperty("--c", "#fff");
    $("head").textContent = `Dengue: ${lastW[1].toLocaleString()} cases a week, ${ch > 5 ? "expected to rise" : ch < -5 ? "expected to ease" : "holding steady"}.`;
    $("sub").textContent = `National weekly count, projected to ${far.cases.toLocaleString()} by the week of ${dm(far.start)}.` + (comp ? ` Since ${date(DEN.rebuilt_from).getUTCFullYear()} the series is rebuilt from WHO situation reports; ${comp.estimated} of those ${comp.reported + comp.derived + comp.estimated} weeks are estimates.` : "");
    $("cardChance").querySelector("h2").textContent = "Smaller error than the simple guess";
    ring(denGain(f4), css("--green"));
    $("chanceLine").textContent = `${f4.weeks_ahead} weeks ahead, against "same as last week"`;
    $("chanceProof").textContent = `${nice(f4.best)}: average miss ${Math.round(f4.mae[f4.best])} cases a week against ${Math.round(f4.mae.last_value)}, on ${f4.n_test} unseen weeks whose real value is known.`;
    $("why").innerHTML = F.map((f) => `<li><b>${f.weeks_ahead} week${f.weeks_ahead > 1 ? "s" : ""} ahead:</b> ${f.best === "last_value" ? "no model beat the simple guess" : `missed by ${Math.round(f.mae[f.best])} cases, the simple guess by ${Math.round(f.mae.last_value)}`}.</li>`).join("");
    $("lang").hidden = true; $("summary").hidden = true;
    $("cardDo").querySelector("h2").textContent = "What is missing";
    $("first").textContent = "A dengue alert level."; $("who").textContent = G ? `The rise classifier caught only ${G.tp} of ${G.tp + G.fn} rises on unseen weeks (${G.fp} false alarms), too few to act on.` : "No dengue rise classifier has been tested.";
    $("then").innerHTML = `<li>Dengue is shown as a count and a short projection, not a verdict.</li>` + (DEN.missing_weeks ? `<li>Gap in the record: ${DEN.missing_weeks}.</li>` : "");
    $("replay").hidden = true;
  }

  // ---------- drawing helpers ----------
  function canvas(el) { const w = el.clientWidth, h = el.clientHeight, r = Math.min(2, devicePixelRatio || 1); el.width = w * r; el.height = h * r; const g = el.getContext("2d"); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h); g.lineJoin = g.lineCap = "round"; return { g, w, h }; }
  const text = (g, s, x, y, o = {}) => { g.font = `${o.w || 500} ${o.s || 12}px ${css("--sans")}`; g.textAlign = o.a || "left"; g.fillStyle = o.c || css("--mute"); g.fillText(s, x, y); };
  const legend = (id, items) => { $(id).innerHTML = items.map(([k, n, dot]) => `<span><i class="${dot ? "dot" : ""}" style="--k:${k}"></i>${n}</span>`).join(""); };

  // ---------- Forecast ----------
  function renderForecast() {
    if (S.disease === "dengue") return renderDengueChart();
    const c = ctx(), a = c.a, hist = c.series.slice(-52), n = hist.length, Hn = Math.min(8, c.lag + 4), { g, w, h } = canvas($("fc"));
    const ink = css("--ink"), line = css("--line"), L = 38, Rt = 14, T = 16, B = 30, total = n - 1 + Hn;
    const vals = hist.map(pct), fut = []; for (let i = 1; i <= Hn; i++) fut.push(a.fc[i]);
    const ymax = Math.ceil((Math.max(...vals, c.th.orange, ...fut.map((f) => f.hi)) + 4) / 10) * 10;
    const X = (i) => L + (i * (w - L - Rt)) / total, Y = (v) => T + (1 - v / ymax) * (h - T - B);
    g.lineWidth = 1; for (let v = 0; v <= ymax; v += 10) { g.strokeStyle = line; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rt, Y(v)); g.stroke(); text(g, v + "%", L - 8, Y(v) + 4, { a: "right" }); }
    for (let i = 0; i < n; i += 8) text(g, dm(hist[i].start), X(i), h - 8, { a: "center" });
    for (const [v, col, name] of [[c.th.yellow, css("--yellow"), "Watch line"], [c.th.orange, css("--orange"), "Alert line"]]) { g.setLineDash([6, 5]); g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rt, Y(v)); g.stroke(); g.setLineDash([]); text(g, name, L + 6, Y(v) - 6, { c: col, w: 600 }); }
    if (Hn) { g.fillStyle = "rgba(121,163,220,.28)"; g.beginPath(); g.moveTo(X(n - 1), Y(a.pLast)); fut.forEach((f, i) => g.lineTo(X(n + i), Y(f.hi))); for (let i = Hn - 1; i >= 0; i--) g.lineTo(X(n + i), Y(fut[i].lo)); g.closePath(); g.fill();
      g.setLineDash([7, 6]); g.strokeStyle = ink; g.globalAlpha = 0.7; g.lineWidth = 2; g.beginPath(); g.moveTo(X(n - 1), Y(a.pLast)); g.lineTo(X(total), Y(a.pLast)); g.stroke();
      g.setLineDash([2, 6]); g.strokeStyle = css("--sky-2"); g.globalAlpha = 1; g.lineWidth = 2.5; g.beginPath(); g.moveTo(X(n - 1), Y(a.pLast)); fut.forEach((f, i) => g.lineTo(X(n + i), Y(f.model))); g.stroke(); g.setLineDash([]); }
    g.strokeStyle = ink; g.lineWidth = 2.6; g.beginPath(); vals.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    const k = S.added.length; if (k) { g.strokeStyle = css("--mark"); g.lineWidth = 3.4; g.beginPath(); for (let i = n - 1 - k; i < n; i++) (i === n - 1 - k ? g.moveTo(X(i), Y(vals[i])) : g.lineTo(X(i), Y(vals[i]))); g.stroke(); }
    const tx = X(n - 1 + c.lag); g.strokeStyle = css("--sun"); g.lineWidth = 2; g.beginPath(); g.moveTo(tx, T); g.lineTo(tx, h - B); g.stroke(); text(g, "Today", tx + (c.lag ? -6 : -6), T + 12, { a: "right", c: ink, w: 700 });
    g.fillStyle = ink; g.beginPath(); g.arc(X(n - 1), Y(a.pLast), 4.5, 0, 7); g.fill();
    legend("fcLegend", [[ink, "Published"], [css("--mark"), "Added weeks"], [ink, "Same as last week"], [css("--sky-2"), "Model projection"], ["rgba(121,163,220,.6)", "Likely range"]].filter((x) => k || x[1] !== "Added weeks"));
    $("fcLead").textContent = `Share of flu tests that came back positive, Malaysia. ${c.lag ? `The newest data is ${c.lag} weeks old, so the stretch up to "Today" is already an estimate.` : "The data is current to this week."}`;
    $("fcNote").textContent = `Honest note: the model's projection did not beat "same as last week" in testing (see Proof), so the dashed line is the main forecast and the model is shown beside it.`;
  }
  function renderDengueChart() {
    const ser = DEN.series.slice(-156), ex = DEN.extrapolation, n = ser.length, total = n - 1 + ex.length, { g, w, h } = canvas($("fc"));
    const ink = css("--ink"), L = 46, Rt = 14, T = 16, B = 30, ymax = Math.ceil(Math.max(...ser.map((s) => s[1]), ...ex.map((e) => e.cases)) / 500) * 500;
    const X = (i) => L + (i * (w - L - Rt)) / total, Y = (v) => T + (1 - v / ymax) * (h - T - B);
    for (let v = 0; v <= ymax; v += 500) { g.strokeStyle = css("--line"); g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rt, Y(v)); g.stroke(); text(g, String(v), L - 8, Y(v) + 4, { a: "right" }); }
    for (let i = 0; i < n; i += 26) text(g, dmy(ser[i][0]).slice(-9), X(i), h - 8, { a: "center" });
    g.strokeStyle = ink; g.lineWidth = 2.4; g.beginPath(); ser.forEach((s, i) => (i ? g.lineTo(X(i), Y(s[1])) : g.moveTo(X(i), Y(s[1])))); g.stroke();
    const st = (DEN.status || []).slice(-156), anyEst = st.includes("estimated"); g.fillStyle = css("--mark"); st.forEach((v, i) => { if (v === "estimated") { g.beginPath(); g.arc(X(i), Y(ser[i][1]), 2.2, 0, 7); g.fill(); } });
    g.setLineDash([2, 6]); g.strokeStyle = css("--sky-2"); g.lineWidth = 2.5; g.beginPath(); g.moveTo(X(n - 1), Y(ser[n - 1][1])); ex.forEach((e, i) => g.lineTo(X(n + i), Y(e.cases))); g.stroke(); g.setLineDash([]);
    legend("fcLegend", [[ink, "Reported dengue cases a week"], [css("--mark"), "Estimated week", 1], [css("--sky-2"), "Model, four weeks beyond the data"]].filter((x) => anyEst || x[1] !== "Estimated week"));
    $("fcLead").textContent = `Weekly dengue cases, Malaysia, to ${dmy(ser[n - 1][0])}, about ${weeksBehind(ser[n - 1][0])} weeks behind today.`;
    $("fcNote").textContent = "The dotted stretch runs past the end of the data and cannot be checked yet." + (anyEst ? " Marked weeks are estimates: WHO published one total for several weeks and it was spread across them." : "");
  }

  // ---------- Map and the bed planner ----------
  function setupMap() {
    const tot = GEO.features.reduce((s, f) => s + f.properties.pop_thousand, 0);
    districts = GEO.features.map((f) => { const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]); let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
      rings.forEach((r) => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
      return { name: f.properties.name, pop: f.properties.pop_thousand, share: f.properties.pop_thousand / tot, cases: f.properties.published_cases_w42_2025, rings, box: [x0, y0, x1, y1], c: [(y0 + y1) / 2, (x0 + x1) / 2] }; });
  }
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  let proj = null;
  function renderMap() {
    const { g, w, h } = canvas($("mapc")), b = districts.reduce((a, d) => [Math.min(a[0], d.box[0]), Math.min(a[1], d.box[1]), Math.max(a[2], d.box[2]), Math.max(a[3], d.box[3])], [999, 999, -999, -999]);
    const kx = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180), pad = 14, sc = Math.min((w - 2 * pad) / ((b[2] - b[0]) * kx), (h - 2 * pad) / (b[3] - b[1]));
    const ox = (w - (b[2] - b[0]) * kx * sc) / 2, oy = (h - (b[3] - b[1]) * sc) / 2;
    const P = (lon, lat) => [ox + (lon - b[0]) * kx * sc, oy + (b[3] - lat) * sc]; proj = { ox, oy, kx, sc, b };
    const mx = Math.max(...districts.map((d) => d.share));
    for (const d of districts) { g.beginPath(); d.rings.forEach((r) => { r.forEach(([x, y], i) => { const q = P(x, y); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); });
      g.fillStyle = `rgba(52,87,154,${0.16 + 0.62 * (d.share / mx)})`; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = d === hover ? 3 : 1.4; g.stroke(); if (d === hover) { g.strokeStyle = css("--sun"); g.lineWidth = 2.5; g.stroke(); } }
    for (const f of FAC) { const q = P(f.lon, f.lat); g.beginPath(); g.arc(q[0], q[1], f.kind === "clinic" ? 2.4 : 4, 0, 7); g.fillStyle = f.kind === "clinic" ? "rgba(18,32,58,.5)" : f.kind === "private" ? css("--sky-3") : "#fff"; g.fill(); if (f.kind !== "clinic") { g.strokeStyle = css("--ink"); g.lineWidth = 1.2; g.stroke(); } }
    for (const hs of HOSP) { const q = P(hs.lon, hs.lat); g.beginPath(); g.arc(q[0], q[1], 6, 0, 7); g.fillStyle = css("--sun"); g.fill(); g.strokeStyle = css("--ink"); g.lineWidth = 1.6; g.stroke(); }
    for (const d of districts) { const q = P(d.c[1], d.c[0]); text(g, d.name, q[0], q[1] + 4, { a: "center", c: css("--ink"), w: 700, s: w < 420 ? 10 : 12 }); }
    legend("mapLegend", [["rgba(52,87,154,.75)", "More people live here"], [css("--sun"), "Hospital in the bed planner", 1], ["#fff", "Other public hospital", 1], [css("--sky-3"), "Private hospital", 1], ["rgba(18,32,58,.5)", "Clinic", 1]]);
  }
  function hit(e) {
    if (!proj) return null; const r = $("mapc").getBoundingClientRect(), lon = (e.clientX - r.left - proj.ox) / (proj.kx * proj.sc) + proj.b[0], lat = proj.b[3] - (e.clientY - r.top - proj.oy) / proj.sc;
    return districts.find((d) => d.rings.some((ring) => { let inn = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inn = !inn; } return inn; })) || null;
  }
  function renderPlan() {
    const c = ctx(), a = c.a, adm = +$("adm").value, share = +$("share").value / 100, occA = +$("occ").value / 100; $("admV").textContent = adm; $("shareV").textContent = Math.round(share * 100) + "%"; $("occV").textContent = Math.round(occA * 100) + "%";
    const est = c.lag === 0 ? a.pLast : a.fc[c.lag].model, mult = clamp(est / c.th.median, 0.3, 4), cap = HOSP.map((h) => ({ ...h, left: Math.floor(Math.round(h.beds * (1 - (h.occ != null ? Math.min(100, h.occ) / 100 : occA))) * share) }));
    let unmet = 0; const rows = districts.map((d) => ({ ...d, need: Math.round(adm * mult * d.share) })).sort((x, y) => y.need - x.need).map((d) => { let need = d.need; const got = [];
      for (const x of cap.map((h) => ({ h, d: km(d.c, [h.lat, h.lon]) })).sort((p, q) => p.d - q.d)) { if (!need) break; const take = Math.min(need, x.h.left); if (take > 0) { x.h.left -= take; need -= take; got.push(`${x.h.name.replace("Hospital ", "")} ${take}`); } }
      unmet += need; return `<tr><td>${d.name}</td><td class="n">${d.need}</td><td>${got.join(", ") || "none"}</td><td class="n ${need ? "no" : ""}">${need || ""}</td></tr>`; });
    $("plan").innerHTML = `<table><tr><th>District</th><th class="n">Need</th><th>Send to</th><th class="n">No bed</th></tr>${rows.join("")}</table>`;
    $("planNote").textContent = `${unmet} admissions have no bed in this scenario. Need = ${adm} usual admissions × ${f1(mult)} (today's estimated positivity ${f1(est)}% ÷ usual ${f1(c.th.median)}%), shared out by population. Room at a hospital = total beds × (1 − occupancy) × the share usable for flu. Bed totals: Ministry of Health bed file (updated ${HMETA.bed_file_updated}) for ${HMETA.counts.ministry + HMETA.counts.lookup} hospitals, estimated for ${HMETA.counts.estimated}. Occupancy is reported for ${HMETA.occupancy_reported.length} and assumed for the rest. An illustration, not a recommended allocation.`;
    if (hover) { $("dName").textContent = hover.name; const near = HOSP.map((h) => ({ h, d: km(hover.c, [h.lat, h.lon]) })).sort((p, q) => p.d - q.d).slice(0, 3);
      $("dInfo").textContent = `${hover.pop >= 1000 ? f1(hover.pop / 1000) + " million" : Math.round(hover.pop) + " thousand"} people (${Math.round(hover.share * 100)}% of Selangor).` + (hover.cases ? ` ${hover.cases} flu cases reported to week 42 of 2025.` : "") + ` Nearest: ${near.map((x) => `${x.h.name.replace("Hospital ", "")} ${Math.round(x.d)} km`).join(", ")}.`; }
    else { $("dName").textContent = "Move patients before wards fill"; $("dInfo").textContent = "Hover a district to see who lives there and its nearest hospitals."; }
  }

  // ---------- Proof ----------
  function renderProof() {
    const v = D.validation, T = D.rise.test, G = T.models.gradient_boosted, a4 = v.alerts.find((x) => x.lag === 4).surges[0], a0 = v.alerts.find((x) => x.lag === 0).surges[0], passed = v.per_horizon.filter((x) => x.passed).length;
    $("kpis").innerHTML = [[`${G.tp} of ${G.tp + G.fn}`, `rapid rises caught on ${T.n_test} unseen weeks, with ${G.fp} false alarms`], [a0.lead_weeks === 0 ? "Same week" : a0.lead_weeks + " weeks early", "the alert fired for the 2025 surge when given that week's data"], [`${-a4.lead_weeks} weeks late`, "on public data alone, because it arrives late"], [`${passed} of ${v.per_horizon.length}`, `flu-level forecasts beat "same as last week" under the fixed rule`]].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
    const names = { already_in_outbreak_now: "Simple rule: already rising", logistic_regression: "Logistic regression", gradient_boosted: "Gradient-boosted (used here)" };
    $("proofA").innerHTML = `<h2>Rapid-rise classifier: will positives rise by half within four weeks?</h2><table><tr><th>Method</th><th class="n">Caught</th><th class="n">Missed</th><th class="n">False alarms</th></tr>${Object.keys(names).map((k) => { const m = T.models[k]; return `<tr><td>${names[k]}</td><td class="n">${m.tp}</td><td class="n">${m.fn}</td><td class="n">${m.fp}</td></tr>`; }).join("")}</table>
      <p class="quiet">${T.test_outbreak_weeks} of ${T.n_test} unseen weeks were followed by such a rise, so this kind of rise is common. Treat it as modest evidence.</p>
      <h2>Forecast of the flu level</h2><table><tr><th>Weeks ahead</th><th class="n">Model miss</th><th class="n">"Same as last week" miss</th><th>Result</th></tr>${v.per_horizon.map((x) => `<tr><td>${x.h}</td><td class="n">${f1(x.mae_model)}</td><td class="n">${f1(x.mae_persist)}</td><td class="${x.passed ? "ok" : "no"}">${x.passed ? "Pass" : "Fail"}</td></tr>`).join("")}</table>
      <p class="quiet">Misses are in percentage points of positivity. The level forecast failed its own test, so the dashboard shows "same as last week" as the main forecast.</p>`;
    $("proofB").innerHTML = `<h2>Dengue: weekly cases, tested on ${date(DEN.test_start).getUTCFullYear()} to ${date(DEN.test_end).getUTCFullYear()}</h2><table><tr><th>Weeks ahead</th><th>Best method</th><th class="n">Its miss</th><th class="n">"Same as last week" miss</th><th class="n">Better by</th></tr>${denF().map((f) => `<tr><td>${f.weeks_ahead}</td><td>${nice(f.best)}</td><td class="n">${Math.round(f.mae[f.best])}</td><td class="n">${Math.round(f.mae.last_value)}</td><td class="n ${denGain(f) ? "ok" : "no"}">${denGain(f)}%</td></tr>`).join("")}</table>
      <p class="quiet">Misses are cases a week; test weeks averaged about ${Math.round(denF()[0].mean_actual)} cases.${DEN.forecast_measured ? " Only weeks whose real value is known are scored; estimated weeks are left out because they would flatter any model." : ""}${DEN.earlier_result ? " " + DEN.earlier_result + " The run to 2026 was done afterwards and is extra evidence, not a result fixed in advance." : ""}</p>
      <h2>What this cannot tell you</h2><ul class="why"><li>Flu activity district by district. No public data exists for it.</li><li>Real hospital capacity, unless a hospital uploads it.</li><li>Case counts for flu. Positivity is a share of tested samples.</li><li>Whether added figures are correct. They are yours to check.</li></ul>`;
  }

  // ---------- Data: the replay and your own numbers ----------
  function renderData() {
    const rp = S.mode === "replay", left = REPLAY_WEEKS - S.added.length, c = ctx();
    $("rpStart").textContent = rp ? "Leave the replay" : "Start the replay"; $("rpNext").disabled = !rp || !left;
    $("rpState").textContent = rp ? `Showing real data to ${dmy(c.series[c.series.length - 1].start)}. ${S.added.length} of ${REPLAY_WEEKS} weeks added.` : "Not replaying. The dashboard shows today's public data.";
    if (!rp) $("upState").textContent = S.added.length ? `${S.added.length} week${S.added.length > 1 ? "s" : ""} added, to ${dmy(c.series[c.series.length - 1].start)}.` : `Next expected: week ${isoWeek(plus(c.series[c.series.length - 1].start, 7)).week} of ${isoWeek(plus(c.series[c.series.length - 1].start, 7)).year}.`;
  }
  function nextWeek() { if (S.mode !== "replay" || S.added.length >= REPLAY_WEEKS) return; S.added.push(D.series[D.replay_cut_index + 1 + S.added.length]); render(); }
  function setMode(m) { S.mode = m; S.added = m === "live" ? stored() : []; if (m === "replay") { S.disease = "flu"; seg(); } render(); }
  const stored = () => { try { return JSON.parse(localStorage.getItem("dom_added") || "[]"); } catch (e) { return []; } };
  function upload(file) {
    if (!file) return; if (S.mode === "replay") { $("upState").textContent = "Leave the replay first."; return; }
    file.text().then((t) => { const rows = t.trim().split(/\r?\n/).map((l) => l.split(",").map((x) => x.trim())), head = rows[0].map((x) => x.toLowerCase()), ix = (k) => head.indexOf(k);
      if (["year", "week", "samples_tested", "influenza_positive"].some((k) => ix(k) < 0)) { $("upState").textContent = "This file does not match the template: it needs year, week, samples_tested and influenza_positive."; return; }
      const out = S.added.slice(); let prev = D.series.concat(out).slice(-1)[0].start;
      for (const r of rows.slice(1)) { const y = +r[ix("year")], wkn = +r[ix("week")], n = +r[ix("samples_tested")], pos = +r[ix("influenza_positive")], st = plus(prev, 7), exp = isoWeek(st);
        if (![y, wkn, n, pos].every(Number.isInteger) || n <= 0 || pos < 0 || pos > n) { $("upState").textContent = `Row for week ${r[ix("week")]}: counts must be whole numbers, with positives between 0 and samples tested.`; return; }
        if (y !== exp.year || wkn !== exp.week) { $("upState").textContent = `Expected week ${exp.week} of ${exp.year} next, but the file has week ${wkn} of ${y}.`; return; }
        const num = (k) => (ix(k) >= 0 && Number.isFinite(+r[ix(k)]) ? Math.max(0, +r[ix(k)]) : 0);
        out.push({ year: y, week: wkn, start: st, source: "UPLOADED", n, pos, h3: num("a_h3"), h1: num("a_h1n1"), b: num("b") }); prev = st; }
      S.added = out; try { localStorage.setItem("dom_added", JSON.stringify(out)); } catch (e) {} render(); });
  }

  // ---------- views ----------
  const VIEWS = { now: renderNow, forecast: renderForecast, map: () => { renderMap(); renderPlan(); }, proof: renderProof, data: renderData };
  function render() { renderNow(); if (S.view !== "now") VIEWS[S.view](); }
  function show(v) { if (!VIEWS[v]) v = "now"; S.view = v; document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + v)); document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === v)); history.replaceState(null, "", "#" + v); render(); scrollTo(0, 0); }
  const seg = () => document.querySelectorAll("#disease button").forEach((b) => b.classList.toggle("on", b.dataset.d === S.disease));

  Promise.all(["data/site.json", "data/districts.geojson", "data/hospitals.json", "data/facilities.json", "data/dengue.json"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json()))).then((r) => {
    [D, GEO, , , DEN] = r; HOSP = r[2].rows; HMETA = r[2].meta; FAC = r[3].rows.filter((f) => f.state === "Selangor"); S.added = stored(); setupMap();
    $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.view); });
    $("disease").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.disease = b.dataset.d; if (S.disease === "dengue" && S.mode === "replay") { S.mode = "live"; S.added = stored(); } seg(); render(); });
    $("lang").onclick = () => { S.bm = !S.bm; renderNow(); };
    $("adm").oninput = $("share").oninput = $("occ").oninput = renderPlan;
    $("mapc").addEventListener("pointermove", (e) => { const d = hit(e); if (d !== hover) { hover = d; renderMap(); renderPlan(); } });
    $("mapc").addEventListener("pointerleave", () => { if (hover) { hover = null; renderMap(); renderPlan(); } });
    $("rpStart").onclick = () => setMode(S.mode === "replay" ? "live" : "replay"); $("rpNext").onclick = nextWeek;
    $("reset").onclick = () => { try { localStorage.removeItem("dom_added"); } catch (e) {} if (S.mode === "live") S.added = []; $("upState").textContent = ""; render(); };
    $("file").onchange = (e) => upload(e.target.files[0]);
    const dz = $("drop"); ["dragover", "dragenter"].forEach((n) => dz.addEventListener(n, (e) => { e.preventDefault(); dz.classList.add("over"); })); ["dragleave", "drop"].forEach((n) => dz.addEventListener(n, (e) => { e.preventDefault(); dz.classList.remove("over"); })); dz.addEventListener("drop", (e) => upload(e.dataTransfer.files[0]));
    let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 120); });
    if (new URLSearchParams(location.search).get("replay") === "1") S.mode = "replay", (S.added = []);
    show(location.hash.slice(1) || "now");
  });
})();
