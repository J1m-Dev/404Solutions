// DOM control room · lane: trust. The Trust page (#p-trust). Loaded after assets/room.js.
// The app writes #trustBody itself (renderTrust in app.js), so everything here re-arranges IN PLACE inside it, again after
// every rewrite, and never moves a node out of it. No number or sentence of the app is changed. Shared helpers: window.Room.
// Top to bottom: the first line (with the section's own caveat chip), four tiles (the app's four counts, in its order),
// ONE plate (the app's chart, its title and its key), then rows (every other part of the app's text, closed).
(function () {
  const { fold, after } = Room;
  const page = $("p-trust"), sec = $("trust"), box = $("trustBody"), board = $("b-trust"); if (!page || !box || !board) return;
  // our own short labels, one for each of the app's four counts, in the app's order (the demo points at them by position)
  const LABELS = ["Rises caught", "After Clear", "Caught early", "How often on"];   // each fits beside the ring at every width
  const LEAD = "How these counts are made";   // our title for the row that holds the app's opening paragraph
  const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const share = (t) => { const m = t.match(/(\d+)\s+of\s+(\d+)/), pc = t.match(/(\d+(?:\.\d+)?)\s*%/); return m ? (+m[2] ? (100 * +m[1]) / +m[2] : 0) : pc ? +pc[1] : null; };
  const opened = { rows: new Set(), key: false };   // what the reader has opened, so a rewrite by the app does not close it

  // ---- the first line: the page, a few words, and the caveat chip of the section's own heading at its right end ----
  // (#trust > h2 and .phead are not rewritten by the app, so the chip is moved once; the heading repeats the first line and is hidden)
  const head = page.querySelector(".phead"), h2 = sec && sec.querySelector(":scope > h2");
  let tools = head && head.querySelector(".tools");
  if (head && h2) { if (!tools) tools = head.appendChild(el("div", "tools")); h2.querySelectorAll(".chip").forEach((c) => tools.append(c)); h2.hidden = true; }
  function firstLine() { const w = $("w-trust"), S = typeof evStats === "function" ? evStats() : null; if (!w || !S) return;
    const n = S.years.length, t = `${WORDS[n] || n} year${n === 1 ? "" : "s"}, ${S.N} weeks`; if (w.textContent !== t) w.textContent = t; }

  // ---- the four counts as tiles on the board: label and ring, the app's count, the app's sentence (three lines; a click opens all four) ----
  function tiles() {
    const ks = [...box.querySelectorAll(":scope > .kpis > .kpi")]; if (!ks.length) return;
    ks.forEach((k, i) => { const b = k.querySelector("b"), s = k.querySelector("span"), count = b ? b.textContent.trim() : "", line = s ? s.textContent.trim() : "";
      let t = board.children[i];
      if (!t) { t = el("article", "tile"); t.tabIndex = 0; t.setAttribute("role", "button"); t.setAttribute("aria-expanded", board.classList.contains("open"));
        const lab = el("span", "k"); lab.append(el("span"), el("i")); const line = el("span", "s"); line.append(el("span"), el("span", "more")); t.append(lab, el("b"), line); board.append(t); }
      const sig = count + "|" + line; if (t._sig === sig) return; t._sig = sig;
      const p = share(count); t.style.setProperty("--p", p == null ? 0 : p.toFixed(1)); t.querySelector("i").hidden = p == null;
      t.querySelector(".k span").textContent = LABELS[i] || ""; t.querySelector("b").textContent = count; // the first clause of the app's sentence shows; the rest of the same sentence (from its own full stop or semicolon on) shows when the tiles are opened
      const cut = line.search(/[.;] /), sp = t.querySelector(".s").children; sp[0].textContent = cut < 0 ? line : line.slice(0, cut); sp[1].textContent = cut < 0 ? "" : line.slice(cut); });
    while (board.children.length > ks.length) board.lastChild.remove();
  }
  const toggle = () => { const on = board.classList.toggle("open"); [...board.children].forEach((t) => t.setAttribute("aria-expanded", on)); };
  board.addEventListener("click", (e) => { if (e.target.closest(".tile")) toggle(); });
  board.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest(".tile")) { e.preventDefault(); toggle(); } });

  // ---- the chart on ONE plate, everything else in rows ----
  function arrange() {
    if (box.querySelector(":scope > .plate, :scope > .rows")) return;   // already arranged since the app's last rewrite
    const kids = [...box.children], iC = kids.findIndex((e) => e.classList.contains("chartbox")); if (iC < 0) return;
    const iK = kids.findIndex((e) => e.classList.contains("kpis"));
    let iH = iC; for (let i = iC - 1; i > iK; i--) if (kids[i].tagName === "H3") { iH = i; break; }   // the chart's own title
    const iN = kids[iC + 1] && kids[iC + 1].matches("p.note") ? iC + 1 : iC;                          // the app's own key to the chart
    const plate = el("div", "plate"), rows = el("div", "rows");
    box.insertBefore(plate, kids[iH]); box.append(rows);
    // the plate: the title (with its "Real data" chip), anything between it and the chart (the hover readout), the chart, the key
    kids.slice(iH, iN + 1).forEach((e) => plate.append(e)); if (kids[iH].tagName === "H3") kids[iH].classList.add("k");
    // the rows: the opening paragraph under a title of ours, then each of the app's sections under its own heading
    const lead = kids.slice(0, iH).filter((e, i) => i !== iK); if (lead.length) { rows.append(el("h3", "", LEAD)); lead.forEach((e) => rows.append(e)); }
    kids.slice(iN + 1).forEach((e) => { if (!e.classList.contains("grid2")) { rows.append(e); return; }
      [...e.children].forEach((col) => [...col.children].forEach((x) => rows.append(x))); e.remove(); });   // two sections side by side become two rows
    // the closing paragraph opens with its own bold title: those words become its row
    const last = rows.lastElementChild, lb = last && last.tagName === "P" && last.firstChild === last.firstElementChild ? last.firstElementChild : null;
    if (lb && lb.tagName === "B") rows.insertBefore(el("h3", "", lb.textContent.trim().replace(/\.$/, "")), last);
    fold(rows);
    rows.querySelectorAll(":scope > details.drawer").forEach((d) => { const key = d.firstElementChild.textContent; if (opened.rows.has(key)) d.open = true;
      d.addEventListener("toggle", () => { d.open ? opened.rows.add(key) : opened.rows.delete(key); }); });
    const note = plate.querySelector(":scope > p.note"); if (note && opened.key) note.classList.add("open");
    // the chart was drawn at the section's width a moment ago: let it take the plate's size now, before the next paint
    const ch = typeof Chart !== "undefined" && Chart.getChart ? Chart.getChart("evChart") : null; if (ch) ch.resize();
  }
  box.addEventListener("click", (e) => { const n = e.target.closest(".plate > p.note"); if (n) setTimeout(() => { opened.key = n.classList.contains("open"); }); });

  function tidy() { box.classList.add("stack"); arrange(); tiles(); if (box.firstElementChild) firstLine(); }
  new MutationObserver(tidy).observe(box, { childList: true }); tidy();
  // if the app has no evidence file it hides its section: the tiles and the chip go with it
  after(() => { const off = !!(sec && sec.hidden); board.hidden = off; if (tools) tools.hidden = off; });
})();
