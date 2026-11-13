import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db, type AccountRow } from "@/lib/supabase";
import { claimPost, getAccount, publishClaimedPost, resumePost } from "@/lib/publish";
import { INSTAGRAM_GRAPH, graph } from "@/lib/meta";
import { technicalError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;          // stop starting new work well before the function limit
const GIVE_UP_AFTER_MS = 25 * 60_000;   // a post still "publishing" after this long is marked as failed

function authorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; other schedulers may send x-cron-secret.
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-cron-secret") || "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Publishes every post whose time has come and finishes videos Instagram was still processing. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const left = () => TIME_BUDGET_MS - (Date.now() - started);
  const supabase = db();
  const summary = { due: 0, published: 0, failed: 0, processing: 0, skipped: 0, renewed: 0 };

  // A post that never finishes must not stay "publishing" forever.
  const unknown = {
    status: "failed",
    error_message: "Still 'publishing' after 25 minutes; the outcome is unknown.",
    student_message: "We couldn't confirm this post went out. Check your Instagram profile before publishing it again.",
  };
  const cutoff = new Date(started - GIVE_UP_AFTER_MS).toISOString();
  await supabase.from("scheduled_posts").update(unknown).eq("status", "publishing").lt("publish_started_at", cutoff);
  await supabase.from("scheduled_posts").update(unknown).eq("status", "publishing").is("publish_started_at", null).lt("updated_at", cutoff);

  const accounts = new Map<string, AccountRow | null>();
  const account = async (userId: string) => {
    if (!accounts.has(userId)) accounts.set(userId, await getAccount(userId).catch(() => null));
    return accounts.get(userId);
  };
  const tally = (r: { ok: boolean; pending?: boolean }) => { if (!r.ok) summary.failed++; else if (r.pending) summary.processing++; else summary.published++; };

  // 1. Videos Instagram was still processing on an earlier run.
  const { data: waiting } = await supabase.from("scheduled_posts")
    .select("id").eq("status", "publishing").not("container_id", "is", null).lt("lease_until", new Date().toISOString())
    .order("publish_started_at", { ascending: true }).limit(10);
  for (const row of waiting ?? []) {
    if (left() < 8000) { summary.skipped++; continue; }
    const post = await resumePost(row.id as string).catch(() => null);
    if (!post) continue;
    tally(await publishClaimedPost(post, await account(post.user_id), Math.min(12_000, left() - 4000)));
  }

  // 2. Posts whose scheduled time has arrived.
  const { data: due, error } = await supabase.from("scheduled_posts")
    .select("id").eq("status", "pending").lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true }).limit(15);
  if (error) {
    console.error("[cron]", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  summary.due = due?.length ?? 0;
  for (const row of due ?? []) {
    if (left() < 10_000) { summary.skipped++; continue; }   // picked up on the next run
    const post = await claimPost(row.id as string, ["pending"]).catch(() => null);
    if (!post) { summary.skipped++; continue; }
    tally(await publishClaimedPost(post, await account(post.user_id), Math.min(20_000, left() - 4000)));
  }

  // 3. Instagram Login tokens can be renewed without the student doing anything: renew those in their last 10 days.
  if (left() > 6000) {
    const { data: expiring } = await supabase.from("instagram_accounts")
      .select("user_id,access_token")
      .like("fb_user_id", "ig:%")
      .gt("token_expires_at", new Date().toISOString())
      .lt("token_expires_at", new Date(Date.now() + 10 * 86400000).toISOString())
      .limit(5);
    for (const acct of expiring ?? []) {
      try {
        const fresh = await graph<{ access_token: string; expires_in?: number }>("/refresh_access_token", {
          host: INSTAGRAM_GRAPH, unversioned: true, params: { grant_type: "ig_refresh_token", access_token: acct.access_token as string },
        });
        await supabase.from("instagram_accounts").update({
          access_token: fresh.access_token,
          token_expires_at: new Date(Date.now() + (fresh.expires_in && fresh.expires_in > 0 ? fresh.expires_in : 60 * 86400) * 1000).toISOString(),
        }).eq("user_id", acct.user_id as string);
        summary.renewed++;
      } catch (e) {
        console.error(`[cron] token renewal failed for ${acct.user_id}: ${technicalError(e)}`);
      }
    }
  }

  return NextResponse.json(summary);
}
