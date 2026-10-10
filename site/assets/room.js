// DOM control room: the shell around the team's app.
// This file only decides what is shown where: the pages, the rail, and the first screen. It computes no result of its own.
// Everything it shows is read from app.js (context(), stepOf(), headOf(), actionsOf(), evStats(), STEP, D, STATE) and
// model.js, which are loaded unchanged. The replay button feeds the team's own replay file through the team's own
// validate() and saveUpload(), one week per press.
(function () {
  const root = document.documentElement;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const date = (iso) => new Date(iso + "T00:00:00Z"), dm = (iso) => date(iso).getUTCDate() + " " + MONTHS[date(iso).getUTCMonth()], dmy = (iso) => dm(iso) + " " + date(iso).getUTCFullYear();
  const plus = (iso, days) => { const d = date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
  const STILL = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const REPLAY_FILE = "templates/demo_real_replay_2025_W38_W41.csv", BARS = 44;
  let replayRows = null, fresh = 0, lastCount = -1, busy = false, lastLen = 0;
  let wantFresh = REPLAY && new URLSearchParams(location.search).get("fresh") === "1";   // arriving from "Replay October 2025": start at the first week
  root.dataset.replay = REPLAY ? "1" : "";
  // the Monday an ISO week starts on (4 January is always in week 1)
  const monday = (y, w) => { const d = new Date(Date.UTC(y, 0, 4)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (w - 1) * 7); return d.toISOString().slice(0, 10); };
  const resize = () => requestAnimationFrame(() => { if (typeof map !== "undefined" && map) map.invalidateSize(); dispatchEvent(new Event("resize")); });

  // ---------- pages ----------
  const pages = [...document.querySelectorAll(".page")].map((p) => p.dataset.page);
  function show(id) {
    if (!pages.includes(id)) id = "now";
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.dataset.page === id));
    document.querySelectorAll(".rail a[data-go]").forEach((a) => a.classList.toggle("on", a.dataset.go === id));
    root.dataset.page = id; scrollTo(0, 0); $("sheet").hidden = true; slideHl();
    resize();   // charts and the map were laid out off screen; let them take their real size now
  }
  // ---------- the arc: the four steps as one scale, the way a gauge shows where a reading sits ----------
  const ARC = (() => { const R = 380.3, cx = 340, cy = 444.3, al = Math.asin(310 / R), at = (t) => { const th = -al + 2 * al * t; return [cx + R * Math.sin(th), cy - R * Math.cos(th)]; }; return { at, d: `M${at(0).map((v) => v.toFixed(1)).join(" ")}A${R} ${R} 0 0 1 ${at(1).map((v) => v.toFixed(1)).join(" ")}` }; })();
  function arc(si) {
    const svg = $("arc"); if (!svg) return;
    if (!svg.firstChild) svg.innerHTML = `<path class="rail" d="${ARC.d}"/><path class="fill" id="arcFill" d="${ARC.d}" pathLength="100"/>` +
      STEPS.map((k, i) => { const [x, y] = ARC.at(i / 3), ax = i === 0 ? "start" : i === 3 ? "end" : "middle", dx = i === 0 ? -6 : i === 3 ? 6 : 0; return `<circle class="tick" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/><text data-i="${i}" x="${(x + dx).toFixed(1)}" y="${(y + (i === 0 || i === 3 ? 30 : -18)).toFixed(1)}" text-anchor="${ax}"><title>${STEP[k].name}: ${STEP[k].say}</title>${STEP[k].name}</text>`; }).join("") +
      `<g id="arcDot"><circle class="halo" r="15"/><circle class="dot" r="8"/></g>`;
    const [x, y] = ARC.at(si / 3); $("arcFill").style.strokeDasharray = `${(si / 3) * 100} 100`; $("arcDot").style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    svg.querySelectorAll("text").forEach((t) => t.classList.toggle("on", +t.dataset.i === si));
  }
  // one soft highlight slides to the page that is open; it is the only glass on the screen
  function slideHl() { const a = document.querySelector(".rail a.on"), h = document.querySelector(".rail .hl"); if (!a || !h) return;
    h.style.transform = `translate(${a.offsetLeft}px,${a.offsetTop}px)`; h.style.width = a.offsetWidth + "px"; h.style.height = a.offsetHeight + "px"; h.style.opacity = 1; }
  addEventListener("resize", slideHl); if (document.fonts && document.fonts.ready) document.fonts.ready.then(slideHl);
  // Routes are written "#/trust", so the browser never jumps to the app's own sections of the same name.
  // A plain link inside the app's text (for example "#proof", which the app folds under More) opens the right page and fold.
  const route = () => {
    const id = location.hash.replace(/^#\/?/, "");
    if (location.hash && !location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search + "#/" + id);
    if (id && !pages.includes(id)) { const el = document.getElementById(id), pg = el && el.closest(".page");
      if (pg) { show(pg.dataset.page); openSub(el); if (el.tagName === "DETAILS") el.open = true; requestAnimationFrame(() => el.scrollIntoView({ block: "start" })); return; } }
    show(id);
  };
  addEventListener("hashchange", route);
  $("atlasTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
    $("atlasTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("#p-atlas > .sub").forEach((s) => s.classList.toggle("on", s.dataset.sub === b.dataset.sub));
    resize(); });
  function openSub(el) { const sub = el.closest("#p-atlas > .sub"), b = sub && !sub.classList.contains("on") && $("atlasTabs").querySelector(`[data-sub="${sub.dataset.sub}"]`); if (b) b.click(); }

  // The Monday each week of the series starts on. Public weeks carry it. An uploaded week that directly follows the row
  // before it (by the app's own nextWeek) is dated seven days on; any other uploaded week is dated from its own year and week.
  function starts(series) { const out = []; series.forEach((s, i) => { const p = i ? series[i - 1] : null, q = p && nextWeek(p);
    out.push(s.start || (out[i - 1] && q.year === s.year && q.week === s.week ? plus(out[i - 1], 7) : Number.isFinite(s.year) && Number.isFinite(s.week) ? monday(s.year, s.week) : null)); }); return out; }
  // ---------- the replay file: which of its weeks comes next, and whether everything loaded so far came from it ----------
  const sameWeek = (x, r) => +x.year === r.year && +x.week === r.week;
  // undefined: the file is still loading. null: no week of the file follows the newest real row.
  function nextRow(c) { if (!replayRows) return undefined; const nx = nextWeek(c.real[c.real.length - 1]); return replayRows.find((x) => sameWeek(x, nx)) || null; }
  const pureReplay = () => !replayRows || STATE.lab.every((r) => replayRows.some((x) => sameWeek(x, r) && +x.samples_tested === r.n && +x.influenza_positive === r.pos));

  // ---------- the first screen: the app's own early-warning step (Clear, Watch, Warning, Outbreak), never a percentage ----------
  function update() {
    if (wantFresh) { wantFresh = false; history.replaceState(null, "", location.pathname + "?replay=1" + location.hash);
      if (STATE.lab.length || SIM.on) { SIM.on = false; if ($("simOn")) $("simOn").checked = false; resetState(); return; } }   // resetState redraws, which brings us back here
    const c = context(), a = c.a, st = stepOf(c), H = headOf(c), iso = starts(c.series), lastIso = iso[iso.length - 1], pure = pureReplay();
    const ES = typeof evStats === "function" ? evStats() : null, band = ES && st.band && !H.byRule ? ES.bands[st.band] : null;
    root.dataset.state = a.dataWarning ? "unconfirmed" : st.key; root.dataset.ready = "1";
    $("lvl").textContent = c.rise.off ? "Classifier off for your own series" : `Classifier: ${STEP[c.rise.band].name} · Alert rule: ${RULE_WORDS[a.level]}`;
    $("flag").hidden = !(c.sim || c.own || (c.uploaded && !(REPLAY && pure)));   // the first line already says "Replay ... real lab data"
    $("flag").textContent = c.sim ? `Simulation on: the newest ${c.nSim} week${c.nSim > 1 ? "s are" : " is"} invented` : c.own ? "Your own uploaded series, not verified" : REPLAY && pure ? "Replay of real weeks" : REPLAY ? "Replay with uploaded weeks, not verified" : "Includes uploaded weeks, not verified";
    // the sentence under the step word is the app's own sub-line, read from its alert card so the two can never differ
    // under the step word: the app's own headline for the step, without repeating the word it starts with
    const name = STEP[st.key].name, raw = a.dataWarning ? "Data warning: check the newest week before acting" : H.head, cut = raw.startsWith(name + ": ") ? raw.slice(name.length + 2) : raw, say = cut.charAt(0).toUpperCase() + cut.slice(1);
    $("head").textContent = say + (/[.!?]$/.test(say) ? "" : ".");
    if (!$("steps").children.length) $("steps").innerHTML = STEPS.map((k) => `<li title="${STEP[k].name}"><span>${STEP[k].name}</span></li>`).join("");
    const si = STEPS.indexOf(st.key); [...$("steps").children].forEach((li, i) => { li.className = i === si ? "on" : i < si ? "past" : ""; }); $("steps").style.setProperty("--k", si / 3);
    $("label").textContent = "Early-warning step, " + (c.own ? "your own lab network" : "Malaysia");
    const word = a.dataWarning ? "Check" : STEP[st.key].name;
    if ($("pct").textContent !== word) { const b = $("pct"); b.textContent = word; b.classList.remove("roll"); void b.offsetWidth; b.classList.add("roll"); }
    const when = lastIso ? `<b>${dmy(lastIso)}</b>` : `<b>${wk(a.last)}</b>`;
    const now = new Date(), today = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    // first line: what this screen is about, and the date. A stranger must not have to ask "clear of what?"
    $("basis").innerHTML = c.sim ? `<b>What-if drill</b> · invented weeks, not a reading` : c.own ? `<b>Your own lab network</b> · data to the week of ${when}` : REPLAY ? `<b>Replay of the October 2025 outbreak</b> · ${pure ? "real lab data" : "with uploaded weeks, not verified,"} to the week of ${when}` : `<b>Flu in Malaysia</b> · ${today}`;
    // the tiles: one question each, a label, a value and one short line, all from the app's own figures
    const act = actionsOf(c)[0], due = a.dataWarning ? "today" : PLAN_WHEN[st.key];
    $("doK").textContent = "Do first" + (due && due !== "ongoing" ? " · " + due : ""); $("who").textContent = act[1] ? "By: " + act[1] : "";
    $("t1").textContent = f1(a.pLast) + "%"; $("because").textContent = `of ${c.own ? "your" : "lab"} samples positive for flu, week of ${lastIso ? dm(lastIso) : wk(a.last)}`;
    { const v = c.series.slice(-26).map(M.pct), top = Math.max(c.th.orange * 1.2, ...v), y = (q) => (52 - (q / top) * 50).toFixed(1), d = v.map((q, i) => (i ? "L" : "M") + ((i * 200) / (v.length - 1)).toFixed(1) + " " + y(q)).join("");
      $("spark").innerHTML = `<line x1="0" x2="200" y1="${y(c.th.orange)}" y2="${y(c.th.orange)}" class="al"/><line x1="0" x2="200" y1="${y(c.th.yellow)}" y2="${y(c.th.yellow)}" class="wl"/><path d="${d}"/>`; }
    $("ageRow").hidden = REPLAY || c.sim || c.own;
    $("age").textContent = c.lag > 0 ? `${c.lag} week${c.lag > 1 ? "s" : ""} old` : "Current"; $("ageS").textContent = c.lag > 0 ? "Published figures run late. This step reads the weeks since." : "Figures run to this week.";
    $("recV").textContent = band ? `${band.rises} of ${band.weeks}` : c.rise.off ? "Off" : "Alert rule"; $("recS").textContent = band ? `${STEP[st.band].name} weeks were followed by a rapid rise, in six past years` : c.rise.off ? "The classifier is off for your own series" : "This step is set by the alert rule on the data";
    $("recV").parentElement.style.setProperty("--p", band ? ((100 * band.rises) / band.weeks).toFixed(1) : 0);
    $("proofRow").hidden = REPLAY; $("aboutBox").hidden = !REPLAY;
    $("planBtn").className = "go"; $("planBtn").querySelector(".lab").textContent = "Full plan";
    arc(STEPS.indexOf(st.key));
    $("first").textContent = actionsOf(c)[0][0] + ".";
    // replay controls
    const n = STATE.lab.length, nr = REPLAY && !c.own ? nextRow(c) : null, done = REPLAY && nr === null;
    $("rpGoLab").textContent = REPLAY ? (done ? "Replay finished" : "Add the next real week") : "Replay October 2025"; $("rpGo").disabled = done || busy; $("rpGo").hidden = !REPLAY || c.own;
    $("rpAgain").hidden = !(REPLAY && (n > 0 || c.sim)); $("rpLeave").hidden = !REPLAY;
    // the strip describes the real replay weeks only: it steps aside while the what-if drill or an own series is on screen
    $("strip").hidden = !REPLAY || c.sim || c.own;
    if (REPLAY && !c.sim && !c.own) { fresh = lastCount >= 0 && n > lastCount ? n - lastCount : 0; lastCount = n; bars(c, iso); }
    // the app's own words on how the replay is built: one click away on this screen, in full on every other page
    const bar = $("replayBar"); bar.querySelectorAll('a[href="./"]').forEach((x) => x.setAttribute("href", "dashboard.html#/now"));
    document.querySelectorAll('a[href="?replay=1"]').forEach((x) => x.setAttribute("href", "dashboard.html?replay=1&fresh=1#/now"));
    if (REPLAY) $("rpAbout").innerHTML = bar.innerHTML.split(/ (?:Newer weeks are loaded|Drop in <a)/)[0] + ` This is what a planner sees with each week's own lab counts in hand. Public data alone arrives about ${D.pub_lag} weeks later.`;
    icons(c);
    // hand the living object what it draws: the app's own weekly values, alert lines, step and wording (nothing is computed here)
    const N = 40, ser = c.series, len = ser.length, grew = lastLen > 0 && len > lastLen ? len - lastLen : 0; lastLen = len;
    dispatchEvent(new CustomEvent("room:update", { detail: { step: si, vals: ser.slice(-N).map(M.pct), dates: iso.slice(-N), prev: !c.own && len >= N + 52 ? ser.slice(-N - 52, -52).map(M.pct) : null,
      th: { yellow: c.th.yellow, orange: c.th.orange }, fresh: grew, names: STEPS.map((k) => STEP[k].name), says: STEPS.map((k) => STEP[k].say),
      records: STEPS.map((k) => (ES && ES.bands[k] ? `In six past years a rapid rise followed ${ES.bands[k].rises} of ${ES.bands[k].weeks} ${STEP[k].name} weeks.` : "")) } }));
    // the data-status line matters on the first screen only when something unusual is on (uploads or a simulation)
    $("stamp").classList.toggle("hush", !(c.sim || (typeof barMsg !== "undefined" && barMsg)));
  }

  // ---------- long explanations become drawers: each heading with what follows it; nothing is removed ----------
  function fold(box) {
    if (!box || !box.querySelector(":scope > h3")) return;
    let cur = null;
    for (const el of [...box.children]) {
      if (el.tagName === "H3") { cur = document.createElement("details"); cur.className = "drawer"; const s = document.createElement("summary"); s.innerHTML = el.innerHTML; const body = document.createElement("div"); body.className = "drawerbody"; cur.append(s, body); cur.addEventListener("toggle", resize); box.insertBefore(cur, el); el.remove(); }
      else if (cur) cur.lastChild.appendChild(el);
    }
  }
  // ---------- the inner pages: one picture first, the long reading one click down (nothing is removed) ----------
  // Why trust it: the app's four counts are shares, so each is drawn as a ring; the chart stays open, every later section is a drawer.
  function rings() { document.querySelectorAll("#trustBody .kpi").forEach((k) => { const b = k.querySelector("b"); if (!b || k._r === b.textContent) return; k._r = b.textContent;
    const m = b.textContent.match(/(\d+)\s+of\s+(\d+)/), pc = b.textContent.match(/(\d+)\s*%/), v = m ? (100 * +m[1]) / +m[2] : pc ? +pc[1] : null; if (v == null) return; k.classList.add("ring"); k.style.setProperty("--p", v.toFixed(1)); }); }
  // Track record: each record reads as one row (the date, what the system said, the result); the rest opens on a click.
  function trackRows() { const t = document.querySelector("#trackBody table"); if (!t || t.classList.contains("rows")) return; const heads = [...t.querySelectorAll("th")].map((x) => x.textContent);
    t.querySelectorAll("tr").forEach((tr) => [...tr.children].forEach((td, i) => { td.dataset.l = heads[i] || ""; })); t.classList.add("rows"); }
  const tidy = { proofBody: (b) => fold(b), trustBody: (b) => { fold(b); const d = b.querySelector("details.drawer"); if (d && !b._opened) { b._opened = true; d.open = true; } rings(); }, trackBody: () => trackRows() };
  for (const id in tidy) { const box = $(id); if (!box) continue; new MutationObserver(() => tidy[id](box)).observe(box, { childList: true }); tidy[id](box); }
  document.querySelectorAll("#stakes .grid2 > div").forEach(fold);
  // Where: the map comes first; its sources, shading choices and layer switches sit together under one drawer
  (function atlas() { const card = $("atlas"), map = $("map"); if (!card || !map) return; const h2 = card.querySelector("h2"), d = document.createElement("details"); d.className = "drawer"; d.innerHTML = "<summary>Map layers, shading and sources</summary><div class=\"drawerbody\"></div>";
    const view = $("mapModeRow") && $("mapModeRow").parentElement; h2.after(map); map.after($("stLegend"), $("mapHint")); if (view) $("mapHint").after(view); card.append(d);
    ["stSrc", "mapNote", "stCtl", "layerToggles"].forEach((id) => { const el = $(id); if (el) d.lastChild.append(el); }); d.addEventListener("toggle", resize); })();
  // long notes show two lines; a click opens them. Rows of the track record open the same way.
  document.addEventListener("click", (e) => { if (e.target.closest("a,button,input,select,label,summary")) return;
    const n = e.target.closest(".page .card p.note, #trustBody > p, #trackBody > p"); if (n) n.classList.toggle("open"); const r = e.target.closest("table.rows tr"); if (r) r.classList.toggle("open"); });

  // In the replay: the data week each step of the app's own ladder was first reached (same rule as stepOf, same frozen cut-offs).
  function milestones() {
    const base = D.series.slice(0, D.replay_cut_index + 1), t = D.rise.current.tiers || { watch: 0.5, warning: 0.5 }, m = {};
    for (let k = 0; k <= STATE.lab.length; k++) { const ser = base.concat(STATE.lab.slice(0, k)), lag = Math.max(0, D.pub_lag - k), a = M.assess(ser, D.models.replay, D, D.thresholds, lag), p = M.riseSignal(ser, D.rise.replay).prob;
      const step = Math.max(p >= t.warning ? 2 : p >= t.watch ? 1 : 0, RULE_RANK[a.level]), iso = starts(ser).pop();
      STEPS.forEach((s, i) => { if (i && !m[s] && step >= i) m[s] = iso; }); }
    return m;
  }
  function bars(c, iso) {
    const ser = c.series.slice(-BARS), d = iso.slice(-BARS), vals = ser.map(M.pct), top = Math.max(c.th.orange * 1.25, ...vals), h = (v) => (100 * v) / top, days = (x, y) => Math.round((date(y) - date(x)) / 864e5);
    const ms = c.own ? {} : milestones(), first = ms.watch || ms.warning || ms.outbreak, firstName = !first ? "" : ms.watch !== ms.warning ? "Watch" : ms.warning !== ms.outbreak ? "Warning" : "Outbreak";
    $("bars").innerHTML = vals.map((v, i) => `<i class="${v >= c.th.orange ? "o" : v >= c.th.yellow ? "y" : ""}${i === vals.length - 1 ? " now" : ""}${i >= vals.length - fresh ? " new" : ""}${first && d[i] === first ? " sig" : ""}" style="height:${h(v)}%" title="Week of ${d[i] ? dmy(d[i]) : wk(ser[i])}: ${f1(v)}%"></i>`).join("") +
      `<u style="bottom:${h(c.th.orange)}%;--k:${css("--orange")}"><b>Alert line ${f1(c.th.orange)}%</b></u><u style="bottom:${h(c.th.yellow)}%;--k:${css("--yellow")}"><b>Watch line ${f1(c.th.yellow)}%</b></u>`;
    $("bars").setAttribute("aria-label", `Weekly flu positivity, last ${vals.length} weeks; newest ${f1(vals[vals.length - 1])}%`);
    $("stripNote").innerHTML = (first ? `<b>${firstName} first shown on data to the week of ${dm(first)}.</b>` + (ms.outbreak && ms.outbreak > first ? ` Outbreak on data to the week of ${dm(ms.outbreak)}, <b>${days(first, ms.outbreak)} days later</b>.` : ms.outbreak ? "" : " The alert rule has not called Outbreak yet.") : "Each press adds one real week of national lab counts.");
  }

  async function replayFile() {
    if (!replayRows) { const r = await fetch(REPLAY_FILE); if (!r.ok) throw new Error("The replay file did not load.");
      const wb = XLSX.read(await r.text(), { type: "string" }); replayRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }); }
    return replayRows;
  }
  $("rpGo").onclick = async () => {
    if (!REPLAY) { location.href = "dashboard.html?replay=1&fresh=1#/now"; return; }
    if (busy) return; busy = true; $("rpGo").disabled = true;   // one week per press, however fast the presses come
    let note = "";
    try {
      await replayFile(); const row = nextRow(context(0)); if (!row) return;   // the week after the newest real row, whatever was undone
      const { errs, out } = validate("lab", [row], false);
      if (errs.length) note = errs.join(" ");
      else { const msg = await saveUpload("lab", out); if (msg) note = msg + " Enter a passcode under More, Uploads, roles and history."; }
    } catch (e) { note = "The next week could not be loaded. Check the connection and press again."; console.error("room", e); }
    finally { busy = false; render(); if (note) { $("strip").hidden = false; $("stripNote").textContent = note; } }
  };
  // Start again also leaves the what-if drill, the same way the app's own "Exit simulation" button does
  $("rpAgain").onclick = () => { if (SIM.on) { SIM.on = false; if ($("simOn")) $("simOn").checked = false; } resetState(); };
  $("rpLeave").onclick = () => { location.href = "dashboard.html#/now"; };
  // "Why?" opens the sheet at the reasons; "See the plan" opens the same sheet at the actions and the plan
  const openSheet = (sel) => { const sh = $("sheet"); sh.hidden = false; sh.scrollTop = 0; const el = sel && sh.querySelector(sel); if (el) sh.scrollTop = Math.max(0, el.getBoundingClientRect().top - sh.getBoundingClientRect().top - 54); $("sheetX").focus({ preventScroll: true }); };
  $("whyBtn").onclick = () => openSheet(); $("planBtn").onclick = () => openSheet(".planbox");   // "Full plan" lands on the task list: what, who, by when
  $("sheetX").onclick = () => { $("sheet").hidden = true; };
  document.addEventListener("pointerdown", (e) => { if (!$("sheet").hidden && !e.target.closest("#sheet, #whyBtn, #planBtn, dialog")) $("sheet").hidden = true; });
  $("rpLink").onclick = () => $("rpGo").onclick(); $("addBtn").onclick = () => { const u = $("uploadBtn"); if (u) u.click(); };
  addEventListener("keydown", (e) => { if (e.key === "Escape") $("sheet").hidden = true; if (e.key === "ArrowRight" && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && REPLAY && root.dataset.page === "now" && $("sheet").hidden && !document.querySelector("dialog[open]") && !e.target.closest("input,select,textarea")) $("rpGo").click(); });

  // ---------- the rail: each page is a small live picture ----------
  let myPath = "";
  const spark = (v, x0, x1, y0, y1) => { const mx = Math.max(...v), mn = Math.min(...v); return v.map((y, i) => (i ? "L" : "M") + (x0 + (i * (x1 - x0)) / (v.length - 1)).toFixed(1) + " " + (y1 - ((y - mn) / (mx - mn || 1)) * (y1 - y0)).toFixed(1)).join(""); };
  function icons(c) {
    const sun = css("--sun"), acc = css("--acc"), set = (id, h) => { const el = $("ic-" + id); if (el && el._h !== h) { el.innerHTML = h; el._h = h; } };
    // Now: the ladder, with the current step lit
    const si = STEPS.indexOf(stepOf(c).key);
    set("now", STEPS.map((s, k) => `<rect x="${6 + k * 8.5}" y="${28 - k * 6}" width="6.5" height="${8 + k * 6}" rx="2" stroke="none" fill="${k === si ? acc : "rgba(255,255,255," + (k < si ? ".6" : ".26") + ")"}"/>`).join(""));
    const v = c.series.slice(-26).map(M.pct), mx = Math.max(...v), mn = Math.min(...v);
    set("forecast", `<path d="${spark(v, 5, 39, 12, 34)}"/><circle cx="39" cy="${(34 - ((v[v.length - 1] - mn) / (mx - mn || 1)) * 22).toFixed(1)}" r="2.6" fill="${sun}" stroke="none"/>`);
    // Trust: of the weeks that were followed by a rise, the share already at Watch or higher (the app's own six-year count)
    const ES = typeof evStats === "function" ? evStats() : null, cells = 40, lit = ES && ES.R ? Math.round((cells * ES.watch.tp) / ES.R) : 0;
    set("trust", Array.from({ length: cells }, (_, i) => `<circle cx="${6 + (i % 8) * 4.6}" cy="${11 + Math.floor(i / 8) * 5.4}" r="1.7" stroke="none" fill="${i < lit ? sun : "rgba(255,255,255,.35)"}"/>`).join(""));
    if (!myPath && typeof STGEO !== "undefined" && STGEO) { const x0 = 99.5, x1 = 119.5, y0 = 0.7, y1 = 7.6;
      myPath = STGEO.features.map((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => { const r = poly[0]; if (r.length < 30) return ""; const st = Math.max(1, Math.floor(r.length / 60));
        return "M" + r.filter((_, i) => i % st === 0).map(([x, y]) => (2 + ((x - x0) / (x1 - x0)) * 40).toFixed(1) + " " + (14 + ((y1 - y) / (y1 - y0)) * 15).toFixed(1)).join("L") + "Z"; }).join("")).join(""); }
    set("atlas", `<path d="${myPath}" stroke="none" fill="#fff"/><circle cx="6.5" cy="24.5" r="2.2" fill="${css("--mark")}" stroke="none"/>`);
    set("track", `<circle cx="22" cy="22" r="13"/><path d="M22 14v8l5 4"/>`);
    set("stakes", `<circle cx="22" cy="15" r="6"/><path d="M10 36c1-8 6-11 12-11s11 3 12 11"/>`);
    set("more", `<rect x="9" y="10" width="26" height="6" rx="3"/><rect x="9" y="19" width="26" height="6" rx="3"/><rect x="9" y="28" width="26" height="6" rx="3"/>`);
  }

  // ---------- the logo's O: the same small Earth as on the landing page (data/dots.json) ----------
  fetch("data/dots.json").then((r) => r.json()).then((d) => {
    const RAD = Math.PI / 180, vec = ([lon, lat]) => { const l = lon * RAD, p = lat * RAD; return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)]; };
    const g = $("navO").getContext("2d"), R = 26, o = 30, l = 108 * RAD, p = 2 * RAD;
    const pr = (v) => { const X = v[0] * Math.cos(l) - v[2] * Math.sin(l), Z0 = v[0] * Math.sin(l) + v[2] * Math.cos(l); return [X, v[1] * Math.cos(p) - Z0 * Math.sin(p), v[1] * Math.sin(p) + Z0 * Math.cos(p)]; };
    g.clearRect(0, 0, 60, 60); g.fillStyle = "#fff";
    for (const pt of d.land) { const q = pr(vec(pt)); if (q[2] > 0.05) { g.globalAlpha = 0.55 + 0.45 * q[2]; g.fillRect(o + q[0] * R - 0.8, o - q[1] * R - 0.8, 1.6, 1.6); } }
    g.globalAlpha = 0.95; g.strokeStyle = "#fff"; g.lineWidth = 1.6; g.beginPath(); g.arc(o, o, R + 1.5, 0, 7); g.stroke();
    g.globalAlpha = 1; const q = pr(vec([102.2, 3.9])); g.fillStyle = css("--mark"); g.beginPath(); g.arc(o + q[0] * R, o - q[1] * R, 4.2, 0, 7); g.fill();
  }).catch(() => {});

  // ---------- review copy only: switch the first-screen treatment and the navigation without reloading ----------
  const rv = $("review"); if (rv) { const mark = () => rv.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.tone === root.dataset.tone)); mark();
    rv.addEventListener("click", (e) => { const x = e.target.closest("button"); if (!x) return; for (const k of ["tone"]) if (x.dataset[k]) { root.dataset[k] = x.dataset[k]; try { sessionStorage.setItem("dom-" + k, x.dataset[k]); } catch (err) {} }
      mark(); requestAnimationFrame(() => { slideHl(); resize(); }); }); }

  // ---------- join the team's render loop: after every render of theirs, refresh the first screen ----------
  const theirs = window.render;
  window.render = function () { const r = theirs.apply(this, arguments); try { update(); } catch (e) { console.error("room", e); } return r; };
  if (REPLAY) replayFile().then(() => { if (typeof D !== "undefined" && D && STATE) update(); }).catch((e) => console.error("room", e));
  route();
  setTimeout(() => { if (!root.dataset.ready) { root.dataset.ready = "1"; $("pct").textContent = "No data"; $("head").textContent = "The data did not load. Check the connection and reload the page."; $("rpGo").hidden = true; } }, 9000);
  if (typeof D !== "undefined" && D && typeof STATE !== "undefined" && STATE) { try { update(); } catch (e) { console.error("room", e); } }
})();
