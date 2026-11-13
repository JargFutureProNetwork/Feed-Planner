"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PostDialog from "./PostDialog";
import { api, dateKey, type Post, STATUS_LABEL, fmtDay, fmtTime, monthKey } from "./shared";

export interface AccountInfo {
  username: string;
  picture: string | null;
  needsReconnect: boolean;
  expiresSoon: boolean;
}

type Editing = { post: Post | null; date?: string } | null;

const RECONNECT_URL = "/api/auth/meta/login";

export default function Planner({ account, aiEnabled }: { account: AccountInfo; aiEnabled: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [month, setMonth] = useState("");            // set after mount so server and browser agree
  const [view, setView] = useState<"grid" | "cal">("grid");
  const [editing, setEditing] = useState<Editing>(null);
  const [toast, setToast] = useState("");
  const [reconnect, setReconnect] = useState(account.needsReconnect);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [avatarOk, setAvatarOk] = useState(!!account.picture);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string, ms = 4500) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);

  const load = useCallback(async () => {
    try { setPosts((await api<{ posts: Post[] }>("/api/posts")).posts); }
    catch (e) { say(e instanceof Error ? e.message : "Your posts couldn't be loaded."); setPosts((p) => p ?? []); }
  }, [say]);

  useEffect(() => { setMonth(monthKey(new Date())); void load(); }, [load]);

  // Scheduled posts go out on the server, so look again now and then (faster while one is publishing).
  const publishing = !!posts?.some((p) => p.status === "publishing");
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void load(); }, publishing ? 5000 : 45000);
    return () => clearInterval(t);
  }, [load, publishing]);

  useEffect(() => { if (posts?.some((p) => p.status === "failed" && /Reconnect/.test(p.student_message || ""))) setReconnect(true); }, [posts]);

  const inMonth = useMemo(
    () => (posts || []).filter((p) => monthKey(new Date(p.scheduled_at)) === month),
    [posts, month],
  );
  const count = (s: Post["status"]) => inMonth.filter((p) => p.status === s).length;

  async function publishNow(post: Post) {
    if (armed !== post.id) { setArmed(post.id); setTimeout(() => setArmed((a) => (a === post.id ? null : a)), 4000); return; }
    setArmed(null); setBusy(post.id);
    setPosts((list) => (list || []).map((p) => (p.id === post.id ? { ...p, status: "publishing" } : p)));
    try {
      const r = await api<{ message: string }>("/api/posts/publish-now", { method: "POST", body: JSON.stringify({ id: post.id }) });
      say(r.message);
    } catch (e) { say(e instanceof Error ? e.message : "Something went wrong. Please try again.", 7000); }
    setBusy(null);
    void load();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/";
  }

  const [y, m] = month ? month.split("-").map(Number) : [0, 0];
  const monthLabel = month ? new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
  const defaultDate = () => {
    const now = new Date();
    if (monthKey(now) === month || !month) { const t = new Date(now.getTime() + 86400000); return dateKey(t); }
    return `${month}-01`;
  };
  const open = (post: Post | null, date?: string) => setEditing({ post, date: date || defaultDate() });

  const groups: [string, Post[]][] = [
    ["Scheduled", inMonth.filter((p) => p.status === "pending" || p.status === "publishing")],
    ["Needs attention", inMonth.filter((p) => p.status === "failed")],
    ["Published", inMonth.filter((p) => p.status === "published")],
  ];

  return (
    <>
      <div className="app">
        <aside className="rail" aria-label="Your posts">
          <div className="brandbox">
            <div className="logo">
              {account.picture && avatarOk
                ? <img src={account.picture} alt="" onError={() => setAvatarOk(false)} />
                : account.username.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <h1>@{account.username}</h1>
              <p>{reconnect ? "Instagram needs reconnecting" : "Instagram connected"}</p>
            </div>
          </div>

          <div className="stats">
            <div className="stat"><b>{count("pending") + count("publishing")}</b><span>Scheduled</span></div>
            <div className="stat"><b>{count("published")}</b><span>Published</span></div>
            <div className="stat"><b>{count("failed")}</b><span>To fix</span></div>
          </div>

          {posts && !inMonth.length && <p className="empty-note">Posts you plan for {monthLabel} are listed here.</p>}
          {groups.map(([label, items]) => items.length > 0 && (
            <details className="group" open key={label}>
              <summary>{label}<span className="count">{items.length}</span></summary>
              {items.map((p) => (
                <button className="row" key={p.id} onClick={() => open(p)}>
                  <span className="th"><img src={p.image_url} alt="" loading="lazy" /></span>
                  <span className="t">
                    <b>{p.caption.split("\n")[0] || "No caption"}</b>
                    <span>{fmtDay(p.scheduled_at)} · {fmtTime(p.scheduled_at)}</span>
                  </span>
                </button>
              ))}
            </details>
          ))}

          <div className="railfoot">
            {reconnect && <a className="btn" href={RECONNECT_URL}>Reconnect Instagram</a>}
            <button className="linkbtn" onClick={logout}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          <header className="bar">
            <input
              className="ctl" type="month" aria-label="Month" value={month}
              onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}
            />
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={view === "grid"} onClick={() => setView("grid")}>Feed</button>
              <button aria-pressed={view === "cal"} onClick={() => setView("cal")}>Calendar</button>
            </div>
            <span className="sp" />
            {reconnect && <a className="btn" href={RECONNECT_URL}>Reconnect</a>}
            <button className="btn primary" onClick={() => open(null)}>+ New post</button>
          </header>

          {reconnect
            ? <div className="notice" role="alert">Your Instagram connection expired, so posts can&apos;t go out. <a href={RECONNECT_URL}>Reconnect</a></div>
            : account.expiresSoon && <div className="notice">Your Instagram connection needs renewing this week. <a href={RECONNECT_URL}>Reconnect</a> now to keep scheduled posts going out.</div>}

          <main className="canvas">
            <div className="wrap">
              <div className="eyebrow">Instagram planner · @{account.username}</div>
              <div className="head"><h2>{monthLabel || " "}</h2></div>

              {!posts ? <p className="sub">Loading your posts…</p> : !inMonth.length ? (
                <>
                  <p className="sub">Nothing is planned for {monthLabel} yet. Three steps and your first post is on its way.</p>
                  <div className="steps">
                    <div className="step"><span className="k">Step 1</span><h3>Add a photo</h3><p>Choose a picture from your computer, or drag it in. We get it ready for Instagram.</p></div>
                    <div className="step"><span className="k">Step 2</span><h3>Write the caption</h3><p>Say what the post is about and add your hashtags.</p></div>
                    <div className="step"><span className="k">Step 3</span><h3>Pick a time</h3><p>Schedule it for later, or publish it right now.</p><button className="btn primary" onClick={() => open(null)}>+ New post</button></div>
                  </div>
                </>
              ) : view === "grid" ? (
                <>
                  <p className="sub">Select a post to change its photo, caption or time.</p>
                  <div className="grid">
                    {inMonth.map((p, i) => (
                      <div className="tilewrap" key={p.id}>
                        <button className="tile" aria-label={`Post ${i + 1}: ${p.caption.split("\n")[0] || "No caption"}`} onClick={() => open(p)}>
                          <span className="badge">{String(i + 1).padStart(2, "0")}</span>
                          <img src={p.image_url} alt="" loading="lazy" />
                        </button>
                        <div className="meta">
                          <b>{fmtDay(p.scheduled_at)}</b><span>{fmtTime(p.scheduled_at)}</span>
                          <span className={`pill ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                        </div>
                        {(p.status === "pending" || p.status === "failed") && (
                          <div className="cardrow">
                            {p.status === "failed" && p.student_message && <span className="why">{p.student_message}</span>}
                            <button className="btn" disabled={busy === p.id} onClick={() => publishNow(p)}>
                              {armed === p.id ? "Select again to publish" : "Publish Now"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="sub">Each post sits on its planned day. Select one to change it, or add a post to any day.</p>
                  <Calendar year={y} month={m} posts={inMonth} onOpen={(p) => open(p)} onAdd={(d) => open(null, d)} />
                </>
              )}
            </div>
          </main>
        </div>
      </div>

      {editing && (
        <PostDialog
          post={editing.post}
          defaultDate={editing.date || defaultDate()}
          aiEnabled={aiEnabled}
          onClose={() => setEditing(null)}
          onChanged={(message, keepOpen) => { if (message) say(message, 6000); if (!keepOpen) setEditing(null); void load(); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function Calendar({ year, month, posts, onOpen, onAdd }: {
  year: number; month: number; posts: Post[]; onOpen: (p: Post) => void; onAdd: (date: string) => void;
}) {
  const days = new Date(year, month, 0).getDate();
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const today = dateKey(new Date());
  return (
    <div className="cal">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div className="dow" key={d}>{d}</div>)}
      {Array.from({ length: lead }, (_, i) => <div className="day off" key={`o${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const d = i + 1;
        const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const items = posts.filter((p) => dateKey(new Date(p.scheduled_at)) === key);
        return (
          <div className="day" key={key}>
            <span className="d">{d}</span>
            {items.map((p) => (
              <button className="mini" key={p.id} title={`${fmtTime(p.scheduled_at)} · ${STATUS_LABEL[p.status]}`} aria-label={`Post at ${fmtTime(p.scheduled_at)}, ${STATUS_LABEL[p.status]}`} onClick={() => onOpen(p)}>
                <img src={p.image_url} alt="" loading="lazy" />
                <span className={`dotst ${p.status}`} />
              </button>
            ))}
            {key >= today && <button className="add" onClick={() => onAdd(key)}>+ Add</button>}
          </div>
        );
      })}
    </div>
  );
}
