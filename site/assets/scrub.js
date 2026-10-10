// DOM control room · lane: signal. The hover readout on EVERY chart of the app (a crosshair and the week's own figures).
// Loaded after vendor/chart.umd.min.js and BEFORE assets/app.js, so it applies to each chart the app creates and re-creates.
// It changes no data: the readout prints what the chart itself holds (its labels, its datasets, its axis title, and the
// team's own tooltip lines where they wrote them). One div.readout sits just above each chart's box (.chartbox).
(function () {
  if (typeof Chart === "undefined") return;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"], INK = "18,32,58";
  const date = (iso) => new Date(iso + "T00:00:00Z"), dmy = (iso) => date(iso).getUTCDate() + " " + MON[date(iso).getUTCMonth()] + " " + date(iso).getUTCFullYear();
  const plus = (iso, days) => { const d = date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const monday = (y, w) => { const d = new Date(Date.UTC(y, 0, 4)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (w - 1) * 7); return d.toISOString().slice(0, 10); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => v != null && v !== "" && Number.isFinite(+v);
  // whole numbers as they are, anything else to one decimal (the app's own f1)
  const fmt = (v) => { v = +v; return Number.isInteger(v) ? v.toLocaleString("en-GB") : (Math.round(v * 10) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  const solid = (c) => (typeof c === "string" && c !== "transparent" && !/,\s*0\s*\)$/.test(c) ? c : null), at = (v, i) => (Array.isArray(v) ? v[i] : v);
  const colour = (ds, i) => (ds.showLine === false ? solid(at(ds.pointBackgroundColor, i)) || solid(at(ds.backgroundColor, i)) || solid(ds.borderColor) : solid(ds.borderColor) || solid(at(ds.backgroundColor, i)));
  // a series name without its long bracket; a one-word bracket ("(public)") and a "not ..." caveat stay. The full name is the pair's title.
  const short = (t) => { const m = String(t || "").match(/^(.*?)\s*\(([^)]*)\)\s*$/); return !m ? String(t || "") : !/\s/.test(m[2]) ? m[0].trim() : /^not\s/.test(m[2]) ? `${m[1]} (${m[2].split(":")[0]})` : m[1]; };
  // a week label as a date: "2025-09-08" and "2025-W37" become "Week of 8 Sept 2025"; anything else is printed as the chart has it
  function nice(raw) { const s = raw == null ? "" : String(raw); let m;
    if ((m = s.match(/^(\d{4}-\d{2}-\d{2})(.*)$/))) return "Week of " + dmy(m[1]) + m[2];
    if ((m = s.match(/^(\d{4})-W(\d{1,2})(.*)$/))) return "Week of " + dmy(monday(+m[1], +m[2])) + m[3];
    if ((m = s.match(/^(\d{4})-(\d{2})$/)) && +m[2] >= 1 && +m[2] <= 12) return MON[+m[2] - 1] + " " + m[1];
    return s; }
  // What only the chart's author could know. obs: the datasets that hold reported weeks (the readout rests on the newest of them).
  // main: which dataset gives the large value, in order. weeks: the Monday of each label, the same dates the first screen prints.
  const HINT = {
    chart: { obs: [0, 1, 2], legend: false, levels: false, weeks: (ch) => { if (typeof context !== "function" || !window.Room) return null;
      const hist = Room.starts(context().series).slice(-60), out = hist.slice(), n = ch.data.labels.length; let last = hist[hist.length - 1];
      while (out.length < n) { last = last ? plus(last, 7) : null; out.push(last); } return out; } },
    evChart: { obs: [0], main: [0, 2, 3], rows: ["That week", "The four weeks after"] },
  };
  const isLine = (ch) => ch && ch.config.type === "line" && ch.scales && ch.scales.x && ch.data && Array.isArray(ch.data.labels) && ch.canvas;
  const S = (ch) => ch.$scrub || (ch.$scrub = { idx: null, live: false, key: false, cache: new Map(), info: null });

  // facts about the chart, worked out once after each update
  function info(ch) { const st = S(ch); if (st.info) return st.info;
    const own = (((ch.config.options || {}).plugins || {}).tooltip) || {}, ys = ch.options.scales && ch.options.scales.y, yt = ys && ys.title && typeof ys.title.text === "string" ? ys.title.text : "", pct = /^%\s*/.test(yt);
    const sets = ch.data.datasets.map((ds) => { let first = -1, prev = null, same = true, n = 0;
      (ds.data || []).forEach((v, i) => { if (!num(v)) return; if (first < 0) first = i; if (n && +v !== prev) same = false; prev = +v; n++; }); return { first, constant: same && n > 2 }; });
    const hint = HINT[ch.canvas.id] || {}, cbk = own.callbacks && own.callbacks.label;
    // more than five pairs can never share one row: that chart's readout grows instead of clipping
    const many = ch.data.datasets.filter((ds, di) => ch.isDatasetVisible(di) && (cbk || ds.label) && !(hint.levels === false && sets[di].constant)).length - 1 > 5;
    return (st.info = { many, hint, cb: own.callbacks && own.callbacks.label, filter: own.filter, yt, pct, sets, weeks: undefined, rest: undefined }); }

  // what the chart holds at one week: one entry for each series that has a value there
  function entries(ch, i) { const st = S(ch); if (st.cache.has(i)) return st.cache.get(i);
    const I = info(ch), D = ch.data, out = [], seen = [];
    D.datasets.forEach((ds, di) => { if (!ch.isDatasetVisible(di)) return; const v = ds.data[i]; if (!num(v)) return;
      const meta = ch.getDatasetMeta(di), el = meta.data[i], item = { chart: ch, label: D.labels[i], parsed: { x: i, y: +v }, raw: v, formattedValue: fmt(v), dataset: ds, datasetIndex: di, dataIndex: i, element: el };
      // where a projection is joined to the reported line it repeats that week's value: the join is not a second reading
      const join = I.sets[di].first === i && seen.some((q) => Math.abs(q - +v) < 1e-9); seen.push(+v);
      let line = null;
      try { if (I.filter && !I.filter(item, di, [], D)) return;
        if (I.cb) { const r = I.cb.call(ch.tooltip || ch, item); line = Array.isArray(r) ? r.join(" ") : r == null ? "" : String(r); if (!line) return; } } catch (e) { return; }
      if (!I.cb && !ds.label) return; if (join) return;
      if (I.hint.levels === false && I.sets[di].constant) return;   // level lines the page already prints beside the chart
      const band = ds.fill === "+1" && !solid(ds.borderColor), lo = band && D.datasets[di + 1] ? D.datasets[di + 1].data[i] : null;
      out.push({ di, v: +v, ds, line, band, lo: num(lo) ? +lo : null, col: colour(ds, i), el, mark: ds.showLine === false }); });
    st.cache.set(i, out); return out; }
  // the series whose value is printed large: the author's order, else the heaviest drawn line that is not a level line
  function mainOf(ch, E) { const I = info(ch); if (!E.length) return null;
    if (I.hint.main) for (const di of I.hint.main) { const e = E.find((x) => x.di === di); if (e) return e; }
    let best = null; E.forEach((e) => { if (e.mark || e.band || I.sets[e.di].constant) return; if (!best || (+e.ds.borderWidth || 3) > (+best.ds.borderWidth || 3)) best = e; });
    return best || E.find((e) => !e.mark && !e.band) || E[0]; }
  // where the readout rests: the newest week that has reported data
  function restOf(ch) { const I = info(ch); if (I.rest !== undefined) return I.rest; const D = ch.data.datasets, n = ch.data.labels.length;
    const obs = I.hint.obs ? I.hint.obs.filter((di) => D[di]) : D.map((_, di) => di).filter((di) => { const ds = D[di]; return ds.label && ds.showLine !== false && !(ds.borderDash && ds.borderDash.length) && solid(ds.borderColor) && !I.sets[di].constant && ch.isDatasetVisible(di); });
    let r = null; for (let i = n - 1; i >= 0 && r == null; i--) if (obs.some((di) => num(D[di].data[i])) && entries(ch, i).length) r = i;
    for (let i = n - 1; i >= 0 && r == null; i--) if (entries(ch, i).length) r = i;
    return (I.rest = r); }
  const snap = (ch, i) => { const n = ch.data.labels.length; for (let d = 0; d < n; d++) { if (i - d >= 0 && entries(ch, i - d).length) return i - d; if (i + d < n && entries(ch, i + d).length) return i + d; } return null; };
  function weekOf(ch, i) { const I = info(ch), raw = ch.data.labels[i];
    if (I.hint.weeks) { try { if (I.weeks === undefined) I.weeks = I.hint.weeks(ch) || null; if (I.weeks && I.weeks[i]) return "Week of " + dmy(I.weeks[i]) + (/\(today\)/.test(String(raw)) ? " (today)" : ""); } catch (e) { I.weeks = null; } }
    return nice(raw); }

  // ---------- the readout: one div just above the chart's box, made once for each box and found again when the chart is re-created ----------
  function ensure(ch) { const cv = ch.canvas, box = cv && cv.parentNode; if (!box || !box.parentNode) return null;
    let ro = box._ro; if (!ro) { const p = box.previousElementSibling; ro = p && p.classList.contains("readout") ? p : null; }
    if (!ro) { ro = document.createElement("div"); ro.className = "readout"; ro.innerHTML = '<span class="k"></span><b class="v"></b><span class="s"></span>'; }
    box._ro = ro; if (ro.nextElementSibling !== box) box.before(ro); wire(cv); return ro; }
  function paint(ch) { const st = S(ch), ro = ensure(ch); if (!ro) return; const I = info(ch), i = st.idx, k = ro.children[0], v = ro.children[1], s = ro.children[2];
    if (i == null) { k.textContent = "No data"; v.textContent = "–"; s.textContent = ""; return; }
    const E = entries(ch, i), m = mainOf(ch, E), u = I.pct ? "%" : ""; let big = "–", lead = "";
    if (m && m.line != null) { const raw = String(m.v); if (m.line.startsWith(raw)) { big = raw; lead = m.line.slice(raw.length).trim(); } else { big = fmt(m.v) + u; lead = m.line; } }   // the team's own tooltip line
    else if (m) { big = fmt(m.v) + u; lead = short(m.ds.label); }
    const key = (e) => `<i style="background:${esc(e.col || "transparent")}"></i>`, tip = (e) => esc(e.ds.label || "");
    ro.classList.toggle("many", I.many); ro.classList.toggle("lines", !!I.cb);
    k.innerHTML = esc(weekOf(ch, i)) + (I.yt ? `<span class="ax"> · ${esc(I.yt)}</span>` : ""); v.textContent = big;   // the week, and what is counted (the chart's own axis title)
    // the author's two tooltip lines for a reported week, each on its own row under a short label
    const R = I.hint.rows; if (R && I.cb && E[0] && E[0].di === 0 && E.length <= R.length && E.every((e, j) => e.di === j)) { s.innerHTML = E.map((e, j) => `<span class="r"><em>${esc(R[j])}</em>${key(e)}<span class="n">${esc(e.line)}</span></span>`).join(""); return; }
    s.innerHTML = (m ? `<span class="p" title="${tip(m)}">${key(m)}<span class="n">${esc(lead)}</span></span>` : "") + E.filter((e) => e !== m).map((e) => `<span class="p" title="${tip(e)}">${key(e)}<span class="n">${e.line != null ? esc(e.line) : esc(short(e.ds.label))}</span>${e.line != null ? ""
      : "<b>" + (e.band && e.lo != null ? fmt(Math.min(e.lo, e.v)) + u + " to " + fmt(Math.max(e.lo, e.v)) + u : fmt(e.v) + u) + "</b>"}</span>`).join(""); }
  function go(ch, i, live) { const st = S(ch); if (st.idx === i && st.live === live) return false; st.idx = i; st.live = live; paint(ch); return true; }

  // the canvas: left and right arrows step week by week when it has focus; a finger moves the crosshair sideways, the page still scrolls up and down
  function wire(cv) { if (cv._scrub) return; cv._scrub = true; cv.tabIndex = 0; cv.style.touchAction = "pan-y";
    if (!cv.getAttribute("aria-label")) cv.setAttribute("aria-label", "Chart. Move across it, or use the left and right arrow keys, to read each week above it.");
    cv.addEventListener("keydown", (ev) => { const ch = Chart.getChart(cv), d = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0; if (!d || !isLine(ch) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      ev.preventDefault(); ev.stopPropagation(); const st = S(ch), n = ch.data.labels.length; let i = st.idx == null ? restOf(ch) : st.idx + d;
      while (i != null && i >= 0 && i < n && !entries(ch, i).length) i += d; if (i == null || i < 0 || i >= n) return; st.key = true; if (go(ch, i, true)) ch.render(); });
    cv.addEventListener("blur", () => { const ch = Chart.getChart(cv); if (!isLine(ch) || !S(ch).key) return; S(ch).key = false; if (go(ch, restOf(ch), false)) ch.render(); }); }

  Chart.defaults.interaction.mode = "index"; Chart.defaults.interaction.intersect = false;   // a week is picked by where the pointer is across the chart, not by touching a point
  Chart.defaults.plugins.tooltip.enabled = false;                                              // the readout replaces the floating box
  Chart.register({ id: "scrub",
    beforeInit(ch) { const h = HINT[ch.canvas && ch.canvas.id]; if (!h || h.legend !== false) return;   // this chart's key is listed under the chart by assets/pages/signal.js, so its seven entries cannot squeeze the plot
      const o = ch.config.options; if (!o) return; o.plugins = o.plugins || {}; o.plugins.legend = o.plugins.legend || {}; o.plugins.legend.display = false; },
    afterUpdate(ch) { if (!isLine(ch)) return; const st = S(ch), n = ch.data.labels.length; st.cache.clear(); st.info = null;
      if (!st.live || st.idx == null || st.idx >= n || !entries(ch, st.idx).length) { st.idx = restOf(ch); st.live = false; } paint(ch); },
    afterDatasetsDraw(ch) { const st = ch.$scrub; if (!st || st.idx == null || !isLine(ch)) return; const a = ch.chartArea, x = ch.scales.x.getPixelForValue(st.idx), g = ch.ctx; if (!(x >= a.left - 1 && x <= a.right + 1)) return;
      const X = Math.round(x) + 0.5; g.save(); g.setLineDash([]); g.lineWidth = 1; g.strokeStyle = `rgba(${INK},${st.live ? 0.6 : 0.22})`; g.beginPath(); g.moveTo(X, a.top); g.lineTo(X, a.bottom); g.stroke();
      for (const e of entries(ch, st.idx)) { if (e.mark || e.band || !e.col || !e.el || !Number.isFinite(e.el.y) || e.el.y < a.top - 1 || e.el.y > a.bottom + 1) continue;
        g.beginPath(); g.arc(x, e.el.y, 4.5, 0, 6.2832); g.fillStyle = e.col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke(); }
      g.restore(); },
    afterEvent(ch, args) { if (!isLine(ch)) return; const e = args.event, st = S(ch);
      if (e.type === "mouseout") { if (!st.key && go(ch, restOf(ch), false)) args.changed = true; return; }
      if (e.type !== "mousemove" && e.type !== "touchstart" && e.type !== "touchmove" && e.type !== "click") return;
      const n = ch.data.labels.length, v = ch.scales.x.getValueForPixel(e.x); if (!Number.isFinite(v) || !n) return;
      const i = snap(ch, Math.max(0, Math.min(n - 1, Math.round(v)))); st.key = false; if (i != null && go(ch, i, true)) args.changed = true; },
  });
})();
