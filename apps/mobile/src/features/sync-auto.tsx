import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useApi } from "@/state/session";
import { AppText, Card, Check } from "@/ui";
import { space } from "@/theme/tokens";
import { flashText } from "@/ui/flash-notice";

/**
 * 自動同步開關（杜杜龍 2026-11-26）：「同步 YouTube 清單」與「同步雲端資料夾」兩頁共用同一個設定——
 * 開＝每週自動同步一次（超過 7 天沒同步的清單／資料夾），手動「同步」鈕照常可按。
 */
export function SyncAutoCard() {
  const s = useApi<{ weekly: boolean }>("/admin/sync-settings");
  const [weekly, setWeekly] = useState(true);
  useEffect(() => {
    if (s.data) setWeekly(s.data.weekly);
  }, [s.data]);
  const change = async (v: boolean) => {
    setWeekly(v);
    try {
      await api("PUT", "/admin/sync-settings", { weekly: v });
      flashText(v ? "已開啟每週自動同步" : "已關閉自動同步");
    } catch (e) {
      setWeekly(!v);
      flashText((e as Error).message);
    }
  };
  return (
    <Card style={{ gap: space.xs }}>
      <Check label="每週自動同步一次" value={weekly} onChange={(v) => void change(v)} disabled={!s.data} />
      <AppText variant="caption" tone="muted">
        同步 YouTube 清單與同步雲端資料夾共用這個設定。超過 7 天沒同步的清單會自動同步；隨時都能手動按「同步」。
      </AppText>
    </Card>
  );
}
