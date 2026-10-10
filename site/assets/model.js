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

  const api = { elogit, inv, pct, weekAfter, forecast, aheadHorizons, alertLevel, assess };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FluModel = api;
})(typeof window !== "undefined" ? window : globalThis);
