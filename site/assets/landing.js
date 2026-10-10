// DOM landing page: opening sequence, the dotted Earth, the moving band, the picture ring, the forecast lens, the dive into the app.
// No libraries. The Earth is a sphere of dots projected in code; data/dots.json is written by pipeline/landing_dots.py.
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $("earth"), cx = cv.getContext("2d"), slotA = $("slotA"), slotB = $("slotB"), horizon = $("how");
  const tag = $("tag"), hud = $("hud"), introO = document.querySelector(".intro-logo i"), root = document.documentElement;
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const RAD = Math.PI / 180, HOME = { lon: 108, lat: 7 }, MARK = { lon: 102.2, lat: 3.9 }, LOW = { lon: 109, lat: -49 };
  const T_LOAD = 1100, T_LOGO = 1150, T_FLY = 1150;
  const LEVELS = [
    { max: 20, name: "Calm", rgb: [185, 198, 209] },
    { max: 40, name: "Watch", rgb: [241, 211, 106] },
    { max: 60, name: "Alert", rgb: [255, 143, 107] },
    { max: 101, name: "Surge likely", rgb: [255, 90, 77] },
  ];
  // SAMPLE figures for the lens until the model output is wired in. Labelled "Sample data" on the page.
  const SAMPLE = {
    1: [12, "Positive tests are near the usual level this week."],
    2: [24, "Positive tests rose two weeks in a row."],
    3: [38, "The rise is faster than usual for October."],
    4: [46, "Positive tests rose from 17% to 22% in two weeks."],
  };

  let W = 0, H = 0, DPR = 1, land = [], mys = [], mark = null, stars = [];
  let pointer = { x: -9999, y: -9999 }, drag = null, off = { lon: 0, lat: 0 }, lastDrag = 0;
  let t0 = performance.now(), introStart = 0, introDone = STILL, diveStart = 0, diveTo = "index.html";
  let chance = 0, level = LEVELS[1], view = { sl: 0, cl: 1, sp: 0, cp: 1 }, lastScroll = 0, bandX = 0, orbitOn = false;

  const vec = ([lon, lat]) => { const l = lon * RAD, p = lat * RAD; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const smooth = (k) => k * k * (3 - 2 * k);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    root.style.setProperty("--r0", clamp(Math.min(W, H) * 0.06, 30, 50) + "px");
  }

  // Where the Earth sits. It glides from the first screen (whole, small) to the second (huge, rising from the bottom) as the page scrolls.
  function frame(now) {
    const a = slotA.getBoundingClientRect(), b = slotB.getBoundingClientRect(), top2 = horizon.getBoundingClientRect().top + scrollY;
    const e = smooth(clamp(scrollY / Math.max(1, top2), 0, 1));
    let x = lerp(a.left + a.width / 2, b.left + b.width / 2, e), y = lerp(a.top + a.height / 2, b.top + b.height / 2, e);
    let R = lerp(Math.min(a.width, a.height) * 0.47, b.width / 2, e), k = 1;
    if (!introDone) { const o = introO.getBoundingClientRect(), r0 = o.width / 2.2;
      k = ease(clamp((now - introStart - T_LOAD - T_LOGO) / T_FLY, 0, 1));
      x = lerp(o.left + o.width / 2, x, k); y = lerp(o.top + o.height / 2, y, k); R = lerp(r0, R, k); }
    let d = 0;
    if (diveStart) { d = clamp((now - diveStart) / 1300, 0, 1); x = lerp(x, W / 2, d); y = lerp(y, H / 2, d); R *= 1 + (R > W ? 2.5 : 11) * d * d * d; }
    return { x, y, R, d, e, k };
  }

  function draw(now) {
    const { x, y, R, d, e, k } = frame(now), intro = introDone ? 9 : (now - introStart) / T_LOAD;
    if (!drag && now - lastDrag > 1200) { off.lon *= 0.94; off.lat *= 0.94; }
    const sway = STILL || drag || diveStart ? 0 : 8 * Math.sin((now - t0) / 4200) * (1 - e);
    const lon0 = lerp(lerp(HOME.lon + sway + off.lon, LOW.lon, e), MARK.lon + 5, d) * RAD;
    const lat0 = lerp(lerp(HOME.lat + off.lat, LOW.lat, e), MARK.lat, d) * RAD;
    const sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0);
    view = { sl, cl, sp, cp, x, y, R };
    const project = (v) => { const X = v[0] * cl - v[2] * sl, Z0 = v[0] * sl + v[2] * cl; return [X, v[1] * cp - Z0 * sp, v[1] * sp + Z0 * cp]; };

    cx.clearRect(0, 0, W, H);
    // faint drifting stars, nearer ones shift more with the pointer
    cx.fillStyle = "#cfe6fa";
    for (const s of stars) { const sx = (((s.x * W + (STILL ? 0 : (now - t0) * 0.004 * s.z) - pointer.nx * 26 * s.z) % W) + W) % W, sy = (s.y * H - pointer.ny * 18 * s.z + H) % H;
      cx.globalAlpha = 0.1 + 0.45 * s.z; cx.fillRect(sx, sy, 1 + s.z, 1 + s.z); }
    cx.globalAlpha = 1;

    cx.save(); cx.beginPath(); cx.rect(0, -9, W, horizon.getBoundingClientRect().bottom + 9); cx.clip();   // the Earth never spills past the second screen
    let g = cx.createRadialGradient(x, y, R * 0.92, x, y, R * 1.4 + 40);
    g.addColorStop(0, "rgba(150,205,255,.22)"); g.addColorStop(1, "rgba(150,205,255,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R * 1.4 + 40, 0, 7); cx.fill();
    g = cx.createRadialGradient(x - R * 0.4, y - R * 0.5, R * 0.1, x, y, R);
    g.addColorStop(0, "#1b3247"); g.addColorStop(0.55, "#0d1a26"); g.addColorStop(1, "#070d13");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.fill();
    cx.lineWidth = 1; cx.strokeStyle = "rgba(191,227,255,.30)"; cx.stroke();
    cx.lineWidth = 1.6; cx.strokeStyle = "rgba(220,242,255,.8)"; cx.beginPath(); cx.arc(x, y, R, Math.PI * 1.08, Math.PI * 1.62); cx.stroke();

    // land dots; while loading they appear from the top down; near the pointer they lift toward it
    const s = clamp(R * 0.0075, 1.1, 3.4), reach = clamp(R * 0.34, 70, 170);
    const scan = STILL || diveStart ? 9 : (((now - t0) % 7000) / 7000) * 3.2 - 1.6;
    cx.fillStyle = "rgb(200,228,250)";
    for (let i = 0; i < land.length; i++) {
      const p = project(land[i]); if (p[2] <= 0) continue;
      if (intro < 1 && (1 - p[1]) / 2 > intro) continue;
      let px = x + p[0] * R, py = y - p[1] * R; if (py < -8 || py > H + 8 || px < -8 || px > W + 8) continue;
      let a = 0.2 + 0.6 * p[2] + 0.22 * Math.max(0, -p[0] * 0.6 + p[1] * 0.6), z = s;
      const sc = Math.abs(p[0] - scan); if (sc < 0.16) a += 0.45 * (1 - sc / 0.16);
      const dx = px - pointer.x, dy = py - pointer.y, dd = dx * dx + dy * dy;
      if (dd < reach * reach) { const q = 1 - Math.sqrt(dd) / reach, lift = 1 + (reach * 0.16 * q * q) / R;
        px = x + p[0] * R * lift; py = y - p[1] * R * lift; a += 0.6 * q; z = s * (1 + 1.1 * q); }
      cx.globalAlpha = Math.min(1, a); cx.fillRect(px - z / 2, py - z / 2, z, z);
    }
    // Malaysia, in the colour of the current risk level
    const c = level.rgb, glow = 0.6 + 0.4 * (chance / 100), ms = clamp(R * 0.0058, 1, 3.6);
    cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    for (let i = 0; i < mys.length; i++) {
      const p = project(mys[i]); if (p[2] <= 0 || (intro < 1 && (1 - p[1]) / 2 > intro)) continue;
      cx.globalAlpha = (0.35 + 0.65 * p[2]) * glow; cx.fillRect(x + p[0] * R - ms / 2, y - p[1] * R - ms / 2, ms, ms);
    }
    cx.globalAlpha = 1;
    const m = project(mark), mx = x + m[0] * R, my = y - m[1] * R, shown = introDone && !diveStart && m[2] > 0.15 && my > 70 && my < H - 20 && !(W < 700 && e > 0.5);
    if (shown) {
      const beat = STILL ? 0.5 : ((now - t0) % 2600) / 2600, rr = lerp(6, 16 + 30 * (chance / 100), beat);
      cx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.8 * (1 - beat)})`; cx.lineWidth = 1.4; cx.beginPath(); cx.arc(mx, my, rr, 0, 7); cx.stroke();
      const tw = tag.offsetWidth, flip = mx + 14 + tw > W - 8;
      tag.hidden = false; tag.classList.toggle("under", flip);
      tag.style.transform = flip ? `translate(${Math.round(clamp(mx - tw / 2, 8, W - tw - 8))}px,${Math.round(my + 24)}px)` : `translate(${Math.round(mx + 14)}px,${Math.round(my - 8)}px)`;
    } else tag.hidden = true;
    // pointer crosshair with the place it is over
    const pd = Math.hypot(pointer.x - x, pointer.y - y);
    if (introDone && !diveStart && !drag && pd < R && pointer.y < horizon.getBoundingClientRect().bottom) {
      const X = (pointer.x - x) / R, Y = -(pointer.y - y) / R, Z = Math.sqrt(Math.max(0, 1 - X * X - Y * Y));
      const vy = Y * cp + Z * sp, Z0 = -Y * sp + Z * cp, vx = X * cl + Z0 * sl, vz = -X * sl + Z0 * cl;
      const la = Math.asin(clamp(vy, -1, 1)) / RAD, lo = Math.atan2(vx, vz) / RAD;
      cx.strokeStyle = "rgba(191,227,255,.7)"; cx.lineWidth = 1; cx.beginPath();
      cx.moveTo(pointer.x - 9, pointer.y); cx.lineTo(pointer.x - 3, pointer.y); cx.moveTo(pointer.x + 3, pointer.y); cx.lineTo(pointer.x + 9, pointer.y);
      cx.moveTo(pointer.x, pointer.y - 9); cx.lineTo(pointer.x, pointer.y - 3); cx.moveTo(pointer.x, pointer.y + 3); cx.lineTo(pointer.x, pointer.y + 9); cx.stroke();
      hud.hidden = false; hud.textContent = `${Math.abs(la).toFixed(1)}°${la >= 0 ? "N" : "S"}  ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? "E" : "W"}`;
      hud.style.transform = `translate(${Math.round(Math.min(pointer.x + 16, W - 150))}px,${Math.round(pointer.y + 14)}px)`;
    } else hud.hidden = true;
    cx.restore();

    tickIntro(now); tickBand(); if (orbitOn) tickOrbit(now);
    if (diveStart && d >= 1) return;
    if (!STILL) requestAnimationFrame(draw);
  }
  const redraw = () => { if (STILL) requestAnimationFrame(draw); };

  // ---- opening: counter, logo, flight ----
  function tickIntro(now) {
    if (introDone) return;
    const t = now - introStart, b = document.body.classList;
    $("loadN").textContent = String(Math.round(clamp(t / T_LOAD, 0, 1) * 100)).padStart(3, "0");
    b.toggle("p-load", t < T_LOAD); b.toggle("p-logo", t >= T_LOAD && t < T_LOAD + T_LOGO);
    if (t > T_LOAD + T_LOGO + 380 && !b.contains("ready")) { b.add("ready"); b.remove("loading"); setWeeks(4, true); }
    if (t > T_LOAD + T_LOGO + T_FLY) { introDone = true; $("intro").remove(); }
  }
  const skipIntro = () => { if (!introDone && performance.now() - introStart < T_LOAD + T_LOGO) introStart = performance.now() - T_LOAD - T_LOGO; };

  // ---- the logo's O: the same Earth, small ----
  function navLogo() {
    const c = $("navO"), g = c.getContext("2d"), R = 26, o = 30, l = HOME.lon * RAD, p = 2 * RAD;
    const pr = (v) => { const X = v[0] * Math.cos(l) - v[2] * Math.sin(l), Z0 = v[0] * Math.sin(l) + v[2] * Math.cos(l); return [X, v[1] * Math.cos(p) - Z0 * Math.sin(p), v[1] * Math.sin(p) + Z0 * Math.cos(p)]; };
    g.clearRect(0, 0, 60, 60); g.fillStyle = "#f4f8fb";
    for (let i = 0; i < land.length; i++) { const q = pr(land[i]); if (q[2] > 0.05) { g.globalAlpha = 0.5 + 0.5 * q[2]; g.fillRect(o + q[0] * R - 0.8, o - q[1] * R - 0.8, 1.6, 1.6); } }
    g.globalAlpha = 0.9; g.strokeStyle = "#f4f8fb"; g.lineWidth = 1.6; g.beginPath(); g.arc(o, o, R + 1.5, 0, 7); g.stroke();
    g.globalAlpha = 1; const q = pr(mark); g.fillStyle = "#ff8a3d"; g.beginPath(); g.arc(o + q[0] * R, o - q[1] * R, 4.2, 0, 7); g.fill();
  }

  // ---- the moving band: drifts by itself and runs faster with the scroll ----
  const track = $("track"); track.innerHTML += track.innerHTML;
  function tickBand() {
    const dy = scrollY - lastScroll; lastScroll = scrollY;
    bandX += (STILL ? 0 : 0.7) + Math.abs(dy) * 0.55; const half = track.scrollWidth / 2; if (half) track.style.transform = `translate3d(${-(bandX % half)}px,0,0)`;
  }

  // ---- the picture ring: back pictures pass above the forecast, front ones below ----
  const cards = [...document.querySelectorAll(".card")], stage = $("stage"), lensEl = document.querySelector(".lens");
  function tickOrbit(now) {
    const w = stage.clientWidth, h = stage.clientHeight, rx = Math.min(w * 0.44, 620), ry = h * 0.37;
    const a0 = (STILL ? 0 : now * 0.00011) + scrollY * 0.0016 + pointer.nx * 0.25;
    const lw = lensEl.offsetWidth / 2, lh = lensEl.offsetHeight / 2, cw = cards[0].offsetWidth / 2, ch = cards[0].offsetHeight / 2;
    cards.forEach((el, i) => {
      const a = a0 + (i / cards.length) * Math.PI * 2, front = (Math.cos(a) + 1) / 2;
      const px = Math.sin(a) * rx, sc = lerp(0.6, 1.08, front); let py = lerp(-ry, ry, front) * (front > 0.5 ? 1 + 0.42 * (1 - Math.abs(Math.sin(a))) : 1);   // front pictures swing clear below the forecast
      if (front > 0.5 && Math.abs(px) < lw + cw * sc + 10) py = Math.max(py, lh + ch * sc + 16);
      el.style.transform = `translate3d(calc(-50% + ${px.toFixed(1)}px),calc(-50% + ${py.toFixed(1)}px),0) scale(${sc.toFixed(3)}) rotate(${(Math.sin(a) * -5).toFixed(2)}deg)`;
      el.style.opacity = lerp(0.22, 1, front).toFixed(2); el.style.filter = front < 0.45 ? `blur(${((0.45 - front) * 7).toFixed(1)}px)` : "none";
      el.style.zIndex = front > 0.5 ? 60 : 10;
    });
  }

  // ---- forecast lens ----
  const C = 2 * Math.PI * 78;
  function setWeeks(n, animate) {
    const [p, why] = SAMPLE[n];
    level = LEVELS.find((l) => p < l.max);
    $("wkLabel").textContent = n === 1 ? "week" : n + " weeks";
    $("why").textContent = why; $("level").textContent = level.name;
    const col = `rgb(${level.rgb.join(",")})`;
    $("level").style.color = col; $("level").style.background = `rgba(${level.rgb.join(",")},.14)`;
    $("arc").style.strokeDasharray = `${(C * p) / 100} ${C}`;
    const a = (-90 + 3.6 * p) * RAD; $("tip").setAttribute("cx", 100 + 78 * Math.cos(a)); $("tip").setAttribute("cy", 100 + 78 * Math.sin(a)); $("tip").style.fill = col;
    const from = chance, start = performance.now(), el = $("pct");
    (function roll(t) { const k = animate && !STILL ? clamp((t - start) / 600, 0, 1) : 1; chance = lerp(from, p, ease(k)); el.textContent = Math.round(chance); if (k < 1) requestAnimationFrame(roll); else redraw(); })(start);
  }
  function ticks() {
    let h = ""; for (let i = 0; i < 40; i++) { const a = (i * 9 - 90) * RAD, c = Math.cos(a), s = Math.sin(a), r = i % 10 ? 94 : 97;
      h += `<line x1="${100 + 91 * c}" y1="${100 + 91 * s}" x2="${100 + r * c}" y2="${100 + r * s}"/>`; }
    $("ticks").innerHTML = h;
  }

  // ---- pointer: the dots and the mist follow it; dragging turns the Earth on the first screen ----
  pointer.nx = pointer.ny = 0;
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.nx = (e.clientX / W) * 2 - 1; pointer.ny = (e.clientY / H) * 2 - 1;
    root.style.setProperty("--mx", pointer.nx.toFixed(3)); root.style.setProperty("--my", pointer.ny.toFixed(3));
    if (drag) { const k = 80 / view.R; off.lon = clamp(drag.lon - (e.clientX - drag.x) * k, -170, 170); off.lat = clamp(drag.lat + (e.clientY - drag.y) * k, -55, 55); lastDrag = performance.now(); }
    redraw();
  });
  cv.addEventListener("pointerdown", (e) => {
    skipIntro(); if (!introDone || scrollY > H * 0.4 || Math.hypot(e.clientX - view.x, e.clientY - view.y) > view.R * 1.1) return;
    drag = { x: e.clientX, y: e.clientY, lon: off.lon, lat: off.lat }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
  });
  const drop = () => { if (drag) { drag = null; lastDrag = performance.now(); cv.style.cursor = ""; redraw(); } };
  addEventListener("pointerup", drop); addEventListener("pointercancel", drop);
  addEventListener("keydown", skipIntro);
  document.addEventListener("pointerleave", () => { pointer.x = pointer.y = -9999; redraw(); });
  addEventListener("resize", () => { size(); redraw(); });
  addEventListener("scroll", redraw, { passive: true });

  new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) horizon.classList.add("in"); }), { threshold: 0.45 }).observe(horizon);
  new IntersectionObserver((es) => es.forEach((en) => { orbitOn = en.isIntersecting; if (orbitOn) tickOrbit(performance.now()); }), { rootMargin: "200px" }).observe($("orbit"));

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

  size(); ticks(); mark = vec([MARK.lon, MARK.lat]);
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), z: Math.random() });
  Promise.all([fetch("data/dots.json").then((r) => r.json()), document.fonts ? document.fonts.ready : 0]).then(([d]) => {
    land = d.land.map(vec); mys = d.malaysia.map(vec); navLogo();
    $("weeks").addEventListener("input", (e) => setWeeks(+e.target.value, true));
    if (STILL) { $("intro").remove(); document.body.classList.add("ready"); document.body.classList.remove("loading"); setWeeks(4, false); tickOrbit(0); }
    introStart = performance.now(); requestAnimationFrame(draw);
  });
})();
