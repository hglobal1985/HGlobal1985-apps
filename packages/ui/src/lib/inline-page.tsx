import { createContext, useContext, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * 「放在一般頁面裡」的畫面（相簿頁、單道食譜頁：上有 TopBar、下有綠色選單列，杜杜龍 2026-11-26）：
 * 手機瀏海與底部手勢條的安全區已經由上方工具列與底部選單處理了，裡面的畫面不可以再留一次（否則上下多出一大塊空白）。
 * 用 `useInsets()` 取代 `useSafeAreaInsets()`；包在 `InlinePage` 裡面就回傳 0。
 */
const Ctx = createContext(false);
export const InlinePage = ({ children }: { children: ReactNode }) => <Ctx.Provider value>{children}</Ctx.Provider>;
export function useInsets() {
  const safe = useSafeAreaInsets();
  return useContext(Ctx) ? { top: 0, bottom: 0, left: 0, right: 0 } : safe;
}
