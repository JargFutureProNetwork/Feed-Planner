import { NextResponse } from "next/server";
import { fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UNAVAILABLE = "Gemini isn't available right now. Try again in a minute; you can still write the copy yourself.";

/**
 * "Plan with Gemini" and "Write with Gemini". The planner sends its prompt and small copies of the
 * post images; this adds the secret key (GEMINI_API_KEY) on the server and returns Gemini's JSON.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return fail(UNAVAILABLE, 503);
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  const body = await request.json().catch(() => null) as { prompt?: unknown; images?: unknown } | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) return fail("That request couldn't be read. Please try again.");
  if (body.prompt.length > 40_000) return fail("There is too much text to send at once. Try planning fewer posts.");
  const images = Array.isArray(body.images) ? body.images.filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s)).slice(0, 12) : [];

  try {
    const parts: Record<string, unknown>[] = images.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } }));
    parts.push({ text: body.prompt });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null) as {
      error?: { message?: string; status?: string };
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    } | null;
    if (!res.ok || !data || data.error) throw new Error(`Gemini HTTP ${res.status}: ${data?.error?.status || ""} ${data?.error?.message || "no message"}`);

    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) {
      console.error(`[ai/plan] empty reply: block=${data.promptFeedback?.blockReason} finish=${data.candidates?.[0]?.finishReason}`);
      return fail("Gemini didn't return any copy for this. Change the photos or the brand notes and try again.", 502);
    }
    let result: unknown;
    try { result = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { return fail("Gemini's answer came back garbled. Please try again.", 502); }
    return NextResponse.json({ result });
  } catch (e) {
    console.error("[ai/plan]", e instanceof Error ? e.message : e);   // the admin sees the real reason in the server log
    return fail(UNAVAILABLE, 502);
  }
}
