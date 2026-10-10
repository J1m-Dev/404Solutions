"""Check that site/assets/model.js gives the same forecast and alert level as the Python code."""
import json
import subprocess

import core as c

site = json.loads((c.ROOT / "site/data/site.json").read_text())
series = c.load_series()
y, p, n, wk, yr = c.arrays(series)
t = len(series) - 1
py = {h: c.inv(c.predict(c.fit(y, n, wk, t, h)[0], y, t, wk[t], h)) for h in c.HORIZONS}
js = subprocess.run(["node", "-e", """
const M=require('./site/assets/model.js');const s=require('./site/data/site.json');
const f=M.forecast(s.series,s.models.current,s);
const a=M.assess(s.series,s.models.current,s,s.thresholds,4);
console.log(JSON.stringify({f:Object.fromEntries(Object.entries(f).map(([h,v])=>[h,v.model])),level:a.level}));
"""], capture_output=True, text=True, cwd=c.ROOT)
out = json.loads(js.stdout)
worst = max(abs(py[h] - out["f"][str(h)]) for h in c.HORIZONS)
ahead = [py[h] for h in c.ahead_horizons(4)]
level = c.alert_level(p[t], ahead, site["thresholds"])
print(f"max forecast difference: {worst:.5f} percentage points | python level={level} js level={out['level']}")
assert worst < 0.01 and level == out["level"], "PARITY FAILED"
print("PARITY OK")
