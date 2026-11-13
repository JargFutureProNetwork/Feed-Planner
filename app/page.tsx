import Script from "next/script";
import { getSessionUserId } from "@/lib/session";
import { getAccount } from "@/lib/publish";
import Login from "@/components/Login";

export const dynamic = "force-dynamic";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const STUDIO_VERSION = "4";   // change when public/studio.js changes, so browsers fetch the new file

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let error = typeof params.error === "string" ? params.error : undefined;

  // Local look-and-feel preview: `FPS_PREVIEW=1 npm run dev`. Never active on the live site.
  const preview = process.env.FPS_PREVIEW === "1" && process.env.NODE_ENV !== "production";

  let account = null;
  if (!preview) {
    try {
      const userId = await getSessionUserId();
      if (userId) account = await getAccount(userId);
    } catch (e) {
      console.error("[page]", e instanceof Error ? e.message : e);   // usually a missing environment variable
      error = error || "setup";
    }
  }

  const instagramLogin = !!(process.env.INSTAGRAM_APP_ID || "").trim();   // older Meta apps only
  const viaInstagram = instagramLogin || !!(process.env.META_LOGIN_CONFIG_ID || "").trim();
  const loginUrl = instagramLogin ? "/api/auth/instagram/login" : "/api/auth/meta/login";
  const step = typeof params.step === "string" && /^[a-z]{1,12}$/.test(params.step) ? params.step : undefined;
  if (!account && !preview) return <Login error={error} step={step} loginUrl={loginUrl} viaInstagram={viaInstagram} />;

  const expires = account?.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  const config = {
    preview,
    loginUrl,
    ai: !!(process.env.GEMINI_API_KEY || "").trim(),
    account: account ? {
      username: account.ig_username,
      picture: account.ig_profile_picture_url,
      needsReconnect: expires != null && expires <= Date.now(),
      expiresSoon: expires != null && expires > Date.now() && expires - Date.now() < WEEK,
    } : null,
  };

  // The planner itself is plain JavaScript (public/studio.js) that draws into these empty elements.
  return (
    <>
      <div className="app" id="app" suppressHydrationWarning>
        <aside className="rail" id="rail" aria-label="Posts by format" suppressHydrationWarning />
        <div className="main">
          <header className="bar" id="bar" suppressHydrationWarning />
          <div className="notice" id="notice" hidden suppressHydrationWarning />
          <main className="canvas" id="canvas" suppressHydrationWarning />
        </div>
      </div>
      <div className="scrim" id="scrim" hidden suppressHydrationWarning />
      <div className="toast" id="toast" role="status" hidden suppressHydrationWarning />
      <script dangerouslySetInnerHTML={{ __html: `window.__FPS__=${JSON.stringify(config).replace(/</g, "\\u003c")};` }} />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" strategy="afterInteractive" />
      <Script src={`/studio.js?v=${STUDIO_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
