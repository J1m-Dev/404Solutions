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
