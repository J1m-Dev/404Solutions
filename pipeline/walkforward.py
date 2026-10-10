"""Walk-forward check of the rapid-rise classifier, run AFTER the main results were known.

The single 70/30 split scores one stretch of weeks. Here each calendar year is tested in turn by a
classifier trained only on the years before it. Settings are unchanged from pipeline/dengue.py.
This is extra evidence, not a pre-registered result.

The "evidence" block measures more on the same year-by-year predictions: a Watch tier below the Warning
tier, weeks where no rise has started yet, simple baselines and a candidate model without seasonal inputs.
It was also run after earlier results were known, so it is development evidence.
"""
import csv
import datetime as dt
import hashlib
import json

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import core as c
import dengue as d

TEST_YEARS = (2019, 2022, 2023, 2024, 2025, 2026)
EVENT = "v1"  # weekly positives reach at least 1.5 times their level four weeks earlier in any of the next four weeks
WARNING = 0.5
GRID = np.arange(0.5, 0.09, -0.05)  # Watch cut-offs tried, highest first
TARGET = 0.9  # share of rises the Watch tier has to catch
FROZEN = "2026-10-11"
LIVE_WATCH, CANDIDATE_WATCH = 0.4, 0.35  # the frozen Watch cut-offs, written out so that a newer data file cannot move them
FROZEN_DATA = "8d85e744357804f93ac4bfa82833209fd6d3b5c51beea7daa162174fd1f04764"  # sha256 of the FluNet file they were picked on (line endings as git stores them)
GB = lambda: GradientBoostingClassifier(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0)


def flu_rows(path=None):
    """Weekly influenza positives for 2017-2019 and 2022 onward (the years with a count every week)."""
    out = []
    for r in csv.DictReader(open(path or c.RAW, encoding="utf-8-sig")):
        y0 = int(r["ISO_YEAR"])
        if r["ORIGIN_SOURCE"] in c.SOURCES and (2017 <= y0 <= 2019 or y0 >= 2022) and r["INF_ALL"] != "":
            out.append({"start": dt.date.fromisoformat(r["ISO_WEEKSTARTDATE"][:10]), "cases": float(r["INF_ALL"])})
    return d.prep(out)


def labelled(rows):
    cs = np.array([r["cases"] for r in rows])
    y = np.log1p(cs)
    rule = lambda j: rows[j - 4]["seg"] == rows[j]["seg"] and cs[j] >= 1.5 * cs[j - 4]
    idx = [i for i in range(len(rows)) if d.usable(rows, i, 4)]
    return y, rule, idx, {i: any(rule(i + k) for k in d.H) for i in idx}


def add(a, b):
    return {k: a.get(k, 0) + b[k] for k in ("tp", "fp", "tn", "fn")}


def rates(m):
    m = dict(m)
    m["recall"] = round(m["tp"] / (m["tp"] + m["fn"]), 3) if m["tp"] + m["fn"] else None
    m["precision"] = round(m["tp"] / (m["tp"] + m["fp"]), 3) if m["tp"] + m["fp"] else None
    return m


def counts(pred, act):
    m = d.confusion(pred, act)
    return {k: m[k] for k in ("tp", "fp", "tn", "fn")}


def band(p, tiers):
    return "warning" if p >= tiers["warning"] else "watch" if p >= tiers["watch"] else "clear"


def pick(p, act):
    """Highest cut-off on the grid that still catches the target share of the rises."""
    p, act = np.asarray(p), np.asarray(act, bool)
    ok = [t for t in GRID if (p >= t)[act].mean() >= TARGET]
    return round(float(ok[0]), 2) if ok else 0.1


def out_of_fold(rows, idx, lab, f):
    """Each test year scored by a model trained on earlier years, with a Watch cut-off picked inside those earlier years."""
    prob, cut = {}, {}
    X = lambda ii: np.array([f(i) for i in ii])
    for year in TEST_YEARS:
        te = [i for i in idx if rows[i]["year"] == year]
        tr = [i for i in idx if te and i + 4 < te[0]]
        ytr = [lab[i] for i in tr]
        if not te or not (0 < sum(ytr) < len(ytr)):
            continue
        prob.update(zip(te, GB().fit(X(tr), ytr).predict_proba(X(te))[:, 1]))
        k = int(len(tr) * 0.7)  # fit on the first 70% of the training weeks, pick the cut-off on the last 30%
        a, b = tr[:k], tr[k:]
        ya, yb = [lab[i] for i in a], [lab[i] for i in b]
        cut[year] = pick(GB().fit(X(a), ya).predict_proba(X(b))[:, 1], yb) if 0 < sum(ya) < len(ya) and sum(yb) else WARNING
    return prob, cut


def periods(te, flag):
    """Runs of consecutive flagged test weeks."""
    out, cur = [], []
    for i, f in zip(te, flag):
        if f and (not cur or i == cur[-1] + 1):
            cur.append(i)
        else:
            if cur:
                out.append(cur)
            cur = [i] if f else []
    if cur:
        out.append(cur)
    return out


def evidence(rows, y, rule, idx, lab):
    """Tiers, bands, onset-only weeks, baselines and the candidate model, all as counts on the out-of-fold weeks."""
    full = lambda i: d.feats(rows, y, i, 2)
    prob, cut = out_of_fold(rows, idx, lab, full)
    cprob, ccut = out_of_fold(rows, idx, lab, lambda i: full(i)[:5])  # candidate: the four seasonal inputs removed
    sprob, _ = out_of_fold(rows, idx, lab, lambda i: full(i)[5:])  # baseline: the four seasonal inputs alone
    te = sorted(prob)
    act = np.array([lab[i] for i in te], bool)
    now = np.array([rule(i) for i in te])
    quiet = np.array([not any(rule(j) for j in range(i - 3, i + 1)) for i in te])  # no rise this week or in the three before
    arr = lambda pr: np.array([pr[i] for i in te])
    skill = lambda p: {"auc": round(float(roc_auc_score(act, p)), 3), "average_precision": round(float(average_precision_score(act, p)), 3)}
    flags = lambda pr, ct: (arr(pr) >= WARNING, np.array([pr[i] >= ct[rows[i]["year"]] for i in te]))
    onset = lambda warn, watch: {"weeks": int(quiet.sum()), "onsets": int(act[quiet].sum()),
                                 "watch": counts(watch[quiet], act[quiet]), "warning": counts(warn[quiet], act[quiet])}

    def tier(flag):
        runs = periods(te, flag)
        return {**counts(flag, act), "on_weeks": int(flag.sum()), "periods": len(runs),
                "periods_without_rise": sum(1 for r in runs if not any(lab[i] for i in r))}

    p, (warn, watch), (cwarn, cwatch) = arr(prob), flags(prob, cut), flags(cprob, ccut)
    weeks = [{"start": str(rows[i]["start"]), "year": rows[i]["year"], "week": rows[i]["week"], "positives": int(rows[i]["cases"]),
              "score": round(float(prob[i]), 3), "band": band(prob[i], {"warning": WARNING, "watch": cut[rows[i]["year"]]}),
              "rise_now": bool(rule(i)), "rise_follows": bool(lab[i])} for i in te]
    edges = (0, 0.2, 0.35, 0.5, 0.65, 0.8, 1)
    # the test weeks from 2025 on, scored again with every count divided by 10, as a smaller lab network would report them
    te2 = [i for i in idx if rows[i]["year"] >= 2025]
    tr2 = [i for i in idx if i + 4 < te2[0]]
    m = GB().fit(np.array([full(i) for i in tr2]), [lab[i] for i in tr2])
    call = lambda yy: m.predict_proba(np.array([d.feats(rows, yy, i, 2) for i in te2]))[:, 1] >= WARNING
    tenth = np.log1p(np.array([r["cases"] for r in rows]) / 10)
    ev = {"protocol": "Each test year was scored by a model trained only on earlier years; Warning uses a cut-off of 0.5, and the Watch cut-off "
                      "for each year is the highest one from 0.50 down to 0.10, in steps of 0.05, that caught at least 90% of the rises in the last 30% "
                      "of those earlier weeks when the model was fitted on the first 70%. "
                      "These figures were worked out after earlier results on the same weeks were known, so they are development evidence, not a pre-registered test.",
          "weeks": len(te), "rises": int(act.sum()), "picks_by_year": {str(k): v for k, v in cut.items()},
          "tiers": {"watch": tier(watch), "warning": tier(warn)},
          "bands": [{"band": b, "weeks": sum(1 for w in weeks if w["band"] == b), "rises": sum(1 for w in weeks if w["band"] == b and w["rise_follows"])}
                    for b in ("clear", "watch", "warning")],
          "onset": onset(warn, watch),
          "skill": {**skill(p), "base_rate": round(float(act.mean()), 3)},
          "baselines": [{"name": "Always warn", **counts(np.ones(len(te), bool), act)},
                        {"name": "Seasonal inputs only", "auc": skill(arr(sprob))["auc"], "note": "The same model given only the time of year."},
                        {"name": "Three-week growth alone", "auc": skill(np.array([y[i] - y[i - 3] for i in te]))["auc"],
                         "note": "Weeks ranked by how much positives grew over the last three weeks."},
                        {"name": "Simple rule: already rising", **counts(now, act),
                         "note": "Says yes when this week's positives are already at least 1.5 times those of four weeks earlier."}],
          "calibration": [{"from": lo, "to": hi, "weeks": int(b.sum()), "rises": int(act[b].sum())}
                          for lo, hi in zip(edges, edges[1:]) for b in [(p >= lo) & ((p < hi) | (hi == 1))]],
          "scale_test": {"weeks": len(te2), "changed_at_a_tenth": int((call(y) != call(tenth)).sum())},
          "candidate": {"name": "Without seasonal inputs", **skill(arr(cprob)), "warning": counts(cwarn, act), "watch": counts(cwatch, act),
                        "onset": onset(cwarn, cwatch), "picks_by_year": {str(k): v for k, v in ccut.items()}},
          "live_tiers": {"event": EVENT, "warning": WARNING, "watch": LIVE_WATCH, "frozen": FROZEN},
          "replay_tiers": {"event": EVENT, "warning": WARNING, "watch": cut[2025]},
          "candidate_tiers": {"event": EVENT, "warning": WARNING, "watch": CANDIDATE_WATCH, "frozen": FROZEN}}
    return ev, weeks, (pick(p, act), pick(arr(cprob), act))  # last: what the rule picks on this data, live and candidate; shown, never used


def main():
    rows = flu_rows()
    y, rule, idx, lab = labelled(rows)
    folds, pooled = [], {}
    for year in TEST_YEARS:
        te = [i for i in idx if rows[i]["year"] == year]
        if not te:
            continue
        tr = [i for i in idx if i + 4 < te[0]]
        ytr, yte = [lab[i] for i in tr], [lab[i] for i in te]
        if not (0 < sum(ytr) < len(ytr)):
            continue
        Xtr, Xte = np.array([d.feats(rows, y, i, 2) for i in tr]), np.array([d.feats(rows, y, i, 2) for i in te])
        gb = GradientBoostingClassifier(n_estimators=150, max_depth=1, learning_rate=0.03, subsample=0.8, random_state=0).fit(Xtr, ytr)
        lr = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000)).fit(Xtr, ytr)
        res = {"already_in_outbreak_now": d.confusion([rule(i) for i in te], yte),
               "logistic_regression": d.confusion(lr.predict(Xte), yte),
               "gradient_boosted": d.confusion(gb.predict(Xte), yte)}
        folds.append({"year": year, "n_train": len(tr), "n_test": len(te), "rises": int(sum(yte)), "models": res})
        for k, m in res.items():
            pooled[k] = add(pooled.get(k, {}), m)
    out = {"note": "Run after the main results were known; settings unchanged. Each year is tested by a classifier trained only on earlier years.",
           "folds": folds, "pooled": {k: rates(m) for k, m in pooled.items()},
           "n_test": sum(f["n_test"] for f in folds), "rises": sum(f["rises"] for f in folds)}
    ev, weeks, now = evidence(rows, y, rule, idx, lab)
    w, g = ev["tiers"]["warning"], out["pooled"]["gradient_boosted"]
    assert (ev["weeks"], ev["rises"]) == (out["n_test"], out["rises"]) and all(w[k] == g[k] for k in ("tp", "fp", "tn", "fn")), "evidence does not match the folds"
    same_file = hashlib.sha256(c.RAW.read_bytes().replace(b"\r\n", b"\n")).hexdigest() == FROZEN_DATA
    assert not same_file or now == (LIVE_WATCH, CANDIDATE_WATCH), "the frozen Watch cut-offs are not what the rule picks on the file they were frozen on"
    out["evidence"] = ev
    c.dump(out, c.ROOT / "outputs" / "walkforward.json")
    (c.ROOT / "site" / "data" / "evidence.json").write_text(json.dumps({"weeks": weeks, "note": (
        "One row per test week, 2019 and 2022 to 2026. score is the classifier's score (not a calibrated probability) from a model trained only on earlier years. "
        "band uses the cut-offs picked for that year. rise_now: positives are already at least 1.5 times those of four weeks earlier. "
        "rise_follows: that happens in at least one of the next four weeks.")}), encoding="utf-8")
    for f in folds:
        g, s = f["models"]["gradient_boosted"], f["models"]["already_in_outbreak_now"]
        print(f["year"], "train", f["n_train"], "test", f["n_test"], "rises", f["rises"], "| boosted", g["tp"], g["fp"], g["tn"], g["fn"], "| simple", s["tp"], s["fp"], s["tn"], s["fn"])
    print("pooled", json.dumps(out["pooled"]))
    print("evidence", json.dumps({k: v for k, v in ev.items() if k != "protocol"}))
    print(f"Watch cut-offs in use, frozen on {FROZEN}: live {LIVE_WATCH}, candidate {CANDIDATE_WATCH} | the rule on {c.RAW.name} picks {now[0]} and {now[1]}"
          + ("" if same_file else " (not the file they were frozen on; the frozen cut-offs stay)"))


if __name__ == "__main__":
    main()
