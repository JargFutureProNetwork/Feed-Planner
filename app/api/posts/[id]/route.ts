import { NextResponse } from "next/server";
import { db, PUBLIC_POST_COLUMNS } from "@/lib/supabase";
import { STORAGE_BUCKET, storagePrefix } from "@/lib/env";
import { GENERIC, captionProblem, cleanCaption, fail, isOwnImage, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit a post that hasn't been published yet. Saving a failed post puts it back in the schedule. */
export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return fail("That post couldn't be found.", 404);
  const body = await request.json().catch(() => null) as { image_url?: unknown; caption?: unknown; scheduled_at?: unknown } | null;
  if (!body) return fail("That request couldn't be read. Please try again.");

  const changes: Record<string, unknown> = { status: "pending", error_message: null, student_message: null };
  if (body.image_url !== undefined) {
    if (!isOwnImage(body.image_url, auth.userId)) return fail("Please add a photo first.");
    changes.image_url = body.image_url;
  }
  if (body.caption !== undefined) {
    const caption = cleanCaption(body.caption);
    if (!caption) return fail("Please write a caption first.");
    const problem = captionProblem(caption);
    if (problem) return fail(problem);
    changes.caption = caption;
  }
  if (body.scheduled_at !== undefined) {
    const when = new Date(String(body.scheduled_at || ""));
    if (Number.isNaN(when.getTime())) return fail("Please pick a date and time.");
    if (when.getTime() < Date.now() - 60_000) return fail("That time has already passed. Pick a later time, or use Publish Now.");
    changes.scheduled_at = when.toISOString();
  }

  const { data, error } = await db().from("scheduled_posts")
    .update(changes).eq("id", id).eq("user_id", auth.userId).in("status", ["pending", "failed"])
    .select(PUBLIC_POST_COLUMNS).maybeSingle();
  if (error) { console.error("[posts PATCH]", error.message); return fail(GENERIC, 500); }
  if (!data) return fail("This post has already been published, so it can't be changed.", 409);
  return NextResponse.json({ post: data });
}

/** Remove a post from the planner. This never deletes anything from Instagram itself. */
export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return fail("That post couldn't be found.", 404);

  const { data, error } = await db().from("scheduled_posts")
    .delete().eq("id", id).eq("user_id", auth.userId).neq("status", "publishing")
    .select("image_url,status").maybeSingle();
  if (error) { console.error("[posts DELETE]", error.message); return fail(GENERIC, 500); }
  if (!data) return fail("This post is being published right now. Try again in a moment.", 409);

  // Tidy up the stored photo unless it is live on Instagram's side of things (kept for the record).
  const url = data.image_url as string;
  const prefix = storagePrefix(auth.userId);
  if (data.status !== "published" && url.startsWith(prefix)) {
    await db().storage.from(STORAGE_BUCKET).remove([`${auth.userId}/${url.slice(prefix.length)}`]).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
