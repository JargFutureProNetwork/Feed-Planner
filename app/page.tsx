import { getSessionUserId } from "@/lib/session";
import { getAccount } from "@/lib/publish";
import Login from "@/components/Login";
import Planner from "@/components/Planner";

export const dynamic = "force-dynamic";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let error = typeof params.error === "string" ? params.error : undefined;

  let account = null;
  try {
    const userId = await getSessionUserId();
    if (userId) account = await getAccount(userId);
  } catch (e) {
    console.error("[page]", e instanceof Error ? e.message : e);   // usually a missing environment variable
    error = error || "setup";
  }

  if (!account) return <Login error={error} />;

  const expires = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  return (
    <Planner
      account={{
        username: account.ig_username,
        picture: account.ig_profile_picture_url,
        needsReconnect: expires != null && expires <= Date.now(),
        expiresSoon: expires != null && expires > Date.now() && expires - Date.now() < WEEK,
      }}
      aiEnabled={!!(process.env.GEMINI_API_KEY || "").trim()}
    />
  );
}
