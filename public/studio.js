/* Feed Preview Studio planner. Plain JavaScript that draws the whole planner into the page. */
"use strict";
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") { for (const s in v) s.startsWith("--") ? e.style.setProperty(s, v[s]) : (e.style[s] = v[s]); }
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (["value", "checked", "disabled", "selected", "hidden", "open", "muted", "controls", "playsInline", "draggable", "src", "type", "multiple", "accept"].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = (o) => JSON.parse(JSON.stringify(o));
const ICON = {
  reel: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.4-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2z"/></svg>',
  carousel: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4.5" width="9" height="9" rx="1.5"/><path d="M5 2.5h7.5A1.5 1.5 0 0 1 14 4v7.5"/></svg>',
  image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.8"/><path d="m3 11 3-3 2.5 2.5L10.5 8l2.8 3"/></svg>',
  spark: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.4 6.6 8.8 2 7.4 6.6 6z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3v10M3 8h10"/></svg>'
};
const icon = (n) => h("span", { html: ICON[n], style: { display: "inline-grid" }, "aria-hidden": "true" });
const TYPE = { reel: "Reel", carousel: "Carousel", image: "Image" };
const TYPES = { reel: "Reels", carousel: "Carousels", image: "Images" };
const FONTS = {
  editorial: { label: "Editorial serif", d: "'Fraunces',Georgia,serif" },
  classic: { label: "Classic serif", d: "'Playfair Display',Georgia,serif" },
  soft: { label: "Soft serif", d: "'DM Serif Display',Georgia,serif" },
  modern: { label: "Modern sans", d: "'Sora','Figtree',sans-serif" },
  bold: { label: "Bold display", d: "'Archivo Black',Impact,sans-serif" },
  hand: { label: "Handwritten", d: "'Caveat',cursive" }
};
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return 0.5;
  const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
const onColor = (hex) => lum(hex) > 0.42 ? "#14171c" : "#ffffff";
function toast(msg, ms = 2800) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => (t.hidden = true), ms);
}
const hideToast = () => { clearTimeout(toast.t); $("#toast").hidden = true; };

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
function nextMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
const ym = (p) => p.month.split("-").map(Number);
const monthLabel = (p) => { const [y, m] = ym(p); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
const dOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDate = (iso) => iso ? dOf(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }) : "No date";
const longDate = (iso) => iso ? dOf(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date";
function slots(p, n) {
  const [y, m] = ym(p), days = new Date(y, m, 0).getDate(), all = [];
  for (let d = 1; d <= days; d++) all.push({ iso: `${y}-${pad(m)}-${pad(d)}`, wd: new Date(y, m - 1, d).getDay() });
  const pref = all.filter(x => (p.days || []).includes(x.wd));
  const pool = pref.length >= n ? pref : all, out = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.min(pool.length - 1, Math.floor(i * pool.length / n))].iso);
  return out;
}
function respace(p) { const s = slots(p, p.posts.length); p.posts.forEach((x, i) => (x.date = s[i])); }
function sortByDate(p) { p.posts = p.posts.map((x, i) => [x, i]).sort((a, b) => (a[0].date || "9").localeCompare(b[0].date || "9") || a[1] - b[1]).map(a => a[0]); }

/* ---------- state ---------- */
const S = { projects: {}, cur: null, view: "grid", group: "type", profile: false, loading: true, readonly: false };
const cap = { db: null, assets: null, sample: null, img: null, downloads: null };
const local = new Map();   // media key -> object URL (this session)
const thumbs = new Map();  // media key -> Blob sent to Claude
const cur = () => S.projects[S.cur];
const FPS = window.__FPS__ || {};   // filled in by the server: the connected account and what is switched on
function newProject(base) {
  return Object.assign({
    id: uid(), name: "", handle: "", about: "", audience: "", voice: "", pillars: [], cta: "", lang: "English",
    colors: ["#1f2a44", "#f1e9dc", "#c8873a"], font: "editorial", logo: null, refs: [],
    month: nextMonth(), days: [1, 3, 5], platform: "ig", posts: [], updatedAt: Date.now()
  }, base || {});
}
function newPost(o) { return Object.assign({ id: uid(), type: "image", media: [], title: "", caption: "", cta: "", hashtags: "", pillar: "", note: "", script: "", overlay: false, date: "", time: "09:00", igUrl: "", ig: null, ph: 0 }, o || {}); }
const hasCopy = (x) => !!(x.caption && x.caption.trim());
function autoType(x) { if (x.media.length > 1) x.type = "carousel"; else if (x.media.length === 1) x.type = x.media[0].kind === "video" ? "reel" : "image"; }

function exampleProject() {
  const p = newProject({
    id: "example", example: true, name: "Oak & Ember Coffee", handle: "@oakandember", lang: "English",
    about: "Small-batch coffee roaster with a 14-seat café. Roasts twice a week, sells beans by the bag and by subscription.",
    audience: "Neighbours and remote workers within walking distance, plus home brewers who order beans online.",
    voice: "Warm, plain-spoken, a little dry. Talks like the person behind the bar, never like an advert.",
    pillars: ["Roast days", "Behind the bar", "Brew at home", "Regulars"], cta: "Order beans at the link in bio",
    colors: ["#23302b", "#efe6d6", "#c8742f"], font: "editorial"
  });
  const P = (type, pillar, title, caption, cta, hashtags, note, script) => p.posts.push(newPost({ type, pillar, title, caption, cta, hashtags, note, script: script || "" }));
  P("reel", "Roast days", "Tuesday is roast day", "The roaster goes on at 6:40. By 7 the whole street smells like toast and brown sugar.\n\nThis week it's the Huila washed lot: 11 kg, dropped at first crack plus ninety seconds. It rests until Thursday, then it's on the bar.", "Bags go on sale Thursday at 8. Link in bio.", "#roastday #smallbatchcoffee #specialtycoffee #coffeeroaster #huila #freshroasted #localcoffee #behindtheroast", "15–20s vertical. Open on beans hitting the cooling tray, no talking for the first 2s. Cover frame: the tray from above with the title in the brand serif.", "Hook: beans pouring into the cooling tray, sound up.\nBody: three cuts — charge, first crack, drop — with the times as on-screen text.\nClose: sealed bags on the counter, 'On the bar Thursday'.");
  P("carousel", "Brew at home", "Your grinder is doing more than your beans", "Most flat-tasting cups we get asked about come down to grind, not coffee. Five slides on what to change first, with the settings we use on the bar.", "Save this for your next bag.", "#brewathome #coffeegrind #pourover #v60 #homebarista #coffeetips #specialtycoffee #aeropress", "5 slides. Slide 1 is this cover card; slides 2–5 use close-up photos of grounds on the cream background with one line of text each.", "Slide 1: Your grinder is doing more than your beans\nSlide 2: Too sour? Go finer, one step at a time\nSlide 3: Too bitter? Go coarser before you change anything else\nSlide 4: Our bar settings: V60 medium-fine, AeroPress medium\nSlide 5: Still stuck? Bring your bag in and we'll dial it with you");
  P("image", "Regulars", "Fourteen seats, about forty regulars", "Marta has had the window seat most mornings since we opened. Flat white, then a filter if the meeting runs long.\n\nWe're a small room. It works because people share tables.", "Tag who you'd share a table with.", "#regulars #neighbourhoodcafe #coffeeshop #localbusiness #flatwhite #cafelife #community #smallbusiness", "Single photo, window light, subject off-centre. Keep the brand overlay off if the photo is strong on its own.");
  P("reel", "Behind the bar", "How we dial in every morning", "Before the doors open we pull three shots and throw away at least two. Here's what we're tasting for and why yesterday's recipe rarely survives.", "Come in before 9 and ask what today's recipe is.", "#dialingin #espresso #barista #behindthebar #specialtycoffee #coffeeshop #morningroutine #espressoshot", "20s. Tight shots on the scale and the cup. Subtitles in white, title card in dark green.", "Hook: 'We bin the first two shots every day.'\nBody: weigh in, time, taste, adjust grind.\nClose: the first shot we'd serve, and the numbers.");
  P("image", "Roast days", "New on the shelf: Huila washed", "Brown sugar, red apple, a clean finish. Good as filter, better than you'd expect as espresso.\n\n250 g bags, roasted Tuesday.", "Order beans at the link in bio.", "#newcoffee #huila #colombiancoffee #singleorigin #freshroasted #coffeebeans #specialtycoffee #coffeesubscription", "Product shot of the bag on the cream background. Tasting notes as three short lines in the accent colour.");
  P("carousel", "Brew at home", "A V60 recipe that forgives you", "This is the recipe we give people who say pour-over is fussy. Fifteen grams, one kettle, three pours, done in three minutes.", "Screenshot slide 4 and try it this weekend.", "#v60 #pourover #coffeerecipe #brewathome #homebarista #filtercoffee #brewguide #specialtycoffee", "4 slides, numbered steps, dark green cards alternating with photos.", "Slide 1: A V60 recipe that forgives you\nSlide 2: 15 g coffee, 250 g water, just off the boil\nSlide 3: Pour 50 g, wait 30s. Then 100 g. Then 100 g.\nSlide 4: Done by 3:00. Slower? Grind coarser.");
  P("image", "Behind the bar", "We close on Mondays. Here's why.", "Monday is when the machine gets stripped, the grinders get new burrs when they need them, and the two of us get a day that isn't 5 a.m.\n\nBack Tuesday, with the roaster on.", "See you Tuesday from 7.", "#smallbusiness #closedmondays #coffeeshop #behindthescenes #cafeowner #localcoffee #honestbusiness #neighbourhoodcafe", "Text card in the accent colour. No photo needed; it breaks up the grid.");
  P("reel", "Regulars", "We asked regulars for their order", "Six people, six orders, one person who claims the batch brew is the best thing we make. He's not wrong.", "What's yours? Tell us below.", "#regulars #coffeeorder #coffeeshop #community #batchbrew #flatwhite #localcafe #coffeelovers", "25s, quick cuts, each person's order as on-screen text in the brand serif.", "Hook: 'What do you always order?'\nBody: six answers, two seconds each.\nClose: the batch brew, poured.");
  P("carousel", "Roast days", "What 'roasted on' really tells you", "The date on the bag isn't a best-before. Coffee needs a few days to settle and has a window where it tastes its best. Here's how to read ours.", "Check the date on your bag and tell us where you are in the window.", "#coffeefreshness #roastdate #coffeeeducation #specialtycoffee #coffeetips #freshroasted #coffeebeans #homebarista", "5 slides with a simple timeline graphic across them.", "Slide 1: What 'roasted on' really tells you\nSlide 2: Days 1–4: resting. Drinkable, a bit sharp.\nSlide 3: Days 5–21: the good window.\nSlide 4: After a month: fine, just quieter.\nSlide 5: Store it sealed, cool and out of the light.");
  P("image", "Brew at home", "Subscriptions, explained in one picture", "A bag every two weeks, roasted the Tuesday before it ships. You pick filter or espresso; we pick the lot. Pause any time.", "Start a subscription at the link in bio.", "#coffeesubscription #freshcoffee #coffeedelivery #specialtycoffee #coffeebeans #brewathome #smallbatch #localroaster", "Flat lay of two bags and a calendar page. Brand overlay on, title only.");
  P("reel", "Behind the bar", "Latte art, honestly", "Half our hearts look like onions before 8 a.m. Here are the pours that didn't make the feed.", "Send this to someone who's learning.", "#latteart #barista #coffeefails #behindthebar #flatwhite #coffeeshop #baristalife #milksteaming", "15s blooper cut. Keep it light; end on one good pour.", "Hook: 'Not every pour is a rosetta.'\nBody: five misses.\nClose: one clean heart.");
  P("image", "Regulars", "Thank you for a good month", "Roughly 2,100 cups, 180 bags and one very patient espresso machine. Thanks for coming in.", "Same time next month.", "#thankyou #smallbusiness #coffeeshop #community #monthinreview #localcoffee #neighbourhoodcafe #coffeeroaster", "Closing card in dark green with three numbers in the accent colour.");
  respace(p);
  return p;
}

/* ---------- media ---------- */
const mediaSrc = (m) => m ? (local.get(m.k) || (m.a || null)) : null;
const frameSrc = (m) => m ? (local.get(m.k + ":p") || (m.p || null)) : null;
const posterSrc = (m) => m ? ((m.cm && m.c && mediaSrc(m.c)) || frameSrc(m)) : null;
const seekTo = (v, t) => new Promise((r) => { let fin = false; const done = () => { if (fin) return; fin = true; v.removeEventListener("seeked", done); r(); }; v.addEventListener("seeked", done); try { v.currentTime = t; } catch (e) {} setTimeout(done, 2500); });
async function bitmap(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch (e) {
    const url = URL.createObjectURL(blob);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
}
async function scaled(src, max, type = "image/jpeg", q = 0.86) {
  const w0 = src.videoWidth || src.naturalWidth || src.width, h0 = src.videoHeight || src.naturalHeight || src.height;
  if (!w0 || !h0) throw new Error("unreadable");
  const s = Math.min(1, max / Math.max(w0, h0)), c = document.createElement("canvas");
  c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), type, q));
}
function videoFrame(url) {
  return new Promise((res, rej) => {
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const to = setTimeout(() => rej(new Error("timeout")), 9000);
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.8, (v.duration || 1) / 2); } catch (e) { rej(e); } };
    v.onseeked = () => scaled(v, 1080).then(b => { clearTimeout(to); res(b); }, e => { clearTimeout(to); rej(e); });
    v.onerror = () => { clearTimeout(to); rej(new Error("video")); };
  });
}
async function store(blob, type) {
  if (!cap.assets) return null;
  try { return (await cap.assets.upload(blob, type ? { type } : undefined)).id; }
  catch (e) { if (e && e.code === "quota_or_state") toast("Storage for this artifact is full. New media stays in this session only.", 5000); return null; }
}
const MAXV = 50 * 1024 * 1024;
async function ingest(file) {
  const k = uid();
  if (file.type.startsWith("video/")) {
    const url = URL.createObjectURL(file); local.set(k, url);
    const m = { k, kind: "video", a: null, p: null, name: file.name };
    try { const fr = await videoFrame(url); local.set(k + ":p", URL.createObjectURL(fr)); thumbs.set(k, fr); m.p = await store(fr, "image/jpeg"); } catch (e) {}
    if (file.size <= MAXV && (file.type === "video/mp4" || file.type === "video/quicktime")) m.a = await store(file);
    if (!m.a) m.big = true;
    return m;
  }
  const bmp = await bitmap(file);
  const blob = await scaled(bmp, 1600);
  local.set(k, URL.createObjectURL(blob));
  return { k, kind: "image", a: await store(blob, "image/jpeg"), name: file.name };
}
async function thumbFor(m) {
  if (!m) return null;
  if (thumbs.has(m.k)) return thumbs.get(m.k);
  const src = m.kind === "video" ? posterSrc(m) : mediaSrc(m);
  if (!src) return null;
  try { const img = new Image(); img.crossOrigin = "anonymous"; img.src = src; await img.decode(); const b = await scaled(img, 1024, "image/jpeg", 0.8); thumbs.set(m.k, b); return b; }
  catch (e) { return null; }
}
function pickFiles({ multiple = true, accept = "image/*,video/*" }, cb) {
  const i = h("input", { type: "file", multiple, accept, id: "picker-" + uid(), style: { display: "none" } });
  i.addEventListener("change", () => { const f = [...i.files]; i.remove(); if (f.length) cb(f); });
  document.body.append(i); i.click();
}
async function addFiles(files, mode) {
  const p = cur(); if (!p) return;
  if (p.example) { toast("Create your own project first, then add media to it."); return; }
  files = files.filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
  if (!files.length) { toast("Those files aren't photos or videos."); return; }
  const made = []; let failed = 0, local_only = 0;
  for (let i = 0; i < files.length; i++) {
    toast(`Reading ${i + 1} of ${files.length}: ${files[i].name}`, 0);
    try { const m = await ingest(files[i]); if (m.big || !m.a) local_only += m.kind === "video" ? 1 : 0; made.push(m); } catch (e) { failed++; }
  }
  hideToast();
  if (!made.length) { toast("Couldn't read those files. Phone HEIC photos need exporting as JPG first.", 5000); return; }
  if (mode === "carousel") { const x = newPost({ media: made }); autoType(x); p.posts.push(x); }
  else if (mode && mode.post) { mode.post.media.push(...made); autoType(mode.post); }
  else for (const m of made) { const x = newPost({ media: [m] }); autoType(x); p.posts.push(x); }
  if (!(mode && mode.post)) respace(p);
  touch(p); render();
  let msg = mode && mode.post ? `${made.length} slide${made.length > 1 ? "s" : ""} added.` : mode === "carousel" ? `Carousel with ${made.length} slides added.` : `${made.length} post${made.length > 1 ? "s" : ""} added.`;
  if (failed) msg += ` ${failed} file${failed > 1 ? "s" : ""} couldn't be read.`;
  if (local_only) msg += ` ${local_only} video${local_only > 1 ? "s are" : " is"} over 50 MB or not MP4/MOV, so only the cover frame is saved and it can't be published.`;
  const vids = made.filter(m => m.kind === "video").length;
  if (vids && !(mode && mode.post)) msg += made.length === 1 ? " Choose its cover under the player." : " Open each video to choose its cover.";
  toast(msg, 5200);
  if (mode && mode.post) return made;
  if (vids && made.length === 1) { const np = p.posts.find(q => q.media[0] === made[0]); if (np) openPost(np.id); }
}

/* ---------- persistence ---------- */
const dirty = new Set(); let saveT = 0, flushing = false, saveState = "";
function touch(p) { if (!p || p.example) return; p.updatedAt = Date.now(); dirty.add(p.id); setSave(cap.db ? "Saving…" : ""); clearTimeout(saveT); saveT = setTimeout(flush, 900); }
function setSave(s) { saveState = s; const e = $("#saveState"); if (e) e.textContent = s; }
const LS_PROJECTS = "fps:projects";
function saveLocal() {
  try { localStorage.setItem(LS_PROJECTS, JSON.stringify(Object.values(S.projects).filter(p => !p.example))); setSave("Saved in this browser"); }
  catch (e) { setSave("Not saved: this browser blocked storage."); }
}
function loadLocal() {
  S.local = true;
  try { for (const p of JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]")) if (p && p.id && !S.projects[p.id]) S.projects[p.id] = normalize(p); } catch (e) {}
}
async function flush() {
  if (S.local) { dirty.clear(); saveLocal(); return; }
  if (!cap.db || flushing || S.readonly) return;
  flushing = true;
  try {
    for (const id of [...dirty]) {
      dirty.delete(id); const p = S.projects[id]; if (!p || p.example) continue;
      try { await cap.db.doc("projects/" + id).set(clone(p)); setSave("Saved"); }
      catch (e) {
        if (e && e.code === "invalid_argument") { S.readonly = true; setSave("View only"); renderNotice(); }
        else { dirty.add(id); setSave("Not saved. It will retry on your next change."); }
        break;
      }
    }
  } finally { flushing = false; }
  if (dirty.size && !S.readonly && saveState === "Saving…") saveT = setTimeout(flush, 900);
}
function remember() { try { localStorage.setItem("fps:last", S.cur); } catch (e) {} }
function normalize(p) {
  const d = newProject({}); for (const k in d) if (p[k] == null) p[k] = d[k];
  p.posts = (p.posts || []).map(x => Object.assign(newPost({}), x, { media: x.media || [] }));
  return p;
}
/* ---------- server connections ---------- */
async function apiCall(url, opts) {
  let res, data = null;
  const json = opts && typeof opts.body === "string";
  try { res = await fetch(url, Object.assign({}, opts, { headers: Object.assign(json ? { "Content-Type": "application/json" } : {}, opts && opts.headers) })); }
  catch (e) { if (e && e.name === "AbortError") throw Object.assign(new Error("cancelled"), { code: "cancelled" }); throw new Error("You seem to be offline. Check your internet connection and try again."); }
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { location.href = "/"; throw new Error("Please connect your Instagram account again."); }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || "Something went wrong. Please try again."), { data });
  return data;
}
const SMALL_UPLOAD = 3.8 * 1024 * 1024;   // small files go through the app's server; big ones (videos) go straight to storage
async function uploadBlob(blob, type) {
  type = type || blob.type || "application/octet-stream";
  if (blob.size <= SMALL_UPLOAD) {
    const f = new FormData(); f.append("file", blob, "upload"); f.append("type", type);
    return (await apiCall("/api/upload", { method: "POST", body: f })).url;
  }
  const s = await apiCall("/api/upload/sign", { method: "POST", body: JSON.stringify({ type, size: blob.size }) });
  const put = await fetch(s.upload_url, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "false" }, body: blob }).catch(() => null);
  if (!put || !put.ok) throw new Error("The file couldn't be uploaded. Please try again.");
  return s.public_url;
}
const serverAssets = {
  async upload(blob, o) { return { id: await uploadBlob(blob, o && o.type) }; },
  async delete(url) { if (/^https?:/.test(url || "")) await apiCall("/api/upload", { method: "DELETE", body: JSON.stringify({ url }) }).catch(() => {}); }
};
const serverDb = {
  collection: () => ({ get: async () => ({ docs: (await apiCall("/api/projects")).projects.map((d) => ({ data: () => d })) }) }),
  doc: (path) => { const url = "/api/projects/" + encodeURIComponent(path.split("/")[1]);
    return { set: (obj) => apiCall(url, { method: "PUT", body: JSON.stringify(obj) }), delete: () => apiCall(url, { method: "DELETE" }) }; }
};
const browserDownloads = {
  async save({ filename, data }) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = h("a", { href: url, download: filename, style: { display: "none" } }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
};
const blobB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("An image couldn't be read.")); r.readAsDataURL(b); });
/* Planning and copywriting run on the server with Google Gemini; the key never reaches the browser. */
const serverAI = {
  async json(prompt, { signal, images } = {}) {
    const imgs = []; for (const b of images || []) imgs.push(await blobB64(b));
    try { return (await apiCall("/api/ai/plan", { method: "POST", signal, body: JSON.stringify({ prompt, images: imgs }) })).result; }
    catch (e) { if (e.code === "cancelled") throw e; throw Object.assign(new Error(e.message), { gemini: true }); }
  }
};
const previewAI = { async json() { throw Object.assign(new Error("This is the preview: Gemini writes the copy on the live site."), { gemini: true }); } };
const AI = () => "Gemini";

async function boot() {
  cap.downloads = browserDownloads;
  if (FPS.preview || !FPS.account) { cap.sample = previewAI; cap.img = { maxCount: 10 }; loadLocal(); firstProject(); S.loading = false; render(); return; }
  cap.assets = serverAssets; cap.db = serverDb;
  if (FPS.ai) { cap.sample = serverAI; cap.img = { maxCount: 10 }; }
  try {
    const snap = await cap.db.collection("projects").get();
    for (const d of snap.docs) { const p = d.data(); if (p && p.id && !S.projects[p.id]) S.projects[p.id] = normalize(clone(p)); }
  } catch (e) { toast("Your saved projects couldn't be loaded. Reload the page to try again.", 6000); }
  firstProject();
  S.loading = false; render();
  igSync(); setInterval(igSync, 20000);
}

/* Opens the planner the person used last. Someone with no project yet gets an empty one for this month, named after their account. */
function firstProject() {
  const all = Object.values(S.projects);
  if (all.length) {
    let last = null; try { last = localStorage.getItem("fps:last"); } catch (e) {}
    S.cur = S.projects[last] ? last : all.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    return;
  }
  const d = new Date(), a = FPS.account;
  const p = newProject({ name: a ? a.username : "My brand", handle: a ? "@" + a.username : "", month: d.getFullYear() + "-" + pad(d.getMonth() + 1) });
  S.projects[p.id] = p; S.cur = p.id;
}

/* The connected Instagram account, shown at the foot of the rail. */
function accountBox() {
  const a = FPS.account;
  if (!a) return h("div", { class: "acct" }, h("div", { class: "logo" }, "P"), h("div", { class: "t" }, h("b", null, "Preview"), h("span", null, "Not connected to Instagram")));
  const pic = h("div", { class: "logo" }, a.username.charAt(0).toUpperCase());
  if (a.picture) pic.replaceChildren(h("img", { src: a.picture, alt: "", onerror: () => pic.replaceChildren(a.username.charAt(0).toUpperCase()) }));
  return h("div", { class: "acct" }, pic,
    h("div", { class: "t" }, h("b", null, "@" + a.username), h("span", null, a.needsReconnect ? "Instagram needs reconnecting" : "Instagram connected")));
}
function accountFoot() {
  const a = FPS.account;
  if (!a) return h("div", { class: "railfoot" });
  return h("div", { class: "railfoot" },
    a.needsReconnect || a.expiresSoon ? h("a", { class: "btn", href: FPS.loginUrl }, "Reconnect Instagram") : null,
    h("button", { class: "linkbtn", onclick: async () => { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/"; } }, "Sign out"));
}

/* ---------- covers ---------- */
function brandVars(p) {
  const [a, b, c] = p.colors;
  return { "--b1": a, "--b2": b, "--b3": c, "--on1": onColor(a), "--on2": onColor(b), "--on3": onColor(c), "--bd": (FONTS[p.font] || FONTS.editorial).d };
}
function cover(p, x, i, o = {}) {
  const slide = o.slide || 0, m = x.media[slide], c = h("div", { class: "cover" });
  if (!m) {
    c.append(h("div", { class: "card v" + (i % 3) },
      x.pillar && h("div", { class: "pl" }, x.pillar),
      h("div", { class: "tt" }, x.title || "Untitled post"),
      p.handle && h("div", { class: "hd" }, p.handle)));
    return c;
  }
  const src = mediaSrc(m), ps = posterSrc(m);
  const miss =() => h("div", { class: "missing" }, m.kind === "video" ? "Video isn't stored here. Add it again to preview." : "Image isn't available in this view.");
  if (m.kind === "video" && o.big && src) c.append(h("video", { crossorigin: "anonymous", src, controls: true, playsInline: true, poster: ps || undefined, preload: "metadata" }));
  else if (m.kind === "video") {
    if (ps) c.append(h("img", { src: ps, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(miss()) }));
    else if (src) c.append(h("video", { src: src + "#t=0.5", muted: true, playsInline: true, preload: "metadata" }));
    else c.append(miss());
  } else if (src) c.append(h("img", { src, alt: x.title || "", loading: "lazy", onerror: (e) => e.target.replaceWith(miss()) }));
  else c.append(miss());
  if (x.overlay && slide === 0 && x.title && !(m.kind === "video" && o.big && o.playing))
    c.append(h("div", { class: "ov" }, x.pillar && h("div", { class: "pl" }, x.pillar), h("div", { class: "tt" }, x.title)));
  return c;
}

/* ---------- render ---------- */
const isTT = (p) => p.platform === "tt";
const platName = (p) => isTT(p) ? "TikTok" : "Instagram";
function render() { const p = cur(); if (!p) return;
  Object.assign(TYPE, isTT(p) ? { reel: "Video", carousel: "Photo carousel", image: "Photo" } : { reel: "Reel", carousel: "Carousel", image: "Image" });
  Object.assign(TYPES, isTT(p) ? { reel: "Videos", carousel: "Carousels", image: "Photos" } : { reel: "Reels", carousel: "Carousels", image: "Images" });
  document.body.dataset.platform = p.platform || "ig";
  const v = brandVars(p); for (const k in v) document.documentElement.style.setProperty(k, v[k]); renderRail(); renderBar(); renderNotice(); renderCanvas(); }
const ordered = (p) => p.posts;
const numOf = (p, x) => p.posts.indexOf(x) + 1;

function renderRail() {
  const p = cur(), rail = $("#rail"); rail.replaceChildren();
  const logoSrc = mediaSrc(p.logo);
  rail.append(accountBox());
  rail.append(h("div", { class: "brandbox sub" },
    h("div", { class: "logo" }, logoSrc ? h("img", { src: logoSrc, alt: "" }) : (p.name || "?").trim().charAt(0).toUpperCase()),
    h("div", { style: { minWidth: 0 } }, h("h1", null, p.name || "Untitled brand"), h("p", null, [p.handle, monthLabel(p)].filter(Boolean).join(" · ")),
      h("div", { class: "swatches" }, p.colors.map(c => h("i", { style: { background: c }, title: c }))))));
  const n = (t) => p.posts.filter(x => x.type === t).length;
  const st = (list) => p.posts.filter(x => x.ig && list.includes(x.ig.s)).length;
  rail.append(h("div", { class: "stats" }, [[st(["scheduled", "publishing"]), "Scheduled"], [st(["published"]), "Published"], [st(["error"]), "To fix"]].map(([v, l]) => h("div", { class: "stat" }, h("b", null, v), h("span", null, l)))));
  rail.append(h("div", { class: "seg", role: "group", "aria-label": "Group posts by" }, [["type", "Format"], ["pillar", "Pillar"], ["week", "Week"]].map(([k, l]) =>
    h("button", { "aria-pressed": String(S.group === k), onclick: () => { S.group = k; renderRail(); } }, l))));
  let groups = [];
  if (S.group === "type") groups = ["reel", "carousel", "image"].map(t => [TYPES[t], p.posts.filter(x => x.type === t), t]);
  else if (S.group === "pillar") { const names = [...new Set(p.posts.map(x => x.pillar || "No pillar yet"))]; groups = names.map(nm => [nm, p.posts.filter(x => (x.pillar || "No pillar yet") === nm)]); }
  else { for (let w = 1; w <= 5; w++) { const it = p.posts.filter(x => x.date && Math.ceil(dOf(x.date).getDate() / 7) === w); if (it.length) groups.push(["Week " + w, it]); } }
  if (!p.posts.length) rail.append(h("p", { class: "empty-note" }, "Posts you add are filed here by format."));
  for (const [label, items, t] of groups) {
    if (!items.length && S.group !== "type") continue;
    rail.append(h("details", { class: "group", open: true },
      h("summary", null, t && icon(t), label, h("span", { class: "count" }, items.length)),
      items.length ? items.map(x => h("button", { class: "row", onclick: () => openPost(x.id) },
        h("span", { class: "n" }, pad(numOf(p, x))),
        h("span", { class: "th", style: { fontSize: "3px" } }, cover(p, x, numOf(p, x) - 1)),
        h("span", { class: "t" }, h("b", null, x.title || "Untitled"), h("span", null, longDate(x.date) + (S.group !== "type" ? " · " + TYPE[x.type] : ""))))) :
        h("p", { class: "empty-note" }, "None yet.")));
  }
  rail.append(accountFoot());
}

function renderBar() {
  const p = cur(), bar = $("#bar"); if (!p) return; bar.replaceChildren();
  const list = Object.values(S.projects).sort((a, b) => (a.example ? 1 : 0) - (b.example ? 1 : 0) || b.updatedAt - a.updatedAt);
  bar.append(
    h("select", { class: "ctl", id: "projectSelect", "aria-label": "Project", onchange: (e) => { S.cur = e.target.value; remember(); render(); } },
      list.map(q => h("option", { value: q.id, selected: q.id === S.cur }, q.example ? "Example: " + q.name : (q.name || "Untitled") + " · " + monthLabel(q)))),
    h("button", { class: "btn", onclick: () => openBrand(true) }, icon("plus"), "New project"),
    h("input", { class: "ctl", type: "month", id: "monthPick", "aria-label": "Month", value: p.month, onchange: (e) => { if (!/^\d{4}-\d{2}$/.test(e.target.value)) { e.target.value = p.month; return; } p.month = e.target.value; respace(p); touch(p); render(); } }),
    h("div", { class: "seg", role: "group", "aria-label": "Platform" }, [["ig", "Instagram"], ["tt", "TikTok"]].map(([k, l]) =>
      h("button", { "aria-pressed": String((p.platform || "ig") === k), onclick: () => { p.platform = k; touch(p); render(); } }, l))),
    h("div", { class: "seg", role: "group", "aria-label": "View" }, [["grid", "Feed"], ["cal", "Calendar"]].map(([k, l]) =>
      h("button", { "aria-pressed": String(S.view === k), onclick: () => { S.view = k; render(); } }, l))),
    h("span", { class: "save", id: "saveState" }, saveState),
    h("span", { class: "sp" }),
    h("button", { class: "btn", onclick: () => openBrand(false) }, "Brand"),
    h("button", { class: "btn", onclick: openAdd }, icon("plus"), "Add media"),
    h("button", { class: "btn", onclick: copyPlan, disabled: !p.posts.length }, "Copy plan"),
    cap.downloads ? h("button", { class: "btn", onclick: downloadAll, disabled: !p.posts.length }, "Download images") : "",
    h("button", { class: "btn primary", onclick: openPlan, disabled: !p.posts.length }, icon("spark"), cap.sample ? "Plan with " + AI() : "Arrange posts"));
}

function renderNotice() {
  const p = cur(), n = $("#notice"); n.replaceChildren();
  if (FPS.account && FPS.account.needsReconnect) n.append("Your Instagram connection expired, so posts can't go out. ", h("a", { href: FPS.loginUrl }, "Reconnect"), " ");
  else if (FPS.account && FPS.account.expiresSoon) n.append("Your Instagram connection needs renewing this week. ", h("a", { href: FPS.loginUrl }, "Reconnect"), " ");
  if (p.example) n.append("This is an example with made-up content. ", h("button", { onclick: () => openBrand(true) }, "Create your own project"));
  else if (S.readonly) n.append("You can look through this plan, but only its editors can change it. Edits you make here aren't saved.");
  else if (S.local) n.append("Preview: this is how the planner looks and works. Nothing here is sent to the server, and publishing and Gemini are switched off.");
  else if (!S.loading && !cap.db) n.append("Your work can't be saved right now. Reload the page and try again.");
  n.hidden = !n.childNodes.length;
}

function tile(p, x, i) {
  const t = h("button", { class: "tile", draggable: !p.example, "aria-label": `Post ${i + 1}: ${x.title || "Untitled"}`, onclick: () => openPost(x.id) },
    h("span", { class: "badge l" }, pad(i + 1)), h("span", { class: "badge r", title: TYPE[x.type], html: ICON[x.type] }), cover(p, x, i));
  t.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-post", x.id); e.dataTransfer.effectAllowed = "move"; });
  t.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("text/x-post")) { e.preventDefault(); t.classList.add("dragover"); } });
  t.addEventListener("dragleave", () => t.classList.remove("dragover"));
  t.addEventListener("drop", (e) => { const id = e.dataTransfer.getData("text/x-post"); t.classList.remove("dragover"); if (!id || id === x.id) return; e.preventDefault(); e.stopPropagation(); movePost(id, p.posts.indexOf(x)); });
  return h("div", { class: "tilewrap" }, t, h("div", { class: "meta" }, h("b", null, shortDate(x.date)), h("span", { class: "pillar" }, x.pillar || TYPE[x.type]),
    h("span", { class: "pill" + (hasCopy(x) ? " ok" : "") }, hasCopy(x) ? "Copy ready" : "No copy yet")),
    !isTT(p) && h("div", { class: "igrow" }, igChip(x),
      confirmBtn(x.ig && x.ig.s === "published" ? "Publish again" : "Publish now", "Select again to publish", () => igPublishNow(p, x), !!(x.ig && x.ig.s === "publishing"))));
}
function movePost(id, to) {
  const p = cur(), from = p.posts.findIndex(x => x.id === id); if (from < 0 || to < 0) return;
  const dates = p.posts.map(x => x.date); const [x] = p.posts.splice(from, 1); p.posts.splice(to, 0, x);
  p.posts.forEach((y, i) => (y.date = dates[i])); touch(p); render();
}

function renderCanvas() {
  const p = cur(), c = $("#canvas"), keep = c.scrollTop; c.replaceChildren();
  const w = h("div", { class: "wrap" }); c.append(w);
  w.append(h("div", { class: "eyebrow" }, platName(p) + " planner" + (FPS.account ? " · @" + FPS.account.username : p.name ? " · " + p.name : "")),
    h("div", { class: "head" }, h("h2", null, monthLabel(p)), h("span", { class: "sp" }),
      S.view === "grid" && p.posts.length > 0 && h("label", { class: "check", style: { fontSize: "13px", color: "var(--muted)" } },
        h("input", { type: "checkbox", id: "profileOrder", checked: S.profile, onchange: (e) => { S.profile = e.target.checked; renderCanvas(); } }), "Profile view: newest first, no planning labels")));
  if (!p.posts.length) {
    w.append(h("p", { class: "sub" }, "Three steps turn a folder of photos and videos into a month you can show a client."),
      h("div", { class: "steps" },
        h("div", { class: "step" }, h("span", { class: "k" }, "Step 1"), h("h3", null, "Describe the brand"), h("p", null, "Name, colours, logo, voice and what the business does. " + AI() + " uses this when the media doesn't make it obvious."), h("button", { class: "btn", onclick: () => openBrand(false) }, "Open brand settings")),
        h("div", { class: "step" }, h("span", { class: "k" }, "Step 2"), h("h3", null, "Add photos, videos and carousels"), h("p", null, "Each photo becomes an image post, each video a reel. Pick several photos together to make one carousel."), h("button", { class: "btn", onclick: openAdd }, "Add media")),
        h("div", { class: "step" }, h("span", { class: "k" }, "Step 3"), h("h3", null, cap.sample ? "Plan with " + AI() : "Arrange the month"), h("p", null, cap.sample ? AI() + " looks at every post, writes the caption, CTA and hashtags, and orders the month so formats and topics alternate." : "Posts are spaced across the month so formats alternate. Write the copy in each post."), h("button", { class: "btn", disabled: true }, "Add media first"))));
    return;
  }
  w.append(h("p", { class: "sub" }, S.view === "grid" ? "Select a post to see its caption, call to action and hashtags. Drag a post onto another to swap its place in the month." : "Each post sits on its planned date. Select one to change the date or the copy."));
  if (S.view === "grid") {
    const list = p.posts.map((x, i) => [x, i]); if (S.profile) list.reverse();
    const ls = mediaSrc(p.logo);
    w.append(h("div", { class: "feedbox" + (S.profile ? " profile" : "") },
      S.profile && h("div", { class: "phead" }, h("div", { class: "logo" }, ls ? h("img", { src: ls, alt: "" }) : (p.name || "?").trim().charAt(0).toUpperCase()),
        h("div", null, h("b", null, isTT(p) ? (p.handle || p.name) : p.name), h("span", null, (isTT(p) ? p.name : p.handle) || ""), h("span", null, `${p.posts.length} posts planned for ${monthLabel(p)}`))),
      h("div", { class: "grid" }, list.map(([x, i]) => tile(p, x, i)))));
  } else {
    const [y, m] = ym(p), days = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const cal = h("div", { class: "cal" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => h("div", { class: "dow" }, d)));
    for (let i = 0; i < lead; i++) cal.append(h("div", { class: "day off" }));
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${pad(m)}-${pad(d)}`, items = p.posts.filter(x => x.date === iso);
      cal.append(h("div", { class: "day" }, h("span", { class: "d" }, d), items.map(x => { const i = p.posts.indexOf(x);
        return h("button", { class: "mini", "aria-label": `Post ${i + 1}: ${x.title || "Untitled"}`, onclick: () => openPost(x.id) }, h("span", { class: "badge l" }, i + 1), h("span", { class: "badge r", html: ICON[x.type] }), cover(p, x, i)); })));
    }
    w.append(cal);
    const stray = p.posts.filter(x => !x.date || !x.date.startsWith(p.month));
    if (stray.length) w.append(h("p", { class: "sub", style: { marginTop: "12px" } }, `${stray.length} post${stray.length > 1 ? "s are" : " is"} dated outside ${monthLabel(p)}. Open the Feed view to find them.`));
  }
  c.scrollTop = keep;
}

/* ---------- dialogs ---------- */
let closeHook = null;
function dialog(node, onClose) {
  const s = $("#scrim"); s.replaceChildren(node); s.hidden = false; closeHook = onClose || null;
  const f = node.querySelector("[autofocus],input,textarea,button"); if (f) setTimeout(() => f.focus(), 30);
}
function closeDialog() { const s = $("#scrim"); if (s.hidden) return; s.hidden = true; s.replaceChildren(); const f = closeHook; closeHook = null; if (f) f(); }
$("#scrim").addEventListener("mousedown", (e) => { if (e.target.id === "scrim") closeDialog(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDialog(); });
const dlgHead = (t) => h("header", null, h("h2", null, t), h("button", { class: "x", "aria-label": "Close", onclick: closeDialog }, "✕"));
function field(id, label, el, hint) { el.id = id; return h("div", { class: "field" }, h("label", { for: id }, label), el, hint && h("small", null, hint)); }

function openBrand(create) {
  const src = cur(), base = create ? newProject({}) : src, real = !src.example;
  if (!create && src.example) { toast("The example is read-only. Create your own project to set a brand."); return; }
  const d = clone(base); d.logo = base.logo; d.refs = [...(base.refs || [])];
  const txt = (v, ph) => h("input", { type: "text", value: v || "", placeholder: ph || "" });
  const area = (v, ph) => h("textarea", { placeholder: ph || "" }, v || "");
  const f = {
    name: txt(d.name, "Oak & Ember Coffee"), handle: txt(d.handle, "@oakandember"),
    about: area(d.about, "What the business sells or does, where, and what makes it different."),
    audience: area(d.audience, "Who the posts are for."),
    voice: area(d.voice, "How the brand talks. Paste a caption you like as an example."),
    pillars: txt((d.pillars || []).join(", "), "Education, Behind the scenes, Offers, Customers"),
    cta: txt(d.cta, "Book at the link in bio"), lang: txt(d.lang, "English"),
    font: h("select", null, Object.entries(FONTS).map(([k, v]) => h("option", { value: k, selected: d.font === k }, v.label)))
  };
  const colors = d.colors.map((c, i) => { const lab = h("span", null, c); const inp = h("input", { type: "color", value: c, id: "brandColor" + i, "aria-label": ["Primary", "Background", "Accent"][i] + " colour", oninput: (e) => { d.colors[i] = e.target.value; lab.textContent = e.target.value; } }); return h("div", { class: "field" }, h("label", { for: "brandColor" + i }, ["Primary", "Background", "Accent"][i]), h("div", { class: "color" }, inp, lab)); });
  const dayBox = h("div", { class: "days" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((n, i) => h("label", null, h("input", { type: "checkbox", id: "day" + i, checked: d.days.includes(i), onchange: (e) => { d.days = e.target.checked ? [...d.days, i] : d.days.filter(v => v !== i); } }), n)));
  const assetRow = h("div", { class: "assetrow" });
  const drawAssets = () => {
    assetRow.replaceChildren();
    if (d.logo) assetRow.append(h("div", { class: "a", title: "Logo" }, h("img", { src: mediaSrc(d.logo) || "", alt: "Logo" }), h("button", { "aria-label": "Remove logo", onclick: () => { d.logo = null; drawAssets(); } }, "✕")));
    assetRow.append(h("button", { class: "btn", onclick: () => pickFiles({ multiple: false, accept: "image/*" }, async ([file]) => {
      try { const k = uid(), b = await scaled(await bitmap(file), 512, "image/png"); local.set(k, URL.createObjectURL(b)); thumbs.set(k, b); d.logo = { k, kind: "image", a: await store(b, "image/png"), name: file.name }; drawAssets(); } catch (e) { toast("That logo couldn't be read. Use a PNG or JPG."); }
    }) }, d.logo ? "Replace logo" : "Upload logo"));
    d.refs.forEach((m, i) => assetRow.append(h("div", { class: "a", title: "Style reference" }, h("img", { src: mediaSrc(m) || "", alt: "Style reference" }), h("button", { "aria-label": "Remove reference", onclick: () => { d.refs.splice(i, 1); drawAssets(); } }, "✕"))));
    if (d.refs.length < 4) assetRow.append(h("button", { class: "btn", onclick: () => pickFiles({ accept: "image/*" }, async (files) => {
      for (const file of files.slice(0, 4 - d.refs.length)) { try { const k = uid(), b = await scaled(await bitmap(file), 1280); local.set(k, URL.createObjectURL(b)); d.refs.push({ k, kind: "image", a: await store(b, "image/jpeg"), name: file.name }); } catch (e) {} }
      drawAssets();
    }) }, "Add style references"));
  };
  drawAssets();
  const copyBrand = create && real ? h("label", { class: "check" }, h("input", { type: "checkbox", id: "copyBrand", onchange: (e) => {
    if (!e.target.checked) return; const s = src;
    f.name.value = s.name; f.handle.value = s.handle; f.about.value = s.about; f.audience.value = s.audience; f.voice.value = s.voice; f.pillars.value = s.pillars.join(", "); f.cta.value = s.cta; f.lang.value = s.lang; f.font.value = s.font;
    d.colors = [...s.colors]; colors.forEach((c, i) => { c.querySelector("input").value = d.colors[i]; c.querySelector("span").textContent = d.colors[i]; }); d.logo = s.logo; d.refs = [...(s.refs || [])]; d.days = [...s.days]; drawAssets();
  } }), h("span", null, `Start from ${src.name || "the current project"}'s brand, for a new month of the same account`)) : null;
  let armed = false;
  const oldDays = (base.days || []).slice().sort().join();
  const save = () => {
    const name = f.name.value.trim(); if (!name) { f.name.focus(); toast("Give the brand a name."); return; }
    Object.assign(base, { name, handle: f.handle.value.trim(), about: f.about.value.trim(), audience: f.audience.value.trim(), voice: f.voice.value.trim(),
      pillars: f.pillars.value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 8), cta: f.cta.value.trim(), lang: f.lang.value.trim() || "English", font: f.font.value,
      colors: d.colors, logo: d.logo, refs: d.refs, days: d.days.length ? d.days : [1, 3, 5] });
    if (create) { S.projects[base.id] = base; S.cur = base.id; remember(); } else if (base.posts.length && base.days.slice().sort().join() !== oldDays) respace(base);
    touch(base); closeDialog(); render();
    if (create) toast("Project created. Add your photos and videos next.", 4000);
  };
  dialog(h("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": "Brand" }, dlgHead(create ? "New project" : "Brand settings"),
    h("div", { class: "body" },
      copyBrand,
      h("div", { class: "two" }, field("brandName", "Brand or account name", f.name), field("brandHandle", "Handle", f.handle)),
      field("brandAbout", "About the business", f.about),
      h("div", { class: "two" }, field("brandAudience", "Audience", f.audience), field("brandVoice", "Voice and tone", f.voice)),
      h("div", { class: "two" }, field("brandPillars", "Content pillars", f.pillars, "Separate with commas. Leave empty and " + AI() + " proposes them."), field("brandCta", "Usual call to action", f.cta)),
      h("div", { class: "hr" }), h("div", { class: "sect" }, "Look"),
      h("div", { class: "three" }, colors),
      h("div", { class: "two" }, field("brandFont", "Headline style", f.font, "Used for cover titles and text posts."), field("brandLang", "Write copy in", f.lang, "Any language, for example Romanian or Russian.")),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Logo and style references"), assetRow, h("small", null, "Up to four past posts or brand-kit images. " + AI() + " matches their style when the new media has no clear branding.")),
      h("div", { class: "hr" }), h("div", { class: "sect" }, "Schedule"),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Usual posting days"), dayBox, h("small", null, "Posts are spread across these days. If there are more posts than days, every day of the month is used."))),
    h("footer", null,
      !create && h("button", { class: "btn danger", style: { marginRight: "auto" }, onclick: (e) => { if (!armed) { armed = true; e.target.textContent = "Select again to delete this project"; return; } deleteProject(base); } }, "Delete project"),
      h("button", { class: "btn", onclick: closeDialog }, "Cancel"), h("button", { class: "btn primary", onclick: save }, create ? "Create project" : "Save brand"))));
}
async function deleteProject(p) {
  closeDialog(); p.posts.forEach(x => igCancel(p, x, true)); delete S.projects[p.id]; dirty.delete(p.id);
  if (cap.db) { try { await cap.db.doc("projects/" + p.id).delete(); } catch (e) {} }
  if (cap.assets) for (const m of [p.logo, ...(p.refs || []), ...p.posts.flatMap(x => x.media)]) { if (!m) continue; const used = Object.values(S.projects).some(q => JSON.stringify(q).includes(m.a || "\u0000")); if (used) continue; for (const id of [m.a, m.p, m.c && m.c.a]) if (id) { try { await cap.assets.delete(id); } catch (e) {} } }
  S.cur = null; firstProject(); render(); toast("Project deleted.");
}

function openAdd() {
  const p = cur(); if (p.example) { openBrand(true); toast("Create your own project first, then add media to it."); return; }
  const go = (mode, accept) => pickFiles({ accept }, (files) => { closeDialog(); addFiles(files, mode); });
  dialog(h("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": "Add media" }, dlgHead("Add media"),
    h("div", { class: "body" },
      h("p", null, "What are you adding?"),
      h("div", { class: "choice" },
        h("button", { onclick: () => go(null, "image/*,video/*") }, h("b", null, "Single posts"), h("span", null, "Pick any number of files at once. Each photo becomes its own image post and each video its own reel.")),
        h("button", { onclick: () => go("carousel", "image/*,video/*") }, h("b", null, "One carousel"), h("span", null, "Pick as many photos and videos as you like. They become the slides of one post, in the order shown."))),
      h("button", { class: "btn", style: { alignSelf: "flex-start" }, onclick: () => { p.posts.push(newPost({ title: "", type: "image" })); respace(p); touch(p); closeDialog(); render(); openPost(p.posts[p.posts.length - 1].id); } }, "Add a text-only post"),
      h("p", { class: "empty-note" }, "You can also drop files anywhere on the page. Photos are resized for the web. Videos up to 50 MB in MP4 or MOV are saved with the project and can be published; larger ones keep only their cover frame."))));
}

function openPost(id) {
  const p = cur(), x = p.posts.find(q => q.id === id); if (!x) return;
  let slide = 0, ctl = null;
  const viewer = h("div", { class: "viewer" }), dots = h("div", { class: "dots" }), hint = h("p", { class: "hint" });
  const coverBox = h("div"), gprev = h("div", { class: "gprev" });
  const drawGrid = () => gprev.replaceChildren(h("span", null, `On your ${platName(p)} profile grid`), h("div", { class: "gtile" }, h("span", { class: "badge r", html: ICON[x.type] }), cover(p, x, p.posts.indexOf(x))));
  const drawCover = () => {
    const m = x.media[slide]; coverBox.replaceChildren(); coverBox.className = "";
    if (!m || m.kind !== "video" || p.example) return;
    coverBox.className = "coverbox";
    const src = mediaSrc(m), v = viewer.querySelector("video");
    const choose = () => pickFiles({ multiple: false, accept: "image/*" }, async ([file]) => {
      try { const k = uid(), b = await scaled(await bitmap(file), 1080); local.set(k, URL.createObjectURL(b)); m.c = { k, kind: "image", a: await store(b, "image/jpeg"), name: file.name }; m.cm = true; thumbs.delete(m.k); touch(p); drawMedia(); toast("Cover image set."); }
      catch (e) { toast("That image couldn't be read. Use a JPG or PNG."); }
    });
    const chk = h("input", { type: "checkbox", id: "coverCustom", checked: !!m.cm, onchange: (e) => { m.cm = e.target.checked; thumbs.delete(m.k); touch(p); drawMedia(); if (m.cm && !m.c) choose(); } });
    coverBox.append(h("div", { class: "sect" }, "Cover"), h("label", { class: "check", for: "coverCustom" }, chk, h("span", null, `Add a cover image to this ${TYPE.reel.toLowerCase()}`)));
    if (m.cm) {
      coverBox.append(h("div", { class: "assetrow" }, m.c && h("div", { class: "a" }, h("img", { src: mediaSrc(m.c) || "", alt: "Cover image" })), h("button", { class: "btn", onclick: choose }, m.c ? "Replace cover image" : "Choose cover image")),
        m.c ? "" : h("p", { class: "hint" }, "Until you choose an image, the video frame is used."));
    } else if (src && v) {
      const range = h("input", { type: "range", id: "coverFrame", min: "0", max: "10", step: "0.05", "aria-label": "Cover frame position" });
      const lab = h("span", { class: "hint" });
      const show = () => (lab.textContent = `Frame at ${Number(range.value).toFixed(1)}s`);
      const fit = () => { if (isFinite(v.duration) && v.duration > 0) range.max = String(v.duration); };
      fit(); range.value = String(m.t != null ? m.t : 0.8); show();
      v.addEventListener("loadedmetadata", () => { fit(); range.value = String(m.t != null ? m.t : 0.8); show(); });
      v.addEventListener("timeupdate", () => { range.value = String(v.currentTime); show(); });
      range.addEventListener("input", () => { try { v.pause(); v.currentTime = Number(range.value); } catch (e) {} show(); });
      coverBox.append(h("p", { class: "hint" }, "Without a cover image, a frame from the video is used. Drag to the moment you want, or pause the video there."), range,
        h("div", { class: "assetrow" }, lab, h("button", { class: "btn", onclick: async () => {
          try {
            v.pause(); const t = Number(range.value);
            if (v.readyState < 2 || Math.abs(v.currentTime - t) > 0.03) await seekTo(v, t);
            const b = await scaled(v, 1080), old = m.p;
            local.set(m.k + ":p", URL.createObjectURL(b)); thumbs.set(m.k, b); m.t = t; v.poster = local.get(m.k + ":p");
            const np = await store(b, "image/jpeg"); if (np) { m.p = np; if (old && cap.assets) cap.assets.delete(old).catch(() => {}); }
            touch(p); drawGrid(); toast("Cover frame set.");
          } catch (e) { toast("That frame couldn't be captured. Play the video for a moment and try again."); }
        } }, "Use this frame as the cover")));
    } else coverBox.append(h("p", { class: "hint" }, "The cover is the frame saved when this video was added. Add the video again to pick a different frame."));
  };
  const drawMedia = () => {
    slide = Math.max(0, Math.min(slide, x.media.length - 1));
    const tall = isTT(p) || (x.media[slide] && x.media[slide].kind === "video");
    viewer.style.aspectRatio = tall ? "9/16" : "4/5"; viewer.style.maxWidth = tall ? "250px" : "";
    viewer.replaceChildren(cover(p, x, p.posts.indexOf(x), { slide, big: true }));
    if (x.media.length > 1) viewer.append(h("button", { class: "nav p", "aria-label": "Previous slide", onclick: () => { slide = (slide - 1 + x.media.length) % x.media.length; drawMedia(); } }, "‹"), h("button", { class: "nav n", "aria-label": "Next slide", onclick: () => { slide = (slide + 1) % x.media.length; drawMedia(); } }, "›"));
    dots.replaceChildren(...(x.media.length > 1 ? x.media.map((_, i) => h("i", { class: i === slide ? "on" : "" })) : []));
    hint.textContent = x.media.length ? `${TYPE[x.type]} · ${x.media.length > 1 ? `slide ${slide + 1} of ${x.media.length}` : x.media[0].name || ""}` : "Text post, drawn in the brand colours";
    rm.hidden = !x.media.length; typeSel.value = x.type;
    drawCover(); drawGrid();
  };
  const set = (k, v) => { x[k] = v; touch(p); };
  const inp = (k, ph) => h("input", { type: "text", value: x[k] || "", placeholder: ph || "", oninput: (e) => { set(k, e.target.value); if (k === "title" || k === "pillar") { if (x.media[slide] && x.media[slide].kind === "video") drawGrid(); else drawMedia(); } } });
  const ta = (k, rows, ph) => h("textarea", { rows, placeholder: ph || "", oninput: (e) => set(k, e.target.value) }, x[k] || "");
  const F = { title: inp("title", "The line people read on the cover"), caption: ta("caption", 7, "Caption"), cta: inp("cta", "What should people do next?"), hashtags: ta("hashtags", 2, "#hashtags"),
    pillar: inp("pillar", p.pillars[0] || "Pillar"), note: ta("note", 2, "Crop, cover text, edit notes"), script: ta("script", 4, x.type === "reel" ? "Hook, body, close" : "Slide 1: …") };
  const pillarList = p.pillars.length ? h("datalist", { id: "pillarList" }, p.pillars.map(v => h("option", { value: v }))) : null;
  if (pillarList) F.pillar.setAttribute("list", "pillarList");
  const typeSel = h("select", { onchange: (e) => { set("type", e.target.value); drawMedia(); } }, Object.entries(TYPE).map(([k, v]) => h("option", { value: k, selected: x.type === k }, v)));
  const date = h("input", { type: "date", value: x.date || "", onchange: (e) => { set("date", e.target.value); resched(); sortByDate(p); const t = $("#scrim header h2"); if (t) t.textContent = `Post ${pad(numOf(p, x))}`; } });
  /* Instagram publishing controls for this post */
  const igStat = h("div", { class: "igstat", "aria-live": "polite" });
  const resched = () => { if (x.ig && x.ig.s === "scheduled") { igCancel(p, x, true); drawIg(); toast("The schedule was cancelled because the date or time changed. Schedule it again.", 5000); } };
  const timeIn = h("input", { type: "time", value: x.time || "09:00", onchange: (e) => { set("time", e.target.value); resched(); } });
  const drawIg = (probs) => {
    const g = x.ig, busy = !!(g && g.s === "publishing");
    igStat.replaceChildren(igStatus(x),
      probs && probs.length ? h("ul", null, probs.map(t => h("li", null, t))) : "",
      h("div", { class: "acts" },
        g && g.s === "scheduled"
          ? h("button", { class: "btn", onclick: () => igCancel(p, x) }, "Cancel schedule")
          : h("button", { class: "btn primary", disabled: busy, onclick: () => { const pr = igProblems(p, x, true); if (pr.length) { drawIg(pr); return; } igSchedule(p, x); } }, "Schedule post"),
        confirmBtn(g && g.s === "published" ? "Publish again" : "Publish now", "Select again to publish", () => { const pr = igProblems(p, x, false); if (pr.length) { drawIg(pr); return; } igRun(p.id, x.id); }, busy)));
  };
  const ov = h("input", { type: "checkbox", id: "postOverlay", checked: !!x.overlay, onchange: (e) => { set("overlay", e.target.checked); drawMedia(); } });
  const rm = h("button", { class: "btn", onclick: () => { x.media.splice(slide, 1); autoType(x); touch(p); drawMedia(); } }, "Remove this slide");
  const aiNote = h("input", { type: "text", id: "aiNote", placeholder: "Optional direction: shorter, mention Saturday's market…", "aria-label": "Direction for " + AI() });
  const aiSt = h("span", { class: "st" });
  const aiBtn = h("button", { class: "btn primary", onclick: async () => {
    if (ctl) { ctl.abort(); return; }
    ctl = new AbortController(); aiBtn.lastChild.textContent = "Stop"; aiSt.textContent = AI() + " is looking at this post…";
    try { const r = await askClaude(p, [x], { signal: ctl.signal, note: aiNote.value.trim(), slides: 4 }); const o = r[0];
      if (o) { applyCopy(p, x, o, true); for (const k in F) F[k].value = x[k] || ""; ov.checked = !!x.overlay; drawMedia(); touch(p); aiSt.textContent = "Rewritten. Edit anything that isn't right."; } else aiSt.textContent = AI() + " didn't return copy for this post. Try again.";
    } catch (e) { aiSt.textContent = e.code === "cancelled" ? "" : errCopy(e); }
    ctl = null; aiBtn.lastChild.textContent = hasCopy(x) ? "Rewrite with " + AI() : "Write with " + AI();
  } }, icon("spark"), hasCopy(x) ? "Rewrite with " + AI() : "Write with " + AI());
  let armed = false;
  const node = h("div", { class: "dlg wide", role: "dialog", "aria-modal": "true", "aria-label": "Post" }, dlgHead(`Post ${pad(numOf(p, x))}`),
    h("div", { class: "post" },
      h("div", { class: "pmedia" }, viewer, dots, hint, coverBox, gprev,
        h("div", { class: "tools" },
          !p.example && h("button", { class: "btn", onclick: () => pickFiles({}, async (files) => { await addFiles(files, { post: x }); drawMedia(); }) }, x.media.length ? "Add slides" : "Add media"), rm,
          cap.downloads && h("button", { class: "btn", onclick: () => downloadPostImage(p, x, slide) }, "Download image"),
          h("button", { class: "btn", onclick: () => { const i = p.posts.indexOf(x); if (i > 0) { movePost(x.id, i - 1); date.value = x.date; node.querySelector("header h2").textContent = `Post ${pad(numOf(p, x))}`; } } }, "Earlier"),
          h("button", { class: "btn", onclick: () => { const i = p.posts.indexOf(x); if (i < p.posts.length - 1) { movePost(x.id, i + 1); date.value = x.date; node.querySelector("header h2").textContent = `Post ${pad(numOf(p, x))}`; } } }, "Later"))),
      h("div", { class: "pfields" }, pillarList,
        cap.sample && !p.example && h("div", { class: "ai" }, aiNote, aiBtn, aiSt),
        field("postTitle", "Cover title", F.title),
        field("postCaption", "Caption", F.caption),
        field("postCta", "Call to action", F.cta),
        field("postTags", "Hashtags", F.hashtags),
        h("button", { class: "btn", style: { alignSelf: "flex-start" }, onclick: () => copyText([x.caption, x.cta, x.hashtags].filter(Boolean).join("\n\n"), "Caption, CTA and hashtags copied.") }, "Copy caption for posting"),
        h("div", { class: "three" }, field("postPillar", "Pillar", F.pillar), field("postType", "Format", typeSel), field("postDate", "Date", date)),
        h("label", { class: "check", for: "postOverlay" }, ov, h("span", null, "Add the cover title over the media in the brand colours. Leave off when the image already carries text. The downloaded image includes it.")),
        field("postScript", x.type === "reel" ? "Reel script" : "Slide text or script", F.script),
        field("postNote", "Design direction", F.note),
        !isTT(p) && !p.example && h("div", { class: "igbox" }, h("div", { class: "sect" }, "Publish to Instagram"),
          field("postTime", "Time on the date above (your local time)", timeIn, "The caption, call to action and hashtags are sent together as the caption."),
          igStat),
        !p.example && h("button", { class: "btn danger", style: { alignSelf: "flex-start" }, onclick: (e) => { if (!armed) { armed = true; e.target.textContent = "Select again to delete this post"; return; } igCancel(p, x, true); p.posts.splice(p.posts.indexOf(x), 1); touch(p); closeDialog(); } }, "Delete post"))));
  drawMedia(); drawIg();
  dialog(node, () => { if (ctl) ctl.abort(); igHook = null; render(); });
  igHook = () => drawIg();
}
function copyText(t, ok) { try { navigator.clipboard.writeText(t).then(() => toast(ok), () => toast("Copying isn't allowed in this view. Select the text and copy it by hand.")); } catch (e) { toast("Copying isn't allowed in this view. Select the text and copy it by hand."); } }
function planText(p) {
  const out = [`${p.name} ${p.handle} · ${monthLabel(p)} · ${p.posts.length} posts`, ""].concat(p.posts.map((x, i) =>
    [`${pad(i + 1)} · ${longDate(x.date)} · ${TYPE[x.type]}${x.pillar ? " · " + x.pillar : ""}`, x.title && "Cover: " + x.title, x.caption, x.cta && "CTA: " + x.cta, x.hashtags, x.script && "Script:\n" + x.script, x.note && "Design: " + x.note, ""].filter(v => v !== "" && v != null && v !== false).join("\n") + "\n"));
  return out.join("\n");
}
function copyPlan() { copyText(planText(cur()), "The whole plan is copied as text."); }

/* ---------- image export ---------- */
const rgba = (hex, a) => { const n = parseInt((/^#?([0-9a-f]{6})$/i.exec(hex) || [0, "000000"])[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
function wrapLines(ctx, text, maxW) {
  const out = []; let line = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = line ? line + " " + w : w; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
async function renderCover(p, x, slide) {
  const m = x.media[slide], tall = isTT(p) || x.type === "reel" || (m && m.kind === "video");
  const W = 1080, H = tall ? 1920 : 1350, c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = W; c.height = H;
  const fam = (FONTS[p.font] || FONTS.editorial).d, ui = "Figtree,system-ui,sans-serif", pad = Math.round(W * 0.075);
  try { await Promise.all([document.fonts.load(`600 72px ${fam}`), document.fonts.load(`600 24px Figtree`)]); } catch (e) {}
  const label = (txt, xx, yy, fg, bar) => { g.fillStyle = bar; g.fillRect(xx, yy - 10, 44, 4); g.fillStyle = fg; g.globalAlpha = .85; g.font = `600 24px ${ui}`; try { g.letterSpacing = "4px"; } catch (e) {} g.fillText(String(txt).toUpperCase(), xx + 60, yy); try { g.letterSpacing = "0px"; } catch (e) {} g.globalAlpha = 1; };
  if (m) {
    const src = m.kind === "video" ? posterSrc(m) : mediaSrc(m); if (!src) throw new Error("nomedia");
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = src; await img.decode();
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    if (x.overlay && slide === 0 && x.title) {
      const c1 = p.colors[0], fg = onColor(c1), size = 76, lh = Math.round(size * 1.14);
      g.font = `600 ${size}px ${fam}`; const lines = wrapLines(g, x.title, W - pad * 2);
      const block = lines.length * lh + (x.pillar ? 56 : 0), top = H - pad - (tall ? 150 : 0) - block;
      const gr = g.createLinearGradient(0, Math.max(0, top - H * 0.22), 0, H); gr.addColorStop(0, rgba(c1, 0)); gr.addColorStop(.45, rgba(c1, .74)); gr.addColorStop(1, rgba(c1, 1));
      g.fillStyle = gr; g.fillRect(0, Math.max(0, top - H * 0.22), W, H);
      g.textBaseline = "alphabetic"; let y = top;
      if (x.pillar) { label(x.pillar, pad, y + 22, fg, p.colors[2]); y += 56; }
      g.fillStyle = fg; g.font = `600 ${size}px ${fam}`; lines.forEach((ln, k) => g.fillText(ln, pad, y + size + k * lh));
    }
  } else {
    const v = Math.max(0, p.posts.indexOf(x)) % 3, bg = p.colors[v], fg = onColor(bg), size = 92, lh = Math.round(size * 1.14), px = Math.round(W * 0.13);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.font = `600 ${size}px ${fam}`; const lines = wrapLines(g, x.title || "Untitled post", W - px * 2);
    const block = lines.length * lh + (x.pillar ? 64 : 0); let y = (H - block) / 2;
    if (x.pillar) { label(x.pillar, px, y + 22, fg, v === 2 ? p.colors[0] : p.colors[2]); y += 64; }
    g.fillStyle = fg; g.font = `600 ${size}px ${fam}`; lines.forEach((ln, k) => g.fillText(ln, px, y + size + k * lh));
    if (p.handle) { g.globalAlpha = .7; g.font = `500 26px ${ui}`; g.fillText(p.handle, px, H - Math.round(H * 0.08)); g.globalAlpha = 1; }
  }
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.93));
}
const slug = (t) => (String(t || "feed").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "feed").slice(0, 40);
async function saveFile(filename, data, ok) {
  if (!cap.downloads) { toast("Downloads aren't available in this view."); return; }
  try { await cap.downloads.save({ filename, data }); toast(ok); }
  catch (e) { if (e && e.code === "declined") return; toast(e && e.code === "rate_limited" ? "A download prompt is already open. Answer it, then try again." : "The download couldn't be started in this view."); }
}
async function downloadPostImage(p, x, slide) {
  try { const b = await renderCover(p, x, slide); await saveFile(`${slug(p.name)}-${pad(numOf(p, x))}${x.media.length > 1 ? "-slide-" + (slide + 1) : ""}.jpg`, b, "Image saved."); }
  catch (e) { toast("This image isn't available here to export. Add the media again and retry."); }
}
async function downloadAll() {
  const p = cur(); if (!p.posts.length) return;
  if (typeof JSZip === "undefined") { toast("The zip tool didn't load. Download images one by one from each post."); return; }
  const zip = new JSZip(); let n = 0, skipped = 0;
  for (let i = 0; i < p.posts.length; i++) {
    const x = p.posts[i], base = `${pad(i + 1)}-${x.date || "undated"}-${TYPE[x.type].toLowerCase().replace(/\s+/g, "-")}`;
    toast(`Preparing post ${i + 1} of ${p.posts.length}…`, 0);
    for (let k = 0; k < Math.max(1, x.media.length); k++) {
      const m = x.media[k], name = !m ? "" : m.kind === "video" ? "-cover" : x.media.length > 1 ? "-slide-" + (k + 1) : "";
      try { zip.file(`${base}${name}.jpg`, await renderCover(p, x, k)); n++; } catch (e) { skipped++; }
    }
  }
  zip.file("captions.txt", planText(p));
  toast("Packing the zip…", 0);
  const blob = await zip.generateAsync({ type: "blob" }); hideToast();
  await saveFile(`${slug(p.name)}-${p.month}-${isTT(p) ? "tiktok" : "instagram"}.zip`, blob, `${n} image${n === 1 ? "" : "s"} and the captions saved${skipped ? `; ${skipped} couldn't be exported` : ""}.`);
}

/* ---------- arranging ---------- */
function arrange(p) {
  const rest = p.posts.map((x, i) => [x, i]).sort((a, b) => ((a[0].ph || 2.5) - (b[0].ph || 2.5)) || a[1] - b[1]).map(a => a[0]), out = [];
  while (rest.length) {
    const prev = out[out.length - 1], win = rest.slice(0, 5);
    let j = prev ? win.findIndex(x => x.type !== prev.type && (x.pillar || "") !== (prev.pillar || "")) : 0;
    if (j < 0) j = win.findIndex(x => x.type !== prev.type);
    if (j < 0) j = 0;
    out.push(rest.splice(j, 1)[0]);
  }
  p.posts = out; respace(p);
}

/* ---------- Claude ---------- */
function errCopy(e) {
  const c = e && e.code;
  if (e && e.gemini) return e.message;
  if (c === "not_granted") return "Gemini wasn't allowed to help in this view. You can still write the copy yourself.";
  if (c === "rate_limited") return "Gemini is at its usage limit for now. Try again in a little while.";
  if (c === "refused") return "Gemini declined this one. Change the media or the brand notes and try again.";
  if (c === "invalid_json") return "Gemini's answer came back garbled. Try again.";
  if (c === "session_expired") return "You've been signed out. Sign in again, then retry.";
  if (c === "image_rejected") return "One of the images couldn't be sent. Remove unusual files and try again.";
  return "Gemini couldn't be reached. Try again.";
}
const cut = (s, n) => (s || "").toString().slice(0, n);
function applyCopy(p, x, o, overwrite) {
  const str = (v) => typeof v === "string" ? v.trim() : "";
  const setIf = (k, v) => { if (v && (overwrite || !x[k])) x[k] = v; };
  setIf("title", cut(str(o.title), 120)); setIf("caption", cut(str(o.caption), 2200)); setIf("cta", cut(str(o.cta), 200));
  setIf("hashtags", cut(Array.isArray(o.hashtags) ? o.hashtags.map(t => String(t).trim()).filter(Boolean).map(t => t.startsWith("#") ? t : "#" + t).join(" ") : str(o.hashtags), 600));
  setIf("pillar", cut(str(o.pillar), 40)); setIf("note", cut(str(o.note), 600)); setIf("script", cut(str(o.script), 1500));
  if (typeof o.overlay === "boolean" && x.media.length && (overwrite || !hasCopyBefore.has(x.id))) x.overlay = o.overlay;
  const w = Number(o.week); if (w >= 1 && w <= 4) x.ph = w;
}
const hasCopyBefore = new Set();
async function askClaude(p, posts, { signal, note, slides = 1 }) {
  const images = [], lines = [], max = cap.img ? cap.img.maxCount : 0;
  for (const x of posts) {
    const tags = [];
    for (const m of x.media.slice(0, slides)) { if (images.length >= max) break; const b = await thumbFor(m); if (b) { images.push(b); tags.push("image " + images.length); } }
    lines.push(`- id: ${x.id} | format: ${TYPE[x.type]}${x.media.length > 1 ? ` (${x.media.length} slides)` : ""} | ${tags.length ? "shown in " + tags.join(", ") + (x.type === "reel" ? " (a frame from the video)" : "") : "no media attached"}` +
      `${x.media[0] && x.media[0].name ? ` | file: ${cut(x.media[0].name, 60)}` : ""}${x.title ? ` | working title: ${cut(x.title, 120)}` : ""}${x.caption ? ` | current caption: ${cut(x.caption, 500)}` : ""}${x.note ? ` | notes: ${cut(x.note, 200)}` : ""}`);
  }
  const refTags = [];
  if (max - images.length >= 1) for (const m of [p.logo, ...(p.refs || [])].filter(Boolean).slice(0, Math.min(3, max - images.length))) { const b = await thumbFor(m); if (b) { images.push(b); refTags.push(`image ${images.length} (${m === p.logo ? "logo" : "style reference"})`); } }
  const prompt = `You are the social media strategist for one brand. Plan ${platName(p)} posts for ${monthLabel(p)} from the media the client supplied.

BRAND
Name: ${cut(p.name, 80) || "(not given)"}
Handle: ${cut(p.handle, 40) || "(not given)"}
What the business does: ${cut(p.about, 800) || "(not given; infer carefully from the media and stay general where unsure)"}
Audience: ${cut(p.audience, 500) || "(not given)"}
Voice and tone: ${cut(p.voice, 800) || "(not given; write naturally and specifically)"}
Content pillars: ${p.pillars.length ? p.pillars.join(", ") : "(none given; choose 3 to 5 short pillar names and reuse them consistently)"}
Usual call to action: ${cut(p.cta, 200) || "(none given)"}
Brand colours: primary ${p.colors[0]}, background ${p.colors[1]}, accent ${p.colors[2]}. Headline style: ${(FONTS[p.font] || FONTS.editorial).label}.
${refTags.length ? "Brand references attached: " + refTags.join(", ") + ". Use them only to understand the brand's look." : ""}

POSTS
${lines.join("\n")}
${note ? "\nEXTRA DIRECTION FROM THE USER: " + cut(note, 400) : ""}

For every post, look at its image and write copy that is about what is actually shown. It must sound like this brand, not like a template. Do not invent facts such as prices, dates, offers, names or results; where a fact is needed, write a [placeholder in square brackets]. Write all copy in ${cut(p.lang, 40) || "English"}.

Reply with only JSON in this shape:
{"posts":[{"id":"<the post id>","title":"cover hook, at most 9 words","caption":"${isTT(p) ? "15 to 60 words in the brand voice, written for TikTok" : "40 to 110 words in the brand voice, with line breaks"}","cta":"one line telling people what to do next","hashtags":["${isTT(p) ? "3 to 6" : "8 to 12"} tags, each starting with #, mixing niche, local and broader ones"],"pillar":"one pillar name","script":"for a carousel: one line of on-slide text per slide, as 'Slide 1: ...'; for a reel: Hook / Body / Close; for a single image: empty string","note":"1 or 2 sentences of design direction: crop, cover text, edits, how to use the brand colours","overlay":true if the image has no text or branding on it and a branded title over it would help, otherwise false,"week":1 to 4, the week of the month where this post fits best (build familiarity first, offers and asks later)}]}
Include every post id exactly once.`;
  const opts = { signal, cache: false }; if (images.length) opts.images = images;
  const res = await cap.sample.json(prompt, opts);
  const arr = res && Array.isArray(res.posts) ? res.posts : Array.isArray(res) ? res : [];
  return posts.map(x => arr.find(o => o && o.id === x.id) || null);
}

function openPlan() {
  const p = cur(); if (p.example) { toast("The example is already planned. Create your own project to plan real posts."); return; }
  const ai = !!cap.sample, missing = p.posts.filter(x => !hasCopy(x)).length;
  const over = h("input", { type: "checkbox", id: "planOverwrite", checked: missing === 0 }), re = h("input", { type: "checkbox", id: "planArrange", checked: true });
  const prog = h("div", { class: "progress", hidden: true }), msg = h("span", null), fill = h("i"); prog.append(msg, h("div", { class: "bartrack" }, fill));
  let ctl = null, running = false;
  const start = h("button", { class: "btn primary", onclick: run }, ai && icon("spark"), ai ? "Start" : "Arrange posts");
  async function run() {
    if (running) { ctl && ctl.abort(); return; }
    if (!ai) { arrange(p); touch(p); closeDialog(); toast("Posts rearranged so formats alternate across the month."); return; }
    const targets = p.posts.filter(x => over.checked || !hasCopy(x));
    hasCopyBefore.clear(); p.posts.forEach(x => { if (hasCopy(x)) hasCopyBefore.add(x.id); });
    running = true; ctl = new AbortController(); start.lastChild.textContent = "Stop"; prog.hidden = false;
    const per = cap.img ? Math.max(1, Math.min(8, cap.img.maxCount - 2)) : 10; let done = 0, wrote = 0, err = null;
    for (let i = 0; i < targets.length && !err; i += per) {
      const chunk = targets.slice(i, i + per);
      msg.textContent = `${AI()} is looking at posts ${i + 1}–${i + chunk.length} of ${targets.length}. This can take a minute.`;
      try { const r = await askClaude(p, chunk, { signal: ctl.signal }); chunk.forEach((x, j) => { if (r[j]) { applyCopy(p, x, r[j], over.checked); wrote++; } }); touch(p); }
      catch (e) { err = e; }
      done += chunk.length; fill.style.width = Math.round(done / targets.length * 100) + "%";
    }
    running = false; ctl = null;
    if (re.checked && (!err || wrote)) arrange(p);
    touch(p);
    if (err && err.code !== "cancelled") { msg.textContent = errCopy(err) + (wrote ? ` ${wrote} post${wrote > 1 ? "s were" : " was"} written before that.` : ""); start.lastChild.textContent = "Try again"; render(); return; }
    closeDialog(); toast(err ? `Stopped. ${wrote} post${wrote === 1 ? "" : "s"} written.` : targets.length ? `Copy written for ${wrote} post${wrote === 1 ? "" : "s"}. Open each one to review it.` : "Posts rearranged.", 4500);
  }
  dialog(h("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": "Plan the month" }, dlgHead(ai ? "Plan with " + AI() : "Arrange posts"),
    h("div", { class: "body" },
      h("p", null, ai ? `${AI()} looks at each post${cap.img ? "" : "'s details"}, reads the brand settings, and writes a cover title, caption, call to action, hashtags, script and design direction for it.` : AI() + " isn't available in this view, so posts are only reordered and spaced across the month. Write the copy inside each post."),
      ai && !cap.img && h("p", { class: "empty-note" }, "This view can't send images, so " + AI() + " works from file names and your notes. Add a working title to each post for better copy."),
      ai && h("label", { class: "check", for: "planOverwrite" }, over, h("span", null, missing ? `Also rewrite the ${p.posts.length - missing} post${p.posts.length - missing === 1 ? "" : "s"} that already have copy` : "Rewrite all posts (every post already has copy)")),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Which days do you want to post?"),
        h("div", { class: "days" }, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((n, i) => h("label", null, h("input", { type: "checkbox", id: "planDay" + i, checked: p.days.includes(i), onchange: (e) => { p.days = e.target.checked ? [...new Set([...p.days, i])] : p.days.filter(v => v !== i); touch(p); } }), n))),
        h("small", null, "Posts are spread across these days when the month is arranged. With more posts than days, every day of the month is used.")),
      h("label", { class: "check", for: "planArrange" }, re, h("span", null, "Reorder the month so formats and pillars alternate, then space posts across the posting days")),
      !p.about && ai && h("p", { class: "empty-note" }, "Tip: the brand has no description yet. Filling in Brand settings first gives far less generic copy."),
      prog),
    h("footer", null, h("button", { class: "btn", onclick: closeDialog }, "Close"), start)), () => { if (ctl) ctl.abort(); render(); });
}

/* ---------- Instagram publishing: the server holds the connection and posts on schedule ---------- */
const igCaption = (x) => [x.caption, x.cta, x.hashtags].map(s => (s || "").trim()).filter(Boolean).join("\n\n");
function igWhen(x) {
  if (!x.date || !/^\d{2}:\d{2}$/.test(x.time || "")) return 0;
  const [y, m, d] = x.date.split("-").map(Number), [hh, mm] = x.time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime() || 0;
}
const fmtWhen = (ms) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const MAX_SLIDES = 20;
function igProblems(p, x, scheduling) {
  if (p.example) return ["This is the example project. Create your own project to publish."];
  if (FPS.preview || !FPS.account) return ["This is the preview: publishing is switched off here. It works on the live site."];
  const out = [], type = x.media.length ? x.type : "image", first = x.media[0];
  const unstored = "is over 50 MB or isn't an MP4 or MOV file, so Instagram can't receive it. Add a smaller MP4.";
  if (type === "reel") {
    if (!first || first.kind !== "video") out.push("A reel needs a video. Change the format to Image, or add a video.");
    else if (!first.a) out.push("This video " + unstored);
  } else if (type === "image") {
    if (first && first.kind === "video") out.push("This post holds a video. Change its format to Reel.");
    else if (first && !mediaSrc(first)) out.push("The photo for this post is missing. Add it again.");
  } else {
    if (x.media.length < 2) out.push("A carousel needs at least two slides. Add more, or change the format to Image.");
    if (x.media.length > MAX_SLIDES) out.push(`Instagram accepts at most ${MAX_SLIDES} slides in a carousel. This one has ${x.media.length}.`);
    x.media.forEach((m, i) => { if (m.kind === "video" ? !m.a : !mediaSrc(m)) out.push(m.kind === "video" ? `The video on slide ${i + 1} ${unstored}` : `The photo on slide ${i + 1} is missing. Add it again.`); });
  }
  if (!hasCopy(x)) out.push("Write the caption first.");
  else {
    const cp = igCaption(x);
    if (cp.length > 2200) out.push(`The caption with its call to action and hashtags is ${cp.length} characters. Instagram allows 2,200.`);
    if ((cp.match(/#[^\s#]+/g) || []).length > 30) out.push("Instagram allows at most 30 hashtags.");
  }
  const at = igWhen(x);
  if (scheduling && !at) out.push("Set both the date and the time.");
  else if (scheduling && at <= Date.now() + 5000) out.push(`${fmtWhen(at)} has already passed. Pick a later time or use Publish now.`);
  return out;
}

const igBusy = new Set();
let igHook = null;
const igPaint = () => { render(); if (igHook) igHook(); };
function countdown(at) {
  let s = Math.max(0, Math.round((at - Date.now()) / 1000)); const d = Math.floor(s / 86400); s %= 86400;
  return (d ? d + "d " : "") + pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60);
}
setInterval(() => document.querySelectorAll("[data-igat]").forEach(e => (e.textContent = countdown(Number(e.dataset.igat)))), 1000);

/* Builds exactly what Instagram will receive: every image slide is exported as a JPEG (with the brand
   overlay when it is on) and uploaded; videos are sent as stored. */
async function igPayload(p, x, step) {
  const type = x.media.length ? x.type : "image", n = type === "carousel" ? x.media.length : 1, media = [];
  let cover_url = null;
  for (let i = 0; i < n; i++) {
    const m = x.media[i];
    step(n > 1 ? `Preparing slide ${i + 1} of ${n}…` : "Preparing your post…");
    if (m && m.kind === "video") {
      media.push({ kind: "video", url: m.a });
      if (type === "reel") { try { cover_url = await uploadBlob(await renderCover(p, x, 0), "image/jpeg"); } catch (e) { cover_url = null; } }
    } else media.push({ kind: "image", url: await uploadBlob(await renderCover(p, x, i), "image/jpeg") });
  }
  return { post_type: type, media, caption: igCaption(x), cover_url };
}
/* when = a timestamp to schedule for, or null to publish now. */
async function igSend(p, x, when) {
  if (igBusy.has(x.id)) return;
  igBusy.add(x.id);
  const prev = x.ig;
  x.ig = { s: "publishing", step: "Preparing your post…" }; igPaint();
  try {
    const payload = await igPayload(p, x, (t) => { x.ig.step = t; if (igHook) igHook(); });
    if (prev && prev.id && prev.s === "scheduled") await apiCall("/api/posts/" + prev.id, { method: "DELETE" }).catch(() => {});
    if (when) {
      const r = await apiCall("/api/posts", { method: "POST", body: JSON.stringify(Object.assign(payload, { scheduled_at: new Date(when).toISOString() })) });
      x.ig = { s: "scheduled", at: when, id: r.post.id };
      toast(`Scheduled for ${fmtWhen(when)}. You can close this page; it posts by itself.`, 6000);
    } else {
      x.ig.step = "Publishing to Instagram…"; if (igHook) igHook();
      const r = await apiCall("/api/posts/publish-now", { method: "POST", body: JSON.stringify(payload) });
      x.ig = r.pending ? { s: "publishing", id: r.post.id, step: r.message } : { s: "published", id: r.post.id, at: Date.now() };
      toast(r.message, 6000);
    }
  } catch (e) {
    x.ig = { s: "error", msg: e.message }; toast(e.message, 8000);
  }
  igBusy.delete(x.id); touch(p); igPaint();
}
const igSchedule = (p, x) => igSend(p, x, igWhen(x));
function igRun(pid, xid) { const p = S.projects[pid], x = p && p.posts.find(q => q.id === xid); if (x) return igSend(p, x, null); }
function igPublishNow(p, x) {
  const probs = igProblems(p, x, false);
  if (probs.length) { toast(probs[0], 6000); if (!p.example) openPost(x.id); return; }
  igSend(p, x, null);
}
function igCancel(p, x, quiet) {
  const g = x.ig; if (!g) return;
  if (g.id && g.s === "scheduled") apiCall("/api/posts/" + g.id, { method: "DELETE" }).catch(() => {});
  x.ig = null; touch(p); if (!quiet) igPaint();
}
/* Scheduled posts are published by the server, so ask it now and then what happened to them. */
async function igSync() {
  if (!cap.db || document.hidden) return;
  const tracked = [];
  for (const p of Object.values(S.projects)) if (!p.example) for (const x of p.posts) if (x.ig && x.ig.id && (x.ig.s === "scheduled" || x.ig.s === "publishing") && !igBusy.has(x.id)) tracked.push([p, x]);
  if (!tracked.length) return;
  let rows; try { rows = (await apiCall("/api/posts")).posts; } catch (e) { return; }
  const by = new Map(rows.map(r => [r.id, r])), changed = new Set();
  for (const [p, x] of tracked) {
    const r = by.get(x.ig.id), id = x.ig.id;
    if (!r) x.ig = null;
    else if (r.status === "published") x.ig = { s: "published", id, at: Date.parse(r.published_at) || Date.now() };
    else if (r.status === "failed") x.ig = { s: "error", id, msg: r.student_message || "This post couldn't be published. Please try again." };
    else if (r.status === "publishing" && x.ig.s !== "publishing") x.ig = { s: "publishing", id, step: "Publishing to Instagram…" };
    else continue;
    changed.add(p);
  }
  changed.forEach(touch); if (changed.size) igPaint();
}
function igChip(x) {
  const g = x.ig; if (!g) return null;
  if (g.s === "scheduled") return h("span", { class: "chip sched", title: "Scheduled for " + fmtWhen(g.at) }, "Scheduled · ", h("span", { "data-igat": g.at }, countdown(g.at)));
  if (g.s === "publishing") return h("span", { class: "chip sched" }, "Publishing…");
  if (g.s === "published") return h("span", { class: "chip ok" }, "Published " + fmtWhen(g.at));
  return h("span", { class: "chip bad", title: g.msg }, "Not published");
}
function igStatus(x) {
  const g = x.ig;
  if (!g) return h("span", null, "Not scheduled yet.");
  if (g.s === "scheduled") return h("span", null, h("b", null, "Scheduled"), ` for ${fmtWhen(g.at)} · goes out in `, h("b", { "data-igat": g.at }, countdown(g.at)),
    h("small", { style: { display: "block", color: "var(--muted)" } }, "It posts by itself, even with this page closed. It goes out exactly as it is now: after changing anything, cancel and schedule it again."));
  if (g.s === "publishing") return h("span", null, g.step || "Publishing…");
  if (g.s === "published") return h("span", null, h("b", null, "Published"), ` ${fmtWhen(g.at)}. It is live on your Instagram profile.`);
  return h("div", { class: "igerr" }, h("b", null, "Not published"), h("span", { style: { display: "block" } }, g.msg));
}
function confirmBtn(label, confirmLabel, fn, disabled, cls) {
  let armed = false, t = 0;
  const b = h("button", { class: cls || "btn", disabled: !!disabled, onclick: (e) => {
    e.stopPropagation();
    if (!armed) { armed = true; b.textContent = confirmLabel; t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    clearTimeout(t); armed = false; b.textContent = label; fn();
  } }, label);
  return b;
}

/* ---------- drop files anywhere ---------- */
window.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (![...e.dataTransfer.types].includes("Files")) return; e.preventDefault(); if (!$("#scrim").hidden) return; addFiles([...e.dataTransfer.files], null); });

boot();
