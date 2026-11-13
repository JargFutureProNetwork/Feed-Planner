"use client";

import { useEffect, useRef, useState } from "react";
import { api, dateKey, fmtFull, type Post, timeKey, toInstagramJpeg } from "./shared";

interface Props {
  post: Post | null;                  // null = a new post
  defaultDate: string;                // YYYY-MM-DD
  aiEnabled: boolean;
  onClose: () => void;
  onChanged: (message?: string, keepOpen?: boolean) => void;
}

export default function PostDialog({ post, defaultDate, aiEnabled, onClose, onChanged }: Props) {
  const locked = post?.status === "published" || post?.status === "publishing";
  const [imageUrl, setImageUrl] = useState(post?.image_url || "");
  const [caption, setCaption] = useState(post?.caption || "");
  const [date, setDate] = useState(post ? dateKey(new Date(post.scheduled_at)) : defaultDate);
  const [time, setTime] = useState(post ? timeKey(new Date(post.scheduled_at)) : "09:00");
  const [direction, setDirection] = useState("");
  const [working, setWorking] = useState<"" | "upload" | "save" | "publish" | "ai" | "delete">("");
  const [problem, setProblem] = useState(post?.status === "failed" ? post.student_message || "" : "");
  const [armed, setArmed] = useState<"" | "publish" | "delete">("");
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fail = (e: unknown) => setProblem(e instanceof Error ? e.message : "Something went wrong. Please try again.");
  const arm = (what: "publish" | "delete") => { setArmed(what); setTimeout(() => setArmed((a) => (a === what ? "" : a)), 4000); };

  async function addPhoto(file: File | undefined) {
    if (!file || locked) return;
    if (!file.type.startsWith("image/")) { setProblem("Please choose a photo (JPG or PNG)."); return; }
    setProblem(""); setWorking("upload");
    try {
      const jpeg = await toInstagramJpeg(file);
      const form = new FormData();
      form.append("file", jpeg, "photo.jpg");
      setImageUrl((await api<{ image_url: string }>("/api/upload", { method: "POST", body: form })).image_url);
    } catch (e) { fail(e); }
    setWorking("");
  }

  function ready(): boolean {
    if (!imageUrl) { setProblem("Please add a photo first."); return false; }
    if (!caption.trim()) { setProblem("Please write a caption first."); return false; }
    if (caption.trim().length > 2200) { setProblem(`The caption is ${caption.trim().length} characters long. Instagram allows 2,200.`); return false; }
    return true;
  }

  async function schedule() {
    if (!ready()) return;
    const when = new Date(`${date}T${time}`);
    if (!date || !time || Number.isNaN(when.getTime())) { setProblem("Please pick a date and time."); return; }
    if (when.getTime() <= Date.now()) { setProblem("That time has already passed. Pick a later time, or use Publish Now."); return; }
    setProblem(""); setWorking("save");
    try {
      const body = JSON.stringify({ image_url: imageUrl, caption, scheduled_at: when.toISOString() });
      if (post) await api(`/api/posts/${post.id}`, { method: "PATCH", body });
      else await api("/api/posts", { method: "POST", body });
      onChanged(`Scheduled for ${fmtFull(when.toISOString())}. You can close this page; it will post by itself.`);
    } catch (e) { fail(e); setWorking(""); }
  }

  async function publishNow() {
    if (!ready()) return;
    if (armed !== "publish") { arm("publish"); return; }
    setArmed(""); setProblem(""); setWorking("publish");
    try {
      const r = await api<{ message: string }>("/api/posts/publish-now", {
        method: "POST", body: JSON.stringify({ id: post?.id, image_url: imageUrl, caption }),
      });
      onChanged(r.message);
    } catch (e) {
      fail(e); setWorking("");
      onChanged(undefined, true);      // refresh the list behind the dialog; the post is now marked as needing attention
    }
  }

  async function remove() {
    if (!post) return;
    if (armed !== "delete") { arm("delete"); return; }
    setArmed(""); setWorking("delete");
    try { await api(`/api/posts/${post.id}`, { method: "DELETE" }); onChanged("Post removed from your planner."); }
    catch (e) { fail(e); setWorking(""); }
  }

  async function writeWithAi() {
    setProblem(""); setWorking("ai");
    try {
      const r = await api<{ caption: string }>("/api/ai/caption", {
        method: "POST", body: JSON.stringify({ image_url: imageUrl || undefined, caption, direction }),
      });
      setCaption(r.caption);
    } catch (e) { fail(e); }
    setWorking("");
  }

  const title = !post ? "New post" : post.status === "published" ? "Published post" : post.status === "failed" ? "Post that needs attention" : "Scheduled post";

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="x" aria-label="Close" ref={closeBtn} onClick={onClose}>✕</button>
        </header>

        <div className="post">
          <div className="pmedia">
            <div
              className="viewer"
              onDragOver={(e) => { if (!locked) { e.preventDefault(); setOver(true); } }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void addPhoto(e.dataTransfer.files[0]); }}
            >
              {imageUrl
                ? <img src={imageUrl} alt="The photo for this post" />
                : (
                  <button className={`drop${over ? " over" : ""}`} onClick={() => picker.current?.click()} disabled={working === "upload"}>
                    <b>{working === "upload" ? "Getting your photo ready…" : "Add a photo"}</b>
                    {working !== "upload" && <span>Drag a picture here, or click to choose one from your computer.</span>}
                  </button>
                )}
            </div>
            <input
              ref={picker} type="file" accept="image/*" hidden
              onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }}
            />
            {imageUrl && !locked && (
              <button className="btn" onClick={() => picker.current?.click()} disabled={working === "upload"}>
                {working === "upload" ? "Getting your photo ready…" : "Change photo"}
              </button>
            )}
            {!locked && <p className="hint">Very tall or very wide photos are trimmed to a shape Instagram accepts.</p>}
          </div>

          <div className="pfields">
            {post?.status === "published" && <div className="okbox">Published {post.published_at ? fmtFull(post.published_at) : ""}. It is live on your Instagram profile.</div>}
            {post?.status === "publishing" && <div className="okbox">This post is being published right now.</div>}
            {problem && <div className="alert" role="alert">{problem}</div>}

            {aiEnabled && !locked && (
              <div className="ai">
                <input
                  type="text" value={direction} onChange={(e) => setDirection(e.target.value)}
                  placeholder="Optional: what is this post about?" aria-label="What is this post about?"
                />
                <button className="btn" onClick={writeWithAi} disabled={!!working}>
                  {working === "ai" ? "Writing…" : caption.trim() ? "Improve with AI" : "Write with AI"}
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor="postCaption">Caption</label>
              <textarea
                id="postCaption" value={caption} readOnly={locked} rows={8}
                placeholder="What do you want to say? Add your hashtags at the end."
                onChange={(e) => setCaption(e.target.value)}
              />
              <small className="count">{caption.trim().length} of 2,200 characters</small>
            </div>

            {!locked && (
              <div className="two">
                <div className="field">
                  <label htmlFor="postDate">Date</label>
                  <input id="postDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="postTime">Time</label>
                  <input id="postTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  <small>Your local time.</small>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer>
          {post && post.status !== "publishing" && (
            <button className="btn danger" style={{ marginRight: "auto" }} onClick={remove} disabled={!!working}>
              {armed === "delete" ? "Select again to remove" : post.status === "published" ? "Remove from planner" : "Delete post"}
            </button>
          )}
          {locked ? <button className="btn" onClick={onClose}>Close</button> : (
            <>
              <button className="btn" onClick={publishNow} disabled={!!working}>
                {working === "publish" ? "Publishing… this takes a few seconds" : armed === "publish" ? "Select again to publish" : "Publish Now"}
              </button>
              <button className="btn primary" onClick={schedule} disabled={!!working}>
                {working === "save" ? "Saving…" : post?.status === "pending" ? "Save changes" : "Schedule Post"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
