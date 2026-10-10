// DOM control room: the one living object on the first screen.
// A single field of dots, the same material as the Earth on the landing page. What the dots form is the treatment:
//   a = the Earth from the landing page, close on Malaysia   b = the signal (the weekly curve as a horizon)   c = the ladder (four steps of light)
//   d = the Earth for today's reading, and the signal while the replay runs (one becomes the other; never both at once)
// It draws only what room.js hands it in a "room:update" event: the app's own weekly values, alert lines, step and wording.
// It computes no result of its own.
(function () {
  const cv = document.getElementById("stage"); if (!cv) return;
  const g = cv.getContext("2d"), root = document.documentElement, tip = document.getElementById("stageTip");
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const TEMPO = [5200, 3600, 2400, 1500];          // one breath, in ms: Clear, Watch, Warning, Outbreak. The rhythm quickens as the step rises.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const day = (iso) => { const d = new Date(iso + "T00:00:00Z"); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3), mix = (a, b, k) => a + (b - a) * k;
  const SANS = '-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif';
  let W = 0, H = 0, x0 = 0, S = null, mys = null, land = null, acc = [255, 255, 255], accAt = 0;
  const RAD = Math.PI / 180, vec = ([lon, lat]) => { const l = lon * RAD, q = lat * RAD; return [Math.cos(q) * Math.sin(l), Math.sin(q), Math.cos(q) * Math.cos(l)]; };
  const grid = []; for (let la = -60; la <= 60; la += 20) { const l = []; for (let lo = 0; lo <= 360; lo += 6) l.push(vec([lo, la])); grid.push(l); }
  for (let lo = 0; lo < 360; lo += 20) { const l = []; for (let la = -90; la <= 90; la += 6) l.push(vec([lo, la])); grid.push(l); }
  const tilt = { x: 0, y: 0 };
  let stepK = 0, dim = 1, arrive = 0, arrivedAt = 0, slide = 0, slideAt = 0, breathAt = performance.now(), phase = 0, last = performance.now();
  const ptr = { x: -9999, y: -9999, cx: -9999, cy: -9999, k: 0, on: false }; let box = { left: 0, top: 0 };

  function size() { const r = Math.min(2, devicePixelRatio || 1), b = cv.getBoundingClientRect(); W = b.width || innerWidth; H = b.height || innerHeight; cv.width = W * r; cv.height = H * r; g.setTransform(r, 0, 0, r, 0, 0);
    const m = document.querySelector("main"); x0 = m ? m.getBoundingClientRect().left - b.left : 0; }
  const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
  function readAcc(now) { if (now - accAt < 120) return; accAt = now; const m = getComputedStyle(root).getPropertyValue("--acc").match(/[\d.]+/g) || [];
    if (m.length >= 3) acc = m.slice(0, 3).map(Number); else { const h = getComputedStyle(root).getPropertyValue("--acc").trim().replace("#", ""); if (h.length === 6) acc = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); } }
  const WARM = { y: [255, 207, 74], o: [255, 138, 72], r: [255, 106, 90] };

  addEventListener("room:update", (e) => { const d = e.detail, first = !S;
    if (S && d.vals.length && d.fresh > 0 && !STILL) { slide = 1; slideAt = performance.now(); }
    S = d; if (first) { arrivedAt = performance.now(); stepK = Math.max(0, d.step); } });
  addEventListener("pointermove", (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = true; }, { passive: true });
  document.addEventListener("pointerleave", () => { ptr.on = false; });
  addEventListener("blur", () => { ptr.on = false; });
  addEventListener("resize", size); size();
  fetch("data/dots.json").then((r) => r.json()).then((d) => { mys = d.malaysia.map(vec); land = d.land.map(vec); }).catch(() => {});

  // one dot; near the pointer it swells and brightens, and settles when the pointer moves on
  function dot(x, y, r, c, a) { const dx = x - ptr.cx, dy = y - ptr.cy, q = ptr.k * Math.max(0, 1 - (dx * dx + dy * dy) / 12100);
    g.fillStyle = rgb(c, clamp(a + q * 0.5, 0, 1) * dim); g.beginPath(); g.arc(x, y, r * (1 + q * 0.7), 0, 6.2832); g.fill(); }

  // ---------- a: the Earth from the landing page, close on Malaysia ----------
  // The same lit body, grid and beads as landing.js. Malaysia's beads carry the step: its colour, and a breath at the step's tempo.
  function earth(now) {
    if (!land) return; const phone = W < 760, R = phone ? H * 0.66 : Math.min(H * 0.56, (W - x0) * 0.4), x = phone ? W * 0.62 : W - R * 0.58, y = phone ? H * 0.6 : H * 0.57, k = ease(arrive);
    tilt.x += ((ptr.on ? clamp(ptr.cx / W - 0.5, -0.6, 0.6) * 7 : 0) - tilt.x) * 0.05; tilt.y += ((ptr.on ? clamp(0.5 - ptr.cy / H, -0.6, 0.6) * 5 : 0) - tilt.y) * 0.05;
    const lon0 = (122 + (STILL ? 0 : 4 * Math.sin(now / 5200)) + tilt.x + (1 - k) * 26) * RAD, lat0 = (6 + tilt.y) * RAD, sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0);
    const pr = (v) => { const X = v[0] * cl - v[2] * sl, Z0 = v[0] * sl + v[2] * cl; return [X, v[1] * cp - Z0 * sp, v[1] * sp + Z0 * cp]; };
    const warm = clamp(stepK / 3, 0, 1), br = 0.5 + 0.5 * Math.sin(phase), beat = slide > 0 ? Math.sin((1 - slide) * Math.PI) : 0, A = dim * k;
    // light behind the Earth: it warms a little with the step, the way the scene on the landing page warms where risk is rising
    let gr = g.createRadialGradient(x, y, R * 0.9, x, y, R * 1.5 + 40); const hc = [mix(226, acc[0], warm * 0.16), mix(238, acc[1], warm * 0.16), mix(252, acc[2], warm * 0.16)];
    gr.addColorStop(0, rgb(hc, (0.34 + 0.1 * br * warm + 0.12 * beat) * A)); gr.addColorStop(1, rgb(hc, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, R * 1.5 + 40, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(x, y, R, 0, 7); g.clip(); g.globalAlpha = A;
    gr = g.createRadialGradient(x - R * 0.42, y - R * 0.5, R * 0.05, x, y, R * 1.08); gr.addColorStop(0, "#8f9cb3"); gr.addColorStop(0.45, "#5f6c85"); gr.addColorStop(0.85, "#3e4960"); gr.addColorStop(1, "#303a4f"); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
    gr = g.createLinearGradient(x - R * 0.6, y - R * 0.7, x + R * 0.7, y + R * 0.8); gr.addColorStop(0.35, "rgba(10,16,30,0)"); gr.addColorStop(1, "rgba(10,16,30,.46)"); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
    gr = g.createRadialGradient(x - R * 0.4, y - R * 0.5, 0, x - R * 0.4, y - R * 0.5, R * 0.62); gr.addColorStop(0, "rgba(255,255,255,.28)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
    g.restore(); g.globalAlpha = 1;
    g.strokeStyle = rgb([255, 255, 255], 0.1 * A); g.lineWidth = 1; g.beginPath();
    for (const ln of grid) { let pen = false; for (const v of ln) { const q = pr(v); if (q[2] > 0) { const px = x + q[0] * R, py = y - q[1] * R; pen ? g.lineTo(px, py) : g.moveTo(px, py); pen = true; } else pen = false; } } g.stroke();
    const sz = clamp(R * 0.0078, 1.2, 4.2);
    for (let i = 0; i < land.length; i++) { const q = pr(land[i]); if (q[2] <= 0.04) continue; const px = x + q[0] * R, py = y - q[1] * R, lit = clamp(0.55 - q[0] * 0.3 + q[1] * 0.35, 0.2, 1);
      dot(px, py, sz * (0.45 + 0.4 * q[2]), [255, 255, 255], (0.22 + 0.6 * lit) * q[2] * k); }
    // Malaysia: one national signal, so every bead takes the same colour; nothing is shaded by state
    let mx = 0, my = 0, mn = 0; const c = [mix(255, acc[0], 0.25 + 0.75 * warm), mix(255, acc[1], 0.25 + 0.75 * warm), mix(255, acc[2], 0.25 + 0.75 * warm)];
    for (let i = 0; i < mys.length; i++) { const q = pr(mys[i]); if (q[2] <= 0.04) continue; const px = x + q[0] * R, py = y - q[1] * R; mx += px; my += py; mn++;
      dot(px, py, sz * (0.62 + 0.18 * br + 0.5 * beat), c, (0.82 + 0.18 * br) * k); }
    if (!mn) return; mx /= mn; my /= mn;
    gr = g.createRadialGradient(mx, my, 0, mx, my, R * (0.2 + 0.05 * br + 0.1 * beat)); gr.addColorStop(0, rgb(c, (0.16 + 0.2 * warm + 0.2 * beat) * A)); gr.addColorStop(1, rgb(c, 0)); g.fillStyle = gr; g.beginPath(); g.arc(mx, my, R * 0.36, 0, 7); g.fill();
    // a leader from Malaysia to the newest reading: the figure changes with every week that is added
    const v = S.vals, n = v.length, cur = n ? (slide > 0 && n > 1 ? mix(v[n - 2], v[n - 1], ease(1 - slide)) : v[n - 1]) : 0, lx = phone ? 52 : mx - R * 0.36, ly = phone ? H - 40 : my + R * 0.42;
    g.strokeStyle = rgb([255, 255, 255], 0.55 * A); g.lineWidth = 1; g.beginPath(); g.moveTo(mx - R * 0.05, my + R * 0.03); g.lineTo(lx + 8, ly - 8); g.lineTo(lx - 34, ly - 8); g.stroke();
    g.textAlign = "left"; g.textBaseline = "top"; g.font = `700 14.5px ${SANS}`; g.fillStyle = rgb([255, 255, 255], A); g.fillText(`Malaysia · ${cur.toFixed(1)}% of flu tests positive`, lx - 34, ly);
    g.font = `500 12.5px ${SANS}`; g.fillStyle = rgb([255, 255, 255], 0.78 * A); g.fillText(n && S.dates[n - 1] ? `Week of ${day(S.dates[n - 1])}` : "", lx - 34, ly + 19);
  }

  // ---------- b: the signal as a horizon ----------
  function horizon(now) {
    const v = S.vals, n = v.length; if (n < 3) return;
    const phone = W < 760, xL = phone ? -30 : x0 + (W - x0) * 0.42, xR = x0 + (W - x0) * (phone ? 0.9 : 0.87), base = H + 6, top = Math.max(S.th.orange * 1.3, ...v) * 1.06, bandH = H * (phone ? 0.7 : H < 620 ? 0.44 : 0.5), yOf = (val) => base - (val / top) * bandH;
    const sl = slide > 0 ? ease(1 - slide) : 1, dx = (xR - xL) / (n - 1), vLast = S.fresh > 0 ? mix(v[n - 2], v[n - 1], sl) : v[n - 1], shift = S.fresh > 0 ? (1 - sl) * dx : 0;
    const val = (k) => (k >= n - 1 ? vLast : v[Math.max(0, k)]);
    const at = (x) => { const f = clamp((x - xL - shift) / dx, 0, n - 1), i = Math.floor(f), u = f - i, s = u * u * (3 - 2 * u); return mix(val(i), val(Math.min(n - 1, i + 1)), s); };
    const rise = ease(arrive), xEnd = xR + shift, p = phone ? 10 : clamp((W - x0) / 104, 10, 13);
    // the field: bright at the ridge, fading with depth; the part above each line takes that line's colour
    for (let x = xL; x <= xEnd + 1; x += p) { const hv = at(x) * rise, yTop = yOf(hv), fadeL = phone ? 1 : clamp((x - xL) / ((xR - xL) * 0.22), 0, 1), wob = Math.sin(phase * 0.5 + x * 0.013);
      for (let y = base - p * 0.5, j = 0; y > yTop; y -= p, j++) { const dv = ((base - y) / bandH) * top, d = (y - yTop) / Math.max(1, base - yTop), near = Math.pow(1 - d, 1.7);
        const c = dv >= S.th.orange ? WARM.o : dv >= S.th.yellow ? WARM.y : [255, 255, 255];
        dot(x, y, 1.2 + 1.7 * near, c, (0.13 + 0.72 * near + 0.06 * wob) * fadeL); } }
    const fadeX = (a) => { if (phone) return rgb([255, 255, 255], a); const gr = g.createLinearGradient(xL, 0, xL + (xR - xL) * 0.22, 0); gr.addColorStop(0, rgb([255, 255, 255], 0)); gr.addColorStop(1, rgb([255, 255, 255], a)); return gr; };
    // the ridge, and behind it one faint line: the same weeks a year earlier (real figures, nothing drawn for effect)
    const xa = xL, pv = S.prev && S.prev.length === n ? S.prev : null, atP = (x) => { const f = clamp((x - xL - shift) / dx, 0, n - 1), i = Math.floor(f), u = f - i; return mix(pv[i], pv[Math.min(n - 1, i + 1)], u * u * (3 - 2 * u)); };
    if (pv) { g.beginPath(); for (let x = xa; x <= xEnd; x += 6) { const y = yOf(atP(x) * rise); x <= xa ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = fadeX(0.34 * dim * rise); g.lineWidth = 1; g.setLineDash([1, 5]); g.stroke(); g.setLineDash([]);
      g.font = `500 12px ${SANS}`; g.textAlign = "left"; g.textBaseline = "bottom"; g.fillStyle = rgb([255, 255, 255], 0.62 * dim * rise); const px = xL + (xR - xL) * 0.3; g.fillText("A year earlier", px, yOf(atP(px) * rise) - 6); }
    g.beginPath(); for (let x = xa; x <= xEnd; x += 6) { const y = yOf(at(x) * rise); x <= xa ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = fadeX(0.9 * dim * rise); g.lineWidth = 1.6; g.stroke();
    // the two lines of the alert rule
    g.font = `600 12.5px ${SANS}`; g.textBaseline = "bottom"; g.textAlign = "right";
    for (const [name, th, c] of [["Watch line", S.th.yellow, WARM.y], ["Alert line", S.th.orange, WARM.o]]) { const y = yOf(th);
      g.strokeStyle = rgb(c, 0.5 * dim * rise); g.lineWidth = 1; g.setLineDash([2, 6]); g.beginPath(); g.moveTo(xL + (xR - xL) * 0.12, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = rgb(c, 0.95 * dim * rise); g.fillText(`${name} ${th.toFixed(1)}%`, W - 22, y - 5); }
    // the newest week: a point that breathes at the step's tempo
    const nx = xEnd, ny = yOf(vLast * rise), b = (phase / 6.2832) % 1, hot = vLast >= S.th.orange ? WARM.o : vLast >= S.th.yellow ? WARM.y : [255, 255, 255];
    g.strokeStyle = rgb(hot, 0.55 * (1 - b) * dim); g.lineWidth = 1.5; g.beginPath(); g.arc(nx, ny, 6 + 24 * b, 0, 6.2832); g.stroke();
    g.fillStyle = rgb(hot, dim); g.beginPath(); g.arc(nx, ny, 5.5, 0, 6.2832); g.fill();
    // the pointer reads any week; when it leaves, the label returns to the newest week
    const inBand = ptr.on && ptr.cy > base - bandH * 1.25 && ptr.cy < H + 20 && ptr.cx > xL && ptr.cx < xEnd + 30 && root.dataset.page === "now", k = inBand ? clamp(Math.round((ptr.cx - xL - shift) / dx), 0, n - 1) : n - 1;
    const lx = inBand ? xL + shift + k * dx : nx, lv = inBand ? val(k) : vLast, ly = yOf(lv * rise);
    if (inBand) { g.strokeStyle = rgb([255, 255, 255], 0.5 * dim); g.lineWidth = 1; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx, base); g.stroke(); g.fillStyle = rgb([255, 255, 255], dim); g.beginPath(); g.arc(lx, ly, 4, 0, 6.2832); g.fill(); }
    label(lx, ly - 16, `${lv.toFixed(1)}% of flu tests positive`, S.dates[k] ? `Week of ${day(S.dates[k])}` : "", lx > W - 190 ? "right" : lx < x0 + 120 ? "left" : "center");
  }
  function label(x, y, a, b, align) { g.textAlign = align; g.textBaseline = "bottom"; const k = ease(arrive) * dim, ax = align === "right" ? Math.min(x + 8, W - 22) : x;
    g.font = `500 12.5px ${SANS}`; g.fillStyle = rgb([255, 255, 255], 0.78 * k); g.fillText(b, ax, y); g.font = `700 14.5px ${SANS}`; g.fillStyle = rgb([255, 255, 255], k); g.fillText(a, ax, y - 17); }

  // ---------- c: the ladder ----------
  let hoverStep = -1;
  function ladder(now) {
    const short = H < 620 && W >= 760, L = x0 + (W - x0) * (W < 760 ? 0.06 : 0.5), R = W - (W < 760 ? 20 : clamp(W * 0.05, 26, 70)), gap = clamp((R - L) * 0.035, 8, 22), cw = (R - L - gap * 3) / 4, floor = H * (W < 760 ? 0.86 : 0.86), p = clamp(cw / 9.5, 9, 15);
    const hs = [0.3, 0.44, 0.58, 0.72].map((k) => k * H * (W < 760 ? 1.08 : short ? 0.92 : 1)); let hov = -1;
    g.textAlign = "left"; g.textBaseline = "top";
    for (let s = 0; s < 4; s++) { const x = L + s * (cw + gap), h = hs[s] * ease(clamp(arrive * 1.5 - s * 0.16, 0, 1)), yTop = floor - h, cur = Math.abs(stepK - s) < 0.5, fill = clamp(stepK - s + 1, 0, 1), br = 0.5 + 0.5 * Math.sin(phase);
      if (ptr.on && ptr.cx >= x - gap / 2 && ptr.cx < x + cw + gap / 2 && ptr.cy > floor - hs[3] - 30 && ptr.cy < H && root.dataset.page === "now") hov = s;
      const up = hoverStep === s ? 8 : 0, cols = Math.max(3, Math.round(cw / p)), px = cw / cols, level = floor - h * fill;
      for (let i = 0; i < cols; i++) for (let y = floor - px * 0.5, j = 0; y > yTop; y -= px, j++) { const lit = y >= level, edge = lit ? Math.pow(1 - (y - level) / Math.max(1, floor - level), 2) : 0, tw = Math.sin(phase + i * 0.9 + j * 0.37);
        const c = cur && lit ? [mix(255, acc[0], 0.35 + 0.65 * edge), mix(255, acc[1], 0.35 + 0.65 * edge), mix(255, acc[2], 0.35 + 0.65 * edge)] : [255, 255, 255];
        const a = lit ? (cur ? 0.4 + 0.5 * edge + 0.14 * br * edge + 0.04 * tw : 0.3 + 0.2 * edge) : 0.17;
        dot(x + px * (i + 0.5), y - up, lit ? (cur ? 1.7 + 1.5 * edge : 1.7) : 1.4, c, a + (hoverStep === s ? 0.1 : 0)); }
      g.font = `${cur ? 700 : 600} ${short ? 13 : 15}px ${SANS}`; g.fillStyle = rgb([255, 255, 255], (cur ? 1 : 0.62) * dim * ease(arrive)); g.fillText(S.names[s], x + 2, floor + 10);
      if (cur) { g.fillStyle = rgb(acc, dim); g.beginPath(); g.arc(x + cw - 6, floor + 18, 3.5 + 1.5 * br, 0, 6.2832); g.fill(); } }
    if (hov !== hoverStep) { hoverStep = hov; if (tip) { tip.hidden = hov < 0; if (hov >= 0) { tip.innerHTML = `<b>${S.names[hov]}</b> ${S.says[hov] || ""}${S.records[hov] ? " <span>" + S.records[hov] + "</span>" : ""}`;
      tip.style.left = clamp(box.left + L + hov * (cw + gap), 12, innerWidth - 320) + "px"; tip.style.top = Math.max(150, box.top + floor - hs[hov] - 14) + "px"; } } }
  }

  (function draw(now) {
    const dt = Math.min(60, now - last); last = now; requestAnimationFrame(draw);
    const onNow = root.dataset.page === "now"; if (!S) return; if (!onNow && dim < 0.02 && !cv._clean) { g.clearRect(0, 0, W, H); cv._clean = true; return; } if (!onNow && cv._clean) return; cv._clean = false;
    box = cv.getBoundingClientRect(); if (Math.abs(box.width - W) > 1 || Math.abs(box.height - H) > 1) size(); ptr.cx = ptr.x - box.left; ptr.cy = ptr.y - box.top;
    readAcc(now); dim += ((onNow ? 1 : 0) - dim) * (STILL ? 1 : 0.12);
    arrive = STILL ? 1 : clamp((now - arrivedAt - 250) / 1500, 0, 1); if (slide > 0) slide = STILL ? 0 : Math.max(0, 1 - (now - slideAt) / 1100);
    stepK += (Math.max(0, S.step) - stepK) * (STILL ? 1 : 0.06); ptr.k += ((ptr.on ? 1 : 0) - ptr.k) * 0.14;
    phase += STILL ? 0 : (dt / mix(TEMPO[Math.floor(clamp(stepK, 0, 3))], TEMPO[Math.ceil(clamp(stepK, 0, 3))], stepK % 1)) * 6.2832;
    g.clearRect(0, 0, W, H); const pick = root.dataset.look || "b", look = pick === "d" ? (root.dataset.replay === "1" ? "b" : "a") : pick;
    if (look !== "c" && hoverStep >= 0) { hoverStep = -1; if (tip) tip.hidden = true; }
    look === "a" ? earth(now) : look === "c" ? ladder(now) : horizon(now);
  })(last);
})();
