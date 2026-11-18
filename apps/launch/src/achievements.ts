/**
 * 學習成就（徽章）：條件由超級管理員設定，會員的進度即時從學習紀錄計算（不另外存進度），
 * 達成時記錄取得時間並通知本人。
 */
import type { Achievement, AchievementType } from "./contract.ts";
import type { D1Database } from "./d1.ts";

type Def = { id: string; name: string; description: string; icon: string; condition_type: AchievementType; threshold: number; course_id: string | null; feature: string | null };

const one = async (db: D1Database, sql: string, ...args: unknown[]) => Number((await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0);

/** 完整學完某門課（有章節且每一堂都完成）。 */
const courseDone = (db: D1Database, sub: string, courseId: string) =>
  one(
    db,
    "SELECT CASE WHEN (SELECT COUNT(*) FROM lessons WHERE course_id = ?1 AND kind = 'chapter') > 0 AND (SELECT COUNT(*) FROM lesson_progress WHERE member_sub = ?2 AND course_id = ?1 AND lesson_id IN (SELECT id FROM lessons WHERE kind = 'chapter')) >= (SELECT COUNT(*) FROM lessons WHERE course_id = ?1 AND kind = 'chapter') THEN 1 ELSE 0 END AS n",
    courseId,
    sub,
  );

async function current(db: D1Database, sub: string, d: Def): Promise<number> {
  switch (d.condition_type) {
    case "lessons_completed":
      return one(db, "SELECT COUNT(*) AS n FROM lesson_progress WHERE member_sub = ? AND lesson_id IN (SELECT id FROM lessons WHERE kind = 'chapter')", sub);
    case "courses_enrolled":
      return one(db, "SELECT COUNT(DISTINCT course_id) AS n FROM enrollments WHERE member_sub = ?", sub);
    case "learning_days":
      return one(db, "SELECT COUNT(DISTINCT date(completed_at, '+8 hours')) AS n FROM lesson_progress WHERE member_sub = ?", sub);
    case "comments_posted":
      return one(db, "SELECT COUNT(*) AS n FROM course_comments WHERE member_sub = ?", sub);
    case "courses_completed":
      return one(
        db,
        `SELECT COUNT(*) AS n FROM (SELECT e.course_id FROM enrollments e WHERE e.member_sub = ?1 GROUP BY e.course_id
           HAVING (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id AND l.kind = 'chapter') > 0
              AND (SELECT COUNT(*) FROM lesson_progress p WHERE p.member_sub = ?1 AND p.course_id = e.course_id AND p.lesson_id IN (SELECT id FROM lessons WHERE kind = 'chapter')) >= (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id AND l.kind = 'chapter'))`,
        sub,
      );
    case "course_completed":
      return d.course_id ? courseDone(db, sub, d.course_id) : 0;
    case "feature_used":
      return d.feature ? one(db, "SELECT COALESCE(MAX(count), 0) AS n FROM feature_uses WHERE member_sub = ? AND feature = ?", sub, d.feature) : 0;
    case "streak_days":
      return one(db, "SELECT COALESCE(MAX(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM (SELECT d, julianday(d) - ROW_NUMBER() OVER (ORDER BY d) AS g FROM (SELECT DISTINCT date(completed_at, '+8 hours') AS d FROM lesson_progress WHERE member_sub = ?)) GROUP BY g)", sub);
    case "watch_minutes":
      return one(db, "SELECT CAST(COALESCE(SUM(COALESCE(NULLIF(l.duration_minutes, 0), (l.end_seconds - l.start_seconds) / 60.0, 0)), 0) AS INTEGER) AS n FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.member_sub = ? AND l.kind = 'chapter'", sub);
    case "centers_subscribed":
      return one(db, "SELECT COUNT(*) AS n FROM center_subscriptions WHERE member_sub = ? AND center_key NOT LIKE 'series:%'", sub);
    case "subscriptions_total":
      return one(db, "SELECT COUNT(*) AS n FROM center_subscriptions WHERE member_sub = ?", sub);
    case "series_subscribed":
      return one(db, "SELECT COUNT(*) AS n FROM center_subscriptions WHERE member_sub = ? AND center_key LIKE 'series:%'", sub);
    case "categories_explored":
      return one(db, "SELECT COUNT(DISTINCT c.category) AS n FROM lesson_progress p JOIN courses c ON c.id = p.course_id WHERE p.member_sub = ? AND c.category <> ''", sub);
    case "early_lessons":
      return one(db, "SELECT COUNT(*) AS n FROM lesson_progress WHERE member_sub = ? AND CAST(strftime('%H', completed_at, '+8 hours') AS INTEGER) BETWEEN 4 AND 7", sub);
    case "night_lessons":
      return one(db, "SELECT COUNT(*) AS n FROM lesson_progress WHERE member_sub = ? AND (CAST(strftime('%H', completed_at, '+8 hours') AS INTEGER) >= 22 OR CAST(strftime('%H', completed_at, '+8 hours') AS INTEGER) < 4)", sub);
    case "weekend_lessons":
      return one(db, "SELECT COUNT(*) AS n FROM lesson_progress WHERE member_sub = ? AND strftime('%w', completed_at, '+8 hours') IN ('0', '6')", sub);
    case "lessons_in_a_day":
      return one(db, "SELECT COALESCE(MAX(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM lesson_progress WHERE member_sub = ? GROUP BY date(completed_at, '+8 hours'))", sub);
  }
}

/**
 * 計算這位會員的所有啟用中徽章：達成的寫入取得時間（只寫一次）。
 * 回傳完整清單與這次「新取得」的徽章（呼叫端用來發通知）。
 */
export async function evaluateAchievements(db: D1Database, sub: string): Promise<{ list: Achievement[]; fresh: Achievement[] }> {
  const [defs, mine] = await Promise.all([
    db
      .prepare("SELECT a.id, a.name, a.description, a.icon, a.condition_type, a.threshold, a.course_id, a.feature, (SELECT title FROM courses WHERE id = a.course_id) AS course_title FROM achievements a WHERE a.active = 1 ORDER BY a.sort_order, a.created_at")
      .all<Def & { course_title: string | null }>(),
    db.prepare("SELECT achievement_id, earned_at FROM member_achievements WHERE member_sub = ?").bind(sub).all<{ achievement_id: string; earned_at: string }>(),
  ]);
  const got = new Map(mine.results.map((r) => [r.achievement_id, r.earned_at]));
  const list: Achievement[] = [];
  const fresh: Achievement[] = [];
  const inserts = [];
  // 同一種條件只算一次（100 枚徽章只有十幾種不同的算法），而且全部同時查（以前一枚一枚排隊查，要等好幾秒）。
  const keyOf = (d: Def) => `${d.condition_type}|${d.course_id ?? ""}|${d.feature ?? ""}`;
  const uniq = new Map<string, Def>();
  for (const d of defs.results) if (!uniq.has(keyOf(d))) uniq.set(keyOf(d), d);
  const values = new Map<string, number>(await Promise.all([...uniq].map(async ([k, d]) => [k, await current(db, sub, d)] as const)));
  for (const d of defs.results) {
    const need = d.condition_type === "course_completed" ? 1 : d.threshold;
    const now = values.get(keyOf(d)) ?? 0;
    let earnedAt = got.get(d.id) ?? null;
    const earned = !!earnedAt || now >= need;
    const a: Achievement = { id: d.id, name: d.name, description: d.description, icon: d.icon, type: d.condition_type, threshold: need, feature: d.feature, courseTitle: d.course_title, current: Math.min(now, need), earned, earnedAt };
    if (earned && !earnedAt) {
      earnedAt = new Date().toISOString();
      a.earnedAt = earnedAt;
      inserts.push(db.prepare("INSERT OR IGNORE INTO member_achievements (member_sub, achievement_id, earned_at) VALUES (?, ?, ?)").bind(sub, d.id, earnedAt));
      fresh.push(a);
    }
    list.push(a);
  }
  if (inserts.length) await db.batch(inserts);
  return { list, fresh };
}
