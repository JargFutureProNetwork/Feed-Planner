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

/** A photo or video this student uploaded through the app. */
export function isOwnMedia(url: unknown, userId: string, kind: "image" | "video"): url is string {
  return typeof url === "string" && url.startsWith(storagePrefix(userId)) && (kind === "image" ? /\.jpe?g$/i : /\.(mp4|mov)$/i).test(url);
}

export interface PostPayload {
  post_type: "image" | "carousel" | "reel";
  media: { kind: "image" | "video"; url: string }[];
  cover_url: string | null;
  image_url: string;
}

/** Checks what the planner wants to publish. Returns a sentence for the student when something is wrong. */
export function parsePostPayload(body: Record<string, unknown>, userId: string): PostPayload | string {
  // Older single-photo requests: { image_url }
  if (!body.media && body.image_url !== undefined) {
    if (!isOwnImage(body.image_url, userId)) return "Please add a photo first.";
    return { post_type: "image", media: [{ kind: "image", url: body.image_url }], cover_url: null, image_url: body.image_url };
  }
  const type = body.post_type;
  if (type !== "image" && type !== "carousel" && type !== "reel") return "This post's format isn't supported.";
  if (!Array.isArray(body.media) || !body.media.length) return "Please add a photo or video first.";
  const media: PostPayload["media"] = [];
  for (const raw of body.media as { kind?: unknown; url?: unknown }[]) {
    const kind = raw?.kind === "video" ? "video" : "image";
    const url = raw?.url;
    if (!isOwnMedia(url, userId, kind)) return kind === "video" ? "One of the videos couldn't be found. Add it again as an MP4 or MOV file." : "One of the photos couldn't be found. Please add it again.";
    media.push({ kind, url });
  }
  if (type === "image" && (media.length !== 1 || media[0].kind !== "image")) return "An image post needs exactly one photo.";
  if (type === "reel" && (media.length !== 1 || media[0].kind !== "video")) return "A reel needs exactly one video.";
  if (type === "carousel" && (media.length < 2 || media.length > 20)) return "A carousel needs between 2 and 20 slides.";
  const cover = isOwnMedia(body.cover_url, userId, "image") ? body.cover_url : null;
  return { post_type: type, media, cover_url: cover, image_url: media.find((m) => m.kind === "image")?.url || cover || media[0].url };
}
