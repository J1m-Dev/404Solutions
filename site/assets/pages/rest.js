// DOM control room · lane: rest. The plan panel (#sheet), Who for (#p-stakes) and More (#p-more). Loaded after assets/room.js.
// The app writes #alertCard, #action, #planBox, #proofBody and the other bodies itself, so everything here re-arranges
// IN PLACE, again after every rewrite. No number or sentence of the app is changed. Shared helpers: window.Room.
(function () {
  const { fold, resize } = Room;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // run fn now and again after every rewrite of the box (the app replaces the box's children with innerHTML)
  const watch = (box, fn) => { if (!box) return; new MutationObserver(() => fn(box)).observe(box, { childList: true }); fn(box); };
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error("rest: " + name, e); } };

  // ---------- 1. the plan panel: the step, the ladder, the task list on the one light plate, the reasons, the rest in rows ----------
  safe("panel", () => {
    const sh = $("sheet"), ac = $("alertCard"), box = $("planBox"); if (!sh || !ac || !box) return;
    // the panel's own first line: the step's dot and word, and the close button. It stays in place while the panel scrolls.
    const head = el("div", "shead"); head.append(el("i", "dot"), el("b", "w"), $("sheetX")); sh.prepend(head);
    // the task list sits right under the ladder, on the plate (the container is moved, never its contents: the app rewrites those)
    ac.after(box); box.classList.add("plate");
    // the summary and the action table (the same actions again) open as rows
    const more = sh.querySelector(":scope > .card:not(#alertCard)"); if (more) { fold(more); more.classList.add("rows"); }
    // after every render of the alert card: the word in the first line is the card's own step; its headline does not say the word twice
    watch(ac, () => { const lv = ac.querySelector(".level"); if (!lv) return;
      const key = [...STEPS, "unconfirmed"].find((k) => lv.classList.contains(k)) || "clear", word = key === "unconfirmed" ? "Check" : STEP[key].name, pre = word + ": ";
      head.dataset.step = key; head.querySelector(".w").textContent = word;
      const h = lv.querySelector("h1"); if (h && !h.firstElementChild && h.textContent.startsWith(pre)) { const t = h.textContent; h.textContent = ""; h.append(el("span", "pre", pre), el("span", "rest", t.slice(pre.length))); } });
    // the ladder is one quiet row; a click on it shows the app's own line under each step, and hides it again
    sh.addEventListener("click", (e) => { if (e.target.closest(".ladder")) sh.classList.toggle("lad"); });
    // ---- Send to Telegram: the step and its first action go to the team's public channel, through /api/alert (site/api/alert.js) ----
    // The node is ours (the app rewrites #planBox and #alertCard, never this), so it is there at every step and after every render.
    const tg = el("div", "tg"), send = el("button", "quiet", "Send to Telegram"), chan = el("a", "link", "Open the channel"), msg = el("span", "tgmsg"), form = el("form", "tgpass"), pin = el("input"), use = el("button", "quiet", "Use");
    send.type = "button"; send.id = "tgSend"; chan.href = "https://t.me/s/dom_alerts_demo"; chan.target = "_blank"; chan.rel = "noopener"; msg.id = "tgMsg"; msg.setAttribute("role", "status");
    pin.type = "password"; pin.autocomplete = "off"; pin.placeholder = "Passcode"; pin.setAttribute("aria-label", "Passcode for sending"); use.type = "submit"; form.hidden = true; form.append(pin, use);
    tg.append(send, chan, msg, form); box.after(tg);
    const KEY = "dom-alert-pass", DRILL = "A drill is never sent", MARKUP = /[<>`*#\[\]{}|\\_~\u0000-\u001f]|https?:|www\./i;   // the function's own plain-text rule
    const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname) || location.protocol === "file:";
    let busy = false, saidAt = "", mem = "";
    const stored = () => { try { return localStorage.getItem(KEY) || mem; } catch (e) { return mem; } };
    const now = () => { try { const c = context(); return { c, key: stepOf(c).key }; } catch (e) { return null; } };   // null until the app has its data
    const say = (t) => { const s = now(); msg.textContent = t; saidAt = s ? s.key : ""; };
    // after every render: a drill is never sent (the app refuses to approve a simulated plan the same way); a status about another step is cleared
    function sync() { const s = now(); if (!s) return; send.disabled = busy || !!s.c.sim;
      if (s.c.sim) { form.hidden = true; msg.textContent = DRILL; } else if (msg.textContent === DRILL || (!busy && saidAt && saidAt !== s.key)) msg.textContent = ""; }
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = pin.value; if (!v) return; mem = v; try { localStorage.setItem(KEY, v); } catch (err) {}
      pin.value = ""; form.hidden = true; say("Passcode kept on this device. Press Send."); send.focus({ preventScroll: true }); });
    send.addEventListener("click", async () => { const s = now(); if (!s || busy || s.c.sim) return;
      const pass = stored(); if (!pass) { form.hidden = false; say("Enter the passcode once"); pin.focus({ preventScroll: true }); return; }
      // everything sent is read from the app now: the step's name, its first action and who acts, the app's own deadline, and the Now page's first line
      const act = actionsOf(s.c)[0] || [], when = s.c.a.dataWarning ? "today" : PLAN_WHEN[s.key];
      let action = String(act[0] || "").trim(); if ((action.length > 160 || MARKUP.test(action)) && action.endsWith(".")) action = action.slice(0, -1);
      const body = { step: STEP[s.key].name, action, who: String(act[1] || "").trim(), basis: $("basis").textContent.replace(/\s+/g, " ").trim().slice(0, 140), passcode: pass };
      if (when && when !== "ongoing") body.when = when;
      busy = true; send.disabled = true; say("Sending..."); let code = 0;
      try { code = (await fetch("/api/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })).status; } catch (e) { code = 0; }
      busy = false;
      if (code === 401) { mem = ""; try { localStorage.removeItem(KEY); } catch (e) {} form.hidden = false; }
      say(code === 200 ? "Sent to the channel, " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : code === 401 ? "Wrong passcode"
        : code === 404 || code === 501 || (!code && LOCAL) ? "Alerts are sent from the live address only" : code === 429 ? "Wait a few seconds" : code === 503 ? "The bot is not connected yet"
        : code === 502 ? "Telegram did not accept it" : "It was not sent. Try again.");
      sync(); });
    Room.after(sync);
    // "Full plan": the whole task list and the send line are in view, under the first line; when everything fits, the panel stays at the top
    $("planBtn").addEventListener("click", () => { const need = tg.offsetTop + tg.offsetHeight + 14; sh.scrollTop = need <= sh.clientHeight ? 0 : Math.max(0, box.offsetTop - head.offsetHeight - 14); });
  });

  // ---------- 2. Who for: the headline on one wide tile, the 2025 surge on the plate, three facts as tiles, the full text in rows ----------
  safe("stakes", () => {
    const board = $("b-stakes"), hero = $("hero"), st = $("stakes"); if (!board || !hero || !st || board.children.length) return;
    const [about, links] = hero.querySelectorAll(":scope > p"), cols = st.querySelectorAll(".grid2 > div"); if (!about || !links || cols.length < 2) return;
    const [uH, uP, uP2, uNote, cH, cList, cNote] = cols[0].children, [sH, sTable, sNote] = cols[1].children;
    const label = (text, chip) => { const k = el("span", "k", text); if (chip) k.append(" ", chip.cloneNode(true)); return k; };
    const tile = (cls, ...kids) => { const t = el("article", "tile " + cls); t.append(...kids.filter(Boolean)); return t; };
    // the headline, with the replay as the one filled button
    const go = links.querySelector("a.btn:not(.ghost)"), trust = links.querySelector("a.ghost"), row = el("div", "row");
    if (go) { const t = go.textContent; go.className = "go"; go.textContent = ""; const arr = el("span", "arr", "→"); arr.setAttribute("aria-hidden", "true"); go.append(arr, el("span", "lab", t)); row.append(go); }
    if (trust) { trust.className = "link"; row.append(trust); }
    board.append(tile("w4 say", hero.querySelector("h1"), row));
    // the 2025 surge, week by week: the app's own table, read down as a timeline, with its caveat under it
    const plate = el("div", "plate"), k = el("span", "k"); k.append(...sH.childNodes); plate.append(k, sTable, sNote); board.append(plate);
    // the user: the first words of the app's own sentence, and its own caveat
    const uT = uP.textContent, cut = "A planner ", end = uT.indexOf(":"), tested = uNote.textContent.split(". ")[0].replace(/\.?$/, ".");
    board.append(uT.startsWith(cut) && end > 0 ? tile("fact", label("The user", uH.querySelector(".chip")), el("b", "", cut.trim()), el("span", "s", uT.slice(cut.length, end) + "."), el("span", "s", tested))
      : tile("fact", label("The user", uH.querySelector(".chip")), el("span", "s", uT), el("span", "s", tested)));
    // the two published costs: each of the app's own lines, split into a label, its number and the rest of the line
    const chip = cH.querySelector(".chip"), li = [...cList.children].map((x) => x.textContent);
    const a = (li[0] || "").match(/^(.+?): (MYR [\d.,]+ \w+) (.+)$/), b = (li[1] || "").match(/^(.+?): (about MYR [\d,]+ to [\d,]+)\. (.+)$/);
    if (a) board.append(tile("fact", label(a[1], chip), el("b", "", a[2]), el("span", "s", a[3])));
    if (b) board.append(tile("fact", label(b[1], chip), el("b", "", b[2]), el("span", "s", b[3])));
    // everything else, in the app's own words, one click down
    const rows = el("div", "rows"); rows.append(el("h3", "", "What DOM does"), about, uH, uP, uP2, uNote, cH, cList, cNote); board.after(rows);
    // the tile above already carries "The user" and its chip as a headline: the row says what it adds, and keeps the chip beside his text
    if (uH.firstChild && uH.firstChild.nodeType === 3) uH.firstChild.textContent = "The user and the decision, in full ";
    fold(rows);
  });

  // on a phone the first line of these two pages fits one line
  safe("first lines", () => { const mq = matchMedia("(max-width:760px)"), set = [["w-stakes", "user and stakes"], ["w-more", "the full detail"]].map(([id, short]) => [$(id), short, $(id) && $(id).textContent]);
    const fit = () => set.forEach(([e, short, long]) => { if (e) e.textContent = mq.matches ? short : long; }); mq.addEventListener("change", fit); addEventListener("resize", fit); fit(); });

  // ---------- 3. More: six rows on one block; nothing is open on arrival; what opens is readable ----------
  safe("more", () => {
    const pg = $("p-more"), folds = pg ? [...pg.querySelectorAll(":scope > details.fold")] : []; if (!folds.length) return;
    const rows = el("div", "rows"); folds[0].before(rows); rows.append(...folds);
    folds.forEach((d) => d.addEventListener("toggle", () => { if (d.open) resize(); }));
    // each chart on a light plate, with the switches that act as its legend; a hover readout placed before the chart comes along
    const plate = (canvas, text, ...first) => { const cb = canvas && canvas.closest(".chartbox"); if (!cb || cb.parentElement.classList.contains("plate")) return;
      const p = el("div", "plate"), ro = cb.previousElementSibling; cb.before(p); p.append(el("span", "k", text), ...first.filter(Boolean)); if (ro && ro.classList.contains("readout")) p.append(ro); p.append(cb); };
    plate($("dengueChart"), "Reported dengue cases per week, Malaysia");
    plate($("stChart"), "One line for each state", $("stViewRow") && $("stViewRow").parentElement, $("stToggles"));
    // the app's long results: each heading with what follows it opens as a row
    ["proofBody", "dengueBody", "stBody"].forEach((id) => watch($(id), fold));
  });
})();
