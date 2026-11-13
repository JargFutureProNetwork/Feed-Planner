import { NextResponse, type NextRequest } from "next/server";
import { appUrl, env } from "@/lib/env";
import { INSTAGRAM_GRAPH, graph } from "@/lib/meta";
import { technicalError } from "@/lib/errors";
import { db } from "@/lib/supabase";
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, signToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ShortToken { access_token?: string; user_id?: string | number; data?: { access_token: string; user_id: string | number }[] }
interface LongToken { access_token: string; expires_in?: number }
interface Profile { id?: string; user_id?: string; username?: string; profile_picture_url?: string; account_type?: string }

/**
 * Instagram sends the student back here:
 * code -> short-lived token -> 60-day token -> their profile -> save -> sign in.
 */
export async function GET(request: NextRequest) {
  const home = (error?: string) => {
    const base = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const res = NextResponse.redirect(new URL(error ? `/?error=${error}` : "/", base));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return home("denied");
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== request.cookies.get(STATE_COOKIE)?.value) return home("state");

  let step = "settings";
  try {
    const client_id = env("INSTAGRAM_APP_ID");
    const client_secret = env("INSTAGRAM_APP_SECRET");

    // 1. Exchange the code for a short-lived token.
    step = "code";
    const shortRaw = await graph<ShortToken>("/oauth/access_token", {
      method: "POST", host: "api.instagram.com", unversioned: true,
      params: { client_id, client_secret, grant_type: "authorization_code", redirect_uri: `${appUrl()}/api/auth/instagram/callback`, code },
    });
    const short = shortRaw.data?.[0] ?? shortRaw;
    if (!short.access_token) throw new Error("Instagram returned no access token.");

    // 2. Upgrade it to a long-lived token (about 60 days).
    step = "token";
    const long = await graph<LongToken>("/access_token", {
      host: INSTAGRAM_GRAPH, unversioned: true,
      params: { grant_type: "ig_exchange_token", client_secret, access_token: short.access_token },
    });
    const token = long.access_token;
    const expiresIn = long.expires_in && long.expires_in > 0 ? long.expires_in : 60 * 24 * 60 * 60;

    // 3. Who is this?
    step = "profile";
    const me = await graph<Profile>("/me", { host: INSTAGRAM_GRAPH, token, params: { fields: "user_id,username,profile_picture_url,account_type" } });
    const igUserId = String(me.user_id || me.id || short.user_id || "");
    if (!igUserId) throw new Error("Instagram returned no user id.");
    const username = me.username || "instagram";

    // 4. Save. Someone who connected earlier through Facebook keeps their planner: same username, same row.
    step = "save";
    const identity = `ig:${igUserId}`;
    const fields = {
      fb_user_id: identity,
      ig_user_id: igUserId,
      ig_username: username,
      ig_profile_picture_url: me.profile_picture_url || null,
      access_token: token,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
    const supabase = db();
    let { data: existing } = await supabase.from("instagram_accounts").select("user_id").eq("fb_user_id", identity).maybeSingle();
    if (!existing && me.username) {
      ({ data: existing } = await supabase.from("instagram_accounts").select("user_id").ilike("ig_username", me.username.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle());
    }
    const { data, error } = existing
      ? await supabase.from("instagram_accounts").update(fields).eq("user_id", existing.user_id).select("user_id").single()
      : await supabase.from("instagram_accounts").insert(fields).select("user_id").single();
    if (error || !data) throw new Error(`Saving the account failed: ${error?.message}`);

    // 5. Sign the student in.
    const res = home();
    res.cookies.set(SESSION_COOKIE, signToken({ uid: data.user_id as string }), cookieOptions());
    return res;
  } catch (e) {
    console.error(`[auth/instagram/callback] step=${step} ${technicalError(e)}`);
    return home(`failed&step=${step}`);
  }
}
