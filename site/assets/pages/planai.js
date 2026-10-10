// DOM control room · lane: planai. On the hosted copy, lets the app's own "Draft with AI" button work through site/api/plan.js.
// Loaded after assets/pages/rest.js. If the function is not there, nothing changes: the button stays as the app left it.
//
// How it stays safe:
// - When the team's own server answers (the app's SERVER flag is true), this file does nothing: the app handles the button.
// - Otherwise it asks GET /api/plan once. Only the answer { ok: true, ai: true } switches anything on. A 404, an error,
//   a page that is not JSON or { ai: false } leaves the page exactly as it is.
// - The draft is shown by the app's own renderer (renderPlanBox), from the app's own PLAN: its chip, its table, its note.
//   The app drops a draft as soon as the figures change, because the draft carries the figures it was made for.
// - "Approve this plan" stays off: an approval is a signed record on a server with storage, and the hosted copy has none.
(function () {
  "use strict";
  const HIS = "Drafting with AI and approving need the local server.";   // the app's sentence on a copy with no server
  const OURS = "Approving needs the team's server.";                      // what is still true once drafting works here
  const box = document.getElementById("planBox"); if (!box) return;
  const $id = (id) => document.getElementById(id);
  let state = "idle";            // idle: not asked yet · asking · on: the function answered and has a key · off: leave the page alone
  let busy = false;              // a draft is being made
  const wired = new WeakSet();   // buttons that already have the click handler (the app makes a new button at every render)

  // the app's flag: true while its own server answers. Unknown counts as true, so nothing is touched.
  const server = () => { try { return SERVER; } catch (e) { return true; } };

  function probe() {
    state = "asking";
    fetch("/api/plan", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { state = d && d.ok === true && d.ai === true ? "on" : "off"; if (state === "on") sync(); })
      .catch(() => { state = "off"; });
  }

  // after every rewrite of #planBox: switch the button on and keep the message true. Things are found by id and never moved.
  function sync() {
    if (state === "off" || server() !== false) return;
    if (state === "idle") return probe();
    if (state !== "on") return;
    let c; try { c = context(); } catch (e) { return; }   // the app has no data yet
    if (c.sim) return;                                     // simulated figures are never sent: the app's button stays off
    const ai = $id("planAI"), msg = $id("planMsg");
    if (!ai || !box.contains(ai)) return;
    if (!wired.has(ai)) { wired.add(ai); ai.addEventListener("click", () => draft(ai)); }
    if (!busy && ai.disabled) ai.disabled = false;
    // only the app's own sentence is replaced. A reason the last draft was not shown (the app's planMsg, which the app
    // clears whenever the figures change) is put in front of it.
    if (msg && msg.textContent === HIS) { let why = ""; try { why = planMsg || ""; } catch (e) {} msg.textContent = (why ? why + " " : "") + OURS; }
  }

  // what the app's own handler does, sent to the hosted function instead of the local server
  async function draft(btn) {
    if (busy || state !== "on" || server() !== false) return;
    let c, inp; try { c = context(); inp = planInputs(c); } catch (e) { return; }
    if (c.sim) return;
    const key = JSON.stringify(inp), msg = $id("planMsg");
    let by = ""; try { by = localStorage.getItem("fs_by") || ""; } catch (e) {}
    if (msg) msg.textContent = "Asking the AI service...";
    btn.disabled = true; busy = true;
    let r = null, d = null;
    try {
      r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...inp, by }), signal: AbortSignal.timeout(40000) });
      try { d = await r.json(); } catch (e) { d = null; }
    } catch (e) { r = null; }
    busy = false; d = d && typeof d === "object" ? d : {};
    const good = r && r.ok && d.source === "ai" && Array.isArray(d.steps) && d.steps.length > 0 &&
      d.steps.every((s) => s && typeof s.what === "string" && typeof s.who === "string" && typeof s.when === "string");
    try {
      // PLAN and planMsg are the app's own (top-level let in app.js). In strict mode an assignment that did not reach
      // them would throw, and then nothing is shown as a draft.
      if (good) { PLAN = { key, source: "ai", steps: d.steps, model: typeof d.model === "string" ? d.model : "" }; planMsg = ""; }
      else planMsg = !r ? "The AI service did not answer. The fixed template is shown."
        : r.status === 400 ? `The request was not accepted${d.detail ? ": " + d.detail : ""}.`
        : `The fixed template is shown: ${aiWhy(d.reason)}${d.detail ? " (" + d.detail + ")" : ""}.`;
      renderPlanBox(context());   // the app's renderer; it resets PLAN and planMsg itself if the figures changed meanwhile
    } catch (e) {
      console.error("planai", e);
      const m = $id("planMsg"); if (m) m.textContent = "The draft could not be shown. The fixed template is shown.";
      if (btn.isConnected) btn.disabled = false;
    }
  }

  new MutationObserver(sync).observe(box, { childList: true, subtree: true });
  sync();
})();
