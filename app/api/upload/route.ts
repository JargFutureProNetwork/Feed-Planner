import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { STORAGE_BUCKET, storagePrefix } from "@/lib/env";
import { fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;   // larger files (videos) go straight to storage through /api/upload/sign

/** Works out what a file really is from its first bytes, not from its name. */
function sniff(bytes: Buffer, declared: string): { ext: string; type: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return { ext: "png", type: "image/png" };
  if (bytes.length > 12 && bytes.toString("latin1", 4, 8) === "ftyp") {
    return declared === "video/quicktime" ? { ext: "mov", type: "video/quicktime" } : { ext: "mp4", type: "video/mp4" };
  }
  return null;
}

/** Stores a small photo, logo or short video in the public bucket and returns its public address. */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return fail("Please choose a photo or video.");
  if (file.size > MAX_BYTES) return fail("That file is too large to send this way.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniff(bytes, String(form?.get("type") || file.type || ""));
  if (!kind) return fail("That file isn't a photo or video we can use. Please choose a JPG, PNG, MP4 or MOV.");

  const path = `${auth.userId}/${randomUUID()}.${kind.ext}`;
  const { error } = await db().storage.from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: kind.type, cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("[upload]", error.message);
    return fail("The file couldn't be saved. Please try again.", 500);
  }
  const url = db().storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ url, image_url: url });
}

/** Removes a file the student uploaded earlier (a replaced cover, a deleted project's media). */
export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  const prefix = storagePrefix(auth.userId);
  if (typeof body?.url !== "string" || !body.url.startsWith(prefix)) return fail("That file couldn't be found.", 404);
  const name = body.url.slice(prefix.length);
  if (!/^[\w-]+\.(jpe?g|png|mp4|mov)$/i.test(name)) return fail("That file couldn't be found.", 404);
  await db().storage.from(STORAGE_BUCKET).remove([`${auth.userId}/${name}`]).catch(() => null);
  return NextResponse.json({ ok: true });
}
