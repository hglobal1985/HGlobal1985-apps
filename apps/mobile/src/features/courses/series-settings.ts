import { useMemo } from "react";
import { UNCATEGORIZED, type SeriesSetting } from "@/api/client";
import { isSuperAdmin } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";

/**
 * 系列卡的設定（業主 2026-11-19）：標題只改顯示（識別名稱不動）、是否顯示在「所有系列」；「未分類」系列只有超級管理員看得到。
 * 全站要顯示系列名稱、判斷系列要不要出現，一律用這裡，不可各自判斷。
 */
export function useSeriesSettings() {
  const { member } = useSession();
  const list = useApi<SeriesSetting[]>("/series-settings");
  const admin = isSuperAdmin(member);
  return useMemo(() => {
    const map = new Map((list.data ?? []).map((x) => [x.series, x]));
    return {
      admin,
      reload: list.reload,
      /** 系列顯示的名稱（有設定標題就用標題）。 */
      titleOf: (series: string) => map.get(series)?.title?.trim() || series,
      /** 設定裡的「顯示在所有系列」（沒設定過＝顯示）。 */
      showInAll: (series: string) => map.get(series)?.showInAll !== false,
      /** 這個系列在第一層（所有系列）看得到嗎：未分類只有超級管理員；關掉「顯示在所有系列」的只有超級管理員。 */
      listed: (series: string) => admin || (series !== UNCATEGORIZED && map.get(series)?.showInAll !== false),
    };
  }, [list.data, list.reload, admin]);
}

/** 學員看得到的卡：系列頁隱藏的卡只有超級管理員看得到（編輯模式淡化顯示）。 */
