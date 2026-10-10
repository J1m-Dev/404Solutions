# FluSentinel: rules frozen before the test weeks are scored

Written 10 Oct 2026, before any forecast origin in the last 30% of weeks was scored.

## Data
WHO FluNet, Malaysia, weekly, 2022 week 1 to 2026 week 37 (245 weeks). Rows with source NOTDEFINED (2022-23) and SENTINEL (2024 on). Target: sentinel influenza positivity = INF_ALL / SPEC_PROCESSED_NB.

## Split
By date. Train: first 70% (171 weeks, to the week of 7 Apr 2025). Test: last 30% (74 weeks). No shuffling.

## Model (frozen)
One ridge regression per horizon (1 to 8 weeks from the newest published week) on the empirical logit of positivity: 3 lags, 2 yearly harmonics, ridge 10, weighted by specimens. Chosen from five settings using forecast origins inside the training weeks only (see `evaluate.py train`). Coefficients are re-estimated at each origin from earlier weeks only.

## Baselines
Last published value; mean of the same ISO week in earlier years.

## Pass rule, per horizon
MAE lower than both baselines, AND 80% interval covers 70 to 90% of test weeks, AND interval score relative to the last-value baseline below 1. Primary endpoint: horizon 6 (two weeks beyond today at a 4-week publication lag).

## Alert thresholds (project thresholds, not MOH's)
From training weeks: median 14.27%, robust SD 6.72. Yellow above 20.99%, Orange above 27.71%. Red: published value above Orange and not forecast to fall by a fifth.

## Alert backtest
A surge is the first week above the Orange line after four weeks at or below it. Reported as counts: surges caught, lead in weeks, false-alarm episodes. Run twice: data 4 weeks old (public) and data current (uploaded).

## Disclosures
- Summary figures of the whole series, including test weeks, were seen during scoping.
- School-term and search-interest features were not built (time).
- The 2023-to-2024 source-label change was not formally tested; specimen volumes are similar across it.
- Few surges exist, so alert results are counts, not rates.

## Addendum, 10 Oct 2026: gradient-boosted model (frozen at tag `freeze-v2`)
Added after the ridge model failed. Gradient-boosted trees predict the change in logit positivity from the newest week; features are recent level and changes, an 8-week deviation, A(H3) and B shares, and yearly harmonics. Setting chosen from five on training-week origins only: 150 trees, depth 1, learning rate 0.03. Interval width comes from past last-value errors. Same per-horizon pass rule. **This is a second scoring of the same test weeks**, so a pass here is weaker evidence than a first-time pass.

## Addendum: dengue models (frozen at tag `freeze-dengue-v1`)
Data: OpenDengue V1.3 national weekly counts for Malaysia, all weekly years (2011-2013, 2015, 2018-2022), with gaps; lags never cross a gap. Split by date, 70/30, models fitted once on training weeks. All settings are fixed in `pipeline/dengue.py` and none were tuned; no test result was seen before this tag. Forecast 1 to 4 weeks ahead: last value, same-week average, ridge, gradient boosting, compared on mean absolute error. Outbreak within 4 weeks under two definitions (above the same-week average of training years + 2 SD; at least 50% higher than 4 weeks earlier), reported as TP, FP, TN, FN, recall and precision against "already in outbreak now".

## Addendum: influenza positives per week (frozen at tag `freeze-flucases-v1`)
Target changed from positivity to the weekly count of influenza-positive lab samples (FluNet). Method and every setting are the dengue ones in `pipeline/dengue.py`, unchanged. Three runs defined in `pipeline/flu_cases.py` before any was scored: 2022 onward only; 2017-2019 added (the only earlier years with a count for every week; testing volume then was about a seventh of today's); and the larger training set tested on the 2022-onward test weeks. The 2025-2026 test weeks have now been scored three times across models, so results on them are weaker evidence. Replace rule: the site switches to a count model only if it beats "same as last week" at all four horizons on those weeks.

## Addendum: walk-forward check and advance record (10 Oct 2026)
- `pipeline/walkforward.py` tests the rapid-rise classifier one calendar year at a time, training only on earlier years. It was written and run AFTER the single-split result was known, with no setting changed. It is extra evidence, not a pre-registered result. Outcome: recall 76%, precision 68% over 282 weeks, against 38% and 78% for the simple rule.
- `pipeline/archive.py record` saves what the system says today about weeks that are not yet published. Each record is committed on the day it is made and never edited except by `archive.py score`, which adds the outcome. The first record is `outputs/prospective/2026-10-10.json`.
