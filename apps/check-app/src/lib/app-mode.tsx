import type { ReactNode } from "react";
import { useElderOn } from "@/lib/elder-mode";

/**
 * 繳作業系統的「至尊模式／超派模式」設定檔（共用元件會讀 useModeProfile()）。
 * 切換機制、字體放大與共用元件的行為和行動大學完全一樣（packages/ui 的 lib/elder-mode.ts）；
 * 這裡只決定繳作業系統在兩種模式下要顯示哪些功能。要調整只改 MODE_PROFILES。
 */
export type FeatureKey = "manage" | "deleteAccount";

export type ModeProfile = {
  key: "elder" | "super";
  name: string;
  /** 底部主選單要顯示的分頁（依序；分頁本身在 lib/nav-tabs.tsx）。 */
  tabs: string[];
  /** 底部主選單放大（至尊模式）。 */
  bigNav: boolean;
  /** 按模式鍵：switch＝直接切換到另一個模式。 */
  modeKey: "switch" | "page";
  /** 頁面大標題與右側按鈕上下堆疊（字放大後才不會擠）。 */
  stackHeaders: boolean;
  /** 上拉選單：sheet＝從下方拉出；page＝整頁顯示（至尊模式不用上拉選單）。 */
  sheets: "sheet" | "page";
  features: Record<FeatureKey, boolean>;
};

export const MODE_PROFILES: Record<ModeProfile["key"], ModeProfile> = {
  elder: { key: "elder", name: "至尊", tabs: ["home", "review", "notices", "me"], bigNav: true, modeKey: "switch", stackHeaders: true, sheets: "page", features: { manage: false, deleteAccount: false } },
  super: { key: "super", name: "超派", tabs: ["home", "review", "notices", "me"], bigNav: false, modeKey: "switch", stackHeaders: false, sheets: "sheet", features: { manage: true, deleteAccount: true } },
};

export function useModeProfile(): ModeProfile {
  return MODE_PROFILES[useElderOn() ? "elder" : "super"];
}
export function useFeature(key: FeatureKey): boolean {
  return useModeProfile().features[key];
}
export function ModeGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  return useFeature(feature) ? <>{children}</> : null;
}
