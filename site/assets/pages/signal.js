// DOM control room · lane: signal. The Signal page (#p-forecast). Loaded after assets/room.js.
// The app draws #chart and writes #signals itself; everything here re-arranges IN PLACE (the nodes the app finds by id are
// kept, only their place changes, once). No number or sentence of the app is changed. Shared helpers: window.Room.
(function () {
  const { resize, after, starts, dm } = Room;
  const card = $("forecast"), board = $("b-forecast"), cv = $("chart"), sig = $("signals"); if (!card || !board || !cv || !sig) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // ---------- once: the chart on one plate under its own title and chip; the long note and the key one click down ----------
  const h2 = card.querySelector(":scope > h2"), note = card.querySelector(":scope > p.note"), box = cv.parentNode, ro = box.previousElementSibling;
  const plate = document.createElement("div"); plate.className = "plate"; card.insertBefore(plate, card.firstChild);
  if (h2) plate.append(h2); if (ro && ro.classList.contains("readout")) plate.append(ro); plate.append(box);   // the readout (assets/scrub.js) sits between the title and the chart
  const rows = document.createElement("div"); rows.className = "rows";
  rows.innerHTML = `<details class="drawer"><summary>What this measures</summary><div class="drawerbody"></div></details>
    <details class="drawer"><summary id="sigSum">What each line is</summary><div class="drawerbody"><ul class="keys" id="sigKeys"></ul></div></details>`;
  card.append(rows); const [d1, d2] = rows.querySelectorAll("details"); if (note) d1.lastChild.append(note); else d1.remove(); d2.lastChild.append(sig);
  rows.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", resize));
  card.classList.add("stack"); const w = $("w-forecast"); if (w) w.textContent = "flu-positive lab samples";

  // ---------- after every render: four tiles from the app's own figures, and the chart's own key as a list ----------
  function tiles() { const c = context(), a = c.a, iso = starts(c.series), last = iso[iso.length - 1], p = a.pLast, y = c.th.yellow, o = c.th.orange;
    const where = p > o ? "above the Alert line" : p > y ? "above the Watch line" : "below the Watch line";
    const year = last ? last.slice(0, 4) : "", age = c.sim ? `newest ${c.nSim} week${c.nSim > 1 ? "s" : ""} invented` : REPLAY || c.own ? "" : c.lag > 0 ? `${c.lag} week${c.lag > 1 ? "s" : ""} old` : "current";
    const h = `<div class="tile"><span class="k">${c.sim ? "Newest reading, invented" : "Newest reading"}</span><b>${f1(p)}%</b><span class="s">${where}</span></div>
      <div class="tile"><span class="k">Watch line</span><b>${f1(y)}%</b><span class="s">crossing it gives Warning</span></div>
      <div class="tile"><span class="k">Alert line</span><b>${f1(o)}%</b><span class="s">crossing it gives Outbreak</span></div>
      <div class="tile"><span class="k">Data to the week of</span><b>${last ? dm(last) : wk(a.last)}</b><span class="s">${[year, age].filter(Boolean).join(" · ")}</span></div>`;
    if (board._h !== h) { board.innerHTML = h; board._h = h; } }
  // the key of the chart, in the chart's own words and colours (its legend is not drawn on the canvas: see assets/scrub.js)
  function keys() { const ch = Chart.getChart(cv), ul = $("sigKeys"); if (!ch || !ul) return;
    const lab = (((ch.config.options || {}).plugins || {}).legend || {}).labels, keep = lab && lab.filter;
    const h = ch.data.datasets.map((ds, i) => ({ text: ds.label, datasetIndex: i, ds })).filter((it) => (keep ? keep(it, ch.data) : it.text)).map(({ ds, text }) => { const band = ds.fill === "+1";
      return `<li><i class="${band ? "band" : ds.showLine === false ? "dot" : ds.borderDash ? "dash" : ""}" style="--c:${esc(band ? ds.backgroundColor : ds.borderColor)}"></i><span>${esc(text)}</span></li>`; }).join("");
    if (ul._h !== h) { ul.innerHTML = h; ul._h = h; }
    $("sigSum").textContent = sig.querySelector(".signal") ? "What each line is, and the supporting signals" : "What each line is"; }
  after(() => { tiles(); keys(); });
})();
