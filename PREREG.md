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

## Addendum: dengue extended to August 2026 (10 Oct 2026)
The 2023 to 2026 weeks were rebuilt from WHO reports (`pipeline/who_dengue.py`) and the dengue comparison was rerun on 2011 to 2026 with the frozen settings. This was done after the 2011 to 2022 result was known, so it is extra evidence, not a pre-registered result. Estimated weeks are excluded from scoring. Outcome on 177 measured test weeks: the best model cut the error of "same as last week" by 7%, 9%, 12% and 16% at one to four weeks ahead.

## Addendum, 11 Oct 2026: event v1, Watch and Warning cut-offs, candidate in shadow (frozen at tag `freeze-tiers-v1`)
- **Event v1.** A rapid rise means weekly influenza positives reach at least 1.5 times their level four weeks earlier in any of the next four weeks. The rapid-rise classifier has used this event from the start; it now carries a version number so that any later change shows. Every advance record names the event version it speaks about.
- **Two tiers.** Warning is a classifier score of 0.50 or more, as before (the score is not a calibrated probability). Watch is a lower cut-off meant to catch at least 90% of rises. Below Watch is Clear.
- **How the cut-offs were chosen: development-set evidence, not pre-registered.** `pipeline/walkforward.py` scores each of six years (2019, 2022 to 2026) with a model trained only on earlier years. The Watch cut-off for a test year was picked without that year: the model was fitted on the first 70% of the training weeks, and the highest cut-off from 0.50 down to 0.10 in steps of 0.05 that caught at least 90% of the rises in the last 30% was used (0.40, 0.40, 0.45, 0.40, 0.30, 0.30). Outcome over 282 test weeks, 120 of them followed by a rise: Warning caught 91 and missed 29, and flagged 42 weeks that no rise followed; Watch caught 113 and missed 7, and flagged 85 weeks that no rise followed. Of the 165 weeks with no rise under way yet, 44 were followed by one: Watch caught 43 of them, Warning 31. These six-year figures were worked out on 11 Oct 2026, on weeks that earlier runs had already scored and after those results were known. They are development-set evidence. None of them is a pre-registered result.
- **Live cut-offs, frozen from 11 Oct 2026.** Warning 0.50. Watch 0.40, the highest cut-off on the same grid that catches at least 90% of the rises across all six years of those year-by-year predictions. The replay demo, whose classifier sees data only up to week 37 of 2025, uses these same two cut-offs. The model itself is unchanged: same training code, same settings, same exported stumps. The cut-offs will not be moved after seeing how advance records score.
- **Candidate model, scored in shadow.** The same model without its four seasonal inputs ranked weeks better on the same six years (ranking score 0.867 against 0.816) and gave fewer false Warning weeks (30 against 42) while catching 90 rise weeks against 91. Its Watch tier was slightly worse: 111 caught against 113, with 94 false weeks against 85, and of the 44 quiet weeks followed by a rise it caught 39 against 43. That comparison was made on weeks already seen, so the candidate is not swapped in. It is trained in Python only and never exported to the site. Every advance record stores its score and band next to the live model's, with cut-offs fixed by the same rule (Warning 0.50, Watch 0.35), and `archive.py score` scores both. A swap would need its own addendum, written before the records that argue for it are scored.
- **What each record pins.** The event version, the cut-offs used, the band and its claim (Clear: no rapid rise in the next four weeks; Watch or Warning: a rapid rise in the next four weeks), a sha256 of the FluNet file (line endings as git stores them) and of the exported classifier, and the git commit. The first record (10 Oct 2026) was made before the bands existed and is scored on its yes or no call only.
- **Reporting policy.** No claim is made from a single scored record. Results are reported once at least eight records have been scored. Records made from the same FluNet file speak about the same weeks and count once.
- **Cut-offs written into the code (added later on 11 Oct 2026, before any record was scored).** As first written, `walkforward.py` worked the two frozen Watch cut-offs out again on every run, so a newer FluNet file with a missed rise could have lowered them. They are now fixed numbers in that file: 0.40 for the live model and 0.35 for the candidate. Run on a newer file, the script prints what the rule would pick there, for information only, and `archive.py record` refuses to write a record with any other cut-off. The record of 11 Oct 2026 was made with 0.40 and 0.35, so nothing already recorded changes.
- **What the page reports (added later on 11 Oct 2026, before any record was scored).** The "Why trust it" section does not quote the year-by-year picks above. It applies the frozen cut-offs to the same weekly scores (`site/data/evidence.json`): Watch or higher flagged 109 of the 120 weeks followed by a rise and 78 of the 162 that were not; Clear was followed by a rise in 11 of 95 weeks. The Watch cut-off was chosen on these same years, so this is a description of the past, labelled as such on the page. Picking the cut-off from earlier years only gave 113 of 120, and that figure moves by several points with how the pick is made.
