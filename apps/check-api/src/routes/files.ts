/** 寰宇繳作業系統 API 網址：通知、檔案保存、一鍵下載備份（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import { zipNamer, zipStream, type ZipEntry } from "../../../../packages/server-shared/src/zip-stream.ts";
import type { Notice } from "../contract.ts";
import type { D1Database, Env } from "../env.ts";
import { type Row, access, body, deleteR2, fail, nameOr, names, needActive, needManager, needTeacher, notify, now, on, retentionOf, rid } from "../core.ts";

// 提醒、通知
on("POST", "/lessons/:id/remind", async (c, [id]) => {
  const l = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(id).first<Row>();
  if (!l) fail(404, "找不到這一堂");
  needTeacher(await access(c, String(l!.activity_id)));
  const ids = await notSubmitted(c.env.DB, l!);
  await notify(c.env.DB, ids, "作業提醒", `「${l!.title}」還有作業沒交${l!.due_at ? `，截止時間 ${twTime(String(l!.due_at))}` : ""}。`, `/activity/${l!.activity_id}`);
  return { reminded: ids.length };
});
export async function notSubmitted(db: D1Database, lesson: Row): Promise<string[]> {
  return (
    await db
      .prepare(
        "SELECT m.member_id FROM members m WHERE m.activity_id = ? AND m.role = 'student' AND m.status = 'active' AND EXISTS (SELECT 1 FROM items i WHERE i.lesson_id = ? AND i.mode != 'onsite' AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.item_id = i.id AND s.member_id = m.member_id AND s.status IN ('submitted','leader_ok','graded')))",
      )
      .bind(lesson.activity_id, lesson.id)
      .all<Row>()
  ).results.map((r) => String(r.member_id));
}
export const twTime = (iso: string) => {
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
on("GET", "/notices", async (c) => {
  const rows = (await c.env.DB.prepare("SELECT * FROM notices WHERE member_id = ? ORDER BY created_at DESC LIMIT 100").bind(c.sub).all<Row>()).results;
  return rows.map((r): Notice => ({ id: String(r.id), title: String(r.title), body: String(r.body), link: String(r.link), read: !!r.read_at, createdAt: String(r.created_at) }));
});
on("POST", "/notices/read", async (c, _p, req) => {
  const b = await body(req);
  if (typeof b.id === "string") await c.env.DB.prepare("UPDATE notices SET read_at = ? WHERE id = ? AND member_id = ?").bind(now(), b.id, c.sub).run();
  else await c.env.DB.prepare("UPDATE notices SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(now(), c.sub).run();
  return { ok: true };
});

// 檔案保存：備份清單、成績表、刪除全部檔案
on("GET", "/activities/:id/files", async (c, [id], req) => {
  const a = await access(c, id);
  needActive(a);
  const mine = new URL(req.url).searchParams.get("mine") === "1" || !a.teacher;
  const rows = (
    await c.env.DB.prepare(
      `SELECT f.id, f.kind, f.name, f.size, f.url, f.body, f.r2_key, s.member_id, i.name AS item_name, l.title AS lesson_title FROM files f JOIN submissions s ON s.id = f.submission_id JOIN items i ON i.id = s.item_id JOIN lessons l ON l.id = i.lesson_id WHERE s.activity_id = ? ${mine ? "AND s.member_id = ?" : ""} ORDER BY l.position, i.position, s.member_id, f.position`,
    )
      .bind(...(mine ? [id, c.sub] : [id]))
      .all<Row>()
  ).results;
  const nm = await names(c.env.DB, rows.map((r) => String(r.member_id)));
  const out = [];
  for (const r of rows) {
    let url = r.kind === "link" ? String(r.url) : "";
    if (r.r2_key) {
      const t = rid(24);
      await c.env.DB.prepare("INSERT INTO tickets (id, file_id, member_id, expires_at) VALUES (?, ?, ?, ?)").bind(t, r.id, c.sub, Date.now() + 3600_000).run();
      url = `/f/${t}?download=1`;
    }
    out.push({ id: r.id, kind: r.kind, name: r.name, size: r.size, url, body: r.kind === "text" ? r.body : undefined, member: nameOr(nm, String(r.member_id)), item: r.item_name, lesson: r.lesson_title });
  }
  return { retentionUntil: retentionOf(a.activity), purged: !!a.activity.files_purged_at, files: out };
});
// 一鍵下載備份（杜杜龍 2026-11-27）：整份作業打包成 ZIP 壓縮檔，每包最多 400MB（太大自動分包，每包各自下載）。
// 學員下載自己的；老師以上可以下載全部（依「課程／作業項目／學員」分資料夾）。文字作業存成 .txt，連結收在「連結.txt」。
export const ZIP_PART_BYTES = 400 * 1024 * 1024;
export type BackupRow = { id: string; kind: string; name: string; size: number; r2_key: string | null; url: string | null; body: string | null; created_at: string; member_id: string; item_name: string; lesson_title: string; lesson_pos: number; item_pos: number };
export async function backupParts(db: D1Database, activityId: string, member: string | null): Promise<{ rows: BackupRow[]; parts: BackupRow[][]; extras: BackupRow[] }> {
  const rows = (
    await db
      .prepare(
        `SELECT f.id, f.kind, f.name, f.size, f.r2_key, f.url, f.body, f.created_at, s.member_id, i.name AS item_name, l.title AS lesson_title, l.position AS lesson_pos, i.position AS item_pos FROM files f JOIN submissions s ON s.id = f.submission_id JOIN items i ON i.id = s.item_id JOIN lessons l ON l.id = i.lesson_id WHERE s.activity_id = ? ${member ? "AND s.member_id = ?" : ""} ORDER BY l.position, i.position, s.member_id, f.position, f.id`,
      )
      .bind(...(member ? [activityId, member] : [activityId]))
      .all<BackupRow>()
  ).results;
  const parts: BackupRow[][] = [];
  let cur: BackupRow[] = [];
  let bytes = 0;
  for (const r of rows.filter((x) => x.r2_key)) {
    if (cur.length && bytes + Number(r.size) > ZIP_PART_BYTES) {
      parts.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(r);
    bytes += Number(r.size);
  }
  const extras = rows.filter((x) => !x.r2_key && (x.kind === "text" || x.kind === "link"));
  if (cur.length || extras.length || !parts.length) parts.push(cur);
  return { rows, parts, extras };
}
on("GET", "/activities/:id/backup", async (c, [id], req) => {
  const a = await access(c, id);
  needActive(a);
  const all = new URL(req.url).searchParams.get("all") === "1" && a.teacher;
  if (a.activity.files_purged_at) return { purged: true, retentionUntil: retentionOf(a.activity), parts: [] };
  const { parts } = await backupParts(c.env.DB, id, all ? null : c.sub);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const t = rid(24);
    await c.env.DB.prepare("INSERT INTO zip_tickets (id, activity_id, member_id, scope, part, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(t, id, c.sub, all ? "all" : "mine", i, Date.now() + 3600_000).run();
    out.push({ index: i + 1, files: parts[i]!.length, bytes: parts[i]!.reduce((n, r) => n + Number(r.size), 0), url: `/z/${t}` });
  }
  return { purged: false, retentionUntil: retentionOf(a.activity), parts: out };
});
/** 下載壓縮檔（/z/<憑證>；1 小時內有效，有權限的人才拿得到憑證）。 */
export async function handleZip(req: Request, env: Env): Promise<Response> {
  const id = new URL(req.url).pathname.split("/")[2] ?? "";
  const plain = { "content-type": "text/plain; charset=utf-8" };
  const t = await env.DB.prepare("SELECT * FROM zip_tickets WHERE id = ?").bind(id).first<Row>();
  if (!t || Number(t.expires_at) < Date.now()) return new Response("下載連結已失效，請回到 App 重新按「一鍵下載備份」", { status: 410, headers: plain });
  const act = await env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(t.activity_id).first<Row>();
  if (!act || act.files_purged_at) return new Response("檔案已刪除", { status: 410, headers: plain });
  const all = t.scope === "all";
  const { parts, extras } = await backupParts(env.DB, String(t.activity_id), all ? null : String(t.member_id));
  const part = Number(t.part);
  const files = parts[part] ?? [];
  const nm = all ? await names(env.DB, [...files, ...extras].map((r) => r.member_id)) : new Map<string, { name: string; avatarUrl: string | null }>();
  const who = (r: BackupRow) => (all ? `${nameOr(nm, r.member_id)}_` : "");
  const top = String(act.title);
  const naming = zipNamer();
  const entries: ZipEntry[] = files.map((r) => ({
    name: naming(`${top}/${r.lesson_title}/${r.item_name}/${who(r)}${r.name || r.id}`),
    date: new Date(r.created_at),
    open: async () => (await env.FILES.get(String(r.r2_key)))?.body ?? null,
  }));
  if (part === 0) {
    const enc = new TextEncoder();
    for (const r of extras.filter((x) => x.kind === "text"))
      entries.push({ name: naming(`${top}/${r.lesson_title}/${r.item_name}/${who(r)}${(r.name || "文字作業").replace(/\.txt$/i, "")}.txt`), date: new Date(r.created_at), open: async () => enc.encode(String(r.body ?? "")) });
    const links = extras.filter((x) => x.kind === "link");
    if (links.length) entries.push({ name: naming(`${top}/連結.txt`), open: async () => enc.encode(links.map((r) => `${r.lesson_title}／${r.item_name}${all ? `／${nameOr(nm, r.member_id)}` : ""}：${r.url ?? ""}`).join("\r\n")) });
  }
  const fileName = `${top}${all ? "_全部作業" : "_我的作業"}${parts.length > 1 ? `_第${part + 1}包` : ""}.zip`;
  return new Response(zipStream(entries), {
    headers: {
      "content-type": "application/zip",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
on("GET", "/activities/:id/storage", async (c, [id]) => {
  needTeacher(await access(c, id));
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(f.size), 0) AS bytes FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.activity_id = ? AND f.r2_key IS NOT NULL").bind(id).first<Row>();
  return { files: Number(r?.n ?? 0), bytes: Number(r?.bytes ?? 0) };
});
on("POST", "/activities/:id/purge", async (c, [id]) => {
  needManager(await access(c, id));
  return { deleted: await purgeFiles(c.env, id) };
});
export async function purgeFiles(env: Env, activityId: string): Promise<number> {
  const rows = (await env.DB.prepare("SELECT f.id, f.r2_key FROM files f JOIN submissions s ON s.id = f.submission_id WHERE s.activity_id = ? AND f.r2_key IS NOT NULL").bind(activityId).all<Row>()).results;
  await deleteR2(env, rows.map((r) => String(r.r2_key)));
  await env.DB.batch([
    env.DB.prepare("UPDATE files SET r2_key = NULL, size = 0 WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id = ?) AND r2_key IS NOT NULL").bind(activityId),
    env.DB.prepare("UPDATE activities SET files_purged_at = ? WHERE id = ?").bind(now(), activityId),
  ]);
  return rows.length;
}
on("GET", "/activities/:id/scores", async (c, [id]) => {
  needTeacher(await access(c, id));
  const db = c.env.DB;
  const items = (await db.prepare("SELECT i.*, l.title AS lesson_title FROM items i JOIN lessons l ON l.id = i.lesson_id WHERE i.activity_id = ? ORDER BY l.position, i.position").bind(id).all<Row>()).results;
  const ms = (await db.prepare("SELECT m.member_id, g.name AS gname FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.activity_id = ? AND m.role = 'student' AND m.status = 'active' ORDER BY g.position, m.joined_at").bind(id).all<Row>()).results;
  const subs = (await db.prepare("SELECT member_id, item_id, points, status FROM submissions WHERE activity_id = ?").bind(id).all<Row>()).results;
  const nm = await names(db, ms.map((m) => String(m.member_id)));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["姓名", "組別", ...items.map((i) => `${i.lesson_title} ${i.name}`), "總分"];
  const lines = [head.map(esc).join(",")];
  for (const m of ms) {
    let total = 0;
    const cells = items.map((i) => {
      const s = subs.find((x) => x.member_id === m.member_id && x.item_id === i.id);
      if (s?.status === "graded") {
        if (i.in_total) total += Number(s.points ?? 0);
        return s.points;
      }
      return "";
    });
    lines.push([nameOr(nm, String(m.member_id)), m.gname ?? "", ...cells, Math.round(total * 10) / 10].map(esc).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="scores.csv"`, "cache-control": "no-store" } });
});
