import { api } from "@/api/client";
import { BackupRestorePanel } from "@/features/backup-restore";
import { useSession } from "@/state/session";
import { EmptyState, Screen } from "@/ui";

/** 超級管理員：備份還原（共用面板 packages/ui/src/features/backup-restore.tsx；後端 /admin/backups）。 */
export default function BackupsScreen() {
  const { member } = useSession();
  if (!member?.titles.includes("超級管理員")) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以使用" /></Screen>;
  return (
    <Screen header={false}>
      <BackupRestorePanel request={(method, path, body) => api(method, path, body)} />
    </Screen>
  );
}
