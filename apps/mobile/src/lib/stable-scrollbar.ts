import { Platform } from "react-native";

/**
 * 網頁版：所有捲動區一律預留捲軸的位置（scrollbar-gutter: stable）。
 * 原因（業主 2026-11-17 錄影）：電腦版視窗在某個尺寸時，內容高度剛好卡在「需不需要捲軸」的邊界——
 * 捲軸出現 → 可用寬度變窄 → 卡片重排（一列 3 張變 2 張）→ 內容變高／變矮 → 捲軸消失 → 寬度又變寬……無限循環，畫面一直閃爍、像重影。
 * 預留捲軸位置後，有沒有捲軸寬度都一樣，就不會再來回重排。手機的捲軸本來就不佔寬度，不受影響。
 */
export function installStableScrollbar(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;
  const style = document.createElement("style");
  style.textContent = "*{scrollbar-gutter:stable}";
  document.head.appendChild(style);
  return () => style.remove();
}
