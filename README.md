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
GEMINI_MODEL=gemini-2.5-flash
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
- **Facilities map**: `pipeline/facilities.py` looks up the team's hospital and clinic list in OpenStreetMap.
- Rebuild order: `evaluate.py test`, `gbm.py test`, `dengue.py`, `flu_cases.py`, `export.py`, `parity.py`.
- Not in the repo (too large): the 500 MB OpenDengue temporal extract. The Malaysia rows used are in `data/raw/opendengue/mys_weekly_national.csv`.

## Added on the simulation-spread-feature branch
- **What-if simulator, cluster hotspots, map layer switches** (see the commit before this one).
- **Own lab network series**: in the upload window, tick "my own lab network". The series replaces the national one on screen; alert lines are fitted to it once it has 52 weeks, and are marked uncalibrated before that.
- **Upload sanity checks**: an implausible jump or sample count asks for a second confirmation.
- **AI wording** is a switch, off by default; without a key the template is shown.
- **Proof**: year-by-year test of the classifier (`pipeline/walkforward.py`) and a record made in advance (`pipeline/archive.py`).
- Each week, after downloading a newer FluNet file: `py archive.py score <new csv>`, then `py archive.py record`, then commit.
