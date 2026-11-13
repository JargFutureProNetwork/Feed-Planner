export interface Post {
  id: string;
  image_url: string;
  caption: string;
  scheduled_at: string;
  status: "pending" | "publishing" | "published" | "failed";
  student_message: string | null;
  published_at: string | null;
}

export const STATUS_LABEL: Record<Post["status"], string> = {
  pending: "Scheduled",
  publishing: "Publishing…",
  published: "Published",
  failed: "Needs attention",
};

const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const dateKey = (d: Date) => `${monthKey(d)}-${pad(d.getDate())}`;
export const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const fmtFull = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Calls the app's own API. Errors always carry a sentence that is fine to show a student. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new Error("You seem to be offline. Check your internet connection and try again.");
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) { window.location.href = "/"; throw new Error("Please connect your Instagram account again."); }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error || "Something went wrong. Please try again.");
  return data as T;
}

/**
 * Turns any picture the browser can open into an Instagram-ready JPEG:
 * centre-cropped to a shape Instagram accepts (between 4:5 portrait and 1.91:1 landscape)
 * and no wider than 1440px.
 */
export async function toInstagramJpeg(file: Blob): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
    } catch {
      throw new Error("That picture couldn't be opened. Photos from an iPhone may need saving as JPG first.");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
  const w = source.width, h = source.height;
  if (!w || !h) throw new Error("That picture couldn't be opened. Please choose a different one.");

  const ratio = Math.min(1.91, Math.max(0.8, w / h));
  let cw = w, ch = h;
  if (w / h > ratio) cw = Math.round(h * ratio); else ch = Math.round(w / ratio);
  const scale = Math.min(1, 1440 / cw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't prepare the photo. Please try a different browser.");
  ctx.fillStyle = "#fff";                      // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo couldn't be prepared. Please try again."))), "image/jpeg", 0.9));
}
