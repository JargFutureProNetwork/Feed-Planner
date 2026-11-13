import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/env";
import { fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;   // the browser has already resized the photo, so this is generous

/** Receives the JPEG the browser prepared and stores it in the public bucket. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return fail("Please choose a photo.");
  if (file.size > MAX_BYTES) return fail("That photo is too large. Please choose a smaller one.");

  const bytes = Buffer.from(await file.arrayBuffer());
  // Instagram only accepts JPEG, so check the real file signature, not just the name.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return fail("That file isn't a photo we can use. Please choose a JPG or PNG picture.");
  }

  const path = `${auth.userId}/${randomUUID()}.jpg`;
  const { error } = await db().storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("[upload]", error.message);
    return fail("The photo couldn't be saved. Please try again.", 500);
  }
  const { data } = db().storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return NextResponse.json({ image_url: data.publicUrl });
}
