"""Rolling-origin evaluation. Usage: evaluate.py train|test

train: forecast origins inside the first 70% of weeks only (for tuning).
test:  forecast origins in the last 30%. Run once, after the freeze tag.
"""
import sys

import numpy as np

import core as c


def run(series, first, last, cfg=None, th=None):
    cfg = cfg or {}
    y, p, n, wk, yr = c.arrays(series)
    rows = []
    for t in range(first, last + 1):
        for h in c.HORIZONS:
            if t + h >= len(y):
                continue
            beta, q, qp = c.fit(y, n, wk, t, h, **cfg)
            yh = c.predict(beta, y, t, wk[t], h, cfg.get("n_lags", c.N_LAGS), cfg.get("n_harm", c.N_HARM))
            tw = c.week_after(wk[t], h)
            rows.append({
                "t": t, "h": h, "actual": p[t + h], "model": c.inv(yh), "persist": p[t],
                "seasonal": c.epiweek_mean(p, wk, yr, t, tw, yr[t] + (1 if tw < wk[t] else 0)),
                "lo": c.inv(yh + q[0]), "hi": c.inv(yh + q[3]),
                "plo": c.inv(y[t] + qp[0]), "phi": c.inv(y[t] + qp[1]),
            })
    return rows


def iscore(lo, hi, a, alpha=0.2):
    return (hi - lo) + (2 / alpha) * max(lo - a, 0) + (2 / alpha) * max(a - hi, 0)


def summarise(rows):
    out = []
    for h in c.HORIZONS:
        r = [x for x in rows if x["h"] == h]
        mae = lambda k: float(np.mean([abs(x[k] - x["actual"]) for x in r]))
        m, pe, se = mae("model"), mae("persist"), mae("seasonal")
        cov = float(np.mean([x["lo"] <= x["actual"] <= x["hi"] for x in r]))
        ris = float(np.mean([iscore(x["lo"], x["hi"], x["actual"]) for x in r])
                    / np.mean([iscore(x["plo"], x["phi"], x["actual"]) for x in r]))
        ok = m < pe and m < se and 0.70 <= cov <= 0.90 and ris < 1
        out.append({"h": h, "n": len(r), "mae_model": m, "mae_persist": pe, "mae_seasonal": se,
                    "skill_persist": 1 - m / pe, "skill_seasonal": 1 - m / se,
                    "coverage80": cov, "rel_interval_score": ris, "passed": bool(ok)})
    return out


def alert_backtest(series, first, last, th, lag):
    """Alert issued at 'today' = origin + lag, using data published through the origin."""
    y, p, n, wk, yr = c.arrays(series)
    hs = c.ahead_horizons(lag)
    levels = {}
    for t in range(first - lag, last - lag + 1):
        if t < 110:
            continue
        ahead = []
        for h in hs:
            beta, _, _ = c.fit(y, n, wk, t, h)
            ahead.append(c.inv(c.predict(beta, y, t, wk[t], h)))
        if lag == 0:
            ahead = [p[t]] + ahead
        levels[t + lag] = c.alert_level(p[t], ahead, th)
    # surge = first week above the orange line after 4 weeks at or below it
    cross = [i for i in range(first, last + 1)
             if p[i] > th["orange"] and all(p[j] <= th["orange"] for j in range(i - 4, i))]
    high = lambda d: levels.get(d) in ("orange", "red")
    events = []
    for x in cross:
        issued = [d for d in range(x - 8, x + 9) if high(d)]
        events.append({"cross_week": f"{series[x]['year']}-W{series[x]['week']:02d}",
                       "caught": bool(issued), "lead_weeks": (x - issued[0]) if issued else None})
    false = 0
    for d in sorted(levels):
        if high(d) and not high(d - 1):
            if not any(d - 8 <= x <= d + 8 for x in cross) and not any(p[j] > th["orange"] for j in range(max(d - 8, 0), min(d + 9, len(p)))):
                false += 1
    return {"lag": lag, "weeks_scored": len(levels), "surges": events, "false_alarm_episodes": false,
            "high_alert_weeks": sum(high(d) for d in levels)}


def main(stage):
    series = c.load_series()
    N = len(series)
    split = int(N * c.TRAIN_SHARE)
    y, p, n, wk, yr = c.arrays(series)
    th = c.thresholds(p[:split])
    print(f"weeks={N} train=0..{split-1} ({series[split-1]['start']}) test={split}..{N-1}")
    print("thresholds", {k: round(v, 2) for k, v in th.items()})
    if stage == "train":
        for cfg in [dict(n_lags=1, n_harm=1, ridge=1.0), dict(n_lags=3, n_harm=2, ridge=1.0),
                    dict(n_lags=3, n_harm=2, ridge=10.0), dict(n_lags=2, n_harm=1, ridge=1.0),
                    dict(n_lags=3, n_harm=1, ridge=0.1)]:
            s = summarise(run(series[:split], 104, split - 2, cfg))
            print(cfg, "| h:skill_persist ", " ".join(f"{x['h']}:{x['skill_persist']:+.2f}" for x in s),
                  "| cov", " ".join(f"{x['coverage80']:.2f}" for x in s))
        return
    rows = run(series, split - 1, N - 2)
    rows = [x for x in rows if x["t"] + x["h"] >= split]
    res = {"stage": "test", "split_index": split, "train_end": series[split - 1]["start"],
           "test_start": series[split]["start"], "test_end": series[-1]["start"], "thresholds": th,
           "per_horizon": summarise(rows),
           "alerts": [alert_backtest(series, split, N - 1, th, lag) for lag in (4, 0)]}
    c.dump(res, c.ROOT / "outputs" / "validation.json")
    for x in res["per_horizon"]:
        print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in x.items()})
    for a in res["alerts"]:
        print(a)


if __name__ == "__main__":
    main(sys.argv[1])
