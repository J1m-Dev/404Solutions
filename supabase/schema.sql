-- FluSentinel on Supabase: the same upload history, roles and undo that server.js provides locally.
-- NOT YET RUN against a real Supabase project. Read supabase/README.md before using it.
--
-- Model: every upload is one row in upload_events and is never deleted. The site reads the rows in
-- order and rebuilds the current data in the browser (reduceLog in site/assets/model.js). Undo marks a
-- row as undone. Roles live in profiles and are enforced here, in the database, not in the browser.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role         text not null default 'viewer' check (role in ('viewer', 'uploader', 'admin'))
);

create table if not exists public.upload_events (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null default 'live' check (mode in ('live', 'replay')),
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users (id),
  by_label    text check (char_length(by_label) <= 60),
  type        text not null check (type in ('lab', 'ili', 'clusters', 'clusterlist', 'beds')),
  own         boolean not null default false,
  rows        jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 500),
  undone      boolean not null default false,
  changed_at  timestamptz,
  changed_by  uuid references auth.users (id)
);
create index if not exists upload_events_mode_time on public.upload_events (mode, created_at);

alter table public.profiles enable row level security;
alter table public.upload_events enable row level security;

-- The caller's role; people without a profile row are viewers.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where user_id = auth.uid()), 'viewer')
$$;

-- Anyone, signed in or not, can read the history (it holds aggregate weekly figures, no personal data).
create policy "read history" on public.upload_events for select to anon, authenticated using (true);

-- Uploaders and admins can add an upload, only as themselves, and never pre-marked as undone.
create policy "add upload" on public.upload_events for insert to authenticated
  with check (public.my_role() in ('uploader', 'admin') and created_by = auth.uid() and undone = false);

-- No update or delete policy exists, so rows cannot be edited or removed directly.
-- Undo, restore and reset go through the functions below, which check the role.

create or replace function public.undo_upload(event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('uploader', 'admin') then raise exception 'not allowed'; end if;
  update public.upload_events set undone = true, changed_at = now(), changed_by = auth.uid() where id = event_id;
end $$;

create or replace function public.restore_upload(event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'not allowed'; end if;
  update public.upload_events set undone = false, changed_at = now(), changed_by = auth.uid() where id = event_id;
end $$;

-- Reset: marks every upload in a mode as undone. Nothing is erased.
create or replace function public.reset_uploads(which_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() <> 'admin' then raise exception 'not allowed'; end if;
  update public.upload_events set undone = true, changed_at = now(), changed_by = auth.uid()
    where mode = which_mode and undone = false;
end $$;

revoke all on function public.undo_upload(uuid), public.restore_upload(uuid), public.reset_uploads(text) from public;
grant execute on function public.undo_upload(uuid), public.restore_upload(uuid), public.reset_uploads(text) to authenticated;

-- People can see their own profile. Roles are assigned by a project owner in the SQL editor, for example:
--   insert into public.profiles (user_id, display_name, role) values ('<user uuid>', 'District officer, Klang', 'uploader');
create policy "read own profile" on public.profiles for select to authenticated using (user_id = auth.uid());
