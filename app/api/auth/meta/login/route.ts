import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, env } from "@/lib/env";
import { GRAPH_VERSION, META_SCOPES } from "@/lib/meta";
import { STATE_COOKIE, cookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Sends the student to Meta's standard login dialog. */
export async function GET() {
  let url: URL;
  try {
    url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", env("META_APP_ID"));
    url.searchParams.set("redirect_uri", `${appUrl()}/api/auth/meta/callback`);
    url.searchParams.set("response_type", "code");
    // Facebook Login for Business can require a saved "configuration" instead of a scope list.
    const configId = (process.env.META_LOGIN_CONFIG_ID || "").trim();
    // (This is also how "Unified login" works on newer Meta apps: permissions come from the configuration.)
    if (configId) { url.searchParams.set("config_id", configId); url.searchParams.set("override_default_response_type", "true"); }
    else url.searchParams.set("scope", META_SCOPES.join(","));
  } catch (e) {
    console.error("[auth/login]", e);
    return NextResponse.redirect(new URL("/?error=setup", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }

  const state = randomBytes(16).toString("hex");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
