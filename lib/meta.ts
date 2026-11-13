/** Thin wrapper around the official Meta Graph API. Server only. */

export const GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "v21.0").trim();
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

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

export async function graph<T>(path: string, options: { method?: "GET" | "POST"; params?: Params; token?: string } = {}): Promise<T> {
  const { method = "GET", params = {}, token } = options;
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
  const err = (data as { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } } | null)?.error;
  if (!res.ok || !data || err) {
    throw new MetaError(err?.message || `Meta answered HTTP ${res.status}`, {
      code: err?.code, subcode: err?.error_subcode, type: err?.type, traceId: err?.fbtrace_id,
    });
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The official two-step publishing flow for one image:
 *   1. POST /{ig-user-id}/media            -> container id
 *   2. wait until the container is FINISHED
 *   3. POST /{ig-user-id}/media_publish    -> published media id
 */
export async function publishImage(igUserId: string, token: string, imageUrl: string, caption: string): Promise<string> {
  const container = await graph<{ id: string }>(`/${igUserId}/media`, {
    method: "POST", token, params: { image_url: imageUrl, caption },
  });

  for (let attempt = 0; attempt < 10; attempt++) {
    const state = await graph<{ status_code?: string; status?: string }>(`/${container.id}`, {
      token, params: { fields: "status_code,status" },
    });
    if (state.status_code === "FINISHED" || state.status_code === "PUBLISHED") break;
    if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
      throw new MetaError(`Media container ${state.status_code}: ${state.status || "no detail"}`, { code: 9004 });
    }
    await sleep(2500);
  }

  const published = await graph<{ id: string }>(`/${igUserId}/media_publish`, {
    method: "POST", token, params: { creation_id: container.id },
  });
  return published.id;
}
