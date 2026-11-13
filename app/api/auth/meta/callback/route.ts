import { NextResponse, type NextRequest } from "next/server";
import { appUrl, env } from "@/lib/env";
import { graph } from "@/lib/meta";
import { technicalError } from "@/lib/errors";
import { db } from "@/lib/supabase";
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, signToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TokenResponse { access_token: string; expires_in?: number }
interface IgAccount { id: string; username?: string; profile_picture_url?: string }
interface PagesResponse {
  data: { id: string; name: string; instagram_business_account?: IgAccount }[];
}

/**
 * Meta sends the student back here. Everything technical happens silently:
 * code -> short-lived token -> 60-day token -> find their Instagram account -> save -> sign in.
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
    const client_id = env("META_APP_ID");
    const client_secret = env("META_APP_SECRET");

    // 1. Exchange the code for a short-lived token.
    step = "code";
    const short = await graph<TokenResponse>("/oauth/access_token", {
      params: { client_id, client_secret, code, redirect_uri: `${appUrl()}/api/auth/meta/callback` },
    });

    // 2. Upgrade it to a long-lived token (about 60 days). Tokens from a Unified login /
    //    business configuration can't be upgraded and usually never expire, so keep the original then.
    step = "token";
    let token = short.access_token;
    let expiresIn = short.expires_in && short.expires_in > 0 ? short.expires_in : 0;
    try {
      const long = await graph<TokenResponse>("/oauth/access_token", {
        params: { grant_type: "fb_exchange_token", client_id, client_secret, fb_exchange_token: short.access_token },
      });
      if (long.access_token) { token = long.access_token; expiresIn = long.expires_in && long.expires_in > 0 ? long.expires_in : expiresIn; }
    } catch (e) {
      console.warn(`[auth/callback] long-lived exchange skipped: ${technicalError(e)}`);
    }

    // 3. Who is this, and which Instagram professional account did they share?
    step = "profile";
    const me = await graph<{ id: string }>("/me", { token, params: { fields: "id" } });

    step = "pages";
    let ig: IgAccount | undefined;
    // a) Classic route: an Instagram account linked to a Facebook Page they manage.
    const pages = await graph<PagesResponse>("/me/accounts", {
      token, params: { fields: "id,name,instagram_business_account{id,username,profile_picture_url}", limit: "100" },
    }).catch((e) => { console.warn(`[auth/callback] /me/accounts: ${technicalError(e)}`); return null; });
    ig = pages?.data?.find((p) => p.instagram_business_account)?.instagram_business_account;
    // b) Unified login: the Instagram account is shared directly, with no Facebook Page involved.
    if (!ig) {
      const assigned = await graph<{ data: IgAccount[] }>("/me/assigned_instagram_accounts", {
        token, params: { fields: "id,username,profile_picture_url", limit: "100" },
      }).catch((e) => { console.warn(`[auth/callback] /me/assigned_instagram_accounts: ${technicalError(e)}`); return null; });
      ig = assigned?.data?.[0];
    }
    if (!ig) return home("no_instagram");

    // 4. Save (or refresh) the account. The same person or the same Instagram account keeps its planner.
    step = "save";
    const fields = {
      fb_user_id: me.id,
      ig_user_id: ig.id,
      ig_username: ig.username || "instagram",
      ig_profile_picture_url: ig.profile_picture_url || null,
      access_token: token,
      token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,   // null = does not expire
    };
    const supabase = db();
    let { data: existing } = await supabase.from("instagram_accounts").select("user_id").eq("fb_user_id", me.id).maybeSingle();
    if (!existing) ({ data: existing } = await supabase.from("instagram_accounts").select("user_id").eq("ig_user_id", ig.id).limit(1).maybeSingle());
    const { data, error } = existing
      ? await supabase.from("instagram_accounts").update(fields).eq("user_id", existing.user_id).select("user_id").single()
      : await supabase.from("instagram_accounts").insert(fields).select("user_id").single();
    if (error || !data) throw new Error(`Saving the account failed: ${error?.message}`);

    // 5. Sign the student in.
    const res = home();
    res.cookies.set(SESSION_COOKIE, signToken({ uid: data.user_id as string }), cookieOptions());
    return res;
  } catch (e) {
    console.error(`[auth/callback] step=${step} ${technicalError(e)}`);
    return home(`failed&step=${step}`);
  }
}
