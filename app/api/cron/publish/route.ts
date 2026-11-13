import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db, type AccountRow } from "@/lib/supabase";
import { claimPost, getAccount, publishClaimedPost } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;   // stop starting new posts well before the function limit
const STUCK_AFTER_MS = 15 * 60_000;

function authorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; other schedulers may send x-cron-secret.
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-cron-secret") || "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Publishes every post whose time has come. Safe to call as often as you like. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const supabase = db();

  // A post left in "publishing" (the server was cut off mid-way) must not stay stuck forever.
  await supabase.from("scheduled_posts")
    .update({
      status: "failed",
      error_message: "Left in 'publishing' for over 15 minutes; the outcome is unknown.",
      student_message: "We couldn't confirm this post went out. Check your Instagram profile before publishing it again.",
    })
    .eq("status", "publishing").lt("updated_at", new Date(started - STUCK_AFTER_MS).toISOString());

  const { data: due, error } = await supabase.from("scheduled_posts")
    .select("id").eq("status", "pending").lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true }).limit(15);
  if (error) {
    console.error("[cron]", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const accounts = new Map<string, AccountRow | null>();
  const summary = { due: due?.length ?? 0, published: 0, failed: 0, skipped: 0 };

  for (const row of due ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) { summary.skipped++; continue; }   // picked up on the next run
    const post = await claimPost(row.id as string, ["pending"]).catch(() => null);
    if (!post) { summary.skipped++; continue; }
    if (!accounts.has(post.user_id)) accounts.set(post.user_id, await getAccount(post.user_id).catch(() => null));
    const result = await publishClaimedPost(post, accounts.get(post.user_id));
    if (result.ok) summary.published++; else summary.failed++;
  }

  return NextResponse.json(summary);
}
