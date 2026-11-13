import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { STORAGE_BUCKET } from "@/lib/env";
import { GRAPH_VERSION, graph } from "@/lib/meta";
import { technicalError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Admin checkup: open /api/admin/check?key=YOUR_CRON_SECRET in a browser.
 * It tests every setting and says in plain words what is wrong. It never prints a secret.
 */

type Result = { ok: boolean | null; label: string; detail: string };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const val = (name: string) => (process.env[name] || "").trim();

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#14171c;background:#f5f6f8}
h1{font-size:22px}li{background:#fff;border:1px solid #d8dce3;border-radius:10px;padding:10px 14px;margin:8px 0;list-style:none}
ul{padding:0}.ok b{color:#17724a}.bad{border-color:#e3a19c}.bad b{color:#b3261e}.skip b{color:#5f6876}
small{display:block;color:#5f6876;overflow-wrap:anywhere}code{background:#eef0f3;padding:1px 5px;border-radius:4px}</style>
<h1>${esc(title)}</h1>${body}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const secret = val("CRON_SECRET");
  if (!secret) return page("Checkup", "<p><b>CRON_SECRET is not set in Vercel.</b> Add it under Settings &gt; Environment Variables, redeploy, then open this page again with <code>?key=</code> followed by that value.</p>", 503);
  const given = request.nextUrl.searchParams.get("key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return page("Checkup", "<p>Add your CRON_SECRET to the address, like this: <code>/api/admin/check?key=YOUR_CRON_SECRET</code></p>", 401);
  }

  const results: Result[] = [];
  const add = (ok: boolean | null, label: string, detail = "") => results.push({ ok, label, detail });

  // 1. Are the settings there at all?
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "META_APP_ID", "META_APP_SECRET", "NEXT_PUBLIC_APP_URL"]) {
    add(!!val(name), `${name} is set`, val(name) ? "" : "Missing. Add it in Vercel > Settings > Environment Variables (Production), then redeploy.");
  }

  // 2. App address
  const appUrl = val("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
  if (appUrl) {
    const here = request.nextUrl.origin;
    add(/^https?:\/\/[^/]+$/.test(appUrl), "NEXT_PUBLIC_APP_URL looks like an address", /^https?:\/\/[^/]+$/.test(appUrl) ? appUrl : `It is "${appUrl}". It must look like https://your-app.vercel.app with nothing after the domain.`);
    add(appUrl === here, "NEXT_PUBLIC_APP_URL matches the address you are using", appUrl === here ? "" : `The setting says ${appUrl} but you opened ${here}. Students must use ${appUrl}, or change the setting to ${here} and redeploy.`);
    add(null, "Redirect URI that must be listed in Meta (Facebook Login for Business > Settings > Valid OAuth Redirect URIs)", `${appUrl}/api/auth/meta/callback`);
  }

  // 3. Supabase
  const sbUrl = val("NEXT_PUBLIC_SUPABASE_URL"), sbKey = val("SUPABASE_SERVICE_ROLE_KEY");
  if (sbUrl && sbKey) {
    add(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(sbUrl), "NEXT_PUBLIC_SUPABASE_URL looks like a Supabase project address", /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(sbUrl) ? "" : `It is "${sbUrl}". It should look like https://abcdefgh.supabase.co with nothing after it.`);

    let role = "";
    if (sbKey.startsWith("eyJ")) { try { role = JSON.parse(Buffer.from(sbKey.split(".")[1], "base64url").toString()).role || ""; } catch { role = "unreadable"; } }
    else if (sbKey.startsWith("sb_secret_")) role = "service_role";
    else if (sbKey.startsWith("sb_publishable_")) role = "anon";
    add(role === "service_role", "SUPABASE_SERVICE_ROLE_KEY is the secret (service_role) key",
      role === "service_role" ? "" : role === "anon"
        ? "This is the PUBLIC key (anon / publishable). Use the secret one: Supabase > Project Settings > API Keys > 'service_role' (or the key starting with sb_secret_)."
        : "This doesn't look like a Supabase key. Copy the 'service_role' secret again, with no spaces or quotes.");

    try {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false } });
      for (const table of ["instagram_accounts", "scheduled_posts"]) {
        const { error } = await sb.from(table).select("id", { count: "exact", head: true });
        add(!error, `Table ${table} exists`, error ? `${error.message || "Could not reach the table"}. Run supabase/schema.sql in the Supabase SQL Editor.` : "");
      }
      const { error: colError } = await sb.from("instagram_accounts").select("user_id,fb_user_id,ig_user_id,ig_username,ig_profile_picture_url,access_token,token_expires_at").limit(1);
      add(!colError, "Table instagram_accounts has every column the app needs", colError ? `${colError.message}. Run the full supabase/schema.sql again.` : "");
      const { data: bucket, error: bucketError } = await sb.storage.getBucket(STORAGE_BUCKET);
      add(!bucketError && !!bucket?.public, `Storage bucket "${STORAGE_BUCKET}" exists and is public`,
        bucketError ? `${bucketError.message}. Create a bucket named exactly ${STORAGE_BUCKET} and make it public (or run schema.sql again). This error also appears when the key is not the service_role key.`
          : bucket?.public ? "" : "The bucket exists but is private. Edit it in Supabase > Storage and switch 'Public bucket' on.");
    } catch (e) {
      add(false, "Supabase can be reached", technicalError(e));
    }
  }

  // 4. Meta app
  if (val("META_APP_ID") && val("META_APP_SECRET")) {
    add(/^\d+$/.test(val("META_APP_ID")), "META_APP_ID is a number", /^\d+$/.test(val("META_APP_ID")) ? "" : "It should contain digits only (App settings > Basic > App ID).");
    try {
      await graph<{ access_token: string }>("/oauth/access_token", {
        params: { client_id: val("META_APP_ID"), client_secret: val("META_APP_SECRET"), grant_type: "client_credentials" },
      });
      add(true, "Meta accepts the App ID and App secret", `Graph API ${GRAPH_VERSION}`);
    } catch (e) {
      add(false, "Meta accepts the App ID and App secret", `${technicalError(e)}. Copy both again from Meta > App settings > Basic (click Show for the secret), with no spaces.`);
    }
    add(null, "Sign-in mode", val("META_LOGIN_CONFIG_ID") ? "Using a Facebook Login for Business configuration (META_LOGIN_CONFIG_ID is set). The configuration must be of type 'User access token' and include all four permissions." : "Asking for permissions by name (no META_LOGIN_CONFIG_ID).");
  }

  // 5. Optional AI helper
  if (val("GEMINI_API_KEY")) {
    const model = val("GEMINI_MODEL") || "gemini-2.5-flash";
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": val("GEMINI_API_KEY") }, cache: "no-store" });
      const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      add(res.ok, `Gemini accepts the key and the model "${model}"`, res.ok ? "" : data?.error?.message || `HTTP ${res.status}`);
    } catch (e) { add(false, "Gemini can be reached", technicalError(e)); }
  } else add(null, "AI caption helper", "Off (GEMINI_API_KEY is not set). The 'Write with AI' button stays hidden.");

  const bad = results.filter((r) => r.ok === false).length;
  const list = results.map((r) =>
    `<li class="${r.ok === false ? "bad" : r.ok ? "ok" : "skip"}"><b>${r.ok === false ? "✗ Problem" : r.ok ? "✓ OK" : "ℹ Info"}</b> · ${esc(r.label)}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</li>`).join("");
  return page(
    bad ? `Checkup: ${bad} thing${bad === 1 ? "" : "s"} to fix` : "Checkup: all settings look right",
    `<ul>${list}</ul><p><small>After changing a setting in Vercel you must redeploy for it to take effect. If everything here is OK but sign-in still fails, note the "Help code" shown on the sign-in screen and check Vercel > Logs for a line starting with [auth/callback].</small></p>`,
  );
}
