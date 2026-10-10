// DOM landing page: a short opening, one Earth that the camera follows across four screens, and the real October 2025 replay.
// No libraries. The Earth is a lit sphere of beads projected in code (data/dots.json, written by pipeline/landing_dots.py).
// Every number on the page is read from data/site.json and run through the same model code the app uses (assets/model.js).
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $("earth"), cx = cv.getContext("2d"), tag = $("tag"), hud = $("hud"), introO = document.querySelector(".intro-logo i"), root = document.documentElement;
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const RAD = Math.PI / 180, MARK = { lon: 102.2, lat: 3.9 }, LIGHT = [-0.42, 0.56, 0.71];
  const CALM = [214, 238, 255], WATCH = [255, 212, 90], FLAG = [255, 170, 80], SURGE = [255, 84, 64];
  // Where the camera is on each screen, and the colour Malaysia takes there: today, the October 2025 surge, the day of the flag, today.
  const KEYS = [
    { el: $("k1"), lon: 108, lat: 7, dim: 1, fit: true, col: CALM },
    { el: $("k2"), lon: 110, lat: 4, dim: 0.3, col: SURGE },
    { el: $("k3"), lon: 107, lat: 5, dim: 0.3, col: FLAG },
    { el: $("k4"), lon: 108, lat: 7, dim: 1, col: CALM },
  ];
  const T_LOGO = 750, T_FLY = 800, T_ASM = 900;
  const SHADE = [0, 1, 2, 3, 4, 5].map((i) => `rgb(${[58, 68, 88].map((c) => Math.round(c + (255 - c) * (i / 5))).join(",")})`);
  const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif';
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

  let W = 0, H = 0, DPR = 1, land = [], mys = [], mark = null, scat = null, buf = [], cnt = [0, 0, 0, 0, 0, 0], lines = [], net = [], snow = [], story = null;
  let pointer = { x: -9999, y: -9999, nx: 0, ny: 0 }, drag = null, off = { lon: 0, lat: 0 }, tilt = { x: 0, y: 0 }, lastDrag = 0, view = { x: 0, y: 0, R: 1 };
  let t0 = performance.now(), introStart = 0, introDone = STILL, diveStart = 0, diveTo = "index.html", todayP = 0;

  const vec = ([lon, lat]) => { const l = lon * RAD, p = lat * RAD; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const smooth = (k) => k * k * (3 - 2 * k);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const dayMonth = (iso) => { const d = new Date(iso + "T00:00:00Z"); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; };

  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    root.style.setProperty("--r0", clamp(Math.min(W, H) * 0.06, 28, 50) + "px");
  }

  function keyAt(i) {
    const k = KEYS[i], r = k.el.getBoundingClientRect(), top = k.el.closest("section").getBoundingClientRect().top;
    return { x: r.left + r.width / 2, y: r.top - top + r.height / 2, R: Math.max(20, k.fit ? Math.min(r.width, r.height) * 0.45 : r.width / 2), lon: k.lon, lat: k.lat, dim: k.dim, col: k.col };
  }
  // The Earth never leaves the screen: scrolling moves the camera from one key position to the next.
  function frame(now) {
    const sh = KEYS[0].el.closest("section").offsetHeight || H, idx = clamp(scrollY / sh, 0, KEYS.length - 1);
    const i = Math.min(Math.floor(idx), KEYS.length - 2), t = smooth(idx - i), a = keyAt(i), b = keyAt(i + 1);
    let x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), R = Math.exp(lerp(Math.log(a.R), Math.log(b.R), t)), d = 0;
    if (!introDone) { const o = introO.getBoundingClientRect(), k = ease(clamp((now - introStart - T_LOGO) / T_FLY, 0, 1));
      x = lerp(o.left + o.width / 2, x, k); y = lerp(o.top + o.height / 2, y, k); R = lerp(o.width / 2.2, R, k); }
    if (diveStart) { d = clamp((now - diveStart) / 1300, 0, 1); x = lerp(x, W / 2, d); y = lerp(y, H / 2, d); R *= 1 + (R > W ? 2.5 : 11) * d * d * d; }
    return { x, y, R, d, idx, lon: lerp(a.lon, b.lon, t), lat: lerp(a.lat, b.lat, t), dim: lerp(a.dim, b.dim, t), col: a.col.map((c, j) => Math.round(lerp(c, b.col[j], t))) };
  }

  // thin white survey lines: they draw across the screen while loading, then only wake up near the pointer
  function drawNet(now, k0, fade) {
    cx.lineWidth = 1; cx.font = "10px ui-monospace,Menlo,monospace";
    for (const t of net) {
      const k = introDone ? 1 : clamp(k0 * 1.7 - t.delay, 0, 1); if (k <= 0) continue;
      const ox = t.x * W + (STILL ? 0 : Math.sin((now - t0) / 9000 + t.ph) * 14) - pointer.nx * 30 * t.z, oy = t.y * H + (STILL ? 0 : Math.cos((now - t0) / 11000 + t.ph) * 10) - pointer.ny * 22 * t.z;
      const dd = Math.hypot(ox - pointer.x, oy - pointer.y), a = fade + (dd < 240 ? 0.3 * (1 - dd / 240) : 0); if (a < 0.02) continue;
      const n = t.p.length, total = k * n;
      cx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`; cx.beginPath(); cx.moveTo(ox + t.p[0][0], oy + t.p[0][1]);
      for (let j = 1; j <= n; j++) { const q = t.p[j % n], pr = t.p[j - 1], f = clamp(total - (j - 1), 0, 1); if (f <= 0) break; cx.lineTo(ox + lerp(pr[0], q[0], f), oy + lerp(pr[1], q[1], f)); }
      cx.stroke();
      if (!introDone && k > 0.6) { cx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.7).toFixed(3)})`; cx.fillText(t.n, ox + t.p[0][0] + 5, oy + t.p[0][1] - 5); }
    }
  }

  function draw(now) {
    const f = frame(now), { x, y, R, d, idx } = f, t = now - introStart;
    const asm = introDone ? 1 : clamp((t - T_LOGO * 0.7) / T_ASM, 0, 1), body = ease(asm);
    const hero = clamp(1 - idx, 0, 1), whole = Math.max(hero, clamp(idx - (KEYS.length - 2), 0, 1));
    tilt.x += (pointer.nx * 6 - tilt.x) * 0.06; tilt.y += (-pointer.ny * 5 - tilt.y) * 0.06;
    if (!drag && now - lastDrag > 1200) { off.lon *= 0.94; off.lat *= 0.94; }
    const sway = STILL || drag || diveStart ? 0 : 7 * Math.sin((now - t0) / 4200) * whole;
    const lon0 = lerp(f.lon + sway + off.lon * hero + tilt.x * (0.3 + 0.7 * whole), MARK.lon + 5, d) * RAD, lat0 = lerp(f.lat + off.lat * hero + tilt.y * (0.3 + 0.7 * whole), MARK.lat, d) * RAD;
    const sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0);
    view = { sl, cl, sp, cp, x, y, R };
    const project = (v) => { const X = v[0] * cl - v[2] * sl, Z0 = v[0] * sl + v[2] * cl; return [X, v[1] * cp - Z0 * sp, v[1] * sp + Z0 * cp]; };

    cx.clearRect(0, 0, W, H);
    cx.fillStyle = "#fff";
    for (const s of snow) { const sx = (((s.x * W + (STILL ? 0 : (now - t0) * 0.006 * s.z) - pointer.nx * 30 * s.z) % W) + W) % W, sy = (((s.y * H + (STILL ? 0 : (now - t0) * 0.004 * s.z) - pointer.ny * 20 * s.z) % H) + H) % H;
      cx.globalAlpha = 0.14 + 0.4 * s.z; cx.fillRect(sx, sy, 1 + s.z * 1.2, 1 + s.z * 1.2); }
    cx.globalAlpha = 1;
    drawNet(now, introDone ? 1 : clamp(t / 450, 0, 1), introDone ? 0 : lerp(0.5, 0, clamp((t - T_LOGO) / 600, 0, 1)));

    // light behind the Earth, a soft shadow beneath it, then the lit body
    let g = cx.createRadialGradient(x, y, R * 0.9, x, y, R * 1.5 + 40);
    g.addColorStop(0, `rgba(226,238,252,${0.4 * Math.max(body, 0.4)})`); g.addColorStop(1, "rgba(226,238,252,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R * 1.5 + 40, 0, 7); cx.fill();
    if (whole > 0.02 && !diveStart) { cx.save(); cx.translate(x + R * 0.08, y + R * 1.17); cx.scale(1, 0.14);
      g = cx.createRadialGradient(0, 0, 0, 0, 0, R * 0.98); g.addColorStop(0, `rgba(14,20,34,${0.5 * whole * body})`); g.addColorStop(1, "rgba(14,20,34,0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(0, 0, R * 0.98, 0, 7); cx.fill(); cx.restore(); }
    cx.save(); cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.clip(); cx.globalAlpha = body;
    g = cx.createRadialGradient(x - R * 0.42, y - R * 0.5, R * 0.05, x, y, R * 1.08);
    g.addColorStop(0, "#8f9cb3"); g.addColorStop(0.45, "#5f6c85"); g.addColorStop(0.85, "#3e4960"); g.addColorStop(1, "#303a4f");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    g = cx.createLinearGradient(x - R * 0.6, y - R * 0.7, x + R * 0.7, y + R * 0.8); g.addColorStop(0.35, "rgba(10,16,30,0)"); g.addColorStop(1, "rgba(10,16,30,.46)");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    g = cx.createRadialGradient(x - R * 0.4 - tilt.x * R * 0.012, y - R * 0.5 + tilt.y * R * 0.012, 0, x - R * 0.4, y - R * 0.5, R * 0.62);
    g.addColorStop(0, "rgba(255,255,255,.30)"); g.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = g; cx.fillRect(x - R, y - R, R * 2, R * 2);
    cx.restore();

    // the wire globe: bright while loading, a faint grid afterwards
    cx.strokeStyle = `rgba(255,255,255,${introDone ? 0.1 : lerp(0.95, 0.1, body)})`; cx.lineWidth = introDone ? 1 : 1.2; cx.beginPath();
    for (const ln of lines) { let pen = false; for (const v of ln) { const p = project(v); if (p[2] > 0) { const px = x + p[0] * R, py = y - p[1] * R; pen ? cx.lineTo(px, py) : cx.moveTo(px, py); pen = true; } else pen = false; } }
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
      let sh = 0.2 + 0.8 * Math.max(0, p[0] * LIGHT[0] + p[1] * LIGHT[1] + p[2] * LIGHT[2]);
      const sc = Math.abs(p[0] - scan); if (sc < 0.16) sh += 0.3 * (1 - sc / 0.16);
      const dx = px - pointer.x, dy = py - pointer.y, dd = dx * dx + dy * dy;
      if (dd < reach * reach) { const q = 1 - Math.sqrt(dd) / reach, lift = (reach * 0.17 * q * q) / R; px += p[0] * R * lift; py -= p[1] * R * lift; sh += 0.5 * q; z = s * (1 + 1.1 * q); }
      const b = Math.min(5, (clamp(sh, 0, 1) * 5.999) | 0), o = cnt[b] * 3; buf[b][o] = px; buf[b][o + 1] = py; buf[b][o + 2] = z; cnt[b]++;
    }
    cx.globalAlpha = f.dim; const round = s >= 2.5;
    if (s >= 1.8) { cx.fillStyle = "rgba(10,16,30,.34)"; for (let b = 0; b < 6; b++) for (let j = 0, a = buf[b]; j < cnt[b] * 3; j += 3) cx.fillRect(a[j] - a[j + 2] * 0.1, a[j + 1], a[j + 2], a[j + 2]); }
    for (let b = 0; b < 6; b++) { cx.fillStyle = SHADE[b]; const a = buf[b];
      if (round) { cx.beginPath(); for (let j = 0; j < cnt[b] * 3; j += 3) { cx.moveTo(a[j] + a[j + 2] / 2, a[j + 1]); cx.arc(a[j], a[j + 1], a[j + 2] / 2, 0, 7); } cx.fill(); }
      else for (let j = 0; j < cnt[b] * 3; j += 3) cx.fillRect(a[j] - a[j + 2] / 2, a[j + 1] - a[j + 2] / 2, a[j + 2], a[j + 2]); }
    // Malaysia: a soft glow and its own beads, coloured by the moment the screen is about
    const c = f.col, m = project(mark), mx = x + m[0] * R, my = y - m[1] * R, ms = clamp(R * 0.0075, 1.4, 4.6), far = lerp(0.42, 1, whole);
    if (asm > 0.55) {
      if (m[2] > 0) { g = cx.createRadialGradient(mx, my, 0, mx, my, R * 0.22 + 22); g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.4 * m[2] * far})`); g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        cx.globalAlpha = 1; cx.fillStyle = g; cx.beginPath(); cx.arc(mx, my, R * 0.22 + 22, 0, 7); cx.fill(); }
      cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      for (let i = 0; i < mys.length; i++) { const p = project(mys[i]); if (p[2] <= 0) continue; cx.globalAlpha = (0.45 + 0.55 * p[2]) * far; cx.fillRect(x + p[0] * R - ms / 2, y - p[1] * R - ms / 2, ms, ms); }
    }
    cx.globalAlpha = body; cx.lineWidth = 1; cx.strokeStyle = "rgba(255,255,255,.4)"; cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.stroke();
    cx.lineWidth = 1.8; cx.strokeStyle = "rgba(255,255,255,.95)"; cx.beginPath(); cx.arc(x, y, R, Math.PI * 1.06, Math.PI * 1.62); cx.stroke();
    cx.globalAlpha = 1;

    // first screen only: a pulse and a label on Malaysia, and a crosshair that reads out where the pointer is
    const first = introDone && !diveStart && hero > 0.6;
    if (first && m[2] > 0.15) {
      const beat = STILL ? 0.5 : ((now - t0) % 2600) / 2600, rr = lerp(7, 18 + 30 * todayP, beat);
      cx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.95 * (1 - beat)})`; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(mx, my, rr, 0, 7); cx.stroke();
      const tw = tag.offsetWidth, flip = mx + 16 + tw > W - 8;
      tag.hidden = false; tag.classList.toggle("under", flip);
      tag.style.transform = flip ? `translate(${Math.round(clamp(mx - tw / 2, 8, W - tw - 8))}px,${Math.round(my + 26)}px)` : `translate(${Math.round(mx + 16)}px,${Math.round(my - 8)}px)`;
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

    // the two charts draw themselves as their screen scrolls in
    if (story) { if (idx > 0.2 && idx < 1.9) chart($("chartA"), "A", clamp((idx - 0.45) / 0.5, 0, 1)); if (idx > 1.2 && idx < 2.9) chart($("chartB"), "B", clamp((idx - 1.45) / 0.5, 0, 1)); }

    tickIntro(now);
    if (diveStart && d >= 1) return;
    if (!STILL) requestAnimationFrame(draw);
  }
  const redraw = () => { if (STILL) requestAnimationFrame(draw); };

  // ---- the October 2025 chart. Mode A: what happened. Mode B: the day the model raised its flag. ----
  function chart(el, mode, prog) {
    const w = el.clientWidth, h = el.clientHeight; if (w < 40 || h < 40) return;
    if (el.width !== Math.round(w * DPR) || el.height !== Math.round(h * DPR)) { el.width = Math.round(w * DPR); el.height = Math.round(h * DPR); }
    const g = el.getContext("2d"); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, w, h);
    const P = story.pts, n = P.length, small = w < 520, fs = small ? 12 : 14, L = 10, Rt = 10, top = small ? 44 : 54, bot = small ? 44 : 50;
    const X = (i) => L + (i * (w - L - Rt)) / (n - 1), Y = (p) => top + (1 - p / story.ymax) * (h - top - bot);
    const at = (u) => { const i = Math.min(n - 2, Math.floor(u)), k = u - i; return [lerp(X(i), X(i + 1), k), lerp(Y(P[i].p), Y(P[i + 1].p), k)]; };
    const path = (from, to) => { g.beginPath(); g.moveTo(...at(from)); for (let i = Math.floor(from) + 1; i < to; i++) g.lineTo(X(i), Y(P[i].p)); g.lineTo(...at(to)); };
    const text = (s, x, y, o = {}) => { g.font = `${o.w || 500} ${o.s || fs}px ${FONT}`; g.textAlign = o.a || "center"; g.fillStyle = o.c || "#fff"; g.globalAlpha = o.o == null ? 1 : o.o; g.fillText(s, x, y); g.globalAlpha = 1; };
    const fi = story.flag, ci = story.cross, show = (from) => clamp((prog - from) / 0.15, 0, 1);

    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(w - Rt, Y(0)); g.stroke();
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.moveTo(L, Y(story.line)); g.lineTo(w - Rt, Y(story.line)); g.stroke(); g.setLineDash([]);
    text("Surge line", L, Y(story.line) - 8, { a: "left", s: fs - 1, o: 0.9 });
    if (!(small && mode === "B")) text("Share of flu tests that came back positive", L, 16, { a: "left", s: fs - 1, o: 0.85 });

    if (mode === "A") {
      const end = prog * (n - 1);
      if (end > 0.01) { g.strokeStyle = "#fff"; g.lineWidth = 3; path(0, end); g.stroke(); }
      if (end > fi) { g.strokeStyle = "rgb(255,84,64)"; g.lineWidth = 5; path(fi, Math.min(end, ci)); g.stroke(); }
      if (end >= fi) { g.fillStyle = "#fff"; g.beginPath(); g.arc(X(fi), Y(P[fi].p), 6, 0, 7); g.fill(); text(P[fi].p.toFixed(1) + "%", X(fi) - 12, Y(P[fi].p) - 14, { a: "right", w: 700, s: fs + 4 }); text(P[fi].d, X(fi), Y(0) + 22, { o: 0.9 }); }
      if (end >= ci) { g.fillStyle = "rgb(255,84,64)"; g.beginPath(); g.arc(X(ci), Y(P[ci].p), 7, 0, 7); g.fill(); text(Math.round(P[ci].p) + "%", X(ci) - 14, Y(P[ci].p) - 12, { a: "right", w: 700, s: fs + (small ? 10 : 18) }); text(P[ci].d, X(ci), Y(0) + 22, { o: 0.9 }); }
    } else {
      const solid = clamp(prog / 0.45, 0, 1) * fi, after = clamp((prog - 0.6) / 0.4, 0, 1);
      if (solid > 0.01) { g.strokeStyle = "#fff"; g.lineWidth = 3; path(0, solid); g.stroke(); }
      if (after > 0) { g.setLineDash([3, 7]); g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 2.5; path(fi, fi + after * (n - 1 - fi)); g.stroke(); g.setLineDash([]); }
      const a1 = show(0.45);
      if (a1 > 0) { const fx = X(fi), label = `${P[fi].d}: flag raised`, sub = `${story.flagPct}% chance of a rapid rise`;
        g.globalAlpha = a1; g.strokeStyle = "rgb(255,170,80)"; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, Y(0)); g.lineTo(fx, top - 6); g.stroke();
        g.font = `700 ${fs}px ${FONT}`; const pw = g.measureText(label).width + 24, px = clamp(fx - pw / 2, 0, w - pw);
        g.fillStyle = "rgb(255,170,80)"; g.beginPath(); g.roundRect ? g.roundRect(px, top - 34, pw, 28, 14) : g.rect(px, top - 34, pw, 28); g.fill();
        g.globalAlpha = 1; text(label, px + pw / 2, top - 15, { w: 700, c: "#18212e", o: a1 }); text(sub, fx + 12, top + 16, { a: "left", s: fs - 1, o: 0.95 * a1 });
        g.fillStyle = "#fff"; g.globalAlpha = a1; g.beginPath(); g.arc(fx, Y(P[fi].p), 6, 0, 7); g.fill(); g.globalAlpha = 1; }
      const a2 = show(0.85);
      if (a2 > 0) { const cxp = X(ci), by = Y(0) + 14;
        g.globalAlpha = a2; g.fillStyle = "rgb(255,84,64)"; g.beginPath(); g.arc(cxp, Y(P[ci].p), 7, 0, 7); g.fill();
        g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(fi), by - 5); g.lineTo(X(fi), by + 5); g.moveTo(X(fi), by); g.lineTo(cxp, by); g.moveTo(cxp, by - 5); g.lineTo(cxp, by + 5); g.stroke(); g.globalAlpha = 1;
        text("4 weeks", (X(fi) + cxp) / 2, by + 22, { w: 700, s: fs + 2, o: a2 }); text(`${P[ci].d}: surge line crossed`, cxp + 14, Y(P[ci].p) + 5, { a: small ? "right" : "left", s: fs - 1, o: a2 * (small ? 0 : 1) }); }
    }
  }

  // ---- opening: the logo with the wire Earth as its O, then the Earth settles and flies to its place ----
  function tickIntro(now) {
    if (introDone) return;
    const t = now - introStart, b = document.body.classList;
    b.toggle("p-logo", t < T_LOGO);
    if (t > T_LOGO + 220 && !b.contains("ready")) { b.add("ready"); b.remove("loading"); }
    if (t > T_LOGO + Math.max(T_FLY, T_ASM)) { introDone = true; $("intro").remove(); try { sessionStorage.setItem("dom-seen", "1"); } catch (e) {} }
  }
  const skipIntro = () => { if (!introDone && performance.now() - introStart < T_LOGO) introStart = performance.now() - T_LOGO; };

  // ---- the logo's O: the same Earth, small ----
  function navLogo() {
    const c = $("navO"), g = c.getContext("2d"), R = 26, o = 30, l = 108 * RAD, p = 2 * RAD;
    const pr = (v) => { const X = v[0] * Math.cos(l) - v[2] * Math.sin(l), Z0 = v[0] * Math.sin(l) + v[2] * Math.cos(l); return [X, v[1] * Math.cos(p) - Z0 * Math.sin(p), v[1] * Math.sin(p) + Z0 * Math.cos(p)]; };
    g.clearRect(0, 0, 60, 60); g.fillStyle = "#fff";
    for (let i = 0; i < land.length; i++) { const q = pr(land[i]); if (q[2] > 0.05) { g.globalAlpha = 0.55 + 0.45 * q[2]; g.fillRect(o + q[0] * R - 0.8, o - q[1] * R - 0.8, 1.6, 1.6); } }
    g.globalAlpha = 0.95; g.strokeStyle = "#fff"; g.lineWidth = 1.6; g.beginPath(); g.arc(o, o, R + 1.5, 0, 7); g.stroke();
    g.globalAlpha = 1; const q = pr(mark); g.fillStyle = "#ff6a3d"; g.beginPath(); g.arc(o + q[0] * R, o - q[1] * R, 4.2, 0, 7); g.fill();
  }

  // ---- real numbers: today's reading, the October 2025 replay and the test result, all from the app's own data and model ----
  function readData(D) {
    const pct = (s) => (100 * s.pos) / s.n, S = D.series, cut = D.replay_cut_index, M = window.FluModel;
    const now = M.riseSignal(S, D.rise.current), then = M.riseSignal(S.slice(0, cut + 1), D.rise.replay), T = D.rise.test.models.gradient_boosted;
    const pts = S.slice(cut - 4, cut + 7).map((s) => ({ p: pct(s), d: dayMonth(s.start) }));
    let cross = pts.findIndex((q, i) => i > 4 && q.p > D.thresholds.orange); if (cross < 0) cross = pts.length - 1;
    story = { pts, flag: 4, cross, line: D.thresholds.orange, ymax: Math.ceil((Math.max(...pts.map((q) => q.p)) + 5) / 5) * 5, flagPct: Math.round(then.prob * 100) };
    todayP = now.prob;
    const word = now.prob >= 0.5 ? "Rise likely" : now.prob >= 0.25 ? "Watch" : "Calm", col = now.prob >= 0.5 ? FLAG : now.prob >= 0.25 ? WATCH : CALM;
    KEYS[0].col = KEYS[3].col = col;
    $("nowPct").textContent = Math.round(now.prob * 100); $("nowWord").textContent = word; $("tagWord").textContent = word.toLowerCase() + " today";
    const last = S[S.length - 1], y = new Date(last.start + "T00:00:00Z").getUTCFullYear();
    $("nowProof").textContent = `Tested on ${D.rise.test.n_test} unseen weeks: it caught ${T.tp} of ${T.tp + T.fn} rises, with ${T.fp} false alarms. Newest public data: week of ${dayMonth(last.start)} ${y}.`;
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
  size(); mark = vec([MARK.lon, MARK.lat]);
  for (let la = -60; la <= 60; la += 20) { const l = []; for (let lo = 0; lo <= 360; lo += 6) l.push(vec([lo, la])); lines.push(l); }
  for (let lo = 0; lo < 360; lo += 20) { const l = []; for (let la = -90; la <= 90; la += 6) l.push(vec([lo, la])); lines.push(l); }
  for (let i = 0; i < 46; i++) { const n = 3 + (Math.random() < 0.3 ? 1 : 0), r = 40 + Math.random() * 120, a0 = Math.random() * 7, p = [];
    for (let j = 0; j < n; j++) { const a = a0 + (j / n) * 6.283 + (Math.random() - 0.5) * 1.2, q = r * (0.5 + Math.random() * 0.8); p.push([Math.cos(a) * q, Math.sin(a) * q * 0.7]); }
    net.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, p, n: String(20 + Math.floor(Math.random() * 79)), delay: Math.random() * 0.7, ph: Math.random() * 6 }); }
  for (let i = 0; i < 60; i++) snow.push({ x: Math.random(), y: Math.random(), z: Math.random() });

  let seen = false; try { seen = sessionStorage.getItem("dom-seen") === "1"; } catch (e) {}
  Promise.all([fetch("data/dots.json").then((r) => r.json()), fetch("data/site.json").then((r) => r.json()), document.fonts ? document.fonts.ready : 0]).then(([d, D]) => {
    land = d.land.map(vec); mys = d.malaysia.map(vec); navLogo(); readData(D);
    scat = new Float32Array(land.length * 3);
    for (let i = 0; i < land.length; i++) { const a = Math.random() * 6.283, q = 0.5 + Math.random() * 1.6; scat[i * 3] = Math.cos(a) * q; scat[i * 3 + 1] = Math.sin(a) * q; scat[i * 3 + 2] = Math.random() * 0.55; }
    buf = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(land.length * 3));
    if (STILL || seen) { introDone = true; $("intro").remove(); document.body.classList.add("ready"); document.body.classList.remove("loading"); }
    introStart = performance.now(); requestAnimationFrame(draw);
  });
})();
