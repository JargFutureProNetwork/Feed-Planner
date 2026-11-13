import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const SESSION_COOKIE = "fps_session";
export const STATE_COOKIE = "fps_oauth_state";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

// The signing key is derived from the Meta app secret, so there is no extra variable to set up.
function key(): Buffer {
  return createHmac("sha256", env("META_APP_SECRET")).update("feed-preview-session-v1").digest();
}

export function signToken(data: Record<string, unknown>, maxAgeSeconds = THIRTY_DAYS): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds })).toString("base64url");
  const signature = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readToken<T extends object>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const expected = createHmac("sha256", key()).update(body).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** The signed-in student's user_id, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  return readToken<{ uid: string }>(store.get(SESSION_COOKIE)?.value)?.uid ?? null;
}

export function cookieOptions(maxAge: number = THIRTY_DAYS) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}
