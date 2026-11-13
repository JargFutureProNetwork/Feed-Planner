# Feed Preview Studio: admin setup guide

A content planner for you and your students. A student clicks **Continue with Meta**, approves the
permissions, and from then on adds a photo, writes a caption, and either schedules the post or
publishes it immediately. All keys live on the server; students never see one.

You do the setup below once. Allow about an hour. You need free accounts at
[supabase.com](https://supabase.com), [developers.facebook.com](https://developers.facebook.com),
[github.com](https://github.com) and [vercel.com](https://vercel.com).

Meta and Vercel rename their menus from time to time. If a label below is slightly different on
your screen, look for the closest match.

---

## Part 1: Supabase (database and photo storage)

1. Go to supabase.com, sign in, and click **New project**. Pick any name and region, set a database
   password (save it somewhere), and wait for the project to finish creating.
2. In the left menu open **SQL Editor**, click **New query**, paste the whole contents of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success".
   This creates both tables, switches on Row Level Security, and creates the public photo bucket.
3. Check the bucket: open **Storage** in the left menu. You should see a bucket called
   `post-images` marked **Public**. If it is missing, click **New bucket**, name it exactly
   `post-images`, and switch **Public bucket** on.
4. Open **Project Settings > API** (or **API Keys**) and copy two values for later:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - the **service_role** secret key → this is `SUPABASE_SERVICE_ROLE_KEY`. Treat it like a password.

## Part 2: Put the code on GitHub

1. Install [Git](https://git-scm.com) if you don't have it, and create a **private** repository on
   github.com (no README, no .gitignore).
2. Because this folder is inside OneDrive, first copy the `feed-preview-app` folder somewhere
   outside OneDrive (for example `C:\dev\feed-preview-app`). OneDrive and `node_modules` don't get
   along.
3. In a terminal inside that folder, run these one at a time, using your own repository address:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Feed Preview Studio"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
```

```bash
git push -u origin main
```

`.env.local` is listed in `.gitignore`, so your secrets are not uploaded. Never remove that line.

## Part 3: Deploy on Vercel (first pass)

1. On vercel.com choose **Add New > Project**, import the GitHub repository, and click **Deploy**.
   The first deploy works, but sign-in won't yet. That's expected.
2. Note the address Vercel gives you, for example `https://feed-preview-app.vercel.app`.
   This is your **app address**. Use the short, permanent one shown under **Domains**, not a long
   preview address.

## Part 4: Meta for Developers

1. Go to developers.facebook.com, click **My Apps > Create App**. Choose the use case for managing
   Instagram content / business (app type **Business**). Give it a name and your email.
2. **App settings > Basic**:
   - Copy the **App ID** → `META_APP_ID`
   - Click **Show** next to **App secret** and copy it → `META_APP_SECRET`
   - **App domains**: your Vercel domain without `https://`, for example `feed-preview-app.vercel.app`
   - Fill in **Privacy Policy URL** (any page you control is fine while in Development mode), then **Save changes**.
3. Add the product **Facebook Login for Business** (in **Add product** or **Use cases > Customize**).
   Open its **Settings** and set:
   - **Client OAuth login**: Yes
   - **Web OAuth login**: Yes
   - **Valid OAuth Redirect URIs**: add exactly these two lines (replace the first with your app address):
     - `https://feed-preview-app.vercel.app/api/auth/meta/callback`
     - `http://localhost:3000/api/auth/meta/callback` (only needed if you run it on your own computer)
   - Save. The address must match character for character: `https`, no trailing slash.
4. Add the product **Instagram** (the "Instagram API with Facebook Login" option) so the
   permissions `instagram_basic` and `instagram_content_publish` are available to the app. Under
   **Use cases > Customize > Permissions**, add those two plus `pages_show_list` and
   `pages_read_engagement`.
5. **If Meta asks you to create a "Configuration"** for Facebook Login for Business: create one
   with login type **User access token**, select the same four permissions, save, and copy its
   **Configuration ID** → `META_LOGIN_CONFIG_ID`. If nothing asks you for a configuration, leave
   that variable empty.
6. Leave the app in **Development** mode (the switch at the top). Do not submit for App Review.

### Add your six students as Testers

1. In the Meta app open **App roles > Roles** and click **Add People**.
2. Choose **Tester** and enter each student's Facebook name or username. Repeat for all six.
3. Each student must **accept** the invitation: they open
   [developers.facebook.com/requests](https://developers.facebook.com/requests) while logged in
   to Facebook (it asks them to register as a developer, which is free and takes one click) and
   click **Confirm**. Until they accept, sign-in fails for them.
4. Each student needs, before they connect:
   - an Instagram **Business** or **Creator** account, and
   - that Instagram account **linked to a Facebook Page** they manage
     (Instagram app > Settings > Accounts Center, or the Page's settings > Linked accounts).
5. When Meta's sign-in asks which Pages and Instagram accounts to share, the student should tick
   their Page **and** their Instagram account, and leave every permission switched on.

## Part 5: Environment variables in Vercel

In Vercel open your project > **Settings > Environment Variables** and add these (for Production):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Part 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from Part 1 |
| `META_APP_ID` | App ID from Part 4 |
| `META_APP_SECRET` | App secret from Part 4 |
| `NEXT_PUBLIC_APP_URL` | Your app address, e.g. `https://feed-preview-app.vercel.app` (no slash at the end) |
| `CRON_SECRET` | Any long random text. Make one up, 30+ characters, letters and numbers only |
| `GEMINI_API_KEY` | Optional. Your Google Gemini key, for the "Write with AI" button |
| `GEMINI_MODEL` | Optional. Defaults to `gemini-2.5-flash` |
| `META_LOGIN_CONFIG_ID` | Optional. Only if Part 4 step 5 applied to you |

Then go to **Deployments**, open the menu on the latest deployment, and click **Redeploy**.
Environment variables only take effect after a redeploy.

## Part 6: Make scheduled posts go out on time

Vercel's free plan runs cron jobs **once a day** only. The included `vercel.json` sets up that
daily run as a safety net, but on its own a post scheduled for 9:00 could wait until the next day.
To publish on time, let your Supabase database call the app every minute (also free):

1. In Supabase open **SQL Editor > New query** and paste [`supabase/cron.sql`](supabase/cron.sql).
2. Replace `https://YOUR-APP.vercel.app` with your app address and `YOUR_CRON_SECRET` with the
   `CRON_SECRET` you set in Vercel.
3. Click **Run**. From now on, a scheduled post goes out within about a minute of its time.

If the SQL editor says an extension isn't available, enable **pg_cron** and **pg_net** under
**Database > Extensions** and run it again.

## Part 7: Test it yourself

1. Open your app address and click **Continue with Meta**. Sign in with your own Facebook account
   (you are the app's admin, so you don't need to be a Tester).
2. Click **+ New post**, add a photo, write a caption, and click **Publish Now** twice (the second
   click confirms). The post should appear on your Instagram within a few seconds.
3. Create another post, schedule it a few minutes ahead, and close the tab. It should go out by itself.

Then send the app address to your students. That link is all they need.

---

## When something goes wrong

Students only ever see a friendly sentence. The technical reason is kept for you:

- **Start here: the checkup page.** Open `https://YOUR-APP.vercel.app/api/admin/check?key=YOUR_CRON_SECRET`
  in your browser. It tests every setting (Supabase key and tables, storage bucket, Meta app ID and
  secret, app address, Gemini key) and says in plain words what to fix. It never shows a secret.
- **Sign-in help codes.** When connecting fails, the message ends with a help code:
  `settings` = a Vercel variable is missing; `code` = Meta rejected the sign-in (wrong App secret, or the
  redirect URI / `NEXT_PUBLIC_APP_URL` doesn't match); `token` = the 60-day upgrade failed (App secret);
  `profile` or `pages` = Meta refused to share the account or Pages (permissions missing, or the
  person isn't a Tester); `save` = Supabase refused to save (wrong key, or schema.sql not run).

- **A post failed**: Supabase > **Table Editor > scheduled_posts** > the `error_message` column
  holds Meta's exact error, code and trace id.
- **Sign-in or AI problems**: Vercel > your project > **Logs**. Look for lines starting with
  `[auth/callback]`, `[publish]` or `[ai/caption]`.

Common causes:

| What the student sees | Usual cause |
| --- | --- |
| "We couldn't find a Facebook Page…" | Their Instagram isn't linked to a Page, or they didn't tick the Page during sign-in. If the Page belongs to a Business portfolio, the app may also need the `business_management` permission added in Meta. |
| "We couldn't finish connecting…" | The student hasn't accepted the Tester invitation, the redirect URI in Meta doesn't match exactly, or `NEXT_PUBLIC_APP_URL` is wrong. |
| "Your Instagram connection expired…" | Tokens last about 60 days, or the student changed their password. They click **Reconnect**. |
| "Instagram's daily posting limit…" | Instagram limits how many posts an account can publish through the API per day. |

Good to know:

- **Connections last about 60 days.** The app shows a Reconnect notice in the final week.
- **Free Supabase projects pause after a week with no activity.** The every-minute job from Part 6
  normally keeps yours awake; if it ever pauses, open the Supabase dashboard and click Restore.
- **This version posts single photos.** Reels and carousels use a different Meta flow and aren't included.
- **Deleting a post here never deletes it from Instagram.**
- **If you rotate `META_APP_SECRET`**, everyone is signed out and simply signs in again.

## Running it on your own computer (optional)

Copy `.env.example` to `.env.local`, fill in the values (use `http://localhost:3000` as the app
address), then:

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

## What's in the project

| Path | What it does |
| --- | --- |
| `app/page.tsx` | Shows the sign-in screen or the planner |
| `components/` | The planner UI (feed, calendar, post editor) |
| `app/api/auth/meta/login` | Sends the student to Meta's login |
| `app/api/auth/meta/callback` | Code → 60-day token → finds their Instagram → saves it |
| `app/api/posts` | List, schedule, edit and delete posts |
| `app/api/posts/publish-now` | Publishes immediately |
| `app/api/cron/publish` | Publishes every post that is due (needs `CRON_SECRET`) |
| `app/api/upload` | Stores the prepared JPEG in Supabase Storage |
| `app/api/ai/caption` | Caption helper (Gemini), key stays on the server |
| `lib/` | Meta API calls, friendly error messages, sessions, database client |
| `supabase/schema.sql` | Tables, Row Level Security, storage bucket |
| `supabase/cron.sql` | The every-minute publishing job |
