// DOM control room · lane: ask. The Ask page (#p-ask). Loaded after assets/room.js. Shared helpers: window.Room.
// A question is answered ONLY from what the app has already drawn on its own pages. Nothing is stored and no data file is
// added: at the moment a question is asked, harvest() reads the text of the app's own elements (today's step and its
// reasons, the plan, the four counts, every drawer) into small pieces, each remembering the page it came from.
// pick() finds the pieces that match the question. They go to /api/ask, which words an answer from them and checks every
// number against them. When that service is not there (no key, a failure, the local preview), the page answers by itself:
// it shows the matching sentences in the app's own words, with the same source chips. No sentence or number is changed.
(function () {
  const root = document.getElementById("askRoot"), page = document.getElementById("p-ask"); if (!root || !page) return;
  const $id = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const PAGE = { now: "Now", forecast: "The signal", trust: "Why trust it", track: "Track record", stakes: "Who it is for", more: "More" };
  const NOT = "That is not in DOM's data.", CAP = 1200, API = "api/ask";
  const REPLAYING = typeof REPLAY !== "undefined" && !!REPLAY;

  // ---------- reading the app's pages into pieces ----------
  const tidy = (s) => s.replace(/\s+/g, " ").replace(/\s+([.,;:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/^(?:\s*·\s*)+|(?:\s*·\s*)+$/g, "").replace(/(?:\s*·\s*){2,}/g, " · ").trim();
  const sents = (t) => t.replace(/([.!?])\s+(?=[A-Z0-9"“(])/g, "$1\u0001").split("\u0001").map((s) => s.trim()).filter(Boolean);
  const stop = (s) => (/[.!?:]$/.test(s) ? s : s + ".");
  const SKIP = new Set(["SCRIPT", "STYLE", "CANVAS", "SVG", "BUTTON", "SELECT", "INPUT", "TEXTAREA", "IMG", "LABEL"]);
  const HARD = new Set(["P", "LI", "DIV", "UL", "OL", "DETAILS", "SECTION", "ARTICLE", "HEADER", "BLOCKQUOTE", "DT", "DD"]);
  const HEAD = new Set(["H1", "H2", "H3", "H4", "SUMMARY"]);
  const SURFACE = ".tile, .plate";   // a kit surface is one piece, named by its own label
  // a heading's words without its chips; the chips ("Real data", "Hypothesis") are kept beside it as the piece's tag
  function heading(h) { const c = h.cloneNode(true), chips = [...c.querySelectorAll(".chip")].map((x) => tidy(x.textContent)).filter(Boolean);
    c.querySelectorAll(".chip, .note, button").forEach((x) => x.remove()); return { h: true, t: tidy(c.textContent).replace(/:$/, ""), tag: chips.join(", ") }; }
  // a table row keeps its column headings, so a row can be read by itself
  function table(t) { const rows = [...t.rows], cells = (r) => [...r.cells].map((c) => tidy(c.textContent));
    const head = rows.length > 1 && [...rows[0].cells].every((c) => c.tagName === "TH") ? cells(rows[0]) : null;
    return rows.slice(head ? 1 : 0).map((r) => cells(r).map((v, i) => (head && head[i] === "#" ? "" : v && head && head[i] ? head[i] + ": " + v : v)).filter(Boolean).join(" · ")).filter(Boolean); }
  // the text of some elements as blocks: one for each paragraph, list item and table row; headings are marked
  function blocks(nodes, skip) {
    const out = []; let buf = "";
    const flush = () => { const t = tidy(buf); buf = ""; if (t) out.push({ h: false, t }); };
    (function walk(list, row) {
      for (const c of list) {
        if (c.nodeType === 3) { buf += c.nodeValue; continue; }
        if (c.nodeType !== 1 || SKIP.has(c.tagName.toUpperCase()) || (skip && c.matches(skip))) continue;
        const tag = c.tagName;
        if (tag === "BR") { buf += " "; continue; }
        if (tag === "TABLE") { flush(); table(c).forEach((t) => out.push({ h: false, t })); continue; }
        if (HEAD.has(tag)) { flush(); const h = heading(c); if (h.t) out.push(h); continue; }
        if (c.matches(SURFACE)) { flush(); const k = c.querySelector(":scope > .k, :scope > h1, :scope > h2, :scope > h3");
          if (k) { const h = heading(k); if (h.t) out.push(h); } walk([...c.childNodes].filter((x) => x !== k), false); flush(); continue; }
        const d = getComputedStyle(c).display;
        if (HARD.has(tag)) { flush(); walk(c.childNodes, /flex/.test(d) && !/column/.test(getComputedStyle(c).flexDirection)); flush(); continue; }
        const sep = d === "inline" ? "" : row || d.startsWith("inline") ? " · " : " ";   // pieces set side by side are separated; stacked ones read on
        buf += sep; walk(c.childNodes, false); buf += sep;
      }
    })(nodes, false);
    flush(); return out;
  }
  // blocks grouped under their headings: [{title, tag, paras}], each para a list of sentences
  function parts(nodes, skip) {
    const out = []; let cur = { title: "", tag: "", paras: [] };
    const close = () => { if (cur.paras.length) out.push(cur); else if (cur.title.length > 40) out.push({ title: "", tag: cur.tag, paras: [[cur.title]] }); };   // a heading that is itself a sentence is kept as one
    for (const b of blocks(nodes, skip)) { if (b.h) { close(); cur = { title: b.t, tag: b.tag || "", paras: [] }; } else cur.paras.push(sents(b.t)); }
    close(); return out;
  }
  const kids = (e) => (e ? [...e.childNodes] : []);
  const text = (id) => { const e = $id(id); return e ? tidy(e.textContent) : ""; };

  function harvest() {
    const L = [];
    // one piece is at most about 1,200 characters; a longer part continues in a second piece with the same name
    const put = (id, pg, title, paras, tag, href) => { paras = (paras || []).map((p) => p.filter(Boolean)).filter((p) => p.length); if (!paras.length) return;
      let cur = [], len = 0, n = 0; const emit = () => { if (!cur.length) return; n++; L.push({ id: n > 1 ? id + String.fromCharCode(96 + n) : id, base: id, page: pg, title: title.slice(0, 160), tag: tag || "", href: href || "#/" + pg, paras: cur }); cur = []; len = 0; };
      for (const p of paras) { let keep = []; for (const s0 of p) { const s = s0.slice(0, CAP - 80); if (len + s.length > CAP - 80 && (cur.length || keep.length)) { if (keep.length) cur.push(keep); keep = []; emit(); } keep.push(s); len += s.length + 1; } if (keep.length) cur.push(keep); }
      emit(); };
    const many = (prefix, pg, fallback, list, href) => list.forEach((p, i) => put(prefix + (i + 1), pg, p.title || fallback, p.paras, p.tag, href));

    // ---- Now: today's step, the four steps, the reasons, what to do, the plan, the newest reading, the data's age ----
    const card = $id("alertCard"), stepP = [], ladderP = [], why = [];
    if (card) for (const k of card.children) {
      if (k.classList.contains("level") || k.classList.contains("cats")) blocks([k]).forEach((b) => stepP.push(sents(b.t)));
      else if (k.classList.contains("ladder")) [...k.children].forEach((s) => { const b = s.querySelector("b"), sm = s.querySelector("small"); const t = b && sm ? tidy(b.textContent) + ": " + tidy(sm.textContent) : tidy(s.textContent); if (t) ladderP.push([t]); });
      else why.push(k);
    }
    if (!stepP.length) { const w = text("pct"), h = text("head"); if (w || h) stepP.push([[w, h].filter(Boolean).join(": ")]); const l = text("lvl"); if (l) stepP.push([l]); }
    put("step", "now", REPLAYING ? "The step in the replay" : "Today's step", stepP);
    put("ladder", "now", "The four steps", ladderP);
    put("why", "now", "Why this step", blocks(why).filter((b) => !b.h).map((b) => sents(b.t)));
    { const f = text("first"), w = text("who"); put("do", "now", "Do first", [[f && stop(f), w].filter(Boolean)]); }
    { const a = $id("action"), h = a && a.previousElementSibling, hd = h && HEAD.has(h.tagName) ? heading(h) : null;
      put("action", "now", hd && hd.t ? hd.t : "Proposed action", blocks(kids(a)).filter((b) => !b.h).map((b) => sents(b.t)), hd ? hd.tag : ""); }
    put("plan", "now", "Step-by-step plan", blocks(kids($id("planBox")), "#planMsg").filter((b) => !b.h).map((b) => sents(b.t)));
    put("summary", "now", "Summary", [sents(text("sumEn"))]);
    { const v = text("t1"), b = text("because"); if (v) put("reading", "now", "Newest reading", [[stop(tidy(v + " " + b))]]); }
    { const row = $id("ageRow"), P = []; if (row && !row.hidden && text("age")) P.push([stop(text("age")), ...sents(text("ageS"))]);
      if (REPLAYING || !P.length) { const b = text("basis"); if (b) P.push([stop(b)]); }
      const st = text("stamp").split(" | ")[0]; if (st) P.push(sents(st));   // the status line's first part: how far the public data runs (the rest lists uploads)
      put("age", "now", "Data age", P); }
    { const v = text("recV"), s = text("recS"); if (v || s) put("reliable", "now", "How reliable", [[v && stop(v), ...sents(s)].filter(Boolean)]); }
    if (REPLAYING) put("replay", "now", "The replay", [sents(text("stripNote")), sents(text("rpAbout"))]);

    // ---- Why trust it: the four counts, then each drawer or heading ----
    { const box = $id("trustBody"), sec = $id("trust"), chip = (sec && sec.querySelector(":scope > h2 .chip")) || document.querySelector("#p-trust .phead .chip");
      if (box) { put("counts", "trust", "The four counts", [...box.querySelectorAll(".kpis .kpi")].map((k) => sents(tidy([...k.children].map((c) => c.textContent).join(" ")))), chip ? tidy(chip.textContent) : "");
        many("trust", "trust", "Why trust it", parts(kids(box), ".kpis")); } }
    // ---- Track record, The signal, Who it is for ----
    many("track", "track", "Track record", parts(kids($id("trackBody"))));
    many("signal", "forecast", "The signal", parts(kids($id("forecast"))));
    // (the fact tiles on this page repeat, in pieces, sentences that its rows hold whole: the rows are read)
    { const pg = $id("p-stakes"); if (pg) many("stakes", "stakes", "Who it is for", parts(kids(pg), ".phead, a.go, a.link, a.btn, .tile.fact")); }
    // ---- More: every result, dengue, the facilities guide, the footer ----
    { const box = $id("proofBody"); if (box) { put("results", "more", "Every result: the headline counts", [...box.querySelectorAll(":scope > .kpis .kpi")].map((k) => sents(tidy([...k.children].map((c) => c.textContent).join(" ")))), "", "#proof");
        many("proof", "more", "Every result, pass or fail", parts(kids(box), ".kpis"), "#proof"); } }
    many("dengue", "more", "Second disease: dengue", parts(kids($id("dengue")), "#dengue > summary"), "#dengue");
    many("guide", "more", "Facilities: sources", parts(kids($id("guide")), "#guide > summary"), "#guide");
    { const f = document.querySelector("main > footer") || document.querySelector("footer"); if (f) put("about", "more", "About this project", [sents(tidy(f.textContent))]); }

    for (const c of L) { c.text = c.paras.map((p) => p.map(stop).join(" ")).join(" "); c.words = new Set(words(c.text)); c.tw = new Set(words(c.title)); }
    return L.filter((c) => c.text);
  }

  // ---------- finding the pieces that match a question ----------
  const STOP = new Set("a an the is are was were be been it its this that these those of in on at to for from by with as and or but if then than so does did has have had what which whom whose when where how i me my we our you your they them their he she his her not no yes can could should would will may might must shall about into over under again more most some any each every all both there here just also only very too tell show give please dom".split(" "));
  const GROUPS = ["reliable trust trusted right accurate accuracy correct reliability caught believe proof", "old age behind late delay lag stale current newest recent date fresh published", "do action plan task respond response act",
    "who acts body owner responsible department", "why reason because explain", "rise surge wave increase spike rapid", "flu influenza", "cost money myr price expensive stake admission", "user planner audience customer",
    "step level status band", "hospital clinic facility bed", "miss missed fail failed wrong limit cannot weakness", "forecast predict prediction projection", "source figure flunet", "followed after follow", "often frequently count times"];
  const SYN = {}; GROUPS.forEach((g) => { const m = g.split(" "); m.forEach((w) => { SYN[w] = m; }); });
  const norm = (w) => { w = w.replace(/'s$/, "").replace(/[^a-z0-9.%-]/g, "").replace(/^[.-]+|[.-]+$/g, ""); if (/^\d/.test(w)) return w.replace(/,/g, ""); if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1); return w; };
  function words(s) { return (s.toLowerCase().match(/[a-z0-9][a-z0-9'.,%-]*/g) || []).map(norm).filter(Boolean); }
  const terms = (q) => [...new Set(words(q).filter((w) => w.length > 1 && !STOP.has(w)))];
  const has = (set, t) => set.has(t) || (SYN[t] || []).some((x) => set.has(x));

  // subjects a planner or a judge is likely to ask about, and the pieces that hold them (by id, or by a word in the piece's name)
  const ROUTES = [
    [/\b(now|today|currently|current|this week|level|step|status|safe)\b/, ["step", "summary", "why"]],
    [/\b(do|action|actions|plan|respond|response|next)\b/, ["do", "action", "plan"]],
    [/\b(old|age|late|behind|delay|lag|fresh|stale|up to date)\b/, ["age", "why"]],
    [/\b(watch line|alert line|threshold|thresholds|cut-?off)\b/, ["why", "signal1", /what each line is/i]],
    [/\b(accura\w*|reliab\w*|trust\w*|right|wrong|miss\w*|caught|catch\w*|false alarms?|precision|recall|perform\w*|good|works?|proof|proven)\b/, ["counts", "reliable", "results", /what this does not show/i]],
    [/\b(model|classifier|machine learning|algorithm|score|scores|trained|training|ai)\b/, [/how these counts are made/i, /predictive model/i, /what is learned/i, "why"]],
    [/\b(limits?|limitations?|cannot|can't|weak\w*|caveats?|fail\w*|not show)\b/, [/what this does not show/i, /what this cannot tell you/i, /no better than a simple guess/i]],
    [/\b(sources?|come from|comes from|dataset|datasets|flunet|collects?|measure[sd]?)\b/, ["about", /what this measures/i, "dengue1"]],
    [/\b(who is (this|it|dom) for|users?|audience|customers?|planners?|built for|what (is|does) (dom|this|it)\b)/, [/^the user$/i, /what dom does/i, "stakes1"]],
    [/\b(costs?|money|myr|ringgit|price|expensive|stakes?|admissions?)\b/, [/published costs/i, /^the user$/i]],
    [/\b(2025|october|replay|last year|surge)\b/, [/2025 surge/i, "replay", "stakes1"]],
    [/\b(dengue|second disease|other diseases?)\b/, [/second disease: the forecast/i, "dengue1", /forecast accuracy/i]],
    [/\b(track record|records?|scored|in advance|written down)\b/, ["track1", /how a record is made/i, /how the records will be scored/i]],
    [/\b(hospitals?|clinics?|facilit\w*|beds?)\b/, ["guide1", "guide2"]],
    [/\b(advice|medical|doctor|official|ministry|affiliat\w*|student|who (made|built))\b/, ["about", "action"]],
    [/\b(forecast\w*|predict\w*|projection|ahead|next (four )?weeks)\b/, ["step", /no better than a simple guess/i, "why"]],
  ];
  // the pieces for a question, best first, with how much of the question they cover (0 to 1)
  function pick(q, chunks) {
    const T = terms(q), N = chunks.length || 1, ql = " " + q.toLowerCase().replace(/[^a-z0-9'-]+/g, " ").replace(/\bright now\b/g, "now") + " ";
    const routed = new Map(); ROUTES.forEach(([re, to]) => { if (re.test(ql)) byUse(chunks, to).forEach((c, i) => routed.set(c, Math.max(routed.get(c) || 0, 1 - i * 0.15))); });
    if (!T.length && !routed.size) return { T, ranked: [], cover: 0, idf: {}, routed: false };
    const idf = {}, known = []; T.forEach((t) => { const df = chunks.filter((c) => has(c.words, t) || has(c.tw, t)).length; idf[t] = Math.log(1 + N / (df + 0.5)); if (df) known.push(t); });
    const total = known.reduce((s, t) => s + idf[t], 0) || 1;
    const ranked = chunks.map((c) => { let score = 0, got = 0; known.forEach((t) => { const a = has(c.words, t), b = has(c.tw, t); if (a || b) got += idf[t]; score += (a ? idf[t] : 0) + (b ? 1.2 * idf[t] : 0); });
      return { c, score: score / (2.2 * total) + (routed.get(c) || 0) + (c.page === "now" ? 0.02 : 0), cover: got / total }; }).filter((r) => r.score > 0.03).sort((x, y) => y.score - x.score);
    // in the data: a known subject, or most of the question's own words are on the pages and one piece holds half of them
    const inData = routed.size > 0 || (known.length > 0 && known.length >= T.length / 2 && ranked.length > 0 && ranked[0].cover >= 0.5);
    return { T, ranked, idf, routed: routed.size > 0, inData };
  }
  // the sentences of a piece that say most about the question, in the order the page has them
  function best(c, T, idf, n) {
    if (c.text.length <= 260) return c.paras.flat();   // a short piece is shown whole
    const all = []; c.paras.forEach((p) => p.forEach((s) => { const w = new Set(words(s)); all.push({ s, score: T.reduce((a, t) => a + (has(w, t) ? idf[t] || 1 : 0), 0), i: all.length }); }));
    const hit = all.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n);
    return (hit.length ? hit : all.slice(0, n)).sort((a, b) => a.i - b.i).map((x) => x.s);
  }

  // ---------- the four suggested questions: each names the pieces that hold its answer, so it always lands ----------
  const lead = (c, shape) => { const out = []; if (c) shape.forEach((n, i) => { if (c.paras[i]) out.push(...c.paras[i].slice(0, n)); }); return out; };
  const find = (c, re) => { if (!c) return []; for (const p of c.paras) for (const s of p) if (re.test(s)) return [s]; return []; };
  const SUGGEST = [
    { q: "Why is the step what it is today?", use: ["step", "why"], also: [], say: (C) => [[C.step, lead(C.step, [1])], [C.why, lead(C.why, [2, 1])]] },
    { q: "How often did a Warning lead to a rapid rise?", use: ["ladder", "why", /how often each band/i], also: [/how often each band/i], say: (C) => [[C.ladder, find(C.ladder, /^Warning\b/i)], [C.why, find(C.why, /how often each classifier band/i)]] },
    { q: "What should I do first, and who does it?", use: ["do", "action", "plan"], also: ["plan"], say: (C) => [[C.do, lead(C.do, [2])], [C.action, find(C.action, /not official guidance/i)]] },
    { q: "How old is the data?", use: ["age", "why"], also: [], say: (C) => [[C.age, lead(C.age, [3, 1])]] },
  ];
  const byUse = (chunks, use) => use.map((u) => chunks.find((c) => (typeof u === "string" ? c.id === u : u.test(c.title)))).filter(Boolean);

  // the page's own answer, with no AI: the matching sentences, unchanged, and where each came from
  function own(q, chunks, sug) {
    if (sug) { const C = {}; chunks.forEach((c) => { if (C[c.base]) C[c.base].paras = C[c.base].paras.concat(c.paras); else C[c.base] = { paras: c.paras, first: c }; });   // a part that runs over two pieces is read as one
      const got = sug.say(C).filter((x) => x[0] && x[1].length); if (got.length) return { text: got.map((x) => x[1].map(stop).join(" ")).join(" "), cites: [...new Set(got.map((x) => x[0].first).concat(byUse(chunks, sug.also)))].slice(0, 3) }; }
    const r = pick(q, chunks); if (!r.ranked.length || !r.inData) return { text: NOT, cites: [] };
    const a = r.ranked[0], b = r.ranked[1] && r.ranked[1].score >= 0.6 * a.score ? r.ranked[1] : null;
    const out = best(a.c, r.T, r.idf, b ? 2 : 3), cites = [a.c];
    if (b) { const more = best(b.c, r.T, r.idf, 1).filter((s) => !out.includes(s)); if (more.length) { out.push(...more); cites.push(b.c); } }
    let t = ""; for (const s of out) { if (t && t.length + s.length > 460) break; t += (t ? " " : "") + stop(s); }
    return { text: t, cites };
  }
  // what goes to the AI: the named pieces first, then the best matches, five at most, and always the step.
  // A question that matches little is still sent, with the page's main pieces: the AI may see a link the word match missed.
  function forAI(q, chunks, sug) {
    const list = sug ? byUse(chunks, sug.use) : []; pick(q, chunks).ranked.forEach((r) => { if (list.length < 5 && !list.includes(r.c)) list.push(r.c); });
    byUse(chunks, ["summary", "why", "do", "age"]).forEach((c) => { if (list.length < 5 && !list.includes(c)) list.push(c); });
    const top = list.slice(0, 5), step = chunks.find((c) => c.id === "step"); if (step && !top.includes(step)) top.push(step);
    return top.slice(0, 6);
  }

  // ---------- the screen ----------
  const box = el("div", "tile askbox"), log = el("div", "asklog"), sug = el("div", "asksug"), form = el("form", "askform"), input = el("input"), send = el("button", "go");
  log.setAttribute("role", "log"); log.setAttribute("aria-live", "polite"); log.setAttribute("aria-label", "Questions and answers"); log.tabIndex = 0;
  log.append(el("b", "askhi", REPLAYING ? "Ask about the replay's reading" : "Ask about today's reading"));
  sug.setAttribute("aria-label", "Suggested questions");
  SUGGEST.forEach((s) => { const b = el("button", "quiet", s.q); b.type = "button"; b.onclick = () => ask(s.q, s); sug.append(b); });
  input.type = "text"; input.maxLength = 300; input.autocomplete = "off"; input.enterKeyHint = "send"; input.placeholder = "Ask DOM a question"; input.setAttribute("aria-label", "Your question");
  send.type = "submit"; send.append(el("span", "lab", "Ask"));
  form.append(input, send); form.noValidate = true;
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.replace(/\s+/g, " ").trim(); if (q.length < 3) { input.focus(); return; } ask(q, SUGGEST.find((s) => s.q.toLowerCase() === q.toLowerCase()) || null); });
  box.append(log, sug, form); root.append(box);

  let busy = false, apiOff = false, told = false;
  const down = () => { log.scrollTop = log.scrollHeight; };
  function chipsFor(cites) { const row = el("div", "asksrc"); const seen = new Set();
    cites.forEach((c) => { const label = (PAGE[c.page] || c.page) + " · " + (c.title.length > 46 ? c.title.slice(0, 44).trim() + "…" : c.title) + (c.tag ? " · " + c.tag : ""); if (seen.has(label)) return; seen.add(label);
      const a = el("a", "", label); a.href = c.href; a.title = "Open " + (PAGE[c.page] || c.page); row.append(a); });
    return row; }
  // one call to the AI service. Returns {answer, cites} or null (then the page answers by itself).
  async function viaAI(q, list) {
    if (apiOff) return null;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch(API, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.slice(0, 300), chunks: list.map((c) => ({ id: c.id, page: PAGE[c.page] || c.page, title: c.title + (c.tag ? " (" + c.tag + ")" : ""), text: c.text.slice(0, 1500) })) }) });
      if (r.status === 404 || r.status === 405 || r.status === 501 || r.status === 503) { apiOff = true; return null; }   // not deployed here, or no key: do not ask again on this visit
      if (!r.ok) return null;
      const j = await r.json(); if (!j || typeof j.answer !== "string" || !j.answer.trim()) return null;
      return { answer: j.answer.trim().slice(0, 900), cites: (Array.isArray(j.cites) ? j.cites : []).map((id) => list.find((c) => c.id === id)).filter(Boolean) };
    } catch (e) { return null; } finally { clearTimeout(timer); }
  }
  async function ask(q, s) {
    if (busy) return; busy = true; send.disabled = true; sug.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    box.classList.add("has"); input.value = "";
    const turn = el("div", "askturn"), ans = el("div", "aska"), wait = el("span", "askwait");
    wait.setAttribute("role", "status"); wait.setAttribute("aria-label", "Reading DOM's pages"); wait.append(el("i"), el("i"), el("i"));
    ans.append(el("span", "k", "DOM"), wait); turn.append(el("p", "askq", q), ans); log.append(turn); down();
    let chunks = [], ai = null, mine = { text: NOT, cites: [] };
    try {
      chunks = harvest(); mine = own(q, chunks, s);
      const list = forAI(q, chunks, s), t0 = Date.now();
      if (list.length) ai = await viaAI(q, list);
      const left = 450 - (Date.now() - t0); if (left > 0) await new Promise((r) => setTimeout(r, left));
    } catch (e) { console.error("ask", e); }
    ans.textContent = "";
    if (ai) { ans.append(el("span", "k", "DOM"), el("p", "", ai.answer)); if (ai.cites.length && ai.answer !== NOT) ans.append(chipsFor(ai.cites)); }
    else { ans.append(el("span", "k", "From DOM's own pages"), el("p", "", mine.text)); if (mine.cites.length) ans.append(chipsFor(mine.cites));
      if (!told) { told = true; ans.append(el("p", "s", "The AI wording is unavailable here.")); } }   // said once in a conversation
    busy = false; send.disabled = false; sug.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    log.scrollTop = Math.max(0, turn.offsetTop - log.offsetTop);   // the newest question at the top of the conversation
  }

  // for checks and the demo run-sheet only: what the page would send, and what it would say by itself
  window.AskDOM = { harvest, own: (q) => own(q, harvest(), SUGGEST.find((s) => s.q === q) || null), suggested: SUGGEST.map((s) => s.q) };
})();
