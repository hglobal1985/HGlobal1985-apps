import { useFocusEffect } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";
import { Platform } from "react-native";

/** 書櫃自成一套咖啡色系（業主 2026-11-17）；底部主選單與瀏覽器工具列也跟著變色。 */
export const LIB = {
  bg: "#2A1D16",
  wood: "#7A4B2A",
  woodDark: "#5A3820",
  brass: "#D8B26A",
  brassDark: "#B28A3E",
  text: "#F3E6CC",
  muted: "#BFA98A",
  card: "#3A2A20",
};

let depth = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

function setThemeColor(color: string) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", color);
}

/** 書櫃頁面呼叫：進入時整個 App 換成咖啡色系（底部選單不亮任何分頁、瀏覽器主色變咖啡色），離開還原。 */
export function useLibraryChrome() {
  // 用「畫面取得／失去焦點」而不是掛載／卸載：從書櫃切到別的分頁時，書櫃畫面還留在堆疊裡不會卸載。
  useFocusEffect(
    useCallback(() => {
      depth += 1;
      setThemeColor(LIB.bg);
      emit();
      return () => {
        depth -= 1;
        if (depth <= 0) {
          depth = 0;
          setThemeColor("#2F5D3A");
        }
        emit();
      };
    }, []),
  );
}

export const useLibraryMode = () =>
  useSyncExternalStore(
    subscribe,
    () => depth > 0,
    () => false,
  );
