import { NextResponse } from "next/server";
import { db, PUBLIC_POST_COLUMNS, type PostRow } from "@/lib/supabase";
import { claimPost, publishClaimedPost } from "@/lib/publish";
import { GENERIC, captionProblem, cleanCaption, fail, isOwnImage, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Publish Now": runs the two-step Instagram flow immediately.
 * Body: { id } for a post that already exists (optionally with a new caption / image_url),
 *       or { image_url, caption } for a brand-new post.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { id?: unknown; image_url?: unknown; caption?: unknown } | null;
  if (!body) return fail("That request couldn't be read. Please try again.");

  const caption = body.caption === undefined ? undefined : cleanCaption(body.caption);
  if (caption !== undefined) {
    if (!caption) return fail("Please write a caption first.");
    const problem = captionProblem(caption);
    if (problem) return fail(problem);
  }
  if (body.image_url !== undefined && !isOwnImage(body.image_url, auth.userId)) return fail("Please add a photo first.");

  let post: PostRow | null;
  try {
    if (typeof body.id === "string") {
      // Save any last-second edits, then take the post so the cron job can't also publish it.
      const edits: Record<string, unknown> = {};
      if (caption !== undefined) edits.caption = caption;
      if (body.image_url !== undefined) edits.image_url = body.image_url;
      if (Object.keys(edits).length) {
        await db().from("scheduled_posts").update(edits)
          .eq("id", body.id).eq("user_id", auth.userId).in("status", ["pending", "failed"]);
      }
      post = await claimPost(body.id, ["pending", "failed"], auth.userId);
      if (!post) return fail("This post is already published or is being published right now.", 409);
    } else {
      if (!caption) return fail("Please write a caption first.");
      if (body.image_url === undefined) return fail("Please add a photo first.");
      const { data, error } = await db().from("scheduled_posts")
        .insert({ user_id: auth.userId, image_url: body.image_url, caption, scheduled_at: new Date().toISOString(), status: "publishing" })
        .select("id,user_id,image_url,caption,scheduled_at,status").single();
      if (error || !data) throw new Error(error?.message || "insert failed");
      post = data as PostRow;
    }
  } catch (e) {
    console.error("[publish-now]", e);
    return fail(GENERIC, 500);
  }

  const result = await publishClaimedPost(post);
  const { data: fresh } = await db().from("scheduled_posts").select(PUBLIC_POST_COLUMNS).eq("id", post.id).maybeSingle();
  if (!result.ok) return NextResponse.json({ error: result.message, post: fresh }, { status: 502 });
  return NextResponse.json({ message: result.message, post: fresh });
}
