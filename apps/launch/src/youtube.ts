import type { D1Database } from "./d1.ts";
import type { Env } from "./d1.ts";

/** 「PT1H2M3S」→ 秒。 */
export function isoSeconds(d: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  const n = (x?: string) => (x ? Number(x) : 0);
  const s = n(m[1]) * 86400 + n(m[2]) * 3600 + n(m[3]) * 60 + n(m[4]);
  return s > 0 ? s : null;
}

/** 發布時間（UTC）換成台灣日期 YYYY-MM-DD。 */
export function taipeiDay(iso: string | undefined): string | null {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return null;
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
}

export type YtMeta = { date: string | null; seconds: number | null; title: string | null };

/** 用 YouTube Data API（官方，videos.list）一次查最多 50 支：每次呼叫只花 1 單位額度（每天免費 1 萬單位）。 */
export async function fetchYoutubeMeta(key: string, ids: string[], fetcher: typeof fetch = fetch): Promise<Map<string, YtMeta>> {
  const out = new Map<string, YtMeta>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${chunk.join(",")}&key=${encodeURIComponent(key)}`;
    const res = await fetcher(url, { headers: { accept: "application/json" } }).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json().catch(() => null)) as { items?: { id: string; snippet?: { publishedAt?: string; title?: string }; contentDetails?: { duration?: string } }[] } | null;
    for (const it of data?.items ?? []) out.set(it.id, { date: taipeiDay(it.snippet?.publishedAt), seconds: isoSeconds(it.contentDetails?.duration), title: it.snippet?.title ?? null });
  }
  return out;
}

const idOf = (input: string | null | undefined): string | null => {
  if (!input) return null;
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname.replace(/^www\./, "") === "youtu.be") return u.pathname.split("/")[1] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    return /\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
};

/**
 * 排程補齊（每 10 分鐘，每次最多 50 個教材，含「完整版課程影片」那一列，業主 2026-11-18）：YouTube 教材的影片長度（0 分鐘者）與發布日期（教材日期空白者）。
 * 沒設定 YOUTUBE_API_KEY 就什麼都不做（不耗資源）；沒有待查的教材時只有一個很小的資料庫查詢。
 * 只有「教材」會填日期（章節的日期是上課日期，不動）。
 */
export async function backfillYoutube(env: Env, limit = 50, fetcher: typeof fetch = fetch): Promise<{ checked: number; updated: number }> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return { checked: 0, updated: 0 };
  const db: D1Database = env.DB;
  const { results } = await db
    .prepare(
      `SELECT l.id, l.kind, l.start_seconds AS s, l.end_seconds AS e, l.duration_minutes AS mins, l.event_date AS d, l.media_type AS mt, l.media_ref AS ref,
        (SELECT a.link_url FROM lesson_attachments a WHERE a.lesson_id = l.id AND a.kind = 'link' AND a.att_type = 'youtube' LIMIT 1) AS link
       FROM lessons l WHERE l.yt_checked_at IS NULL AND l.kind <> 'section'
        AND ((l.media_type = 'youtube' AND l.media_ref IS NOT NULL) OR EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = l.id AND a.kind = 'link' AND a.att_type = 'youtube'))
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; kind: string; s: number | null; e: number | null; mins: number; d: string | null; mt: string; ref: string | null; link: string | null }>();
  if (!results.length) return { checked: 0, updated: 0 };
  const vids = results.map((r) => ({ r, vid: idOf(r.mt === "youtube" ? r.ref : r.link) }));
  const meta = await fetchYoutubeMeta(key, [...new Set(vids.map((x) => x.vid).filter((x): x is string => !!x))], fetcher);
  const now = new Date().toISOString();
  const stmts: ReturnType<D1Database["prepare"]>[] = [];
  let updated = 0;
  for (const { r, vid } of vids) {
    const m = vid ? meta.get(vid) : undefined;
    const sets: string[] = ["yt_checked_at = ?"];
    const vals: unknown[] = [now];
    if (m) {
      if (r.kind === "material" && !r.d && m.date) (sets.push("event_date = ?"), vals.push(m.date));
      if (r.mins === 0 && m.seconds) {
        const len = r.e != null ? r.e - (r.s ?? 0) : m.seconds - (r.s ?? 0);
        if (len > 0) (sets.push("duration_minutes = ?"), vals.push(Math.max(1, Math.ceil(len / 60))));
      }
      if (sets.length > 1) updated++;
    }
    stmts.push(db.prepare(`UPDATE lessons SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, r.id));
  }
  await db.batch(stmts);
  return { checked: results.length, updated };
}
