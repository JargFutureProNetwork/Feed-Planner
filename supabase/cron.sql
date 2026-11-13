-- Feed Preview Studio: publish scheduled posts every minute (free).
--
-- Vercel's free plan only runs cron jobs once a day, which is too slow for
-- "post at 9:00". This asks your Supabase database to call the app every
-- minute instead.
--
-- BEFORE RUNNING: replace the two placeholders below
--   https://YOUR-APP.vercel.app   -> your real app address
--   YOUR_CRON_SECRET              -> the CRON_SECRET you set in Vercel
-- Then run it in Supabase > SQL Editor.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove an older copy of the job, if there is one.
select cron.unschedule(jobid) from cron.job where jobname = 'publish-due-instagram-posts';

select cron.schedule(
  'publish-due-instagram-posts',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR-APP.vercel.app/api/cron/publish',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    timeout_milliseconds := 55000
  );
  $$
);

-- To check it is running:   select * from cron.job_run_details order by start_time desc limit 5;
-- To stop it:               select cron.unschedule('publish-due-instagram-posts');
