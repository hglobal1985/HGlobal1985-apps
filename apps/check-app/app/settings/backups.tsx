import { api } from "@/api/client";
import { BackupRestorePanel } from "@/features/backup-restore";
import { Screen } from "@/kit";

/** 備份還原（超級管理員；共用面板 packages/ui/src/features/backup-restore.tsx；後端 /admin/backups，沒有權限伺服器會回 403）。 */
export default function BackupsPage() {
  return (
    <Screen title="備份還原">
      <BackupRestorePanel request={(method, path, body) => api(method, path, body)} />
    </Screen>
  );
}
