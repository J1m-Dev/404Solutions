// FluSentinel model arithmetic. Mirrors pipeline/core.py; pipeline/parity.py checks they agree.
(function (root) {
  const elogit = (pos, n) => Math.log((pos + 0.5) / (n - pos + 0.5));
  const inv = (y) => 100 / (1 + Math.exp(-y));
  const pct = (s) => (100 * s.pos) / s.n;
  const weekAfter = (week, h) => ((week - 1 + h) % 52) + 1;

  function feat(y, s, targetWeek, nLags, nHarm) {
    const f = [1];
    for (let k = 0; k < nLags; k++) f.push(y[s - k]);
    for (let k = 1; k <= nHarm; k++) {
      const a = (2 * Math.PI * k * targetWeek) / 52;
      f.push(Math.sin(a), Math.cos(a));
    }
    return f;
  }

  // Forecast horizons 1..8 from the newest week in `series`, using exported coefficients.
  function forecast(series, modelSet, cfg) {
    const y = series.map((s) => elogit(s.pos, s.n));
    const t = y.length - 1;
    const out = {};
    for (let h = 1; h <= 8; h++) {
      const m = modelSet[String(h)];
      const f = feat(y, t, weekAfter(series[t].week, h), cfg.n_lags, cfg.n_harm);
      const yh = f.reduce((a, v, i) => a + v * m.beta[i], 0);
      out[h] = {
        model: inv(yh),
        baseline: inv(y[t]),
        lo: inv(y[t] + m.qp[0]),
        hi: inv(y[t] + m.qp[1]),
      };
    }
    return out;
  }

  // Horizons counted from the newest data week: today, then four weeks beyond.
  function aheadHorizons(lag) {
    const hs = [];
    for (let h = Math.max(lag, 1); h < lag + 5; h++) if (h <= 8) hs.push(h);
    return hs;
  }

  function alertLevel(pLast, ahead, th) {
    const peak = Math.max(...ahead);
    if (pLast > th.orange && ahead[ahead.length - 1] >= 0.8 * pLast) return "red";
    if (peak > th.orange || pLast > th.orange) return "orange";
    if (peak > th.yellow || pLast > th.yellow) return "yellow";
    return "green";
  }

  function assess(series, modelSet, cfg, th, lag) {
    const fc = forecast(series, modelSet, cfg);
    const last = series[series.length - 1];
    const pLast = pct(last);
    const hs = aheadHorizons(lag);
    let ahead = hs.map((h) => fc[h].model);
    if (lag === 0) ahead = [pLast].concat(ahead);
    const level = alertLevel(pLast, ahead, th);

    const recent = series.slice(-4);
    const sum = (k) => recent.reduce((a, s) => a + (s[k] || 0), 0);
    const typed = sum("h3") + sum("h1") + sum("b");
    const shares = { "A(H3)": sum("h3"), "A(H1N1)": sum("h1"), "B": sum("b") };
    let wave = "Mixed", waveShare = 0;
    for (const k in shares) {
      const sh = typed ? shares[k] / typed : 0;
      if (sh > 0.6) { wave = k; waveShare = sh; }
    }
    const p2 = pct(series[series.length - 3]);
    let phase = "steady";
    if (pLast > p2 * 1.15) phase = "rising";
    else if (pLast < p2 * 0.85) phase = "easing";
    else if (pLast > th.yellow) phase = "at a high level";

    const ns = series.slice(-27, -1).map((s) => s.n).sort((a, b) => a - b);
    const medN = ns[Math.floor(ns.length / 2)];
    const dataWarning = last.n < 0.5 * medN;

    return { fc, level, pLast, ahead, hs, wave, waveShare, phase, dataWarning, medN, last, p2, lag };
  }

  // Gradient-boosted "rapid rise within 4 weeks" classifier, exported from Python as decision stumps.
  function riseSignal(series, cls) {
    const y = series.map((s) => Math.log1p(s.pos)), i = y.length - 1;
    let m = 0; for (let k = i - 7; k <= i; k++) m += y[k] / 8;
    const w = weekAfter(Math.min(series[i].week, 52), 2); // week 53 counts as 52, as in pipeline/dengue.py prep()
    const x = [y[i], y[i] - y[i - 1], y[i - 1] - y[i - 2], y[i] - y[i - 3], y[i] - m];
    for (const k of [1, 2]) { const a = (2 * Math.PI * k * w) / 52; x.push(Math.sin(a), Math.cos(a)); }
    // Each stump adds lr times one leaf value to the log-odds score; `by` keeps that share per input group.
    const names = cls.inputs || x.map((_, f) => "input_" + f), by = {};
    for (const k of names) by[k] = 0;
    let z = cls.init;
    for (const [f, th, l, r] of cls.stumps) { const v = cls.lr * (x[f] <= th ? l : r); z += v; by[names[f]] += v; }
    const p = 1 / (1 + Math.exp(-z));
    const t = cls.tiers || { warning: 0.5, watch: 0.5 };
    const band = p >= t.warning ? "warning" : p >= t.watch ? "watch" : "clear";
    const parts = Object.keys(by).map((key) => ({ key, value: by[key] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { prob: p, yes: p >= 0.5, band, parts, base: cls.init, score: z };
  }

  // Rebuilds the current uploaded data from the upload history, skipping uploads that were undone
  // and entries of any other type (they are not uploaded data).
  function reduceLog(log) {
    const s = { lab: [], ili: [], clusters: [], beds: [], clusterlist: [], own: false, stamp: null };
    for (const e of log) {
      if (e.undone || !Array.isArray(s[e.type]) || !Array.isArray(e.rows)) continue;
      if (e.type === "lab" && e.own) { s.lab = e.rows.slice(); s.own = true; }
      else if (e.type === "beds" || e.type === "clusterlist") s[e.type] = e.rows.slice();
      else s[e.type] = s[e.type].concat(e.rows);
      s.stamp = e.at;
    }
    return s;
  }

  const api = { elogit, inv, pct, weekAfter, forecast, aheadHorizons, alertLevel, assess, riseSignal, reduceLog };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FluModel = api;
})(typeof window !== "undefined" ? window : globalThis);
