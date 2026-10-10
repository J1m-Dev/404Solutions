# FluSentinel

Influenza early warning for Selangor planners: alert level, category, proposed action, plain-language summary, an upload for newer data, and a capacity planner.

## Run locally
```
node server.js
```
Open http://localhost:5173 (live data) or http://localhost:5173/?replay=1 (replay of the October 2025 surge).

Replay demo: click **Upload newest data**, choose *Weekly lab counts*, pick `site/templates/demo_real_replay_2025_W38_W41.csv`, confirm. The alert moves from Green to "Outbreak trend detected". `demo_SIMULATED_bad_file.csv` shows the data warning.

## AI summary (Gemini)
Create `.env.local` next to `server.js` (it is git-ignored):
```
GEMINI_API_KEY=your-key
GEMINI_MODEL=                # leave empty for gemini-3.5-flash-lite, with built-in fallbacks
```
Check the model name against Google's current list. Without a key the template summary is shown. The AI text is used only if every number in it appears in the figures it was sent.

## Rebuild the numbers
```
cd pipeline
py -3.13 evaluate.py test   # scores the unseen weeks -> outputs/validation.json
py -3.13 export.py          # writes site/data/* and site/templates/*
py -3.13 parity.py          # checks the site's JavaScript matches Python
```
Needs only numpy. Rules are in `PREREG.md`, frozen at git tag `freeze-v1`.

## Storage
Uploads are kept in `data/store.json` by `server.js`. This stands in for the database. To move to Supabase: create tables `uploads(mode, type, rows jsonb, created_at)`, replace the three `/api/state` handlers with Supabase client calls in `site/assets/app.js` (`loadState`, `saveUpload`, `resetState`), and move `/api/summary` into a Supabase Edge Function that holds `GEMINI_API_KEY`. If the API is unreachable the site falls back to browser storage, so it also works as a plain static site.

## Labels
Real data / Estimated / Exploratory / Simulated / Uploaded, not verified. Bed numbers in `pipeline/export.py` are simulated placeholders.

## Added since the first version
- **Drag and drop upload**: drop files or a folder anywhere on the page; the data type is recognised from the columns. `site/templates/sample_SIMULATED_500_weeks_*.csv` are invented test files (`pipeline/make_sample.py`).
- **Dengue (second disease)**: `pipeline/dengue.py`, on OpenDengue national weekly counts 2011-2022. Needs scikit-learn.
- **Influenza case counts and rapid-rise classifier**: `pipeline/flu_cases.py`; the classifier is exported by `pipeline/export.py` and run in the browser.
- **Facilities map**: `pipeline/facilities.py` looked up the team's hospital and clinic list in OpenStreetMap. Replaced by the Ministry registry; see the last section.
- Rebuild order: `evaluate.py test`, `gbm.py test`, `dengue.py`, `flu_cases.py`, `export.py`, `parity.py`.
- Not in the repo (too large): the 500 MB OpenDengue temporal extract. The Malaysia rows used are in `data/raw/opendengue/mys_weekly_national.csv`.

## Added on the simulation-spread-feature branch
- **What-if simulator, cluster hotspots, map layer switches** (see the commit before this one).
- **Own lab network series**: in the upload window, tick "my own lab network". The series replaces the national one on screen; alert lines are fitted to it once it has 52 weeks, and are marked uncalibrated before that.
- **Upload sanity checks**: an implausible jump or sample count asks for a second confirmation.
- **AI wording** is a switch, off by default; without a key the template is shown.
- **Proof**: year-by-year test of the classifier (`pipeline/walkforward.py`) and a record made in advance (`pipeline/archive.py`).
- Each week, after downloading a newer FluNet file: `py archive.py score <new csv>`, then `py archive.py record`, then commit.

## Priority 2 additions
- **Upload history, roles and undo** (`server.js`): every upload is kept, with who and when; any upload can be undone, and nothing is erased. Set `UPLOAD_PASSCODE` and `ADMIN_PASSCODE` in `.env.local` (see `.env.example`) to require a passcode: viewers read, uploaders upload and undo, the admin also restores and resets. With no passcode set the server is in open mode. `node tests/role_test.js "<project folder>"` checks all of this on a throwaway port.
- **Supabase**: `supabase/schema.sql` and `supabase/README.md` describe the same model for Supabase. Designed, not yet run against a real project.
- **Schools layer**: government schools and pupils per district (Ministry of Education records via OpenDOSM, 30 June 2025) as a second map view.
- **All states chart** (`pipeline/states.py`): dengue by state, monthly 1993-2010 and yearly 2009-2023, with a switch per state and a national layer, plus the model comparison per state. Influenza has no state series; the chart shows the national line and the published state snapshots.
- **Data request draft**: `docs/PILOT_REQUEST.md`, for the Selangor State Health Department. Not sent.
- **Heat maps**: the "All states" section has a map shading every state by dengue cases or cases per 100,000 people, with a year slider (2009-2018 and 2023) and a play button; for influenza it shows the week-40 2025 snapshot. On the Selangor map, an uploaded cluster list is drawn as a heat layer (`site/vendor/leaflet-heat.js`) with its own switch.

## Dengue rebuilt to 2026 from WHO reports
No weekly dataset exists for Malaysia after 2022. `pipeline/who_dengue.py` rebuilds one from WHO Western Pacific Dengue Situation Updates:
```
py who_dengue.py fetch   # downloads the 84 fortnightly PDFs (about 98 MB, not committed) from WHO's library
py who_dengue.py parse   # reads the Malaysia sentence in each (80 have one) -> data/raw/who_dengue/parsed.json
py who_dengue.py build   # weekly series with a status per week -> data/raw/who_dengue/mys_weekly_2023_2026.csv
py who_dengue.py model   # joins it to 2011-2022 and reruns the model comparison -> site/data/dengue.json
```
Each week is **reported** (stated in a report), **derived** (exact from the running totals), **estimated** (several weeks share one published total, spread between neighbours) or missing. Of 187 rebuilt weeks: 108 reported, 14 derived, 65 estimated. Forecast accuracy is scored on reported and derived weeks only. Needs `pdftotext` on the path.

## One map, more state data, and the Ministry's facility registry
- **One map** (`#atlas`): the Selangor map and the all-states map are now a single map. It opens on the whole country with every state shaded. A Disease switch controls it: influenza shades states by Ministry of Health cluster counts from the 2025 surge; dengue shades them by year (1999 to 2023) with a slider and a play button. Zooming in (zoom 7 or more, or the "Zoom to Selangor" button, or a click on a state) adds hospitals and clinics for every state, and Selangor's district shading, cluster heat and hotspot circles. Every layer has its own switch. The capacity heuristic and the state trend chart sit under the map in the same section.
- **Facilities** (`pipeline/moh_facilities.py`): hospitals and walk-in health clinics come from the Ministry of Health's own registry (`facilities_master.csv`, github.com/MoH-Malaysia/data-resources-public, "as registered on 31 December 2025"), at the Ministry's coordinates. Rows whose coordinates fall more than 25 km outside their state are looked up by name on OpenStreetMap, or left off and listed on the site. Rural clinics, dental clinics and private GP clinics are not plotted. This replaces the team's hand-made Selangor list (`pipeline/facilities.py`, kept for reference).
- **Private hospitals** (`pipeline/private_hospitals.py`): 214 hospitals from the "Hospital Swasta" layer of MyGeoCKAPS, the Ministry's public map of facilities licensed under Act 586, at the Ministry's map points and cross-checked against OpenStreetMap. The layer states no as-at date.
- **State dengue data** (`pipeline/states.py`): yearly by state 1999 to 2023 (Mendeley Data, Ministry of Health open data, OpenDengue), weekly by state February 2010 to April 2015 and December 2019 to December 2024, and the same four-method comparison run per state on the weekly series. The weekly files were shared online with no stated source or licence, so they are not committed; `py -3.13 states.py fetch` downloads them again. They are used because their yearly sums agree with official totals, and the site says so.
- **Influenza by state**: only Ministry cluster counts exist (all states for weeks 43 to 45 of 2025, five states for week 40). They are shown on the map and in the trend chart; no state model is possible.
- **Real bed counts** (`pipeline/beds.py`): the Ministry's `bedutil_facility.csv` (same repository, last updated 3 September 2024) gives beds, ICU beds and ventilators for public hospitals. They are shown in the hospital pop-ups, and the Selangor capacity table now works from total beds x (1 - occupancy) x a share usable for flu. Occupancy in that file is patchy: a reported 0% or a negative figure is treated as not reported, and those hospitals use an assumed-occupancy slider. For the twelve Selangor hospitals in the capacity table the first choice is a Selangor State Assembly written answer (sitting of 18 February to 3 March 2025), which lists official beds, beds in operation and the 2024 occupancy rate for every Ministry hospital in the state (`data/raw/facilities/selangor_assembly_beds_2025.csv`); the table uses beds in operation and that occupancy. `selangor_beds_lookup.json` holds the same hospitals looked up one by one on their own pages as a cross-check. `tests/role_test.js` now runs on its own port and its own temporary store, so it no longer writes into the real upload history.
- Rebuild order for these: `states.py`, then `moh_facilities.py` (it reads the state outlines that `states.py` writes), then `beds.py`.

## Recall-first ladder, evidence on screen, track record (11 October 2026)
- **Ladder.** The alert card shows one of four steps. Clear, Watch and Warning are bands of the rapid-rise classifier (cut-offs 0.40 and 0.50, frozen on 11 October 2026, event "v1"); Outbreak is the alert rule on the data. The step shown is the higher of the two. Watch asks for free checks, Warning for preparation, and only Outbreak for the costly response. The classifier is unchanged: same training code, same exported stumps.
- **Why each band.** `riseSignal` in `site/assets/model.js` returns the band and the exact contribution of each input to the score (the model is a sum of one-input steps), and the card prints the three largest in plain words. `pipeline/parity.py` now also checks the browser classifier against scikit-learn; before this it checked only the forecast.
- **Evidence** (`pipeline/walkforward.py` writes `site/data/evidence.json`, one row per test week with its out-of-fold score). The "Why trust it" section works its counts out from those rows at the cut-offs in use: how often each band was followed by a rapid rise, the quiet-weeks table, simple alternatives, a year-by-year table, and how long the classifier had been at Warning before each alert-line crossing. These describe six past years; the Watch cut-off was chosen with them in view. Nothing there is a pre-registered result.
- **Not for an own series.** The classifier depends on the size of the lab network (with counts divided by ten, 41 of 85 calls changed), so it is switched off when a planner uploads their own series.
- **Track record** (`pipeline/archive.py`). Each record stores the band, the cut-offs, SHA-256 fingerprints of the data file and the exported classifier, the git commit, and the call of a candidate model (the same classifier without its time-of-year inputs) that is scored in shadow and never shown as the live answer. Weekly routine: `py archive.py score <new FluNet csv>`, `py archive.py record <new FluNet csv>`, `py export.py`, commit, push. The cut-offs and the alert lines are fixed numbers, so a newer file cannot move them. The replay uses the same cut-offs as the live page.
- **Action plan.** The page shows a fixed-template plan for the proposed actions. With `GEMINI_API_KEY` set in `.env.local`, "Draft with AI" asks Gemini for an ordered plan in English. The server checks every draft before returning it (numbers must be among the computed figures, roles and deadlines come from fixed lists, no level names, no treatment advice), caches good drafts in the store, and falls back to the template on any failure. A plan counts only after a named uploader or admin approves it; the approval is an entry in the same history as uploads and can be undone. `node tests/plan_test.js "<project folder>"` tests this against a local mock.
- **AI wording of the summary** is English only. Malay is always the fixed template.
- **Page layout.** Now, Signal, Why trust it, Where, Track record, Who it is for; then folded sections (full results, dengue, state trends, the what-if drill, uploads and roles, facility sources).
- **Capacity table.** A district first uses hospitals inside it, then the nearest within 40 km; the rest is shown as unplaced.
- **Classifier stress test** (`pipeline/stress_rise.py`): the year-by-year models are given damaged counts (half the samples, 20% noise, missing weeks, all three) and their bands compared with the bands on clean counts. Bands change in 5 to 23% of weeks; a Warning stays at Watch or higher in 95% or more.
- Rebuild order for this part: `walkforward.py`, `export.py`, `parity.py`, `stress_rise.py`.

## Known limits found by the code audit (11 October 2026), not fixed
- **Week 53.** The week arithmetic assumes 52 weeks a year; 2026 has an ISO week 53 (28 December 2026). Uploads and the classifier's time-of-year inputs will be one week out across that boundary.
- **The alert rule uses the level projection** for an early Yellow, an early Orange and for Red against Orange, although as a forecast that projection was no better than "same as last week". It is labelled on the page; the rule was not changed because its test results belong to it as it is.
- **The classifier's event is loose.** 72 of its 133 Warning weeks (54%) came with a rapid rise already under way or within the three weeks before, and at the low lab volumes of 2017 to 2019 a 1.5-times change is often noise. A stricter event (a floor on the count, or "crosses the watch line") is the next step, as a new event version scored in the Track record.
- **Undo and restore** do not re-check that the remaining lab weeks are consecutive.
- **The repository is private**, so the commit time of a Track record entry is not something an outsider can check today.
