-- Feed Preview Studio: database schema
-- Run this once in Supabase > SQL Editor > New query > Run.
-- It is safe to run again: nothing is dropped.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. instagram_accounts: one row per student, created when they connect.
--    user_id is the student's identity inside this app.
-- ---------------------------------------------------------------------------
create table if not exists public.instagram_accounts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique default gen_random_uuid(),
  fb_user_id              text not null unique,          -- who logged in with Meta
  ig_user_id              text not null,                 -- Instagram professional account id
  ig_username             text not null,
  ig_profile_picture_url  text,
  access_token            text not null,                 -- 60-day long-lived token
  token_expires_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. scheduled_posts: every planned, published or failed post.
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.instagram_accounts (user_id) on delete cascade,
  image_url        text not null,                        -- public JPEG in Supabase Storage
  caption          text not null default '',
  scheduled_at     timestamptz not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'publishing', 'published', 'failed')),
  error_message    text,                                 -- raw Meta error, for the admin only
  student_message  text,                                 -- the friendly sentence the student sees
  ig_media_id      text,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists scheduled_posts_due_idx  on public.scheduled_posts (status, scheduled_at);
create index if not exists scheduled_posts_user_idx on public.scheduled_posts (user_id, scheduled_at);

-- Keep updated_at current.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists instagram_accounts_touch on public.instagram_accounts;
create trigger instagram_accounts_touch before update on public.instagram_accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists scheduled_posts_touch on public.scheduled_posts;
create trigger scheduled_posts_touch before update on public.scheduled_posts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--    The web app talks to the database only from its server, with the
--    service_role key, which bypasses RLS. With RLS switched on, the public
--    (anon) key can read nothing at all, so tokens can never leak to a browser.
-- ---------------------------------------------------------------------------
alter table public.instagram_accounts enable row level security;
alter table public.scheduled_posts    enable row level security;

-- instagram_accounts holds access tokens: deliberately NO policies.
-- Only the server (service_role) can read or write it.

-- scheduled_posts: a signed-in user may only ever touch their own rows.
-- (Used only if you later add Supabase Auth; harmless otherwise.)
drop policy if exists "Owners read their posts"   on public.scheduled_posts;
drop policy if exists "Owners add their posts"    on public.scheduled_posts;
drop policy if exists "Owners change their posts" on public.scheduled_posts;
drop policy if exists "Owners delete their posts" on public.scheduled_posts;

create policy "Owners read their posts" on public.scheduled_posts
  for select to authenticated using (auth.uid() = user_id);
create policy "Owners add their posts" on public.scheduled_posts
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Owners change their posts" on public.scheduled_posts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners delete their posts" on public.scheduled_posts
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Storage: a public bucket for the JPEGs Instagram downloads.
--    Public = anyone with the link can view a file (Instagram needs that).
--    Uploading is only possible through the app's server.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 8388608, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ===========================================================================
-- Everything below is the same as supabase/migration-002.sql (included here so a
-- brand-new project only needs this one file).
-- ===========================================================================

-- 1. Each student's planner projects (brand, month, posts, captions) are saved here.
create table if not exists public.projects (
  user_id     uuid not null references public.instagram_accounts (user_id) on delete cascade,
  id          text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.projects enable row level security;

drop policy if exists "Owners read their projects"   on public.projects;
drop policy if exists "Owners write their projects"  on public.projects;
create policy "Owners read their projects" on public.projects
  for select to authenticated using (auth.uid() = user_id);
create policy "Owners write their projects" on public.projects
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Posts can now be a single image, a carousel or a reel.
alter table public.scheduled_posts
  add column if not exists post_type           text not null default 'image',
  add column if not exists media               jsonb,          -- [{ "kind": "image" | "video", "url": "..." }]
  add column if not exists cover_url           text,           -- reel cover
  add column if not exists container_id        text,           -- where Instagram's processing has got to
  add column if not exists publish_started_at  timestamptz,
  add column if not exists lease_until         timestamptz;

do $$ begin
  alter table public.scheduled_posts
    add constraint scheduled_posts_post_type_check check (post_type in ('image', 'carousel', 'reel'));
exception when duplicate_object then null; end $$;

-- 3. The storage bucket now also accepts videos and PNG logos, up to 50 MB per file.
update storage.buckets
   set public = true,
       file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']
 where id = 'post-images';
