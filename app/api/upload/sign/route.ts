import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/env";
import { fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "video/mp4": "mp4", "video/quicktime": "mov" };
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Large files (videos) can't pass through the app's server on Vercel's free plan, so the browser
 * sends them straight to Supabase Storage. This hands out a one-time upload address for one file
 * inside the student's own folder.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { type?: unknown; size?: unknown } | null;
  const ext = TYPES[String(body?.type || "")];
  if (!ext) return fail("That kind of file can't be used. Please choose a JPG, PNG, MP4 or MOV.");
  if (typeof body?.size !== "number" || body.size <= 0 || body.size > MAX_BYTES) return fail("That file is over 50 MB. Please choose a smaller one.");

  const path = `${auth.userId}/${randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[upload/sign]", error?.message);
    return fail("The upload couldn't be started. Please try again.", 500);
  }
  return NextResponse.json({
    upload_url: data.signedUrl,
    public_url: db().storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl,
  });
}
