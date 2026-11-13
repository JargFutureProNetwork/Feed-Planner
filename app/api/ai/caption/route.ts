import { NextResponse } from "next/server";
import { getAccount } from "@/lib/publish";
import { fail, isOwnImage, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UNAVAILABLE = "The writing helper isn't available right now. You can still write the caption yourself.";

/**
 * Writes a caption with Google Gemini. The API key stays on the server (GEMINI_API_KEY);
 * students only ever see a "Write with AI" button.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) return fail(UNAVAILABLE, 503);
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  const body = await request.json().catch(() => null) as { image_url?: unknown; caption?: unknown; direction?: unknown } | null;
  if (!body) return fail("That request couldn't be read. Please try again.");
  const current = typeof body.caption === "string" ? body.caption.slice(0, 2200) : "";
  const direction = typeof body.direction === "string" ? body.direction.slice(0, 400) : "";

  try {
    const account = await getAccount(auth.userId);
    const parts: Record<string, unknown>[] = [];

    if (isOwnImage(body.image_url, auth.userId)) {
      const img = await fetch(body.image_url, { cache: "no-store" });
      if (img.ok) parts.push({ inline_data: { mime_type: "image/jpeg", data: Buffer.from(await img.arrayBuffer()).toString("base64") } });
    }

    parts.push({
      text: `You write Instagram captions for the account @${account?.ig_username || "this account"}.
${parts.length ? "Look at the attached photo and write a caption about what it actually shows." : "No photo is attached, so work from the notes below."}
${current ? `The current draft caption is:\n"""${current}"""\nImprove it; keep its language and its facts.` : ""}
${direction ? `Direction from the account owner: ${direction}` : ""}

Rules: 40 to 110 words with natural line breaks, written like a person and not like an advert. Do not invent facts such as prices, dates, offers, names or results; where a fact is needed, write a [placeholder in square brackets]. Write in the language of the draft or the direction; if there is neither, write in English. Finish with one short line telling people what to do next.

Reply with only JSON in this shape: {"caption":"the caption text","hashtags":["8 to 12 tags, each starting with #, mixing niche and broader ones"]}`,
    });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null) as {
      error?: { message?: string; status?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    } | null;
    if (!res.ok || !data || data.error) throw new Error(`Gemini HTTP ${res.status}: ${data?.error?.status || ""} ${data?.error?.message || "no message"}`);

    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { caption?: unknown; hashtags?: unknown };
    const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
    if (!caption) throw new Error("Gemini returned no caption text");
    const tags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((t) => String(t).trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)).slice(0, 30)
      : [];
    return NextResponse.json({ caption: [caption, tags.join(" ")].filter(Boolean).join("\n\n").slice(0, 2200) });
  } catch (e) {
    console.error("[ai/caption]", e instanceof Error ? e.message : e);   // the admin sees the real reason in the server log
    return fail(UNAVAILABLE, 502);
  }
}
