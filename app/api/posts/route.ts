import { NextResponse } from "next/server";
import { db, PUBLIC_POST_COLUMNS } from "@/lib/supabase";
import { GENERIC, captionProblem, cleanCaption, fail, parsePostPayload, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The student's scheduled, published and failed posts, oldest first. */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { data, error } = await db().from("scheduled_posts")
    .select(PUBLIC_POST_COLUMNS).eq("user_id", auth.userId).order("scheduled_at", { ascending: true });
  if (error) { console.error("[posts GET]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ posts: data });
}

/** "Schedule post": saves an image, carousel or reel that the cron job publishes at its time. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return fail("That request couldn't be read. Please try again.");

  const payload = parsePostPayload(body, auth.userId);
  if (typeof payload === "string") return fail(payload);
  const caption = cleanCaption(body.caption);
  if (!caption) return fail("Please write a caption first.");
  const problem = captionProblem(caption);
  if (problem) return fail(problem);
  const when = new Date(String(body.scheduled_at || ""));
  if (Number.isNaN(when.getTime())) return fail("Please pick a date and time.");
  if (when.getTime() < Date.now() - 60_000) return fail("That time has already passed. Pick a later time, or use Publish now.");

  const { data, error } = await db().from("scheduled_posts")
    .insert({
      user_id: auth.userId, image_url: payload.image_url, caption, scheduled_at: when.toISOString(), status: "pending",
      post_type: payload.post_type, media: payload.media, cover_url: payload.cover_url,
    })
    .select(PUBLIC_POST_COLUMNS).single();
  if (error) { console.error("[posts POST]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ post: data });
}
