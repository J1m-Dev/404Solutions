// DOM landing page: the opening, one Earth that the camera follows across four screens, the forecast ring, the dive into the app.
// No libraries. The Earth is a lit sphere of beads projected in code; data/dots.json is written by pipeline/landing_dots.py.
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $("earth"), cx = cv.getContext("2d"), tag = $("tag"), hud = $("hud"), introO = document.querySelector(".intro-logo i"), root = document.documentElement;
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const RAD = Math.PI / 180, MARK = { lon: 102.2, lat: 3.9 }, LIGHT = [-0.42, 0.56, 0.71];
  // Where the camera is on each screen: whole Earth, close on Malaysia, Earth rising from the bottom, whole Earth again.
  const KEYS = [
    { el: $("k1"), lon: 108, lat: 7, dim: 1, fit: true },
    { el: $("k2"), lon: 109, lat: 4, dim: 0.5 },
    { el: $("k3"), lon: 109, lat: -47, dim: 0.95 },
    { el: $("k4"), lon: 108, lat: 7, dim: 1 },
  ];
  const T_LOAD = 1500, T_LOGO = 1150, T_FLY = 1300, T_ASM = 1700;
  const STATES = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya"];
  const LEVELS = [
    { max: 20, name: "Calm", rgb: [232, 237, 243] },
    { max: 40, name: "Watch", rgb: [255, 212, 90] },
    { max: 60, name: "Alert", rgb: [255, 138, 92] },
    { max: 101, name: "Surge likely", rgb: [255, 77, 61] },
  ];
  // SAMPLE figures for the ring until the model output is wired in. Labelled "Sample data" on the page.
  const SAMPLE = {
    1: [12, "Positive tests are near the usual level this week."],
    2: [24, "Positive tests rose two weeks in a row."],
    3: [38, "The rise is faster than usual for October."],
    4: [46, "Positive tests rose from 17% to 22% in two weeks."],
  };
  const SHADE = [0, 1, 2, 3, 4, 5].map((i) => `rgb(${[70, 82, 104].map((c, j) => Math.round(c + ([255, 255, 255][j] - c) * (i / 5))).join(",")})`);

  let W = 0, H = 0, DPR = 1, land = [], mys = [], mark = null, scat = null, buf = [], cnt = [0, 0, 0, 0, 0, 0], lines = [], net = [], snow = [];
  let pointer = { x: -9999, y: -9999, nx: 0, ny: 0 }, drag = null, off = { lon: 0, lat: 0 }, tilt = { x: 0, y: 0 }, lastDrag = 0, view = { x: 0, y: 0, R: 1 };
  let t0 = performance.now(), introStart = 0, introDone = STILL, diveStart = 0, diveTo = "index.html", chance = 0, level = LEVELS[1];

  const vec = ([lon, lat]) => { const l = lon * RAD, p = lat * RAD; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const smooth = (k) => k * k * (3 - 2 * k);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    root.style.setProperty("--r0", clamp(Math.min(W, H) * 0.06, 28, 50) + "px");
  }

  function keyAt(i) {
    const k = KEYS[i], r = k.el.getBoundingClientRect(), top = k.el.closest("section").getBoundingClientRect().top;
    return { x: r.left + r.width / 2, y: r.top - top + r.height / 2, R: Math.max(20, k.fit ? Math.min(r.width, r.height) * 0.45 : r.width / 2), lon: k.lon, lat: k.lat, dim: k.dim };
  }
  // The Earth never leaves the screen: scrolling moves the camera from one key position to the next.
  function frame(now) {
    const sh = KEYS[0].el.closest("section").offsetHeight || H, idx = clamp(scrollY / sh, 0, KEYS.length - 1);
    const i = Math.min(Math.floor(idx), KEYS.length - 2), t = smooth(idx - i), a = keyAt(i), b = keyAt(i + 1);
    let x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), R = Math.exp(lerp(Math.log(a.R), Math.log(b.R), t)), k = 1, d = 0;
    if (!introDone) { const o = introO.getBoundingClientRect();
      k = ease(clamp((now - introStart - T_LOAD - T_LOGO) / T_FLY, 0, 1));
      x = lerp(o.left + o.width / 2, x, k); y = lerp(o.top + o.height / 2, y, k); R = lerp(o.width / 2.2, R, k); }
    if (diveStart) { d = clamp((now - diveStart) / 1300, 0, 1); x = lerp(x, W / 2, d); y = lerp(y, H / 2, d); R *= 1 + (R > W ? 2.5 : 11) * d * d * d; }
    return { x, y, R, d, idx, lon: lerp(a.lon, b.lon, t), lat: lerp(a.lat, b.lat, t), dim: lerp(a.dim, b.dim, t) };
  }

  // thin white lines with small numbers, as a survey of the scene; they draw in while loading and wake near the pointer
  function drawNet(now, loadK, fade) {
    cx.lineWidth = 1; cx.font = "10px ui-monospace,Menlo,monospace";
    for (const t of net) {
      const k = introDone ? 1 : clamp(loadK * 1.7 - t.delay, 0, 1); if (k <= 0) continue;
      const ox = t.x * W + (STILL ? 0 : Math.sin((now - t0) / 9000 + t.ph) * 14) - pointer.nx * 30 * t.z, oy = t.y * H + (STILL ? 0 : Math.cos((now - t0) / 11000 + t.ph) * 10) - pointer.ny * 22 * t.z;
      const dd = Math.hypot(ox - pointer.x, oy - pointer.y), a = fade + (dd < 280 ? 0.55 * (1 - dd / 280) : 0); if (a < 0.02) continue;
      const n = t.p.length, total = k * n;
      cx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`; cx.beginPath(); cx.moveTo(ox + t.p[0][0], oy + t.p[0][1]);
      for (let j = 1; j <= n; j++) { const q = t.p[j % n], pr = t.p[j - 1], f = clamp(total - (j - 1), 0, 1); if (f <= 0) break; cx.lineTo(ox + lerp(pr[0], q[0], f), oy + lerp(pr[1], q[1], f)); }
      cx.stroke();
      if (k > 0.6) { cx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.7).toFixed(3)})`; cx.fillText(t.n, ox + t.p[0][0] + 5, oy + t.p[0][1] - 5); }
    }
  }

  function draw(now) {
    const f = frame(now), { x, y, R, d, idx } = f, t = now - introStart;
    const loadK = introDone ? 1 : clamp(t / T_LOAD, 0, 1), asm = introDone ? 1 : clamp((t - T_LOAD - T_LOGO * 0.5) / T_ASM, 0, 1), body = ease(asm);
    const hero = clamp(1 - idx, 0, 1), whole = Math.max(hero, clamp(idx - (KEYS.length - 2), 0, 1));
    tilt.x += (pointer.nx * 6 - tilt.x) * 0.06; tilt.y += (-pointer.ny * 5 - tilt.y) * 0.06;
    if (!drag && now - lastDrag > 1200) { off.lon *= 0.94; off.lat *= 0.94; }
    const sway = STILL || drag || diveStart ? 0 : 7 * Math.sin((now - t0) / 4200) * whole;
    const lon0 = lerp(f.lon + sway + off.lon * hero + tilt.x, MARK.lon + 5, d) * RAD, lat0 = lerp(f.lat + off.lat * hero + tilt.y, MARK.lat, d) * RAD;
    const sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0);
    view = { sl, cl, sp, cp, x, y, R };
    const project = (v) => { const X = v[0] * cl - v[2] * sl, Z0 = v[0] * sl + v[2] * cl; return [X, v[1] * cp - Z0 * sp, v[1] * sp + Z0 * cp]; };

    cx.clearRect(0, 0, W, H);
    cx.fillStyle = "#fff";
    for (const s of snow) { const sx = (((s.x * W + (STILL ? 0 : (now - t0) * 0.006 * s.z) - pointer.nx * 30 * s.z) % W) + W) % W, sy = (((s.y * H + (STILL ? 0 : (now - t0) * 0.004 * s.z) - pointer.ny * 20 * s.z) % H) + H) % H;
      cx.globalAlpha = 0.18 + 0.5 * s.z; cx.fillRect(sx, sy, 1 + s.z * 1.2, 1 + s.z * 1.2); }
    cx.globalAlpha = 1;
    drawNet(now, loadK, introDone ? 0.07 : lerp(0.5, 0.07, clamp((t - T_LOAD - T_LOGO) / 900, 0, 1)));

    // light behind the Earth, a soft shadow beneath it, then the lit body
    let g = cx.createRadialGradient(x, y, R * 0.9, x, y, R * 1.5 + 40);
    g.addColorStop(0, `rgba(255,255,255,${0.42 * Math.max(body, loadK * 0.5)})`); g.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R * 1.5 + 40, 0, 7); cx.fill();
    if (whole > 0.02 && !diveStart) { cx.save(); cx.translate(x + R * 0.08, y + R * 1.17); cx.scale(1, 0.14);
      g = cx.createRadialGradient(0, 0, 0, 0, 0, R * 0.98); g.addColorStop(0, `rgba(28,38,56,${0.42 * whole * body})`); g.addColorStop(1, "rgba(28,38,56,0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(0, 0, R * 0.98, 0, 7); cx.fill(); cx.restore(); }
    cx.save(); cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.clip(); cx.globalAlpha = body;
    g = cx.createRadialGradient(x - R * 0.42, y - R * 0.5, R * 0.05, x, y, R * 1.08);
    g.addColorStop(0, "#a9b5c8"); g.addColorStop(0.45, "#7b889e"); g.addColorStop(0.85, "#566279"); g.addColorStop(1, "#465068");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    g = cx.createLinearGradient(x - R * 0.6, y - R * 0.7, x + R * 0.7, y + R * 0.8); g.addColorStop(0.35, "rgba(18,26,42,0)"); g.addColorStop(1, "rgba(18,26,42,.42)");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    g = cx.createRadialGradient(x - R * 0.4 - tilt.x * R * 0.012, y - R * 0.5 + tilt.y * R * 0.012, 0, x - R * 0.4, y - R * 0.5, R * 0.62);
    g.addColorStop(0, "rgba(255,255,255,.34)"); g.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    cx.restore();

    // the wire globe: bright while loading, a faint grid afterwards
    const wire = introDone ? 0.11 : lerp(0.95, 0.11, body), nLines = Math.ceil(lines.length * (introDone ? 1 : ease(loadK)));
    cx.strokeStyle = `rgba(255,255,255,${wire})`; cx.lineWidth = introDone ? 1 : 1.2; cx.beginPath();
    for (let i = 0; i < nLines; i++) { let pen = false; for (const v of lines[i]) { const p = project(v); if (p[2] > 0) { const px = x + p[0] * R, py = y - p[1] * R; pen ? cx.lineTo(px, py) : cx.moveTo(px, py); pen = true; } else pen = false; } }
    cx.stroke();

    // land beads: lit from the upper left, lifted near the pointer; on load they fly in and settle
    const s = clamp(R * 0.0078, 1.2, 4.2), reach = clamp(R * 0.34, 70, 170), scan = STILL || diveStart ? 9 : (((now - t0) % 7000) / 7000) * 3.2 - 1.6;
    cnt.fill(0);
    for (let i = 0; i < land.length; i++) {
      const p = project(land[i]); if (p[2] <= 0) continue;
      let k1 = 1; if (asm < 1) { k1 = ease(clamp((asm - scat[i * 3 + 2]) / 0.45, 0, 1)); if (k1 < 0.04) continue; }
      let px = x + p[0] * R, py = y - p[1] * R, z = s;
      if (k1 < 1) { px += scat[i * 3] * R * (1 - k1) * 1.6; py += scat[i * 3 + 1] * R * (1 - k1) * 1.6; }
      if (py < -8 || py > H + 8 || px < -8 || px > W + 8) continue;
      let sh = 0.16 + 0.84 * Math.max(0, p[0] * LIGHT[0] + p[1] * LIGHT[1] + p[2] * LIGHT[2]);
      const sc = Math.abs(p[0] - scan); if (sc < 0.16) sh += 0.3 * (1 - sc / 0.16);
      const dx = px - pointer.x, dy = py - pointer.y, dd = dx * dx + dy * dy;
      if (dd < reach * reach) { const q = 1 - Math.sqrt(dd) / reach, lift = (reach * 0.17 * q * q) / R; px += p[0] * R * lift; py -= p[1] * R * lift; sh += 0.5 * q; z = s * (1 + 1.1 * q); }
      const b = Math.min(5, (clamp(sh, 0, 1) * 5.999) | 0), o = cnt[b] * 3; buf[b][o] = px; buf[b][o + 1] = py; buf[b][o + 2] = z; cnt[b]++;
    }
    cx.globalAlpha = f.dim; const round = s >= 2.5;
    if (s >= 1.8) { cx.fillStyle = "rgba(22,30,46,.30)"; for (let b = 0; b < 6; b++) for (let j = 0, a = buf[b]; j < cnt[b] * 3; j += 3) cx.fillRect(a[j] - a[j + 2] * 0.1, a[j + 1], a[j + 2], a[j + 2]); }
    for (let b = 0; b < 6; b++) { cx.fillStyle = SHADE[b]; const a = buf[b];
      if (round) { cx.beginPath(); for (let j = 0; j < cnt[b] * 3; j += 3) { cx.moveTo(a[j] + a[j + 2] / 2, a[j + 1]); cx.arc(a[j], a[j + 1], a[j + 2] / 2, 0, 7); } cx.fill(); }
      else for (let j = 0; j < cnt[b] * 3; j += 3) cx.fillRect(a[j] - a[j + 2] / 2, a[j + 1] - a[j + 2] / 2, a[j + 2], a[j + 2]); }
    // Malaysia, in the colour of the current risk level, with a soft glow
    const c = level.rgb, m = project(mark), mx = x + m[0] * R, my = y - m[1] * R, ms = clamp(R * 0.006, 1.1, 4.4);
    if (asm > 0.55) {
      if (m[2] > 0) { g = cx.createRadialGradient(mx, my, 0, mx, my, R * 0.2 + 20); g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.34 * m[2]})`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        cx.globalAlpha = 1; cx.fillStyle = g; cx.beginPath(); cx.arc(mx, my, R * 0.2 + 20, 0, 7); cx.fill(); }
      cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      for (let i = 0; i < mys.length; i++) { const p = project(mys[i]); if (p[2] <= 0) continue; cx.globalAlpha = 0.45 + 0.55 * p[2]; cx.fillRect(x + p[0] * R - ms / 2, y - p[1] * R - ms / 2, ms, ms); }
    }
    cx.globalAlpha = body; cx.lineWidth = 1; cx.strokeStyle = "rgba(255,255,255,.4)"; cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.stroke();
    cx.lineWidth = 1.8; cx.strokeStyle = "rgba(255,255,255,.95)"; cx.beginPath(); cx.arc(x, y, R, Math.PI * 1.06, Math.PI * 1.62); cx.stroke();
    cx.globalAlpha = 1;

    // first screen only: a pulse and a label on Malaysia, and a crosshair that reads out where the pointer is
    const first = introDone && !diveStart && hero > 0.6;
    if (first && m[2] > 0.15) {
      const beat = STILL ? 0.5 : ((now - t0) % 2600) / 2600, rr = lerp(6, 16 + 30 * (chance / 100), beat);
      cx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.9 * (1 - beat)})`; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(mx, my, rr, 0, 7); cx.stroke();
      const tw = tag.offsetWidth, flip = mx + 14 + tw > W - 8;
      tag.hidden = false; tag.classList.toggle("under", flip);
      tag.style.transform = flip ? `translate(${Math.round(clamp(mx - tw / 2, 8, W - tw - 8))}px,${Math.round(my + 24)}px)` : `translate(${Math.round(mx + 14)}px,${Math.round(my - 8)}px)`;
    } else tag.hidden = true;
    if (first && !drag && Math.hypot(pointer.x - x, pointer.y - y) < R) {
      const X = (pointer.x - x) / R, Y = -(pointer.y - y) / R, Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
      const vy = Y * cp + Z * sp, Z0 = -Y * sp + Z * cp, la = Math.asin(clamp(vy, -1, 1)) / RAD, lo = Math.atan2(X * cl + Z0 * sl, -X * sl + Z0 * cl) / RAD;
      cx.strokeStyle = "rgba(255,255,255,.85)"; cx.lineWidth = 1; cx.beginPath();
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cx.moveTo(pointer.x + ax * 4, pointer.y + ay * 4); cx.lineTo(pointer.x + ax * 11, pointer.y + ay * 11); }
      cx.stroke();
      hud.hidden = false; hud.textContent = `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}  ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`;
      hud.style.transform = `translate(${Math.round(Math.min(pointer.x + 16, W - 150))}px,${Math.round(pointer.y + 14)}px)`;
    } else hud.hidden = true;

    tickIntro(now);
    if (diveStart && d >= 1) return;
    if (!STILL) requestAnimationFrame(draw);
  }
  const redraw = () => { if (STILL) requestAnimationFrame(draw); };

  // ---- opening: counter and wire lines, then the logo, then the Earth settles and flies to its place ----
  function tickIntro(now) {
    if (introDone) return;
    const t = now - introStart, b = document.body.classList;
    $("loadN").textContent = String(Math.round(clamp(t / T_LOAD, 0, 1) * 100)).padStart(3, "0");
    b.toggle("p-load", t < T_LOAD); b.toggle("p-logo", t >= T_LOAD && t < T_LOAD + T_LOGO);
    if (t > T_LOAD + T_LOGO + 420 && !b.contains("ready")) { b.add("ready"); b.remove("loading"); setWeeks(4, true); }
    if (t > T_LOAD + T_LOGO + Math.max(T_FLY, T_ASM)) { introDone = true; $("intro").remove(); }
  }
  const skipIntro = () => { if (!introDone && performance.now() - introStart < T_LOAD + T_LOGO) introStart = performance.now() - T_LOAD - T_LOGO; };

  // ---- the logo's O: the same Earth, small ----
  function navLogo() {
    const c = $("navO"), g = c.getContext("2d"), R = 26, o = 30, l = 108 * RAD, p = 2 * RAD;
    const pr = (v) => { const X = v[0] * Math.cos(l) - v[2] * Math.sin(l), Z0 = v[0] * Math.sin(l) + v[2] * Math.cos(l); return [X, v[1] * Math.cos(p) - Z0 * Math.sin(p), v[1] * Math.sin(p) + Z0 * Math.cos(p)]; };
    g.clearRect(0, 0, 60, 60); g.fillStyle = "#fff";
    for (let i = 0; i < land.length; i++) { const q = pr(land[i]); if (q[2] > 0.05) { g.globalAlpha = 0.55 + 0.45 * q[2]; g.fillRect(o + q[0] * R - 0.8, o - q[1] * R - 0.8, 1.6, 1.6); } }
    g.globalAlpha = 0.95; g.strokeStyle = "#fff"; g.lineWidth = 1.6; g.beginPath(); g.arc(o, o, R + 1.5, 0, 7); g.stroke();
    g.globalAlpha = 1; const q = pr(mark); g.fillStyle = "#ff6a3d"; g.beginPath(); g.arc(o + q[0] * R, o - q[1] * R, 4.2, 0, 7); g.fill();
  }

  // ---- forecast ring ----
  const C = 2 * Math.PI * 78;
  function setWeeks(n, animate) {
    const [p, why] = SAMPLE[n];
    level = LEVELS.find((l) => p < l.max);
    $("wkLabel").textContent = n === 1 ? "week" : n + " weeks";
    $("why").textContent = why; $("level").textContent = level.name;
    const col = `rgb(${level.rgb.join(",")})`;
    $("level").style.background = col; $("tip").style.fill = col;
    $("arc").style.strokeDasharray = `${(C * p) / 100} ${C}`;
    const a = (-90 + 3.6 * p) * RAD; $("tip").setAttribute("cx", 100 + 78 * Math.cos(a)); $("tip").setAttribute("cy", 100 + 78 * Math.sin(a));
    const from = chance, start = performance.now(), el = $("pct");
    (function roll(t) { const k = animate && !STILL ? clamp((t - start) / 600, 0, 1) : 1; chance = lerp(from, p, ease(k)); el.textContent = Math.round(chance); if (k < 1) requestAnimationFrame(roll); else redraw(); })(start);
  }
  function ticks() {
    let h = ""; for (let i = 0; i < 40; i++) { const a = (i * 9 - 90) * RAD, c = Math.cos(a), s = Math.sin(a), r = i % 10 ? 94 : 97;
      h += `<line x1="${100 + 91 * c}" y1="${100 + 91 * s}" x2="${100 + r * c}" y2="${100 + r * s}"/>`; }
    $("ticks").innerHTML = h;
  }

  // ---- pointer: the Earth leans toward it, beads lift under it, the fog shifts; dragging turns the Earth on the first screen ----
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.nx = (e.clientX / W) * 2 - 1; pointer.ny = (e.clientY / H) * 2 - 1;
    root.style.setProperty("--mx", pointer.nx.toFixed(3)); root.style.setProperty("--my", pointer.ny.toFixed(3));
    if (drag) { const k = 80 / view.R; off.lon = clamp(drag.lon - (e.clientX - drag.x) * k, -170, 170); off.lat = clamp(drag.lat + (e.clientY - drag.y) * k, -55, 55); lastDrag = performance.now(); }
    redraw();
  });
  cv.addEventListener("pointerdown", (e) => {
    skipIntro(); if (!introDone || scrollY > H * 0.3 || Math.hypot(e.clientX - view.x, e.clientY - view.y) > view.R * 1.1) return;
    drag = { x: e.clientX, y: e.clientY, lon: off.lon, lat: off.lat }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
  });
  const drop = () => { if (drag) { drag = null; lastDrag = performance.now(); cv.style.cursor = ""; redraw(); } };
  addEventListener("pointerup", drop); addEventListener("pointercancel", drop);
  addEventListener("keydown", skipIntro);
  document.addEventListener("pointerleave", () => { pointer.x = pointer.y = -9999; redraw(); });
  addEventListener("resize", () => { size(); redraw(); });
  addEventListener("scroll", redraw, { passive: true });

  // ---- entering the app: dive into Malaysia, then hand over ----
  document.querySelectorAll("[data-enter]").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault(); if (diveStart) return;
    diveTo = el.getAttribute("href") || "index.html";
    if (STILL) { location.href = diveTo; return; }
    document.body.classList.add("leaving"); diveStart = performance.now();
    setTimeout(() => $("veil").classList.add("on"), 900);
    setTimeout(() => { location.href = diveTo; }, 1450);
  }));
  // coming back with the browser's Back button restores the page
  addEventListener("pageshow", (e) => { if (e.persisted) { diveStart = 0; $("veil").classList.remove("on"); document.body.classList.remove("leaving"); requestAnimationFrame(draw); } });

  // ---- set-up ----
  size(); ticks(); mark = vec([MARK.lon, MARK.lat]);
  const names = STATES.concat(STATES).map((n) => `<div>${n}</div>`).join("");
  $("namesL").innerHTML = names; $("namesR").innerHTML = STATES.slice(8).concat(STATES.slice(0, 8), STATES.slice(8), STATES.slice(0, 8)).map((n) => `<div>${n}</div>`).join("");
  for (let la = -60; la <= 60; la += 20) { const l = []; for (let lo = 0; lo <= 360; lo += 6) l.push(vec([lo, la])); lines.push(l); }
  for (let lo = 0; lo < 360; lo += 20) { const l = []; for (let la = -90; la <= 90; la += 6) l.push(vec([lo, la])); lines.push(l); }
  for (let i = 0; i < 46; i++) { const n = 3 + (Math.random() < 0.3 ? 1 : 0), r = 40 + Math.random() * 120, a0 = Math.random() * 7, p = [];
    for (let j = 0; j < n; j++) { const a = a0 + (j / n) * 6.283 + (Math.random() - 0.5) * 1.2, q = r * (0.5 + Math.random() * 0.8); p.push([Math.cos(a) * q, Math.sin(a) * q * 0.7]); }
    net.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, p, n: String(20 + Math.floor(Math.random() * 79)), delay: Math.random() * 0.7, ph: Math.random() * 6 }); }
  for (let i = 0; i < 70; i++) snow.push({ x: Math.random(), y: Math.random(), z: Math.random() });

  Promise.all([fetch("data/dots.json").then((r) => r.json()), document.fonts ? document.fonts.ready : 0]).then(([d]) => {
    land = d.land.map(vec); mys = d.malaysia.map(vec); navLogo();
    scat = new Float32Array(land.length * 3);
    for (let i = 0; i < land.length; i++) { const a = Math.random() * 6.283, q = 0.5 + Math.random() * 1.6; scat[i * 3] = Math.cos(a) * q; scat[i * 3 + 1] = Math.sin(a) * q; scat[i * 3 + 2] = Math.random() * 0.55; }
    buf = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(land.length * 3));
    $("weeks").addEventListener("input", (e) => setWeeks(+e.target.value, true));
    if (STILL) { $("intro").remove(); document.body.classList.add("ready"); document.body.classList.remove("loading"); setWeeks(4, false); }
    introStart = performance.now(); requestAnimationFrame(draw);
  });
})();
