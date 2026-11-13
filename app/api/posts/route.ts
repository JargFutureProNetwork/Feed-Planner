import { NextResponse } from "next/server";
import { db, PUBLIC_POST_COLUMNS } from "@/lib/supabase";
import { GENERIC, captionProblem, cleanCaption, fail, isOwnImage, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The student's posts, oldest first. */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { data, error } = await db().from("scheduled_posts")
    .select(PUBLIC_POST_COLUMNS).eq("user_id", auth.userId).order("scheduled_at", { ascending: true });
  if (error) { console.error("[posts GET]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ posts: data });
}

/** "Schedule Post": saves a post that the cron job will publish at its time. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { image_url?: unknown; caption?: unknown; scheduled_at?: unknown } | null;
  if (!body) return fail("That request couldn't be read. Please try again.");

  if (!isOwnImage(body.image_url, auth.userId)) return fail("Please add a photo first.");
  const caption = cleanCaption(body.caption);
  if (!caption) return fail("Please write a caption first.");
  const problem = captionProblem(caption);
  if (problem) return fail(problem);
  const when = new Date(String(body.scheduled_at || ""));
  if (Number.isNaN(when.getTime())) return fail("Please pick a date and time.");
  if (when.getTime() < Date.now() - 60_000) return fail("That time has already passed. Pick a later time, or use Publish Now.");

  const { data, error } = await db().from("scheduled_posts")
    .insert({ user_id: auth.userId, image_url: body.image_url, caption, scheduled_at: when.toISOString(), status: "pending" })
    .select(PUBLIC_POST_COLUMNS).single();
  if (error) { console.error("[posts POST]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ post: data });
}
