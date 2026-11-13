import { NextResponse, type NextRequest } from "next/server";
import { appUrl, env } from "@/lib/env";
import { graph } from "@/lib/meta";
import { technicalError } from "@/lib/errors";
import { db } from "@/lib/supabase";
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, signToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TokenResponse { access_token: string; expires_in?: number }
interface PagesResponse {
  data: { id: string; name: string; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[];
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

    // 2. Upgrade it straight away to a long-lived token (about 60 days).
    step = "token";
    const long = await graph<TokenResponse>("/oauth/access_token", {
      params: { grant_type: "fb_exchange_token", client_id, client_secret, fb_exchange_token: short.access_token },
    });
    const token = long.access_token;
    const expiresIn = long.expires_in && long.expires_in > 0 ? long.expires_in : 60 * 24 * 60 * 60;

    // 3. Who is this, and which Instagram professional account is linked to their Page?
    step = "profile";
    const me = await graph<{ id: string }>("/me", { token, params: { fields: "id" } });
    step = "pages";
    const pages = await graph<PagesResponse>("/me/accounts", {
      token, params: { fields: "id,name,instagram_business_account{id,username,profile_picture_url}", limit: "100" },
    });
    if (!pages.data?.length) return home("no_page");
    const ig = pages.data.find((p) => p.instagram_business_account)?.instagram_business_account;
    if (!ig) return home("no_instagram");

    // 4. Save (or refresh) the account. user_id is created on first connect and kept afterwards.
    step = "save";
    const { data, error } = await db().from("instagram_accounts")
      .upsert({
        fb_user_id: me.id,
        ig_user_id: ig.id,
        ig_username: ig.username || "instagram",
        ig_profile_picture_url: ig.profile_picture_url || null,
        access_token: token,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      }, { onConflict: "fb_user_id" })
      .select("user_id").single();
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
