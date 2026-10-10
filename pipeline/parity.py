"""Check that site/assets/model.js gives the same forecast, alert level and rapid-rise signal as the Python code."""
import datetime as dt
import json
import subprocess

import numpy as np

import core as c
import dengue as d
from export import rise_model
from walkforward import band

site = json.loads((c.ROOT / "site/data/site.json").read_text())
series = c.load_series()
y, p, n, wk, yr = c.arrays(series)
t = len(series) - 1
py = {h: c.inv(c.predict(c.fit(y, n, wk, t, h)[0], y, t, wk[t], h)) for h in c.HORIZONS}
js = subprocess.run(["node", "-e", """
const M=require('./site/assets/model.js');const s=require('./site/data/site.json');
const f=M.forecast(s.series,s.models.current,s);
const a=M.assess(s.series,s.models.current,s,s.thresholds,4);
const rise={current:M.riseSignal(s.series,s.rise.current),replay:M.riseSignal(s.series.slice(0,s.replay_cut_index+1),s.rise.replay)};
console.log(JSON.stringify({f:Object.fromEntries(Object.entries(f).map(([h,v])=>[h,v.model])),level:a.level,rise}));
"""], capture_output=True, text=True, cwd=c.ROOT)
out = json.loads(js.stdout)
worst = max(abs(py[h] - out["f"][str(h)]) for h in c.HORIZONS)
ahead = [py[h] for h in c.ahead_horizons(4)]
level = c.alert_level(p[t], ahead, site["thresholds"])
print(f"max forecast difference: {worst:.5f} percentage points | python level={level} js level={out['level']}")
assert worst < 0.01 and level == out["level"], "PARITY FAILED"

# Rapid-rise classifier: scikit-learn here against the exported stumps as model.js runs them, for the newest week of each series.
cut = site["replay_cut_index"]
for name, upto, last in (("current", None, series[-1]), ("replay", dt.date.fromisoformat(series[cut]["start"]), series[cut])):
    cls, r = site["rise"][name], out["rise"][name]
    m, gb, rows = rise_model(upto, keep=True)
    assert str(rows[-1]["start"]) == last["start"], "PARITY FAILED: the two series end on different weeks"
    assert all(m[k] == cls[k] for k in ("stumps", "init", "lr", "inputs")), "PARITY FAILED: site.json does not hold the classifier this code trains; run export.py"
    x = d.feats(rows, np.log1p([w["cases"] for w in rows]), len(rows) - 1, 2)
    prob, z = float(gb.predict_proba([x])[0, 1]), float(gb.decision_function([x])[0])
    parts = dict.fromkeys(cls["inputs"], 0.0)
    for f, th, lo, hi in cls["stumps"]:
        parts[cls["inputs"][f]] += cls["lr"] * (lo if x[f] <= th else hi)
    total = r["base"] + sum(v["value"] for v in r["parts"])
    gap = max(abs(parts[v["key"]] - v["value"]) for v in r["parts"])
    size = [abs(v["value"]) for v in r["parts"]]
    print(f"rapid rise, {name} ({last['year']}-W{last['week']:02d}): scikit-learn {prob:.6f} js {r['prob']:.6f} (difference {abs(prob - r['prob']):.1e})"
          f" | band python={band(prob, cls['tiers'])} js={r['band']} | parts + base against the log-odds: {abs(total - z):.1e}, largest gap in one part {gap:.1e}")
    assert abs(prob - r["prob"]) < 1e-6 and r["yes"] == (prob >= 0.5) and band(prob, cls["tiers"]) == r["band"], "PARITY FAILED"
    assert abs(total - z) < 1e-5 and abs(total - r["score"]) < 1e-9 and gap < 1e-9, "PARITY FAILED: parts and base do not add up to the score"
    assert sorted(parts) == sorted(v["key"] for v in r["parts"]) and size == sorted(size, reverse=True), "PARITY FAILED: parts are not one per input group, largest first"

# The same comparison at every week the series could end on, so that all three bands are exercised.
import walkforward as wf
js = subprocess.run(["node", "-e", """
const M=require('./site/assets/model.js');const s=require('./site/data/site.json');
const out={};for(const k of ['current','replay']){out[k]=[];for(let t=7;t<s.series.length;t++){const r=M.riseSignal(s.series.slice(0,t+1),s.rise[k]);out[k].push([t,r.prob,r.yes,r.band,r.score,r.base+r.parts.reduce((a,p)=>a+p.value,0)]);}}
console.log(JSON.stringify(out));
"""], capture_output=True, text=True, cwd=c.ROOT)
wide = json.loads(js.stdout)
rows = wf.flu_rows()
ly = np.log1p(np.array([w["cases"] for w in rows]))
at = {str(w["start"]): j for j, w in enumerate(rows)}
for name, upto in (("current", None), ("replay", dt.date.fromisoformat(series[cut]["start"]))):
    cls = site["rise"][name]
    _, gb, _ = rise_model(upto, keep=True)
    worst, seen, bad = 0.0, {}, 0
    for t, prob, yes, b, score, total in wide[name]:
        j = at.get(series[t]["start"])
        if j is None or j < 7 or rows[j - 7]["seg"] != rows[j]["seg"]:
            continue
        x = d.feats(rows, ly, j, 2)
        q, z = float(gb.predict_proba([x])[0, 1]), float(gb.decision_function([x])[0])
        worst = max(worst, abs(q - prob), abs(total - z) / 10)
        bad += (band(q, cls["tiers"]) != b) + (yes != (q >= 0.5))
        seen[b] = seen.get(b, 0) + 1
    print(f"rapid rise, {name}, every week ending: {sum(seen.values())} compared, largest difference {worst:.1e}, bands seen {seen}, mismatches {bad}")
    assert sum(seen.values()) > 100 and worst < 1e-6 and bad == 0 and len(seen) == 3, "PARITY FAILED: the browser classifier and scikit-learn disagree somewhere in the series"
print("PARITY OK")
