import { NextResponse } from "next/server";
import { db, PUBLIC_POST_COLUMNS, type PostRow } from "@/lib/supabase";
import { POST_COLUMNS, publishClaimedPost } from "@/lib/publish";
import { GENERIC, captionProblem, cleanCaption, fail, parsePostPayload, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Publish now": runs Instagram's container flow straight away for an image, carousel or reel.
 * A video that Instagram is still processing when time runs out is finished by the cron job;
 * the reply then carries pending: true.
 */
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

  const now = new Date();
  const { data, error } = await db().from("scheduled_posts")
    .insert({
      user_id: auth.userId, image_url: payload.image_url, caption, scheduled_at: now.toISOString(), status: "publishing",
      post_type: payload.post_type, media: payload.media, cover_url: payload.cover_url,
      publish_started_at: now.toISOString(), lease_until: new Date(now.getTime() + 55_000).toISOString(),
    })
    .select(POST_COLUMNS).single();
  if (error || !data) { console.error("[publish-now]", error?.message); return fail(GENERIC, 500); }

  const result = await publishClaimedPost(data as PostRow);
  const { data: fresh } = await db().from("scheduled_posts").select(PUBLIC_POST_COLUMNS).eq("id", (data as PostRow).id).maybeSingle();
  if (!result.ok) return NextResponse.json({ error: result.message, post: fresh }, { status: 502 });
  return NextResponse.json({ message: result.message, pending: !!result.pending, post: fresh });
}
