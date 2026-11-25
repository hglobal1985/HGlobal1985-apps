/**
 * 語意搜尋的資料來源（業主 2026-11-25）：每一種來源＝哪張資料表的哪個欄位、搜尋結果的膠囊標籤叫什麼、點下去去哪。
 * 在「設定 → 搜尋與 AI 設定」可個別開關（search-settings.ts 的 semSrc* 參數）；新增來源只加這一處＋一個開關參數。
 * 只收公開的文字（已上架、非「只限網址」的課程；中心／系列／相簿／EDM 本來就公開），不含會員或 Amway 資料。
 */
import type { D1Database } from "./d1.ts";

export type SourceKind = "course" | "lesson" | "section" | "series" | "center" | "intro" | "edm" | "photo";
export type Candidate = { kind: SourceKind; ref: string; txt: string };
export type Hit = { kind: SourceKind; tag: string; id: string; title: string; sub: string; link: string; score: number };

export const SOURCES: { kind: SourceKind; param: string; tag: string; label: string; fields: string }[] = [
  { kind: "course", param: "semSrcCourse", tag: "課程卡", label: "課程卡", fields: "courses.title（課程名稱）" },
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
/** 把「非課程／非章節」的命中補上標題與連結（只處理分數最高的幾筆）。看不到的（下架、只限網址）直接略過。 */
export async function resolveHits(db: D1Database, hits: { kind: SourceKind; ref: string; txt: string; score: number }[]): Promise<Hit[]> {
  const out: Hit[] = [];
  const centerName = async (key: string) => (await db.prepare("SELECT display_name AS n FROM center_names WHERE center_key = ?").bind(key).first<{ n: string }>())?.n || key;
  const courseOf = (id: string) => db.prepare(`SELECT c.id, c.title FROM courses c WHERE c.id = ? AND ${PUBLIC}`).bind(id).first<{ id: string; title: string }>();
  for (const h of hits) {
    const base = { kind: h.kind, tag: tagOf(h.kind), id: `${h.kind}:${h.ref}`, score: h.score };
    if (h.kind === "series") out.push({ ...base, title: h.txt, sub: "", link: `/series/${enc(h.ref)}` });
    else if (h.kind === "center") out.push({ ...base, title: await centerName(h.ref), sub: "", link: `/courses?center=${enc(h.ref)}` });
    else if (h.kind === "intro") {
      const c = await courseOf(h.ref);
      if (c) out.push({ ...base, title: c.title, sub: h.txt.slice(0, 60), link: `/course/${c.id}` });
    } else if (h.kind === "lesson" || h.kind === "section") {
      const l = await db.prepare(`SELECT l.title, c.id AS cid, c.title AS ct FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND ${PUBLIC}`).bind(h.ref).first<{ title: string; cid: string; ct: string }>();
      if (l) out.push({ ...base, title: l.title, sub: l.ct, link: `/course/${l.cid}` });
    } else if (h.kind === "edm" || h.kind === "photo") {
      const m = await db.prepare("SELECT owner_kind, owner_key, center_key FROM cover_media WHERE id = ?").bind(h.ref).first<{ owner_kind: string; owner_key: string; center_key: string | null }>();
      if (!m) continue;
      let title = "";
      let link = "";
      if (m.owner_kind === "center" && m.center_key) (title = await centerName(m.center_key)), (link = `/courses?center=${enc(m.center_key)}`);
      else if (m.owner_kind === "series") (title = m.owner_key), (link = `/series/${enc(m.owner_key)}`);
      else {
        // 課程的 EDM／相片：owner_key 是課程編號，或（區塊照片）區塊的編號。
        const c = (await courseOf(m.owner_key)) ?? (await db.prepare(`SELECT c.id, c.title FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND ${PUBLIC}`).bind(m.owner_key).first<{ id: string; title: string }>());
        if (c) (title = c.title), (link = `/course/${c.id}`);
      }
      if (title) out.push({ ...base, title, sub: h.txt.replace(/\s+/g, " ").slice(0, 60), link });
    }
  }
  return out;
}
