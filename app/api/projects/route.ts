import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { GENERIC, fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Every planner project (brand, month, posts) this student has saved. */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const { data, error } = await db().from("projects").select("data").eq("user_id", auth.userId).order("updated_at", { ascending: false });
  if (error) { console.error("[projects GET]", error.message); return fail(GENERIC, 500); }
  return NextResponse.json({ projects: (data ?? []).map((row) => row.data) });
}
