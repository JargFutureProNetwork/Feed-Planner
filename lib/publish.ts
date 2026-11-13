import { db, type AccountRow, type PostRow, type PostStatus } from "./supabase";
import { publishImage } from "./meta";
import { friendlyError, needsReconnect, technicalError } from "./errors";

const POST_COLUMNS = "id,user_id,image_url,caption,scheduled_at,status";

/**
 * Atomically moves a post into "publishing". Returns null if someone else (the cron job,
 * a second click) already took it, which is what prevents double posting.
 */
export async function claimPost(id: string, from: PostStatus[], userId?: string): Promise<PostRow | null> {
  let query = db().from("scheduled_posts")
    .update({ status: "publishing", error_message: null, student_message: null })
    .eq("id", id).in("status", from);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select(POST_COLUMNS).maybeSingle();
  if (error) throw new Error(`claimPost: ${error.message}`);
  return (data as PostRow | null) ?? null;
}

export async function getAccount(userId: string): Promise<AccountRow | null> {
  const { data, error } = await db().from("instagram_accounts")
    .select("user_id,ig_user_id,ig_username,ig_profile_picture_url,access_token,token_expires_at")
    .eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`getAccount: ${error.message}`);
  return (data as AccountRow | null) ?? null;
}

/**
 * Publishes a post that is already claimed ("publishing") and records the outcome.
 * Never throws: the result says what to tell the student.
 */
export async function publishClaimedPost(post: PostRow, account?: AccountRow | null): Promise<{ ok: boolean; message: string }> {
  try {
    const acct = account ?? (await getAccount(post.user_id));
    if (!acct) throw new Error("No Instagram account is connected for this user.");
    const mediaId = await publishImage(acct.ig_user_id, acct.access_token, post.image_url, post.caption);
    await db().from("scheduled_posts")
      .update({ status: "published", ig_media_id: mediaId, published_at: new Date().toISOString(), error_message: null, student_message: null })
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
