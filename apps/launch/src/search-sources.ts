/**
 * 語意搜尋的資料來源（業主 2026-11-25）：每一種來源＝哪張資料表的哪個欄位、搜尋結果的膠囊標籤叫什麼、點下去去哪。
 * 在「設定 → 搜尋與 AI 設定」可個別開關（search-settings.ts 的 semSrc* 參數）；新增來源只加這一處＋一個開關參數。
 * 只收公開的文字（已上架、非「只限網址」的課程；中心／系列／相簿／EDM 本來就公開），不含會員或 Amway 資料。
 */
import type { D1Database } from "./d1.ts";

export type SourceKind = "course" | "lesson" | "section" | "series" | "center" | "intro" | "edm" | "photo";
export type Candidate = { kind: SourceKind; ref: string; txt: string };
/** thumb＝左邊縮圖（沒有就由畫面顯示預設圖）；image＝要「直接放大看」的原圖（EDM、相片），有它就不跳頁；link＝要前往的頁面。 */
export type Hit = { kind: SourceKind; tag: string; prio: number; id: string; title: string; sub: string; link: string; thumb: string | null; image?: string; score: number; /** 所屬課程（要鎖頭標記與原因的命中才有）。 */ courseId?: string; /** 目前這位使用者沒有權限（API 層依權限補上）。 */ locked?: boolean; lockLines?: string[] };

export const SOURCES: { kind: SourceKind; param: string; tag: string; label: string; fields: string }[] = [
  { kind: "course", param: "semSrcCourse", tag: "教材卡", label: "教材卡", fields: "courses.title（教材卡名稱）" },
  { kind: "lesson", param: "semSrcLesson", tag: "單一教材", label: "單一教材", fields: "lessons.title（教材標題，不含區塊）" },
  { kind: "section", param: "semSrcSection", tag: "區塊", label: "區塊（課程裡的分組）", fields: "lessons.title（kind＝區塊）" },
  { kind: "series", param: "semSrcSeries", tag: "系列卡", label: "系列卡", fields: "courses.series（系列名稱，同名只算一張）" },
  { kind: "center", param: "semSrcCenter", tag: "中心卡", label: "中心卡", fields: "center_names.display_name／courses.host_center_key（中心名稱）" },
  { kind: "intro", param: "semSrcIntro", tag: "課程介紹", label: "課程介紹", fields: "courses.description（課程說明，取前 200 字）" },
  { kind: "edm", param: "semSrcEdm", tag: "EDM", label: "EDM 海報（OCR 文字辨識）", fields: "cover_media.ocr_text（scope＝edm，辨識完成的海報文字，取前 200 字）" },
  { kind: "photo", param: "semSrcPhoto", tag: "相片", label: "相片（AI 場景辨識）", fields: "cover_media.scene_text（相簿與區塊照片的場景標籤）" },
];
export const tagOf = (k: string) => SOURCES.find((s) => s.kind === k)?.tag ?? k;

const PUBLIC = "c.status = 'published' AND c.view_scope NOT IN ('link_login', 'link_guest')";

/** 目前所有可建向量的文字（只含已開啟的來源）。 */
export async function candidates(db: D1Database, on: (kind: SourceKind) => boolean): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const q = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results;
  if (on("course")) for (const r of await q<{ id: string; t: string }>(`SELECT c.id, c.title AS t FROM courses c WHERE ${PUBLIC} AND c.title <> ''`)) out.push({ kind: "course", ref: r.id, txt: r.t });
  if (on("lesson") || on("section")) {
    for (const r of await q<{ id: string; t: string; k: string }>(`SELECT l.id, l.title AS t, l.kind AS k FROM lessons l JOIN courses c ON c.id = l.course_id WHERE ${PUBLIC} AND l.title <> ''`)) {
      const kind: SourceKind = r.k === "section" ? "section" : "lesson";
      if (on(kind)) out.push({ kind, ref: r.id, txt: r.t });
    }
  }
  if (on("series")) for (const r of await q<{ s: string }>(`SELECT DISTINCT c.series AS s FROM courses c WHERE ${PUBLIC} AND c.series <> ''`)) out.push({ kind: "series", ref: r.s, txt: r.s });
  if (on("center"))
    for (const r of await q<{ k: string; n: string | null }>(`SELECT DISTINCT c.host_center_key AS k, (SELECT n.display_name FROM center_names n WHERE n.center_key = c.host_center_key) AS n FROM courses c WHERE ${PUBLIC} AND c.host_center_key IS NOT NULL AND c.host_center_key <> ''`)) out.push({ kind: "center", ref: r.k, txt: r.n || r.k });
  if (on("intro")) for (const r of await q<{ id: string; t: string }>(`SELECT c.id, substr(c.description, 1, 200) AS t FROM courses c WHERE ${PUBLIC} AND length(trim(c.description)) >= 4`)) out.push({ kind: "intro", ref: r.id, txt: r.t.trim() });
  if (on("edm")) for (const r of await q<{ id: string; t: string }>(`SELECT id, substr(ocr_text, 1, 200) AS t FROM cover_media WHERE scope = 'edm' AND kind = 'image' AND ocr_status = 'done' AND length(trim(ocr_text)) >= 4`)) out.push({ kind: "edm", ref: r.id, txt: r.t.trim() });
  if (on("photo")) for (const r of await q<{ id: string; t: string }>(`SELECT id, substr(scene_text, 1, 200) AS t FROM cover_media WHERE scene_status = 'done' AND length(trim(scene_text)) >= 2`)) out.push({ kind: "photo", ref: r.id, txt: r.t.trim() });
  return out;
}

const enc = encodeURIComponent;
const pub = (key: string | null | undefined, v = 0) => (key ? `/api/v2/media/pub?k=${enc(key)}&v=${v}` : null);
/** 把「非課程／非章節」的命中補上標題、縮圖與去向（只處理分數最高的幾筆）。看不到的（下架、只限網址）直接略過。
 *  去向（業主 2026-11-25）：單一教材＝直接播放、區塊＝直接開該區塊、教材卡／課程介紹＝課程頁、系列卡＝系列頁、中心卡＝中心頁、EDM／相片＝直接放大看圖。 */
export async function resolveHits(db: D1Database, hits: { kind: SourceKind; ref: string; txt: string; score: number }[]): Promise<Hit[]> {
  const out: Hit[] = [];
  const centerOf = async (key: string) => {
    const r = await db.prepare("SELECT (SELECT display_name FROM center_names WHERE center_key = ?1) AS n, (SELECT COALESCE(cover_key, edm_key) FROM center_art WHERE center_key = ?1) AS k, (SELECT art_version FROM center_art WHERE center_key = ?1) AS v").bind(key).first<{ n: string | null; k: string | null; v: number | null }>();
    return { name: r?.n || key, thumb: pub(r?.k, r?.v ?? 0) };
  };
  const courseOf = (id: string) => db.prepare(`SELECT c.id, c.title, COALESCE(c.cover_key, c.edm_key) AS k, c.art_version AS v FROM courses c WHERE c.id = ? AND ${PUBLIC}`).bind(id).first<{ id: string; title: string; k: string | null; v: number | null }>();
  for (const h of hits) {
    const base = { kind: h.kind, tag: tagOf(h.kind), prio: 0, id: `${h.kind}:${h.ref}`, score: h.score };
    if (h.kind === "series") {
      const a = await db.prepare("SELECT COALESCE(cover_key, edm_key) AS k, art_version AS v FROM series_art WHERE series = ?").bind(h.ref).first<{ k: string | null; v: number | null }>();
      out.push({ ...base, title: h.txt, sub: "", link: `/series/${enc(h.ref)}`, thumb: pub(a?.k, a?.v ?? 0) });
    } else if (h.kind === "center") {
      const c = await centerOf(h.ref);
      out.push({ ...base, title: c.name, sub: "", link: `/courses?center=${enc(c.name)}`, thumb: c.thumb });
    } else if (h.kind === "intro") {
      const c = await courseOf(h.ref);
      if (c) out.push({ ...base, title: c.title, sub: h.txt.slice(0, 60), link: `/course/${c.id}`, thumb: pub(c.k, c.v ?? 0), courseId: c.id });
    } else if (h.kind === "lesson" || h.kind === "section") {
      const l = await db.prepare(`SELECT l.title, c.id AS cid, c.title AS ct, COALESCE(c.cover_key, c.edm_key) AS k, c.art_version AS v FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND ${PUBLIC}`).bind(h.ref).first<{ title: string; cid: string; ct: string; k: string | null; v: number | null }>();
      if (l) out.push({ ...base, title: l.title, sub: l.ct, link: h.kind === "lesson" ? `/course/${l.cid}?lesson=${enc(h.ref)}` : `/course/${l.cid}?block=${enc(h.ref)}`, thumb: pub(l.k, l.v ?? 0), courseId: l.cid });
    } else if (h.kind === "edm" || h.kind === "photo") {
      const m = await db.prepare("SELECT owner_kind, owner_key, center_key, kind, r2_key, poster_key FROM cover_media WHERE id = ?").bind(h.ref).first<{ owner_kind: string; owner_key: string; center_key: string | null; kind: string; r2_key: string; poster_key: string | null }>();
      if (!m || m.kind !== "image") continue;
      let title = "";
      let link = "";
      let courseId: string | undefined;
      if (m.owner_kind === "center" && m.center_key) {
        const c = await centerOf(m.center_key);
        (title = c.name), (link = `/courses?center=${enc(c.name)}`);
      } else if (m.owner_kind === "series") (title = m.owner_key), (link = `/series/${enc(m.owner_key)}`);
      else {
        // 課程的 EDM／相片：owner_key 是課程編號，或（區塊照片）區塊的編號。
        const c = (await courseOf(m.owner_key)) ?? (await db.prepare(`SELECT c.id, c.title FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND ${PUBLIC}`).bind(m.owner_key).first<{ id: string; title: string }>());
        if (c) (title = c.title), (link = `/course/${c.id}`), (courseId = c.id);
      }
      // 直接放大看圖（link 留著，放大畫面可再前往）；縮圖＝圖片本身。
      if (title) out.push({ ...base, title, sub: h.txt.replace(/\s+/g, " ").slice(0, 60), link, thumb: pub(m.r2_key), image: pub(m.r2_key)!, ...(courseId ? { courseId } : {}) });
    }
  }
  return out;
}
