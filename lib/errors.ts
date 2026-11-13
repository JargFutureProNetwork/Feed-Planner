import { MetaError } from "./meta";

export const RECONNECT_MESSAGE = "Your Instagram connection expired. Please click Reconnect, then try again.";

/** True when the only fix is for the student to connect again. */
export function needsReconnect(e: unknown): boolean {
  if (!(e instanceof MetaError)) return false;
  return e.code === 190 || e.code === 102 || [458, 459, 460, 463, 464, 467].includes(e.subcode ?? -1);
}

/** Turns any technical failure into one calm sentence a student can act on. */
export function friendlyError(e: unknown): string {
  if (e instanceof MetaError) {
    const { code, subcode } = e;
    if (e.network) return "We couldn't reach Instagram just now. Please try again in a minute.";
    if (needsReconnect(e)) return RECONNECT_MESSAGE;
    if (code === 10 || code === 3 || (code != null && code >= 200 && code <= 299))
      return "Instagram didn't give this app permission to post. Click Reconnect and approve every permission it asks for.";
    if (subcode === 2207042 || code === 4 || code === 17 || code === 32 || code === 613 || code === 80002)
      return "Instagram's daily posting limit was reached. Please try again later.";
    if (code === 36003 || subcode === 2207009)
      return "Instagram doesn't accept this photo's shape. Please upload it again or pick a different photo.";
    if (subcode === 2207004 || subcode === 2207005 || code === 36000 || code === 36001)
      return "Instagram couldn't use this photo. Please pick a different one.";
    if (code === 9004 || subcode === 2207052 || subcode === 2207003 || subcode === 2207020)
      return "Instagram couldn't load your photo. Please upload it again and retry.";
    if (code === 9007 || subcode === 2207027)
      return "Instagram is still preparing your photo. Please try again in a minute.";
    if (subcode === 2207050 || subcode === 2207051)
      return "Instagram has put a temporary restriction on this account. Open the Instagram app to check, then try again.";
    if (subcode === 2207010) return "The caption is too long for Instagram. Please shorten it.";
    if (code === 1 || code === 2 || code === -1 || subcode === 2207001)
      return "Instagram is having a temporary problem. Please try again in a few minutes.";
  }
  return "Something went wrong while posting. Please try again, and tell your teacher if it keeps happening.";
}

/** The full technical story, for the admin's eyes only. */
export function technicalError(e: unknown): string {
  if (e instanceof MetaError) return e.describe();
  if (e instanceof Error) return e.message;
  return String(e);
}
