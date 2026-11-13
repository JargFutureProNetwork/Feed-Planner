import { NextResponse } from "next/server";
import { getSessionUserId } from "./session";
import { storagePrefix } from "./env";

/** JSON error with a sentence that is safe to show a student. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export const SIGNED_OUT = "Please connect your Instagram account again.";
export const GENERIC = "Something went wrong. Please try again.";

/** Resolves the signed-in student or returns a ready-made 401 response. */
export async function requireUser(): Promise<{ userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return { response: fail(SIGNED_OUT, 401) };
  return { userId };
}

/** Only images this student uploaded through the app may be posted. */
export function isOwnImage(url: unknown, userId: string): url is string {
  return typeof url === "string" && url.startsWith(storagePrefix(userId)) && /\.jpe?g$/i.test(url);
}

export function cleanCaption(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

export function captionProblem(caption: string): string | null {
  if (caption.length > 2200) return `The caption is ${caption.length} characters long. Instagram allows 2,200.`;
  if ((caption.match(/#[^\s#]+/g) || []).length > 30) return "Instagram allows at most 30 hashtags.";
  return null;
}
