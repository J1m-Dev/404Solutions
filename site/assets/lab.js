// DOM control room, trial page: two directions for the first screen over the same data and model as dashboard.html.
// Every number comes from data/site.json, data/facilities.json, data/states_map.geojson and assets/model.js.
(function () {
  const M = window.FluModel, $ = (id) => document.getElementById(id), root = document.documentElement;
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1), clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const date = (iso) => new Date(iso + "T00:00:00Z"), dm = (iso) => date(iso).getUTCDate() + " " + MONTHS[date(iso).getUTCMonth()], dmy = (iso) => dm(iso) + " " + date(iso).getUTCFullYear();
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim(), pct = (s) => (100 * s.pos) / s.n;
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const LEVELS = {
    green: { name: "Green", col: "--green", head: "No outbreak trend.", sub: "Routine surveillance." },
    yellow: { name: "Yellow", col: "--yellow", head: "Possible outbreak trend. Watch.", sub: "Above the watch line, or expected to cross it." },
    orange: { name: "Orange", col: "--orange", head: "Outbreak trend detected.", sub: "At, or expected to reach, the alert line within four weeks." },
    red: { name: "Red", col: "--red", head: "Surge under way.", sub: "The newest data is already above the alert line." },
  };
  const ACTIONS = {
    green: ["Continue routine sentinel surveillance", "State health department"],
    yellow: ["Remind schools to report pupils with symptoms to the district health office", "District health offices, schools"],
    orange: ["Start school-cluster response and vaccination outreach in the top-ranked districts", "State and district health offices"],
    red: ["Open surge beds and fast-track respiratory clinics", "State health department, hospitals"],
  };
  const REPLAY_WEEKS = 6, BARS = 44;
  let D, FAC, GEO;
  const S = { mode: "live", added: [], fresh: -1, marks: {} };

  function ctx() {
    const replay = S.mode === "replay", base = replay ? D.series.slice(0, D.replay_cut_index + 1) : D.series, key = replay ? "replay" : "current";
    const series = base.concat(S.added), lag = Math.max(0, D.pub_lag - S.added.length);
    return { replay, base, series, lag, th: D.thresholds, a: M.assess(series, D.models[key], D, D.thresholds, lag), rise: M.riseSignal(series, D.rise[key]) };
  }
  function roll(el, to) {
    const from = +el.textContent || 0, t0 = performance.now(); if (STILL) { el.textContent = to; return; }
    clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = to), 1200);
    (function f(t) { const k = clamp((t - t0) / 1000, 0, 1), e = 1 - Math.pow(1 - k, 4); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  // ---------- the reading ----------
  let energy = 0.17;   // how lively the contour lines are; follows the chance of a rapid rise
  function render() {
    const c = ctx(), a = c.a, lastIso = c.series[c.series.length - 1].start, L = LEVELS[a.level], p = c.rise.prob * 100;
    const early = !a.dataWarning && a.level === "green" && c.rise.yes;
    root.dataset.state = early ? "early" : a.level; energy = c.rise.prob;
    $("fresh").innerHTML = c.replay ? `<b>Replay</b> · real data to <b>${dmy(lastIso)}</b>` : `Public data to <b>${dmy(lastIso)}</b> · about ${D.pub_lag} weeks behind`;
    $("lvl").textContent = "Level: " + L.name; $("lvl").style.setProperty("--c", css(L.col));
    roll($("pct"), Math.round(p));
    $("head").textContent = a.dataWarning ? "Check the newest data first." : early ? "Early sign of a rapid rise." : L.head;
    $("sub").textContent = a.dataWarning ? `Only ${a.last.n} samples were tested in the newest week, under half the usual ${a.medN}.` : early ? "The alert level is still Green, but the machine-learning signal says a rise is likely." : L.sub;
    const act = early ? ACTIONS.yellow : ACTIONS[a.level];
    $("first").textContent = act[0] + "."; $("who").textContent = (early ? "The Yellow step, taken early. " : "") + "Who acts: " + act[1];
    const T = D.rise.test.models.gradient_boosted;
    $("why").innerHTML = [`<b>${f1(a.pLast)}%</b> of flu tests were positive in the week of ${dm(lastIso)}, ${a.phase} from ${f1(a.p2)}% two weeks before.`,
      c.lag > 0 ? `That data is <b>${c.lag} week${c.lag > 1 ? "s" : ""} old</b>, so today's level is an estimate.` : `The data is <b>current to this week</b>, so the level is observed.`,
      `Highest level expected in the coming weeks: <b>${f1(Math.max(...a.ahead))}%</b>. Watch line ${f1(c.th.yellow)}%, alert line ${f1(c.th.orange)}%.`,
      a.wave === "Mixed" ? "No single virus type dominates." : `${a.wave} makes up ${Math.round(a.waveShare * 100)}% of typed positives.`].map((w) => `<li>${w}</li>`).join("");
    $("proofLine").textContent = `The percentage is a machine-learning estimate. On ${D.rise.test.n_test} unseen weeks it caught ${T.tp} of ${T.tp + T.fn} rises, with ${T.fp} false alarms: modest evidence, because such rises were common in those weeks.`;
    renderRail(c);
    const left = REPLAY_WEEKS - S.added.length;
    $("rpGo").textContent = c.replay ? (left ? "Add the next real week" : "Replay finished") : "Replay October 2025"; $("rpGo").disabled = c.replay && !left; $("rpLeave").hidden = !c.replay;
    const ms = c.replay ? milestones() : {}; S.marks = ms;
    $("stripNote").innerHTML = c.replay ? (ms.signal ? `<b>First signal: ${dm(ms.signal)}.</b>` + (ms.yellow && ms.yellow > ms.signal ? ` Level Yellow on ${dm(ms.yellow)}: the signal came <b>${days(ms.signal, ms.yellow)} days earlier</b>.` : " The alert level is still Green.") + (ms.orange ? ` Orange on ${dm(ms.orange)}.` : "") : `Week ${S.added.length} of ${REPLAY_WEEKS} added.`) : `Each bar is one week: the share of flu tests that came back positive. See it catch last year's surge.`;
    renderBars(c);
    $("stageNote").textContent = `One national signal covers every state: no state-by-state flu data is published. Point at a state to see its hospitals and clinics.`;
  }

  // In the replay: the week the model first said "likely", and the weeks the alert level first reached Yellow and Orange.
  function milestones() {
    const base = D.series.slice(0, D.replay_cut_index + 1), m = {};
    for (let k = 0; k <= S.added.length; k++) { const ser = base.concat(S.added.slice(0, k)), lag = Math.max(0, D.pub_lag - k), a = M.assess(ser, D.models.replay, D, D.thresholds, lag), iso = ser[ser.length - 1].start;
      if (!m.signal && M.riseSignal(ser, D.rise.replay).yes) m.signal = iso; if (!m.yellow && a.level !== "green") m.yellow = iso; if (!m.orange && (a.level === "orange" || a.level === "red")) m.orange = iso; }
    return m;
  }
  const days = (a, b) => Math.round((date(b) - date(a)) / 864e5);

  // ---------- the weeks behind the number ----------
  function renderBars(c) {
    const ser = c.series.slice(-BARS), vals = ser.map(pct), top = Math.max(c.th.orange * 1.25, ...vals), h = (v) => (100 * v) / top;
    $("bars").innerHTML = vals.map((v, i) => `<i class="${v >= c.th.orange ? "o" : v >= c.th.yellow ? "y" : ""}${i === vals.length - 1 ? " now" : ""}${i >= vals.length - S.fresh ? " new" : ""}${S.marks && ser[i].start === S.marks.signal ? " sig" : ""}" style="height:${h(v)}%" title="Week of ${dmy(ser[i].start)}: ${f1(v)}%"></i>`).join("") +
      `<u style="bottom:${h(c.th.orange)}%;--k:${css("--orange")}"><b>Alert line ${f1(c.th.orange)}%</b></u><u style="bottom:${h(c.th.yellow)}%;--k:${css("--yellow")}"><b>Watch line ${f1(c.th.yellow)}%</b></u>`;
    $("bars").setAttribute("aria-label", `Weekly flu positivity for the last ${vals.length} weeks; newest ${f1(vals[vals.length - 1])}%`);
    S.fresh = 0;
  }

  // ---------- navigation: each page is a small live picture ----------
  let myPath = "";
  function renderRail(c) {
    const C = 2 * Math.PI * 15, p = clamp(c.rise.prob, 0, 1), sun = css("--sun");
    $("icNow").innerHTML = `<circle cx="22" cy="22" r="15" opacity=".3"/><circle cx="22" cy="22" r="15" stroke="${sun}" stroke-width="3.2" stroke-dasharray="${C * p} ${C}" transform="rotate(-90 22 22)"/><text x="22" y="26.500" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" stroke="none">${Math.round(p * 100)}</text>`;
    const v = c.series.slice(-26).map(pct), mx = Math.max(...v), mn = Math.min(...v);
    $("icFc").innerHTML = `<path d="${v.map((y, i) => (i ? "L" : "M") + (5 + (i * 34) / 25).toFixed(1) + " " + (34 - ((y - mn) / (mx - mn || 1)) * 22).toFixed(1)).join("")}"/><circle cx="39" cy="${(34 - ((v[25] - mn) / (mx - mn || 1)) * 22).toFixed(1)}" r="2.6" fill="${sun}" stroke="none"/>`;
    $("icMap").innerHTML = `<path d="${myPath}" transform="translate(0 12)" stroke-width="1" fill="rgba(255,255,255,.55)"/><circle cx="6.500" cy="25" r="2.4" fill="${css("--mark")}" stroke="none"/>`;
    const T = D.rise.test.models.gradient_boosted, n = T.tp + T.fn, cols = 8;
    $("icProof").innerHTML = Array.from({ length: n }, (_, i) => `<circle cx="${6 + (i % cols) * 4.6}" cy="${10 + Math.floor(i / cols) * 5.4}" r="1.7" stroke="none" fill="${i < T.tp ? sun : "rgba(255,255,255,.35)"}"/>`).join("");
    $("icData").innerHTML = `<path d="M22 28V11M15 17l7-7 7 7M9 30v5h26v-5"/>`;
  }

  // ---------- direction 2: the country is the stage ----------
  function setupMap() {
    const x0 = 99.5, x1 = 119.5, y0 = 0.7, y1 = 7.6, P = ([x, y], w, h, pad) => [(pad + ((x - x0) / (x1 - x0)) * (w - 2 * pad)).toFixed(1), (pad + ((y1 - y) / (y1 - y0)) * (h - 2 * pad)).toFixed(1)];
    const path = (f, w, h, pad, keep) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => { const r = poly[0]; if (r.length < keep) return ""; const st = Math.max(1, Math.floor(r.length / 220)); return "M" + r.filter((_, i) => i % st === 0).map((q) => P(q, w, h, pad).join(" ")).join("L") + "Z"; }).join("");
    const by = {}; for (const f of FAC) { const s = (by[f.state] = by[f.state] || { government: 0, private: 0, clinic: 0, beds: 0, withBeds: 0 }); s[f.kind]++; if (f.kind === "government" && f.beds) { s.beds += f.beds; s.withBeds++; } }
    $("states").innerHTML = GEO.features.map((f) => `<path data-n="${f.properties.name}" d="${path(f, 1000, 400, 6, 8)}"/>`).join("");
    myPath = GEO.features.map((f) => path(f, 44, 18, 1, 30)).join(" ");
    const card = $("stateCard"), show = (n) => { const s = by[n]; document.querySelectorAll("#states path").forEach((q) => q.classList.toggle("hot", q.dataset.n === n)); if (!n) { card.hidden = true; return; } card.hidden = false;
      card.innerHTML = `<b>${n}</b>` + (s ? `${s.government} public hospital${s.government === 1 ? "" : "s"}, ${s.private} private, ${s.clinic} health clinics.` + (s.withBeds ? `<br>${s.beds.toLocaleString()} beds in the ${s.withBeds} public hospital${s.withBeds === 1 ? "" : "s"} with a published figure.` : "") + `<br><small>Ministry of Health registry and bed file.</small>` : "No facilities listed."); };
    $("states").addEventListener("pointerover", (e) => e.target.dataset.n && show(e.target.dataset.n));
    $("states").addEventListener("click", (e) => e.target.dataset.n && show(e.target.dataset.n));
    $("states").addEventListener("pointerleave", () => show(null));
  }

  // ---------- the moving contour lines (they breathe faster as the chance rises) ----------
  function contours() {
    const cv = $("contours"), g = cv.getContext("2d"); let w, h, t = 0, last = performance.now(), e = energy;
    const size = () => { const r = Math.min(2, devicePixelRatio || 1); w = innerWidth; h = innerHeight; cv.width = w * r; cv.height = h * r; g.setTransform(r, 0, 0, r, 0, 0); }; size(); addEventListener("resize", size);
    (function draw(now) {
      const dt = Math.min(50, now - last); last = now; e += (energy - e) * 0.03; t += dt * (0.00012 + e * 0.0005);
      g.clearRect(0, 0, w, h); const map = root.dataset.dir === "map", cx = w * (map ? 0.62 : 0.3), cy = h * (map ? 0.42 : 0.5), R = Math.hypot(w, h) * 0.075, acc = css("--acc");
      for (let i = 1; i <= 15; i++) { const amp = 0.05 + e * 0.1; g.beginPath();
        for (let k = 0; k <= 96; k++) { const th = (k / 96) * Math.PI * 2, r = R * i * (1 + amp * Math.sin(3 * th + t * 6 + i * 0.5) + amp * 0.6 * Math.sin(5 * th - t * 4 + i * 0.9)), x = cx + r * 1.35 * Math.cos(th), y = cy + r * 0.8 * Math.sin(th); k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.strokeStyle = i <= 3 ? acc : "#fff"; g.globalAlpha = (i <= 3 ? 0.22 : 0.12) * (1 - i / 22) + e * 0.08; g.lineWidth = 1.2; g.stroke(); }
      g.globalAlpha = 1; if (!STILL) requestAnimationFrame(draw);
    })(last);
  }

  const sw = (id, key) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; root.dataset[key] = b.dataset.v; $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); try { sessionStorage.setItem("lab-" + key, b.dataset.v); } catch (err) {} });
  Promise.all(["data/site.json", "data/facilities.json", "data/states_map.geojson"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.json()))).then((r) => {
    D = r[0]; FAC = r[1].rows; GEO = r[2];
    for (const [id, key] of [["swDir", "dir"], ["swRoom", "room"]]) { sw(id, key); let v = new URLSearchParams(location.search).get(key); try { v = v || sessionStorage.getItem("lab-" + key); } catch (e) {} if (v) { root.dataset[key] = v; $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === v)); } }
    setupMap(); contours();
    $("rpGo").onclick = () => { if (S.mode !== "replay") { S.mode = "replay"; S.added = []; } else if (S.added.length < REPLAY_WEEKS) { S.added.push(D.series[D.replay_cut_index + 1 + S.added.length]); S.fresh = 1; } render(); };
    $("rpLeave").onclick = () => { S.mode = "live"; S.added = []; render(); };
    $("whyBtn").onclick = () => { $("sheet").hidden = false; }; $("sheetX").onclick = () => { $("sheet").hidden = true; };
    addEventListener("keydown", (e) => { if (e.key === "Escape") $("sheet").hidden = true; if (e.key === "ArrowRight" && S.mode === "replay") $("rpGo").click(); });
    const q = new URLSearchParams(location.search); if (q.get("replay")) { S.mode = "replay"; for (let i = 0; i < Math.min(REPLAY_WEEKS, +q.get("replay") - 1); i++) S.added.push(D.series[D.replay_cut_index + 1 + i]); }
    render();
  });
})();
