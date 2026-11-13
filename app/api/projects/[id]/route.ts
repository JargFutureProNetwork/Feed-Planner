import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { GENERIC, fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const ID = /^[a-z0-9]{6,40}$/i;
const MAX_CHARS = 1_500_000;   // a project is text only; its photos and videos live in storage

/** Saves one project. The planner calls this a moment after every change. */
export async function PUT(request: Request, { params }: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!ID.test(id)) return fail("That project couldn't be found.", 404);

  const text = await request.text();
  if (text.length > MAX_CHARS) return fail("This project has grown too large to save. Start a new project for the next month.", 413);
  let data: { id?: unknown } | null = null;
  try { data = JSON.parse(text); } catch { /* handled below */ }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.id !== id) return fail("That project couldn't be saved. Please try again.");

  const { error } = await db().from("projects")
    .upsert({ user_id: auth.userId, id, data, updated_at: new Date().toISOString() }, { onConflict: "user_id,id" });
  if (error) { console.error("[projects PUT]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { id } = await params;
  if (!ID.test(id)) return fail("That project couldn't be found.", 404);
  const { error } = await db().from("projects").delete().eq("user_id", auth.userId).eq("id", id);
  if (error) { console.error("[projects DELETE]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ ok: true });
}
