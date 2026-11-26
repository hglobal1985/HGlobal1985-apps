import { useEffect, useSyncExternalStore } from "react";
import { api, type ThumbBadge, type ThumbBadgeKind } from "@/api/client";

/**
 * 縮圖符號（杜杜龍 2026-11-23）：全站只讀一次 `/thumb-badges`（所有系列卡、課程卡、中心卡指定的符號與顏色），
 * 每個縮圖用 `useThumbBadge(kind, key)` 取自己的；編輯存檔後呼叫 `reloadThumbBadges()`，全站縮圖立刻更新。
 */
let data: Map<string, ThumbBadge> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const keyOf = (kind: ThumbBadgeKind, key: string) => `${kind}:${key}`;
const emit = () => listeners.forEach((l) => l());

export function reloadThumbBadges(): Promise<void> {
  loading = api<ThumbBadge[]>("GET", "/thumb-badges")
    .then((rows) => {
      data = new Map(rows.map((b) => [keyOf(b.kind, b.key), b]));
      emit();
    })
    .catch(() => {
      if (!data) data = new Map(); // 讀不到就當作都沒設定（顯示預設圖示），下次重新整理再試
      emit();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => data;

/** 取得某張卡的縮圖符號；沒設定回 null（畫面用預設圖示）。key：課程＝課程編號、系列＝系列名稱、中心＝中心名稱。 */
export function useThumbBadge(kind: ThumbBadgeKind, key: string | null | undefined): ThumbBadge | null {
  const map = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!data && !loading) void reloadThumbBadges();
  }, []);
  if (!map || !key) return null;
  return map.get(keyOf(kind, kind === "center" ? key.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() : key)) ?? null;
}
