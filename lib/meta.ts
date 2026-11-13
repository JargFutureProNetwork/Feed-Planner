/** Thin wrapper around the official Meta Graph API. Server only. */

export const GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "v21.0").trim();
export const FACEBOOK_GRAPH = "graph.facebook.com";
/** Accounts connected with "Instagram Login" (no Facebook Page) are served by this host instead. */
export const INSTAGRAM_GRAPH = "graph.instagram.com";
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export const META_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"];

export class MetaError extends Error {
  code?: number;
  subcode?: number;
  type?: string;
  traceId?: string;
  network = false;

  constructor(message: string, extra: Partial<Pick<MetaError, "code" | "subcode" | "type" | "traceId" | "network">> = {}) {
    super(message);
    this.name = "MetaError";
    Object.assign(this, extra);
  }

  /** One line with everything the admin needs for debugging. Stored in scheduled_posts.error_message. */
  describe(): string {
    return [
      this.message,
      this.type,
      this.code != null ? `code ${this.code}` : "",
      this.subcode != null ? `subcode ${this.subcode}` : "",
      this.traceId ? `fbtrace_id ${this.traceId}` : "",
    ].filter(Boolean).join(" | ");
  }
}

type Params = Record<string, string | undefined>;

export async function graph<T>(path: string, options: { method?: "GET" | "POST"; params?: Params; token?: string; host?: string; unversioned?: boolean } = {}): Promise<T> {
  const { method = "GET", params = {}, token, host = FACEBOOK_GRAPH, unversioned = false } = options;
  const GRAPH = `https://${host}${unversioned ? "" : `/${GRAPH_VERSION}`}`;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) query.set(k, v);
  if (token) query.set("access_token", token);

  let res: Response;
  try {
    res = method === "GET"
      ? await fetch(`${GRAPH}${path}?${query}`, { cache: "no-store" })
      : await fetch(`${GRAPH}${path}`, { method, body: query, cache: "no-store" });
  } catch (e) {
    throw new MetaError(`Network error calling Meta: ${e instanceof Error ? e.message : String(e)}`, { network: true });
  }

  let data: unknown = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  let err = (data as { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } } | null)?.error;
  // api.instagram.com reports errors in its own flat shape.
  const flat = data as { error_type?: string; error_message?: string; code?: number } | null;
  if (!err && flat?.error_message) err = { message: flat.error_message, type: flat.error_type, code: flat.code };
  if (!res.ok || !data || err) {
    throw new MetaError(err?.message || `Meta answered HTTP ${res.status}`, {
      code: err?.code, subcode: err?.error_subcode, type: err?.type, traceId: err?.fbtrace_id,
    });
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MediaItem { kind: "image" | "video"; url: string }
export interface PublishJob {
  post_type: "image" | "carousel" | "reel";
  media: MediaItem[];
  caption: string;
  cover_url?: string | null;
  /** Where a previous attempt got to: "k:id,id" = carousel slides created, "c:id" = final container created. */
  state?: string | null;
}
export type StepResult = { done: true; mediaId: string } | { done: false; state: string };

async function containerReady(id: string, token: string, host: string): Promise<boolean> {
  const s = await graph<{ status_code?: string; status?: string }>(`/${id}`, { token, host, params: { fields: "status_code,status" } });
  if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
    throw new MetaError(`Media container ${s.status_code}: ${s.status || "no detail"}`, { code: 9004 });
  }
  return s.status_code === "FINISHED" || s.status_code === "PUBLISHED";
}

/**
 * Publishes an image, a carousel or a reel with the official container flow:
 *   create container(s) -> wait until Instagram has processed them -> media_publish.
 * Videos can take minutes to process, longer than one server request may run. So this works in steps:
 * it stops at `deadline`, hands back where it got to, and is called again later with that state.
 * `save` is called whenever a container has been created, so nothing is ever created twice.
 */
export async function publishStep(
  igUserId: string, token: string, host: string, job: PublishJob, deadline: number, save: (state: string) => Promise<void>,
): Promise<StepResult> {
  const create = async (params: Params) => (await graph<{ id: string }>(`/${igUserId}/media`, { method: "POST", token, host, params })).id;
  let kids: string[] = [], container = "";
  if (job.state?.startsWith("c:")) container = job.state.slice(2);
  else if (job.state?.startsWith("k:")) kids = job.state.slice(2).split(",").filter(Boolean);

  if (!container && !kids.length) {
    if (job.post_type === "carousel") {
      for (const m of job.media) {
        kids.push(await create(m.kind === "video"
          ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" }
          : { image_url: m.url, is_carousel_item: "true" }));
      }
      await save(`k:${kids.join(",")}`);
    } else {
      const m = job.media[0];
      container = await create(job.post_type === "reel"
        ? { media_type: "REELS", video_url: m.url, caption: job.caption, cover_url: job.cover_url || undefined }
        : { image_url: m.url, caption: job.caption });
      await save(`c:${container}`);
    }
  }

  if (!container) {
    for (;;) {
      let ready = true;
      for (const id of kids) if (!(await containerReady(id, token, host))) { ready = false; break; }
      if (ready) break;
      if (Date.now() + 3000 > deadline) return { done: false, state: `k:${kids.join(",")}` };
      await sleep(3000);
    }
    container = await create({ media_type: "CAROUSEL", children: kids.join(","), caption: job.caption });
    await save(`c:${container}`);
  }

  for (;;) {
    if (await containerReady(container, token, host)) break;
    if (Date.now() + 3000 > deadline) return { done: false, state: `c:${container}` };
    await sleep(3000);
  }
  const published = await graph<{ id: string }>(`/${igUserId}/media_publish`, { method: "POST", token, host, params: { creation_id: container } });
  return { done: true, mediaId: published.id };
}
