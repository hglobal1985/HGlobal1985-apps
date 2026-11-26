import { useApi } from "@/state/session";

/** 公告的範圍：中心、系列、首頁（杜杜龍 2026-11-21 統一成同一個模組，後端同一張表）。 */
export type BroadcastScope = "center" | "series" | "home";
export type BroadcastItem = { id: string; text: string; date: string; scope: BroadcastScope; canEdit: boolean };
export type Broadcasts = { seconds: number; items: BroadcastItem[] };

/** 讀公告（公開）：center＋series 可同時給（中心課程頁＝該中心＋所屬系列的公告）；home＝首頁。都沒給就不讀。 */
export function useBroadcasts(t: { center?: string; series?: string; home?: boolean }) {
  const q = [t.home ? "home=1" : "", t.center ? `center=${encodeURIComponent(t.center)}` : "", t.series ? `series=${encodeURIComponent(t.series)}` : ""].filter(Boolean).join("&");
  return useApi<Broadcasts>(q ? `/broadcasts?${q}` : null);
}
