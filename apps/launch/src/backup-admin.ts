/**
 * 行動大學後台：備份還原（杜杜龍 2026-11-27；共用模組 packages/server-shared/src/backup-restore.ts）。
 * 只給超級管理員。還原正式資料須杜杜龍核准：要輸入備份日期當確認字樣，還原前自動備份現況，稽核紀錄不含資料內容。
 */
import { listBackups, planRestore, runRestore, type RestoreBucket, type RestoreDb } from "../../../packages/server-shared/src/backup-restore.ts";
import { audit, fail, readJson, requireSuperAdmin } from "./api-core.ts";
import type { Ctx } from "./api-core.ts";
import { LAUNCH_BACKUP_TABLES } from "./weekly-backup.ts";

const bucketOf = (ctx: Ctx): RestoreBucket => {
  const b = ctx.env.MEDIA as unknown as RestoreBucket | undefined;
  return b ?? fail(503, "no_bucket", "沒有備份儲存空間");
};
const dbOf = (ctx: Ctx) => ctx.db as unknown as RestoreDb;

export async function backupList(ctx: Ctx) {
  requireSuperAdmin(ctx);
  return { backups: await listBackups(bucketOf(ctx)) };
}

export async function backupPlan(ctx: Ctx, date: string) {
  requireSuperAdmin(ctx);
  const plan = await planRestore(dbOf(ctx), bucketOf(ctx), LAUNCH_BACKUP_TABLES, date);
  if (!plan) fail(404, "backup_not_found", "找不到這份備份");
  return plan;
}

export async function backupRestore(ctx: Ctx, date: string) {
  const s = requireSuperAdmin(ctx);
  const body = await readJson<{ confirm?: unknown }>(ctx.req);
  try {
    const r = await runRestore({ db: dbOf(ctx), bucket: bucketOf(ctx), appId: "learn", appLabel: "行動大學", tables: LAUNCH_BACKUP_TABLES, date, confirm: typeof body.confirm === "string" ? body.confirm : "", now: new Date() });
    await audit(ctx.db, s.sub, "backup.restore", "backup", date, `${Object.keys(r.restored).length} 張表；還原前備份 ${r.pre_restore}`).run();
    return r;
  } catch (e) {
    const code = e instanceof Error ? e.message : "error";
    if (code === "confirm_mismatch") fail(400, code, "請輸入備份日期確認");
    if (code === "backup_not_found") fail(404, code, "找不到這份備份");
    if (code === "backup_mismatch" || code === "backup_incomplete") fail(409, code, "備份內容和目前資料表對不上，沒有還原任何資料");
    throw e;
  }
}
