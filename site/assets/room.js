// DOM control room: the shell around the team's app.
// This file only decides what is shown where: the pages, the rail, and the first screen. It computes no result of its own.
// Every figure it shows is read from app.js (context(), LEVELS, ACTIONS, D, STATE) and model.js, which are loaded unchanged.
// The replay button feeds the team's own replay file through the team's own validate() and saveUpload(), one week per press.
(function () {
  const root = document.documentElement, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const date = (iso) => new Date(iso + "T00:00:00Z"), dm = (iso) => date(iso).getUTCDate() + " " + MONTHS[date(iso).getUTCMonth()], dmy = (iso) => dm(iso) + " " + date(iso).getUTCFullYear();
  const plus = (iso, days) => { const d = date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const COL = { green: "--green", yellow: "--yellow", orange: "--orange", red: "--red" };
  const REPLAY_FILE = "templates/demo_real_replay_2025_W38_W41.csv", BARS = 44;
  let replayRows = null, fresh = 0, lastCount = -1;

  // ---------- pages ----------
  const pages = [...document.querySelectorAll(".page")].map((p) => p.dataset.page);
  function show(id) {
    if (!pages.includes(id)) id = "now";
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.dataset.page === id));
    document.querySelectorAll(".rail a[data-go]").forEach((a) => a.classList.toggle("on", a.dataset.go === id));
    root.dataset.page = id; scrollTo(0, 0); $("sheet").hidden = true;
    // charts and the map were laid out off screen; let them take their real size now
    requestAnimationFrame(() => { if (typeof map !== "undefined" && map) map.invalidateSize(); dispatchEvent(new Event("resize")); });
  }
  // routes are written "#/forecast", so the browser never jumps to the app's own sections of the same name;
  // a plain "#proof" link inside the app's text still opens the right page
  const route = () => { const id = location.hash.replace(/^#\/?/, ""); if (location.hash && !location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search + "#/" + id); show(id); };
  addEventListener("hashchange", route);
  $("atlasTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
    $("atlasTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("#p-atlas .sub").forEach((s) => s.classList.toggle("on", s.dataset.sub === b.dataset.sub));
    requestAnimationFrame(() => { if (typeof map !== "undefined" && map) map.invalidateSize(); dispatchEvent(new Event("resize")); }); });

  // ---------- the first screen ----------
  const FRACTIONS = [[1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [1, 3], [2, 5], [1, 2], [3, 5], [2, 3], [3, 4], [4, 5], [9, 10]];
  const inWords = (p) => { const f = FRACTIONS.reduce((b, x) => (Math.abs(x[0] / x[1] - p) < Math.abs(b[0] / b[1] - p) ? x : b)); return `About ${f[0]} in ${f[1]}`; };
  function roll(el, to) {
    const from = +el.textContent || 0, t0 = performance.now(); if (STILL || from === to || !el._seen) { el.textContent = to; el._seen = true; return; }   // the first number appears at once; later changes count up or down
    clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = to), 1200);
    (function f(t) { const k = clamp((t - t0) / 1000, 0, 1), e = 1 - Math.pow(1 - k, 4); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); })(t0);
  }
  // the Monday each week of the series starts on: public weeks carry it, newer weeks follow on
  function starts(series) { const out = []; series.forEach((s, i) => out.push(s.start || (i ? plus(out[i - 1], 7) : null))); return out; }

  function update() {
    const c = context(), a = c.a, iso = starts(c.series), lastIso = iso[iso.length - 1], early = !a.dataWarning && a.level === "green" && c.rise.yes;
    root.dataset.state = early ? "early" : a.level;
    $("lvl").textContent = "Alert level: " + a.level[0].toUpperCase() + a.level.slice(1); $("lvl").style.setProperty("--c", css(COL[a.level]));
    $("flag").hidden = !(c.sim || c.own || c.uploaded);
    $("flag").textContent = c.sim ? `Simulation on: the newest ${c.nSim} week${c.nSim > 1 ? "s are" : " is"} invented` : c.own ? "Your own uploaded series, not verified" : REPLAY ? "Replay of real weeks" : "Includes uploaded weeks, not verified";
    $("head").textContent = a.dataWarning ? "Check the newest data first." : early ? "Early sign of a rapid rise." : LEVELS[a.level].head + ".";
    $("label").textContent = "Chance that flu positives rise by half within four weeks, " + (c.own ? "your own lab network" : "Malaysia");
    roll($("pct"), Math.round(c.rise.prob * 100));
    const when = lastIso ? `<b>${dmy(lastIso)}</b>` : `<b>${wk(a.last)}</b>`;
    $("basis").innerHTML = `${inWords(c.rise.prob)}. ` + (c.sim ? `A what-if scenario, not a reading: it runs to ${when}.`
      : REPLAY ? `Replay: an estimate from real national data to ${when}.`
      : `An estimate from ${c.own ? "your uploaded series" : "national data"} to ${when}` + (c.lag > 0 ? `, about ${c.lag} week${c.lag > 1 ? "s" : ""} behind.` : ", current to this week."));
    $("first").textContent = ACTIONS[a.level][0][0] + ".";
    // replay controls
    const n = STATE.lab.length, total = replayRows ? replayRows.length : 4;
    $("rpGo").textContent = REPLAY ? (n < total ? "Add the next real week" : "Replay finished") : "Replay October 2025"; $("rpGo").disabled = REPLAY && n >= total;
    $("rpAgain").hidden = !(REPLAY && n > 0); $("rpLeave").hidden = !REPLAY;
    $("strip").hidden = !REPLAY;
    if (REPLAY) { fresh = lastCount >= 0 && n > lastCount ? n - lastCount : 0; lastCount = n; bars(c, iso); }
    icons(c);
    // the data-status line matters on the first screen only when something unusual is on (uploads or a simulation)
    $("stamp").classList.toggle("quiet", !(c.sim || STATE.stamp));
  }

  // In the replay: the week the classifier first said "likely", and the weeks the alert level first reached Yellow and Orange.
  function milestones() {
    const base = D.series.slice(0, D.replay_cut_index + 1), m = {};
    for (let k = 0; k <= STATE.lab.length; k++) { const ser = base.concat(STATE.lab.slice(0, k)), lag = Math.max(0, D.pub_lag - k), a = M.assess(ser, D.models.replay, D, D.thresholds, lag), iso = plus(base[base.length - 1].start, 7 * k);
      if (!m.signal && M.riseSignal(ser, D.rise.replay).yes) m.signal = iso; if (!m.yellow && a.level !== "green") m.yellow = iso; if (!m.orange && (a.level === "orange" || a.level === "red")) m.orange = iso; }
    return m;
  }
  function bars(c, iso) {
    const ser = c.series.slice(-BARS), d = iso.slice(-BARS), vals = ser.map(M.pct), top = Math.max(c.th.orange * 1.25, ...vals), h = (v) => (100 * v) / top, ms = c.own ? {} : milestones(), days = (x, y) => Math.round((date(y) - date(x)) / 864e5);
    $("bars").innerHTML = vals.map((v, i) => `<i class="${v >= c.th.orange ? "o" : v >= c.th.yellow ? "y" : ""}${i === vals.length - 1 ? " now" : ""}${i >= vals.length - fresh ? " new" : ""}${d[i] === ms.signal ? " sig" : ""}" style="height:${h(v)}%" title="Week of ${d[i] ? dmy(d[i]) : wk(ser[i])}: ${f1(v)}%"></i>`).join("") +
      `<u style="bottom:${h(c.th.orange)}%;--k:${css("--orange")}"><b>Alert line ${f1(c.th.orange)}%</b></u><u style="bottom:${h(c.th.yellow)}%;--k:${css("--yellow")}"><b>Watch line ${f1(c.th.yellow)}%</b></u>`;
    $("bars").setAttribute("aria-label", `Weekly flu positivity, last ${vals.length} weeks; newest ${f1(vals[vals.length - 1])}%`);
    $("stripNote").innerHTML = ms.signal ? `<b>First signal: ${dm(ms.signal)}.</b>` + (ms.yellow && ms.yellow > ms.signal ? ` Level Yellow on ${dm(ms.yellow)}: the signal came <b>${days(ms.signal, ms.yellow)} days earlier</b>.` : " The alert level is still Green.") + (ms.orange ? ` Orange on ${dm(ms.orange)}.` : "") : "Each bar is one real week: the share of flu tests that came back positive.";
  }

  async function replayFile() {
    if (!replayRows) { const wb = XLSX.read(await (await fetch(REPLAY_FILE)).text(), { type: "string" }); replayRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }); }
    return replayRows;
  }
  $("rpGo").onclick = async () => {
    if (!REPLAY) { location.href = "dashboard.html?replay=1#/now"; return; }
    const rows = await replayFile(), k = STATE.lab.length; if (k >= rows.length) return;
    const { errs, out } = validate("lab", [rows[k]]);
    if (errs.length) { $("stripNote").textContent = errs.join(" "); return; }
    const msg = await saveUpload("lab", out); render(); if (msg) $("stripNote").textContent = msg + " Enter a passcode on the Data page.";
  };
  $("rpAgain").onclick = () => resetState();
  $("rpLeave").onclick = () => { location.href = "dashboard.html#/now"; };
  $("whyBtn").onclick = () => { $("sheet").hidden = false; }; $("sheetX").onclick = () => { $("sheet").hidden = true; };
  addEventListener("keydown", (e) => { if (e.key === "Escape") $("sheet").hidden = true; if (e.key === "ArrowRight" && REPLAY && root.dataset.page === "now" && !e.target.closest("input,select,textarea")) $("rpGo").click(); });

  // ---------- the rail: each page is a small live picture ----------
  let myPath = "", dgPath = "";
  const spark = (v, x0, x1, y0, y1) => { const mx = Math.max(...v), mn = Math.min(...v); return v.map((y, i) => (i ? "L" : "M") + (x0 + (i * (x1 - x0)) / (v.length - 1)).toFixed(1) + " " + (y1 - ((y - mn) / (mx - mn || 1)) * (y1 - y0)).toFixed(1)).join(""); };
  function icons(c) {
    const C = 2 * Math.PI * 15, p = clamp(c.rise.prob, 0, 1), sun = css("--sun"), set = (id, h) => { const el = $("ic-" + id); if (el && el._h !== h) { el.innerHTML = h; el._h = h; } };
    set("now", `<circle cx="22" cy="22" r="15" opacity=".3"/><circle cx="22" cy="22" r="15" stroke="${sun}" stroke-width="3.2" stroke-dasharray="${C * p} ${C}" transform="rotate(-90 22 22)"/><text x="22" y="26.5" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" stroke="none">${Math.round(p * 100)}</text>`);
    const v = c.series.slice(-26).map(M.pct), mx = Math.max(...v), mn = Math.min(...v);
    set("forecast", `<path d="${spark(v, 5, 39, 12, 34)}"/><circle cx="39" cy="${(34 - ((v[v.length - 1] - mn) / (mx - mn || 1)) * 22).toFixed(1)}" r="2.6" fill="${sun}" stroke="none"/>`);
    set("sim", `<path d="M8 13h28M8 22h28M8 31h28" opacity=".45"/><circle cx="${SIM.on ? 28 : 16}" cy="13" r="3.6" fill="${SIM.on ? sun : "#fff"}" stroke="none"/><circle cx="27" cy="22" r="3.6" fill="#fff" stroke="none"/><circle cx="19" cy="31" r="3.6" fill="#fff" stroke="none"/>`);
    if (!myPath && typeof STGEO !== "undefined" && STGEO) { const x0 = 99.5, x1 = 119.5, y0 = 0.7, y1 = 7.6;
      myPath = STGEO.features.map((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => { const r = poly[0]; if (r.length < 30) return ""; const st = Math.max(1, Math.floor(r.length / 60));
        return "M" + r.filter((_, i) => i % st === 0).map(([x, y]) => (2 + ((x - x0) / (x1 - x0)) * 40).toFixed(1) + " " + (14 + ((y1 - y) / (y1 - y0)) * 15).toFixed(1)).join("L") + "Z"; }).join("")).join(""); }
    set("atlas", `<path d="${myPath}" stroke="none" fill="#fff"/><circle cx="6.5" cy="24.5" r="2.2" fill="${css("--mark")}" stroke="none"/>`);
    if (!dgPath && typeof DENGUE !== "undefined" && DENGUE) dgPath = spark(DENGUE.series.slice(-104).filter((_, i) => i % 4 === 0).map((r) => r[1]), 5, 39, 12, 34);
    set("dengue", `<path d="${dgPath}" stroke-dasharray="1 4.2" stroke-width="2.6"/>`);
    const T = D.rise.test.models.gradient_boosted, n = T.tp + T.fn;
    set("proof", Array.from({ length: n }, (_, i) => `<circle cx="${6 + (i % 8) * 4.6}" cy="${10 + Math.floor(i / 8) * 5.4}" r="1.7" stroke="none" fill="${i < T.tp ? sun : "rgba(255,255,255,.35)"}"/>`).join(""));
    set("history", `<path d="M22 28V11M15 17l7-7 7 7M9 30v5h26v-5"/>${STATE.lab.length ? `<circle cx="35" cy="11" r="4" fill="${sun}" stroke="none"/>` : ""}`);
    set("stakes", `<circle cx="22" cy="15" r="6"/><path d="M10 36c1-8 6-11 12-11s11 3 12 11"/>`);
  }

  // ---------- the background lines: steady atmosphere, not a signal ----------
  (function contours() {
    const cv = $("contours"), g = cv.getContext("2d"); let w, h, t = 0, last = performance.now();
    const size = () => { const r = Math.min(2, devicePixelRatio || 1); w = innerWidth; h = innerHeight; cv.width = w * r; cv.height = h * r; g.setTransform(r, 0, 0, r, 0, 0); }; size(); addEventListener("resize", size);
    (function draw(now) {
      const dt = Math.min(50, now - last); last = now; t += dt * 0.0002;
      g.clearRect(0, 0, w, h); const cx = w * 0.74, cy = h * 0.5, R = Math.hypot(w, h) * 0.085, acc = css("--acc");
      for (let i = 1; i <= 9; i++) { g.beginPath();
        for (let k = 0; k <= 96; k++) { const th = (k / 96) * Math.PI * 2, r = R * i * (1 + 0.065 * Math.sin(3 * th + t * 6 + i * 0.5) + 0.04 * Math.sin(5 * th - t * 4 + i * 0.9)), x = cx + r * 1.35 * Math.cos(th), y = cy + r * 0.8 * Math.sin(th); k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.strokeStyle = i <= 3 ? acc : "#fff"; g.globalAlpha = (i <= 3 ? 0.3 : 0.14) * (1 - i / 14) + 0.012; g.lineWidth = 1.2; g.stroke(); }
      g.globalAlpha = 1; if (!STILL) requestAnimationFrame(draw);
    })(last);
  })();

  // ---------- join the team's render loop: after every render of theirs, refresh the first screen ----------
  const theirs = window.render;
  window.render = function () { const r = theirs.apply(this, arguments); try { update(); } catch (e) { console.error(e); } return r; };
  if (REPLAY) replayFile();
  route();
})();
