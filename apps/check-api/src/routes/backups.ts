/**
 * 繳作業系統後台：備份還原（杜杜龍 2026-11-27；共用模組 packages/server-shared/src/backup-restore.ts，規則見 docs/rules/member-central.md「備份還原」）。
 * 只給超級管理員。還原正式資料須杜杜龍核准：要輸入備份日期當確認字樣，還原前自動備份現況；這個 App 沒有稽核資料表，只寫不含資料內容的日誌。
 */
import { listBackups, planRestore, runRestore, type RestoreBucket, type RestoreDb } from "../../../../packages/server-shared/src/backup-restore.ts";
import { type Ctx, body, fail, on, superAdmin } from "../core.ts";
import { CHECK_BACKUP_TABLES } from "../weekly-backup.ts";

/** 真正的 R2 物件有 text()；型別上只宣告用到的部分。 */
const bucketOf = (c: Ctx): RestoreBucket => c.env.FILES as unknown as RestoreBucket;
const dbOf = (c: Ctx) => c.env.DB as unknown as RestoreDb;
async function needSuper(c: Ctx): Promise<void> {
  if (!(await superAdmin(c))) fail(403, "只有超級管理員可以使用備份還原");
}

on("GET", "/admin/backups", async (c) => {
  await needSuper(c);
  return { backups: await listBackups(bucketOf(c)) };
});
on("GET", "/admin/backups/:date", async (c, [date]) => {
  await needSuper(c);
  return (await planRestore(dbOf(c), bucketOf(c), CHECK_BACKUP_TABLES, date!)) ?? fail(404, "找不到這份備份");
});
on("POST", "/admin/backups/:date/restore", async (c, [date], req) => {
  await needSuper(c);
  const b = await body(req);
  try {
    const r = await runRestore({ db: dbOf(c), bucket: bucketOf(c), appId: "check", appLabel: "繳作業系統", tables: CHECK_BACKUP_TABLES, date: date!, confirm: typeof b.confirm === "string" ? b.confirm : "", now: new Date() });
    console.log("backup restore", JSON.stringify({ date, tables: Object.keys(r.restored).length, pre_restore: r.pre_restore }));
    return r;
  } catch (e) {
    const code = e instanceof Error ? e.message : "error";
    if (code === "confirm_mismatch") fail(400, "請輸入備份日期確認");
    if (code === "backup_not_found") fail(404, "找不到這份備份");
    if (code === "backup_mismatch" || code === "backup_incomplete") fail(409, "備份內容和目前資料表對不上，沒有還原任何資料");
    throw e;
  }
});
