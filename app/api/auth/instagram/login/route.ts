import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, env } from "@/lib/env";
import { INSTAGRAM_SCOPES } from "@/lib/meta";
import { STATE_COOKIE, cookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Sends the student to Instagram's own login. No Facebook account or Page is involved. */
export async function GET() {
  let url: URL;
  try {
    url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", env("INSTAGRAM_APP_ID"));
    url.searchParams.set("redirect_uri", `${appUrl()}/api/auth/instagram/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  } catch (e) {
    console.error("[auth/instagram/login]", e);
    return NextResponse.redirect(new URL("/?error=setup", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }

  const state = randomBytes(16).toString("hex");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
