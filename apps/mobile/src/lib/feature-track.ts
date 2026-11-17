import { api } from "@/api/client";
import type { FeatureKey } from "../../../launch/src/contract";

/**
 * 功能體驗徽章（業主 2026-11-17，類似新手教學）：會員第一次用到某個網站功能時回報給伺服器，
 * 伺服器記錄並結算對應徽章。同一個分頁、同一個功能只回報一次；沒登入或失敗都靜默略過，不影響操作。
 * 新增功能徽章：在 contract.ts 的 FEATURES 加一筆，再在功能的入口呼叫 trackFeature("代碼")。
 */
const sent = new Set<string>();
export function trackFeature(key: FeatureKey) {
  if (sent.has(key)) return;
  sent.add(key);
  api("POST", "/me/features", { feature: key }).catch(() => sent.delete(key));
}
