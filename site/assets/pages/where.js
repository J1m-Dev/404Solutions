// DOM control room · lane: where. The Where page (#p-atlas) and the Record page (#p-track). Loaded after assets/room.js.
// The app writes #trackBody, #hotRank, #plan, #stLegend and the map itself, so everything here re-arranges IN PLACE, again
// after every rewrite, and never moves a node out of a container the app rewrites. No number or sentence of the app is
// changed: a tile repeats a figure the app already printed, read from the app's own text. Shared helpers: window.Room.
(function () {
  const { fold, resize, after, dm } = Room;
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const text = (id) => { const e = $(id); return e ? e.textContent.trim() : ""; };
  const set = (e, v) => { if (e.textContent !== v) e.textContent = v; };
  // a tile is made once and refilled: a label, a value, one short line. A tile with no value steps aside.
  function tile(board, key, k, v, s, tab, cls) {
    let t = board.querySelector(`:scope > [data-t="${key}"]`);
    if (!t) { t = el("article", "tile" + (cls ? " " + cls : "")); t.dataset.t = key; if (tab) t.dataset.for = tab; t.append(el("span", "k"), el("b"), el("span", "s")); board.append(t); }
    set(t.children[0], k); set(t.children[1], v || ""); set(t.children[2], s || ""); t.hidden = !v; return t;
  }
  // one row that opens: a short title of ours, the app's own nodes inside
  function row(rows, title, ...kids) {
    const d = el("details", "drawer"), s = el("summary"), b = el("div", "drawerbody"); s.textContent = title; kids.forEach((k) => k && b.append(k));
    d.append(s, b); d.addEventListener("toggle", resize); rows.append(d); return d;
  }

  // ---------- Where, the Map tab: four counts, the map on one plate with its two view buttons, everything that tunes it in rows ----------
  (function atlasMap() {
    const card = $("atlas"), mapEl = $("map"); if (!card || !mapEl) return;
    const h2 = card.querySelector("h2"), view = card.querySelector(".viewbtns"), mode = $("mapModeRow") && $("mapModeRow").parentElement;
    const plate = el("div", "plate"), top = el("div", "ptop"), rows = el("div", "rows");
    if (h2) top.append(h2); if (view) top.append(view);
    plate.append(top, mapEl); if ($("stLegend")) plate.append($("stLegend"));
    row(rows, "What the map is showing", $("mapHint"), $("layerToggles"));
    row(rows, "Disease and shading", $("stCtl"), mode);
    row(rows, "Sources and notes", $("stSrc"), $("mapNote"));
    card.append(plate, rows); card.classList.add("stack"); resize();
  })();
  function mapTiles() {
    const b = $("b-atlas"); if (!b) return;
    tile(b, "gov", "Public hospitals", text("n_government"), "Ministry of Health registry", "map");
    tile(b, "priv", "Private hospitals", text("n_private"), "Licensed under Act 586", "map");
    tile(b, "clin", "Health clinics", text("n_clinic"), "Government clinics", "map");
    // the state the app names first after "Highest, <period>:" in its own legend, with the legend's own unit
    const lg = $("stLegend"), hb = lg && [...lg.querySelectorAll("b")].find((x) => /^Highest/.test(x.textContent));
    const m = hb && hb.nextSibling ? hb.nextSibling.textContent.match(/^\s*([^(]+?)\s*\(([^)]+)\)/) : null, u = lg && lg.querySelector(".lgbar + span");
    const unit = u ? u.textContent.replace(/^0 to [\d,.]+\s*/, "") : "";
    const when = hb ? hb.textContent.replace(/^Highest,?\s*/, "").replace(/:\s*$/, "") : "";
    tile(b, "top", "Highest state", m ? m[1] : "", m ? (m[2] + " " + unit).trim() + (when ? ", " + when : "") : "", "map");
  }

  // ---------- Where, the Districts and beds tab: the capacity table wide, the districts beside it (two plates on a second .board), the working in a row ----------
  let hospOpen = false;
  (function atlasBeds() {
    const plan = $("plan"), hot = $("hotRank"); if (!plan || !hot) return;
    const R = plan.parentElement, L = hot.parentElement, grid = R.parentElement, card = grid.closest(".card");
    R.classList.add("plate", "pl-beds"); L.classList.add("plate", "pl-districts"); grid.classList.add("board", "bedgrid");
    // the caveat the app ends its note with is repeated under the title, in its own words (bedTiles fills it)
    const h3 = R.querySelector(":scope > h3"), cav = el("span", "s"); cav.id = "bedCaveat"; if (h3) h3.after(cav);
    // the three sliders sit together under one label
    const box = el("div", "assume"), k = el("span", "k"), sl = el("div", "sliders"); k.textContent = "Assumptions"; sl.append(...R.querySelectorAll(":scope > label")); box.append(k, sl); cav.after(box);
    const rows = el("div", "rows"); row(rows, "How the demand and the room are worked out", $("planNote"));
    card.append(rows); card.classList.add("stack");
    // the app rewrites #plan on every slider move: its hospital table folds under its own heading, and stays open if it was opened
    function tidy() { fold(plan); const d = plan.querySelector(":scope > details.drawer"); if (d && !d._seen) { d._seen = true; d.open = hospOpen; d.addEventListener("toggle", () => { hospOpen = d.open; }); } bedTiles(); }
    new MutationObserver(tidy).observe(plan, { childList: true }); new MutationObserver(bedTiles).observe(hot, { childList: true }); tidy();
  })();
  function bedTiles() {
    const b = $("b-atlas"), plan = $("plan"); if (!b || !plan) return;
    const note = text("planNote"), dem = note.match(/about ([\d,]+) admissions/), un = plan.querySelector(":scope > p.note b"), tabs = plan.querySelectorAll("table");
    tile(b, "need", "Assumed demand", dem ? dem[1] : "", "admissions, split by population", "beds");
    tile(b, "unmet", "Unplaced", un ? un.textContent.trim() : "", "admissions with no room within 40 km", "beds");
    tile(b, "hosp", "Hospitals", tabs[1] ? String(tabs[1].querySelectorAll("tr").length - 1) : "", text("bedChip"), "beds");
    // "Most cases: Petaling (534)." is the app's own first line above the districts table
    const mb = [...document.querySelectorAll("#hotRank > p:first-child b")].find((x) => /^Most/.test(x.textContent)), m = mb && mb.nextSibling ? mb.nextSibling.textContent.match(/^\s*([^(]+?)\s*\(([^)]+)\)/) : null;
    const lab = mb ? mb.textContent.replace(/:\s*$/, "") : "";
    tile(b, "most", lab || "Most cases", m ? m[1] : "", m ? m[2] + " " + lab.replace(/^Most\s+/, "") : "", "beds");
    const cav = $("bedCaveat"), c = note.match(/This is an illustration, not a recommended allocation\./); if (cav) { set(cav, c ? c[0] : ""); cav.hidden = !c; }
  }
  function atlasTiles() { mapTiles(); bedTiles(); }
  // the first line fits one line on a phone
  { const w = $("w-atlas"); if (w) w.textContent = "beds and clinics"; }
  { const lg = $("stLegend"); if (lg) new MutationObserver(mapTiles).observe(lg, { childList: true }); }
  after(atlasTiles);

  // ---------- Record: the scoreboard as tiles, each record a row that opens on one plate, the app's two paragraphs in rows ----------
  (function track() {
    const box = $("trackBody"), card = $("track"), board = $("b-track"); if (!box || !card) return;
    function tiles() {
      const t = box.querySelector("table.recs"); if (!t || !board) return;
      const recs = [...t.querySelectorAll("tr")].slice(1).filter((tr) => tr.children.length > 1), res = recs.map((tr) => tr.lastElementChild.textContent.trim());
      const n = recs.length, waiting = res.filter((x) => /^Awaiting/.test(x)), scored = n - waiting.length;
      const lag = typeof D !== "undefined" && D && D.pub_lag ? ` Public data runs about ${D.pub_lag} weeks behind.` : "";
      const t1 = tile(board, "scored", "Scored so far", `${scored} of ${n}`, (scored ? "Records scored so far." : "None scored yet.") + lag, "", "w2"), b1 = t1.children[1];
      // the scoreboard itself: one ring for each record, filled only when it has been scored
      let dots = b1.querySelector(".dots"); if (!dots || dots.children.length !== n) { if (dots) dots.remove(); dots = el("span", "dots"); dots.setAttribute("aria-hidden", "true");
        res.forEach((x, i) => { const d = el("i", /^Awaiting/.test(x) ? "miss" : ""); d.style.setProperty("--n", i); dots.append(d); }); b1.append(dots); }
      // "one claim, written down on two days" is the app's own phrase in its first paragraph
      const said = box.textContent.match(/there (?:is|are) ([^.]+?),? and nothing has been scored/), how = said ? said[1].charAt(0).toUpperCase() + said[1].slice(1) : "";
      tile(board, "written", "Records written", String(n), how);
      const due = waiting.map((x) => x.match(/\d{4}-\d{2}-\d{2}/)).filter(Boolean).map((x) => x[0]).sort()[0], line = due ? waiting.find((x) => x.includes(due)) : "";
      tile(board, "due", "Next result due", due ? dm(due) : n ? "All scored" : "", line);
    }
    function arrange() {
      if (box.querySelector(":scope > .plate")) return tiles();
      const t = box.querySelector(":scope > table"); if (!t) return;
      const ps = [...box.querySelectorAll(":scope > p")], heads = [...t.querySelectorAll("th")].map((x) => x.textContent);
      t.querySelectorAll("tr").forEach((tr, r) => { [...tr.children].forEach((td, i) => { td.dataset.l = heads[i] || ""; });
        if (r && tr.children.length > 1) { tr.tabIndex = 0; tr.setAttribute("role", "button"); tr.setAttribute("aria-expanded", "false"); } });
      t.classList.add("recs");
      // the plate's label is the section's own title and chip, repeated (the title itself sits outside what the app rewrites)
      const plate = el("div", "plate"), k = el("p", "k"), h2 = card.querySelector(":scope > h2"); if (h2) k.innerHTML = h2.innerHTML; plate.append(k, t);
      const rows = el("div", "rows"), names = ["How a record is made", "How the records will be scored"]; ps.forEach((p, i) => row(rows, names[i] || "More", p));
      box.append(plate, rows); box.classList.add("stack"); tiles();
    }
    const flip = (tr) => { const on = tr.classList.toggle("open"); tr.setAttribute("aria-expanded", on ? "true" : "false"); };
    box.addEventListener("click", (e) => { if (e.target.closest("a,button,summary")) return; const tr = e.target.closest("table.recs tr[role=button]"); if (tr) flip(tr); });
    box.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("table.recs tr[role=button]")) { e.preventDefault(); flip(e.target); } });
    new MutationObserver(arrange).observe(box, { childList: true }); arrange();
  })();
})();
