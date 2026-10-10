# Moving the upload history to Supabase

Status: **designed, not tested.** `schema.sql` has not been run against a real project. The local server (`server.js`) is the tested implementation of the same behaviour; `tests/role_test.js` checks it.

## What stays the same
- Uploads are a history that is never erased; the site rebuilds current data from it with `reduceLog` in `site/assets/model.js`.
- Three roles: viewer (read), uploader (upload, undo one upload), admin (also restore and reset).
- Roles are enforced on the server side. Here that means row-level security and three database functions.

## Steps
1. Create a Supabase project. Run `schema.sql` in the SQL editor.
2. Turn on email sign-in. Create your own user, then give it a role:
   `insert into public.profiles (user_id, display_name, role) values ('<your user id>', 'Admin', 'admin');`
3. In `site/assets/app.js`, replace the four functions that talk to the local server:
   - `loadState`: `select * from upload_events where mode = <mode> order by created_at`, then `M.reduceLog(rows)`.
   - `saveUpload`: `insert into upload_events (mode, type, own, rows, by_label)`.
   - `setUndone`: `rpc('undo_upload', { event_id })` or `rpc('restore_upload', { event_id })`.
   - `resetState`: `rpc('reset_uploads', { which_mode })`.
   The passcode box becomes an email sign-in. The project address and the public (anon) key go in the page; they are meant to be public, because the rules above are what protect the data.
4. Move the AI wording call into an Edge Function that holds `GEMINI_API_KEY` as a secret. Never put that key in the page.

## Check before trusting it
- Signed out: can read, cannot insert.
- Signed in with no profile row: can read, cannot insert.
- Uploader: can insert and undo, cannot restore or reset.
- Admin: can do all four.
- Nobody can update or delete a row directly.

## What this still does not give you
- Review of whether uploaded figures are correct. They remain "uploaded, not verified".
- Personal data protection beyond aggregates. Do not upload anything that identifies a person.
