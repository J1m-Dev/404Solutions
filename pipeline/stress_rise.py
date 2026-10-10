"""Does the rapid-rise classifier survive bad data? (The stress test in export.py covers the alert rule only.)

Year by year, as in walkforward.py: each test year is scored by a model trained on clean earlier years. The test
year's weekly counts are then damaged and scored again, and the bands are compared with the bands on clean data.
Damage:  half the samples (each positive kept with chance one half, then doubled);
         noise of 20% on every weekly count;
         one week in ten missing, filled with the week before;
         all three together.
Cut-offs are the frozen ones (Watch 0.40, Warning 0.50). 20 runs each, fixed seed. Run after the frozen tiers were
set; this is a description, not a pre-registered test.

    py -3.13 stress_rise.py     -> outputs/stress_rise.json and site/data/stress_rise.json
"""
import json

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier

import core as c
import dengue as d
import walkforward as wf

RUNS, WATCH, WARNING = 20, 0.40, 0.50
band = lambda p: np.where(p >= WARNING, 2, np.where(p >= WATCH, 1, 0))


def damage(cs, kind, rng):
    x = cs.copy()
    if kind in ("half", "all"):
        x = 2.0 * rng.binomial(x.astype(int), 0.5)
    if kind in ("noise", "all"):
        x = np.round(x * rng.uniform(0.8, 1.2, len(x)))
    if kind in ("missing", "all"):
        for i in np.where(rng.random(len(x)) < 0.1)[0]:
            if i:
                x[i] = x[i - 1]
    return x


def main():
    rows = wf.flu_rows()
    y, rule, idx, lab = wf.labelled(rows)
    cs = np.array([r["cases"] for r in rows])
    folds = []
    for year in wf.TEST_YEARS:
        te = [i for i in idx if rows[i]["year"] == year]
        tr = [i for i in idx if te and i + 4 < te[0]]
        ytr = [lab[i] for i in tr]
        if not te or not (0 < sum(ytr) < len(ytr)):
            continue
        m = GradientBoostingClassifier(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(np.array([d.feats(rows, y, i, 2) for i in tr]), ytr)
        folds.append((m, te))
    clean = np.concatenate([band(m.predict_proba(np.array([d.feats(rows, y, i, 2) for i in te]))[:, 1]) for m, te in folds])
    rise = np.concatenate([[lab[i] for i in te] for _, te in folds]).astype(bool)
    rng = np.random.default_rng(0)
    out = []
    for kind, label in (("half", "Half the samples, counts scaled back up"), ("noise", "Noise of 20% on every weekly count"), ("missing", "One week in ten missing, filled with the week before"), ("all", "All three together")):
        same, warn_kept, clear_kept, caught = [], [], [], []
        for _ in range(RUNS):
            y2 = np.log1p(damage(cs, kind, rng))
            b = np.concatenate([band(m.predict_proba(np.array([d.feats(rows, y2, i, 2) for i in te]))[:, 1]) for m, te in folds])
            same.append(float((b == clean).mean()))
            warn_kept.append(float((b[clean == 2] >= 1).mean()))   # a clean Warning that is still Watch or higher
            clear_kept.append(float((b[clean == 0] == 0).mean()))  # a clean Clear that is still Clear
            caught.append(int(((b >= 1) & rise).sum()))            # rise weeks still in Watch or higher
        out.append({"test": label, "runs": RUNS, "band_unchanged": round(float(np.mean(same)), 3), "band_unchanged_worst": round(min(same), 3),
                    "warning_still_watch_or_higher": round(float(np.mean(warn_kept)), 3), "clear_still_clear": round(float(np.mean(clear_kept)), 3),
                    "rise_weeks_flagged_mean": round(float(np.mean(caught)), 1), "rise_weeks_flagged_worst": min(caught)})
    res = {"note": "Bands on damaged counts against bands on clean counts, same models. Run after the cut-offs were frozen.", "weeks": int(len(clean)), "rise_weeks": int(rise.sum()),
           "clean": {"clear": int((clean == 0).sum()), "watch": int((clean == 1).sum()), "warning": int((clean == 2).sum()), "rise_weeks_flagged": int(((clean >= 1) & rise).sum())},
           "cutoffs": {"watch": WATCH, "warning": WARNING}, "tests": out}
    assert res["clean"]["rise_weeks_flagged"] == 109 and res["clean"]["warning"] == 133, res["clean"]  # must agree with walkforward.py at the frozen cut-offs
    for path in (c.ROOT / "outputs" / "stress_rise.json", c.ROOT / "site" / "data" / "stress_rise.json"):
        path.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
