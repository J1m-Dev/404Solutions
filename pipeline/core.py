"""FluSentinel core: data loading, model, baselines, alert rule. numpy only.

The same arithmetic is mirrored in site/assets/model.js; pipeline/parity.py checks they agree.
"""
import csv
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "flunet_mys_2026-10-10.csv"
SOURCES = ("SENTINEL", "NOTDEFINED")
START_YEAR = 2022
HORIZONS = range(1, 9)
TRAIN_SHARE = 0.70
N_LAGS = 3
N_HARM = 2
RIDGE = 10.0
PUB_LAG = 4  # weeks FluNet runs behind (observed once, 10 Oct 2026)


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def load_series(path=RAW):
    rows = [r for r in csv.DictReader(open(path, encoding="utf-8-sig"))
            if int(r["ISO_YEAR"]) >= START_YEAR and r["ORIGIN_SOURCE"] in SOURCES]
    rows.sort(key=lambda r: r["ISO_WEEKSTARTDATE"])
    out = []
    for r in rows:
        out.append({
            "year": int(r["ISO_YEAR"]), "week": int(r["ISO_WEEK"]),
            "start": r["ISO_WEEKSTARTDATE"][:10], "source": r["ORIGIN_SOURCE"],
            "n": _num(r["SPEC_PROCESSED_NB"]), "pos": _num(r["INF_ALL"]),
            "h3": _num(r["AH3"]), "h1": _num(r["AH1N12009"]), "b": _num(r["INF_B"]),
        })
    return out


def elogit(pos, n):
    eps = 0.5
    return math.log((pos + eps) / (n - pos + eps))


def inv(y):
    return 100.0 / (1.0 + math.exp(-y))


def arrays(series):
    y = np.array([elogit(s["pos"], s["n"]) for s in series])
    p = np.array([100.0 * s["pos"] / s["n"] for s in series])
    n = np.array([s["n"] for s in series])
    wk = np.array([s["week"] for s in series])
    yr = np.array([s["year"] for s in series])
    return y, p, n, wk, yr


def week_after(week, h):
    return (week - 1 + h) % 52 + 1


def feat(y, s, target_week, n_lags=N_LAGS, n_harm=N_HARM):
    f = [1.0] + [y[s - k] for k in range(n_lags)]
    for k in range(1, n_harm + 1):
        a = 2 * math.pi * k * target_week / 52.0
        f += [math.sin(a), math.cos(a)]
    return f


def fit(y, n, wk, t, h, n_lags=N_LAGS, n_harm=N_HARM, ridge=RIDGE):
    """Fit horizon-h model on pairs whose target week index is <= t."""
    X, Y, W = [], [], []
    for s in range(n_lags - 1, t - h + 1):
        X.append(feat(y, s, week_after(wk[s], h), n_lags, n_harm))
        Y.append(y[s + h])
        W.append(n[s + h])
    X, Y, W = np.array(X), np.array(Y), np.array(W)
    W = W / W.mean()
    P = np.eye(X.shape[1]) * ridge
    P[0, 0] = 0.0
    A = X.T @ (X * W[:, None]) + P
    beta = np.linalg.solve(A, X.T @ (W * Y))
    res = Y - X @ beta
    q = np.quantile(res, [0.10, 0.25, 0.75, 0.90])
    pers = np.array([y[s + h] - y[s] for s in range(n_lags - 1, t - h + 1)])
    qp = np.quantile(pers, [0.10, 0.90])
    return beta, q, qp


def predict(beta, y, t, wk_t, h, n_lags=N_LAGS, n_harm=N_HARM):
    return float(np.dot(beta, feat(y, t, week_after(wk_t, h), n_lags, n_harm)))


def epiweek_mean(p, wk, yr, t, target_week, target_year):
    m = [p[i] for i in range(t + 1) if wk[i] == target_week and yr[i] < target_year]
    return float(np.mean(m)) if m else float(np.mean(p[: t + 1]))


def thresholds(p_train):
    med = float(np.median(p_train))
    sd = float(1.4826 * np.median(np.abs(p_train - med)))
    return {"median": med, "robust_sd": sd, "yellow": med + sd, "orange": med + 2 * sd}


def alert_level(p_last, ahead, th):
    """p_last: newest published positivity. ahead: forecasts for today and the next 4 weeks."""
    peak = max(ahead)
    if p_last > th["orange"] and ahead[-1] >= 0.8 * p_last:
        return "red"
    if peak > th["orange"] or p_last > th["orange"]:
        return "orange"
    if peak > th["yellow"] or p_last > th["yellow"]:
        return "yellow"
    return "green"


def ahead_horizons(lag):
    """Horizons counted from the newest published week: today, then 4 weeks beyond."""
    return [h for h in range(max(lag, 1), lag + 5) if h <= 8]


def dump(obj, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=1), encoding="utf-8")
