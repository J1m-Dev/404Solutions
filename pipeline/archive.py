"""Prospective record: write down what the system says today, before the truth is published.

    py archive.py record [csv]      save today's outputs to outputs/prospective/<date>.json (csv: a newer FluNet download)
    py archive.py score <csv>       score earlier records against a newer FluNet download

Commit and push each record on the day it is made; the commit time is the proof it came first.
Public data runs about four weeks behind, so the weeks a record speaks about have already happened
but cannot be seen yet. That is what makes this a fair test.

Each record also pins what made it: the event version, the Watch and Warning cut-offs, a sha256 of the
FluNet file (line endings as git stores them) and of the exported classifier, and the git commit.
The candidate model without seasonal inputs is scored alongside in shadow; the site never uses it.
"""
import datetime as dt
import hashlib
import json
import subprocess
import sys

import numpy as np

import core as c
import dengue as d
import walkforward as wf
from export import rise_model

DIR = c.ROOT / "outputs" / "prospective"
POLICY = "No claim is made from a single scored record. Results are reported once at least eight records have been scored."
CLAIM = {"clear": "no rapid rise in the next four weeks", "watch": "a rapid rise in the next four weeks", "warning": "a rapid rise in the next four weeks"}
wk = lambda s: f"{s['year']}-W{s['week']:02d}"
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, cwd=c.ROOT).stdout.strip()


def classifier_sha(m, tiers):
    """sha256 of the classifier as the site runs it: stumps, init, lr and tiers as canonical JSON."""
    return sha(json.dumps({"stumps": m["stumps"], "init": m["init"], "lr": m["lr"], "tiers": tiers}, sort_keys=True, separators=(",", ":")).encode())


def after(s, k):
    """The week k weeks after s, from the calendar (2026 has 53 weeks, so counting to 52 would be wrong)."""
    iso = (dt.date.fromisoformat(str(s["start"])[:10]) + dt.timedelta(weeks=k)).isocalendar()
    return {"year": iso[0], "week": iso[1]}


def record(csv=None):
    if csv:  # a newer download: every loader below reads core.RAW
        c.RAW = c.Path(csv).resolve() if hasattr(c, "Path") else __import__("pathlib").Path(csv).resolve()
    series = c.load_series()
    y, p, n, wkk, yr = c.arrays(series)
    N = len(series)
    # The alert lines are the ones the site shows, read from its data file, so that a newer download cannot move them.
    th = json.loads((c.ROOT / "site" / "data" / "site.json").read_text())["thresholds"]
    t = N - 1
    ahead = [c.inv(c.predict(c.fit(y, n, wkk, t, h)[0], y, t, wkk[t], h)) for h in c.ahead_horizons(c.PUB_LAG)]
    level = c.alert_level(p[t], ahead, th)
    rows = wf.flu_rows()
    ly = np.log1p(np.array([r["cases"] for r in rows]))
    m = rise_model()
    x = d.feats(rows, ly, len(rows) - 1, 2)
    z = m["init"] + m["lr"] * sum((l if x[f] <= thr else r) for f, thr, l, r in m["stumps"])
    prob = 1 / (1 + np.exp(-z))
    ev = json.loads((c.ROOT / "outputs" / "walkforward.json").read_text())["evidence"]
    tiers, ctiers = ev["live_tiers"], ev["candidate_tiers"]
    assert (tiers["watch"], ctiers["watch"]) == (wf.LIVE_WATCH, wf.CANDIDATE_WATCH), "outputs/walkforward.json does not hold the frozen cut-offs; run walkforward.py"
    # Candidate in shadow: same settings and weeks, the four seasonal inputs removed. Trained here only, never exported.
    _, _, idx, lab = wf.labelled(rows)
    cf = lambda i: d.feats(rows, ly, i, 2)[:5]
    cprob = float(wf.GB().fit(np.array([cf(i) for i in idx]), [lab[i] for i in idx]).predict_proba([cf(len(rows) - 1)])[0, 1])
    band, cband = wf.band(prob, tiers), wf.band(cprob, ctiers)
    last = series[-1]
    today = after(last, c.PUB_LAG)
    span = f"{wk(after(last, 1))} to {wk(today)}"
    DIR.mkdir(parents=True, exist_ok=True)
    made = str(dt.date.today())
    same = sorted(q["made_on"] for q in (json.loads(f.read_text()) for f in DIR.glob("*.json")) if q["newest_published_week"] == wk(last) and q["made_on"] != made)
    rec = {"made_on": made, "data_file": c.RAW.name, "newest_published_week": wk(last),
           "newest_positivity_percent": round(float(p[t]), 1), "today_week_estimate": wk(today),
           "alert_level_for_today": level, "alert_line_percent": round(th["orange"], 1),
           "claim_alert": f"Positivity in {wk(today)} will be {'above' if level in ('orange', 'red') else 'at or below'} the alert line of {th['orange']:.1f}%.",
           "rapid_rise_probability": round(float(prob), 3), "rapid_rise_call": bool(prob >= 0.5),
           "claim_rise": f"Weekly positives will{'' if prob >= 0.5 else ' not'} reach 1.5 times their level four weeks earlier in any of {span}.",
           "event": wf.EVENT, "tiers": tiers, "rapid_rise_band": band, "claim_band": f"{band.capitalize()}: {CLAIM[band]}, {span}.",
           "candidate": {"name": ev["candidate"]["name"], "note": "Scored in shadow. It is trained in Python only and the site never uses it.",
                         "probability": round(cprob, 3), "band": cband, "tiers": ctiers, "claim_band": f"{cband.capitalize()}: {CLAIM[cband]}, {span}."},
           "same_weeks_as": same,
           "data_sha256": sha(c.RAW.read_bytes().replace(b"\r\n", b"\n")), "classifier_sha256": classifier_sha(m, tiers),
           "git_commit": git("rev-parse", "--short", "HEAD") or None, "git_dirty": bool(git("status", "--porcelain")) if git("rev-parse", "--short", "HEAD") else None,
           "policy": POLICY, "status": "awaiting data"}
    path = DIR / f"{rec['made_on']}.json"
    if path.exists():
        print("A record for today already exists; not overwriting:", path.name)
        return
    path.write_text(json.dumps(rec, indent=1))
    print(json.dumps(rec, indent=1))


def score(newer_csv):
    series = c.load_series(newer_csv)
    idx = {wk(s): i for i, s in enumerate(series)}
    p = np.array([100.0 * s["pos"] / s["n"] for s in series])
    pos = np.array([s["pos"] for s in series])
    for path in sorted(DIR.glob("*.json")):
        rec = json.loads(path.read_text())
        i0, it = idx.get(rec["newest_published_week"]), idx.get(rec["today_week_estimate"])
        if rec["status"] != "awaiting data" or i0 is None or it is None:
            continue
        above = bool(p[it] > rec["alert_line_percent"])
        rose = any(pos[j] >= 1.5 * pos[j - 4] for j in range(i0 + 1, it + 1))
        rec.update({"status": "scored", "scored_with": __import__("pathlib").Path(newer_csv).name, "scored_with_sha256": sha(open(newer_csv, "rb").read().replace(b"\r\n", b"\n")), "actual_positivity_today_week": round(float(p[it]), 1),
                    "alert_correct": above == (rec["alert_level_for_today"] in ("orange", "red")),
                    "rapid_rise_happened": bool(rose), "rise_call_correct": bool(rose) == rec["rapid_rise_call"]})
        if "rapid_rise_band" in rec:  # the first record was made before the bands existed
            rec["band_correct"] = bool(rose) == (rec["rapid_rise_band"] != "clear")
        if "candidate" in rec:
            cand = rec["candidate"]
            cand.update({"call_correct": bool(rose) == (cand["band"] == "warning"), "band_correct": bool(rose) == (cand["band"] != "clear")})
        path.write_text(json.dumps(rec, indent=1))
        print("scored", path.name, "| alert", rec["alert_correct"], "| rise call", rec["rise_call_correct"], "| band", rec.get("band_correct"),
              "| candidate band", rec.get("candidate", {}).get("band_correct"))
    done = {q["newest_published_week"] for q in (json.loads(f.read_text()) for f in DIR.glob("*.json")) if q["status"] == "scored"}
    print(f"Scored so far: {len(done)} of the 8 separate weeks needed before results are reported.")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "score":
        score(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == "record":
        record(sys.argv[2] if len(sys.argv) > 2 else None)
    else:  # a mistyped command must not write a record
        print(__doc__)
