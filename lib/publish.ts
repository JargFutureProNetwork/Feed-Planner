import { db, type AccountRow, type PostRow, type PostStatus } from "./supabase";
import { FACEBOOK_GRAPH, INSTAGRAM_GRAPH, publishStep, type PublishJob } from "./meta";

/** Which Meta host serves this account: Instagram Login accounts live on graph.instagram.com. */
export const isInstagramLogin = (account: Pick<AccountRow, "fb_user_id">) => account.fb_user_id.startsWith("ig:");
export const graphHostFor = (account: Pick<AccountRow, "fb_user_id">) => (isInstagramLogin(account) ? INSTAGRAM_GRAPH : FACEBOOK_GRAPH);
import { friendlyError, needsReconnect, technicalError } from "./errors";

export const POST_COLUMNS = "id,user_id,image_url,caption,scheduled_at,status,post_type,media,cover_url,container_id";
const LEASE_MS = 55_000;
export const STILL_PROCESSING = "Instagram is still preparing your video. It will appear on your profile in a few minutes.";

/**
 * Atomically moves a post into "publishing". Returns null if someone else (the cron job,
 * a second click) already took it, which is what prevents double posting.
 */
export async function claimPost(id: string, from: PostStatus[], userId?: string): Promise<PostRow | null> {
  let query = db().from("scheduled_posts")
    .update({ status: "publishing", error_message: null, student_message: null, container_id: null, publish_started_at: new Date().toISOString(), lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("id", id).in("status", from);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select(POST_COLUMNS).maybeSingle();
  if (error) throw new Error(`claimPost: ${error.message}`);
  return (data as PostRow | null) ?? null;
}

export async function getAccount(userId: string): Promise<AccountRow | null> {
  const { data, error } = await db().from("instagram_accounts")
    .select("user_id,fb_user_id,ig_user_id,ig_username,ig_profile_picture_url,access_token,token_expires_at")
    .eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`getAccount: ${error.message}`);
  return (data as AccountRow | null) ?? null;
}

/**
 * Takes over a post whose video Instagram was still processing last time. The lease makes sure
 * two requests never work on the same post at once.
 */
export async function resumePost(id: string): Promise<PostRow | null> {
  const now = new Date();
  const { data, error } = await db().from("scheduled_posts")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", id).eq("status", "publishing").not("container_id", "is", null).lt("lease_until", now.toISOString())
    .select(POST_COLUMNS).maybeSingle();
  if (error) throw new Error(`resumePost: ${error.message}`);
  return (data as PostRow | null) ?? null;
}

/**
 * Works on a post that is already claimed ("publishing") and records the outcome.
 * Never throws. `pending` means Instagram is still processing a video and the cron job will finish it.
 */
export async function publishClaimedPost(post: PostRow, account?: AccountRow | null, budgetMs = 35_000): Promise<{ ok: boolean; pending?: boolean; message: string }> {
  try {
    const acct = account ?? (await getAccount(post.user_id));
    if (!acct) throw new Error("No Instagram account is connected for this user.");
    const job: PublishJob = {
      post_type: post.post_type || "image",
      media: Array.isArray(post.media) && post.media.length ? post.media : [{ kind: "image", url: post.image_url }],
      caption: post.caption,
      cover_url: post.cover_url,
      state: post.container_id,
    };
    const result = await publishStep(acct.ig_user_id, acct.access_token, graphHostFor(acct), job, Date.now() + budgetMs,
      async (state) => { await db().from("scheduled_posts").update({ container_id: state }).eq("id", post.id); });
    if (!result.done) {
      await db().from("scheduled_posts").update({ container_id: result.state, lease_until: new Date().toISOString() }).eq("id", post.id);
      return { ok: true, pending: true, message: STILL_PROCESSING };
    }
    await db().from("scheduled_posts")
      .update({ status: "published", ig_media_id: result.mediaId, published_at: new Date().toISOString(), error_message: null, student_message: null })
      .eq("id", post.id);
    return { ok: true, message: "Published to Instagram." };
  } catch (e) {
    const message = friendlyError(e);
    console.error(`[publish] post ${post.id} failed: ${technicalError(e)}`);
    await db().from("scheduled_posts")
      .update({ status: "failed", error_message: technicalError(e), student_message: message })
      .eq("id", post.id);
    // Make the Reconnect button appear for an expired or revoked token.
    if (needsReconnect(e)) {
      await db().from("instagram_accounts").update({ token_expires_at: new Date().toISOString() }).eq("user_id", post.user_id);
    }
    return { ok: false, message };
  }
}
