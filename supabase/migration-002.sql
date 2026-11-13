-- Feed Preview Studio: update 2 (brand projects, carousels, reels)
-- Run this once in Supabase > SQL Editor BEFORE deploying the new version of the app.
-- It only adds things. Nothing existing is changed or removed, and it is safe to run again.

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
