import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../src/d1.ts";

/** 以 node:sqlite 模擬 D1（測試用），並套用 migrations。 */
/**
 * 測試用資料庫（套用全部 migration）。
 * firstLesson（預設 true）＝測試資料捷徑：新建的一般課程自動帶一堂空白「第 1 堂」。
 * 正式程式自 2026-11-16 起新增課程不再自動建立章節（業主指示）；這個捷徑只是讓早期寫好、需要一堂章節的測試不必各自多建一堂。
 * 要驗證「新增課程沒有章節」的測試請傳 { firstLesson: false }。
 */
export function createTestDb(opts: { firstLesson?: boolean } = {}): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  if (opts.firstLesson !== false)
    db.exec("CREATE TRIGGER test_first_lesson AFTER INSERT ON courses WHEN NEW.is_list = 0 AND IFNULL(NEW.created_by_sub, '') <> '' AND NEW.title NOT LIKE '%（複製）' BEGIN INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type) VALUES (NEW.id || '-l1', NEW.id, 1, '第 1 堂', 0, 'demo'); END;");

  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement & { exec(): D1Result } => {
    const args = () => values.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v)) as never[];
    const exec = (): D1Result => {
      const st = db.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: st.all(...args()) as unknown[] };
      const r = st.run(...args());
      return { results: [], meta: { changes: Number(r.changes) } };
    };
    return {
      bind: (...v: unknown[]) => statement(sql, v),
      first: async <T,>() => ((db.prepare(sql).get(...args()) as T | undefined) ?? null),
      all: async <T,>() => exec() as D1Result<T>,
      run: async () => exec(),
      exec,
    };
  };
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
