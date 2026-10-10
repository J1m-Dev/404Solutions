// DOM landing page: the dotted Earth, the forecast lens, and the dive into the app.
// No libraries. The Earth is a sphere of dots projected in code; data/dots.json is written by pipeline/landing_dots.py.
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $("earth"), cx = cv.getContext("2d"), slot = $("slot"), tag = $("tag"), logoO = $("logoO");
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const RAD = Math.PI / 180, HOME = { lon: 108, lat: 7 }, MARK = { lon: 102.2, lat: 3.9 };
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

  let W = 0, H = 0, DPR = 1, land = [], mys = [], mark = null;
  let pointer = { x: -9999, y: -9999 }, drag = null, off = { lon: 0, lat: 0 }, lastDrag = 0;
  let t0 = performance.now(), introStart = t0, diveStart = 0, diveTo = "index.html";
  let chance = 0, level = LEVELS[1];

  const vec = ([lon, lat]) => { const l = lon * RAD, p = lat * RAD; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // Where the Earth sits: the empty middle column on wide screens, its own block on a phone.
  function frame(now) {
    const r = slot.getBoundingClientRect(), o = logoO.getBoundingClientRect();
    let x = r.left + r.width / 2, y = r.top + r.height / 2, R = Math.min(r.width, r.height) * 0.46;
    const k = STILL ? 1 : ease(clamp((now - introStart) / 1500, 0, 1));
    x = lerp(o.left + o.width / 2, x, k); y = lerp(o.top + o.height / 2, y, k); R = lerp(o.width / 2, R, k);
    let d = 0;
    if (diveStart) { d = clamp((now - diveStart) / 1300, 0, 1); const e = d * d * d;
      x = lerp(x, W / 2, d); y = lerp(y, H / 2, d); R = R * (1 + 11 * e); }
    return { x, y, R, d };
  }

  function draw(now) {
    const f = frame(now), { x, y, R, d } = f;
    if (!drag && now - lastDrag > 1200) { off.lon *= 0.94; off.lat *= 0.94; }
    const sway = STILL || drag || diveStart ? 0 : 8 * Math.sin((now - t0) / 4200);
    const lon0 = (lerp(HOME.lon + sway + off.lon, MARK.lon + 5, d)) * RAD, lat0 = lerp(HOME.lat + off.lat, MARK.lat, d) * RAD;
    const sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0);
    const project = (v) => { const X = v[0] * cl - v[2] * sl, Z0 = v[0] * sl + v[2] * cl; return [X, v[1] * cp - Z0 * sp, v[1] * sp + Z0 * cp]; };

    cx.clearRect(0, 0, W, H);
    // atmosphere and body
    let g = cx.createRadialGradient(x, y, R * 0.9, x, y, R * 1.45);
    g.addColorStop(0, "rgba(150,205,255,.20)"); g.addColorStop(1, "rgba(150,205,255,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R * 1.45, 0, 7); cx.fill();
    g = cx.createRadialGradient(x - R * 0.4, y - R * 0.45, R * 0.1, x, y, R);
    g.addColorStop(0, "#1a3044"); g.addColorStop(0.55, "#0d1a26"); g.addColorStop(1, "#070d13");
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, R, 0, 7); cx.fill();
    cx.lineWidth = 1; cx.strokeStyle = "rgba(191,227,255,.30)"; cx.stroke();
    cx.lineWidth = 1.6; cx.strokeStyle = "rgba(215,240,255,.75)"; cx.beginPath(); cx.arc(x, y, R, Math.PI * 1.02, Math.PI * 1.55); cx.stroke();

    // land dots; the ones near the pointer lift toward it
    const s = clamp(R * 0.0075, 1.1, 3.2), reach = Math.max(70, R * 0.34);
    const scan = STILL || diveStart ? 9 : (((now - t0) % 7000) / 7000) * 3.2 - 1.6;
    cx.fillStyle = "rgb(200,228,250)";
    for (let i = 0; i < land.length; i++) {
      const p = project(land[i]); if (p[2] <= 0) continue;
      let px = x + p[0] * R, py = y - p[1] * R, a = 0.2 + 0.6 * p[2] + 0.22 * Math.max(0, -p[0] * 0.6 + p[1] * 0.6), z = s;
      const sc = Math.abs(p[0] - scan); if (sc < 0.16) a += 0.45 * (1 - sc / 0.16);
      const dx = px - pointer.x, dy = py - pointer.y, dd = dx * dx + dy * dy;
      if (dd < reach * reach) { const k = 1 - Math.sqrt(dd) / reach, lift = 1 + 0.09 * k * k;
        px = x + p[0] * R * lift; py = y - p[1] * R * lift; a = Math.min(1, a + 0.6 * k); z = s * (1 + 1.1 * k); }
      cx.globalAlpha = Math.min(1, a); cx.fillRect(px - z / 2, py - z / 2, z, z);
    }
    // Malaysia, in the colour of the current risk level
    const c = level.rgb, glow = 0.55 + 0.45 * (chance / 100), ms = clamp(R * 0.0058, 1, 3.4);
    cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    for (let i = 0; i < mys.length; i++) {
      const p = project(mys[i]); if (p[2] <= 0) continue;
      cx.globalAlpha = (0.35 + 0.65 * p[2]) * glow; cx.fillRect(x + p[0] * R - ms / 2, y - p[1] * R - ms / 2, ms, ms);
    }
    cx.globalAlpha = 1;
    // pulse on Malaysia and its label
    const m = project(mark), mx = x + m[0] * R, my = y - m[1] * R;
    if (m[2] > 0.15 && !diveStart) {
      const beat = STILL ? 0.5 : ((now - t0) % 2600) / 2600, rr = lerp(6, 16 + 30 * (chance / 100), beat);
      cx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.75 * (1 - beat)})`; cx.lineWidth = 1.4;
      cx.beginPath(); cx.arc(mx, my, rr, 0, 7); cx.stroke();
      tag.hidden = false;
      const tw = tag.offsetWidth, flip = mx + 30 + tw > W - 8;   // no room on the right: sit under the mark
      tag.classList.toggle("under", flip);
      tag.style.transform = flip ? `translate(${Math.round(clamp(mx - tw / 2, 8, W - tw - 8))}px,${Math.round(my + 26)}px)` : `translate(${Math.round(mx + 30)}px,${Math.round(my - 20)}px)`;
    } else tag.hidden = true;

    if (diveStart && d >= 1) return;
    if (!STILL || diveStart || drag || now - introStart < 1600) requestAnimationFrame(draw);
  }
  const redraw = () => { if (STILL) requestAnimationFrame(draw); };

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
    let h = ""; for (let i = 0; i < 40; i++) { const a = (i * 9 - 90) * RAD, c = Math.cos(a), s = Math.sin(a);
      h += `<line x1="${100 + 91 * c}" y1="${100 + 91 * s}" x2="${100 + (i % 10 ? 94 : 97) * c}" y2="${100 + (i % 10 ? 94 : 97) * s}"/>`; }
    $("ticks").innerHTML = h;
  }

  // ---- pointer: the dots follow it; dragging turns the Earth ----
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (drag) { const f = frame(performance.now()), k = 80 / f.R;
      off.lon = clamp(drag.lon - (e.clientX - drag.x) * k, -170, 170); off.lat = clamp(drag.lat + (e.clientY - drag.y) * k, -55, 55); lastDrag = performance.now(); }
    redraw();
  });
  cv.addEventListener("pointerdown", (e) => {
    const f = frame(performance.now()); if (Math.hypot(e.clientX - f.x, e.clientY - f.y) > f.R * 1.1) return;
    drag = { x: e.clientX, y: e.clientY, lon: off.lon, lat: off.lat }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; redraw();
  });
  const drop = () => { if (drag) { drag = null; lastDrag = performance.now(); cv.style.cursor = ""; redraw(); } };
  addEventListener("pointerup", drop); addEventListener("pointercancel", drop);
  addEventListener("pointerleave", () => { pointer.x = pointer.y = -9999; redraw(); });
  addEventListener("resize", () => { size(); redraw(); });
  addEventListener("scroll", redraw, { passive: true });

  // ---- entering the app: dive into Malaysia, then hand over ----
  document.querySelectorAll("[data-enter]").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault(); if (diveStart) return;
    diveTo = el.getAttribute("href") || "index.html";
    if (STILL) { location.href = diveTo; return; }
    document.body.classList.add("leaving"); diveStart = performance.now(); requestAnimationFrame(draw);
    setTimeout(() => $("veil").classList.add("on"), 900);
    setTimeout(() => { location.href = diveTo; }, 1450);
  }));
  // coming back with the browser's Back button restores the page
  addEventListener("pageshow", (e) => { if (e.persisted) { diveStart = 0; $("veil").classList.remove("on"); document.body.classList.remove("leaving"); requestAnimationFrame(draw); } });

  size(); ticks(); mark = vec([MARK.lon, MARK.lat]);
  fetch("data/dots.json").then((r) => r.json()).then((d) => {
    land = d.land.map(vec); mys = d.malaysia.map(vec);
    introStart = performance.now(); requestAnimationFrame(draw);
    setTimeout(() => { document.body.classList.add("ready"); setWeeks(4, true); }, STILL ? 0 : 500);
    $("weeks").addEventListener("input", (e) => setWeeks(+e.target.value, true));
  });
})();
