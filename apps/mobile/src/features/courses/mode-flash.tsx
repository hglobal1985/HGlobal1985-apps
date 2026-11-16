import Ionicons from "@expo/vector-icons/Ionicons";
import { FLASH_ICON, showFlash } from "@/ui/flash-notice";
import type { CourseViewMode } from "./view-toggle";

/** 三種顯示模式的正式名稱（業主 2026-11-15，同日再改為：系列／單元／教育中心）。 */
export const MODE_NAME: Record<CourseViewMode, string> = { series: "系列", chapter: "單元", center: "教育中心" };
const MODE_ICON = { series: "grid-outline", chapter: "list-outline", center: "business-outline" } as const;

/** 切換模式時的全螢幕文字提醒（版面與動畫在共用模組 ui/flash-notice.tsx）。 */
export function flashMode(mode: CourseViewMode, color: string): void {
  showFlash({ icon: <Ionicons name={MODE_ICON[mode]} size={FLASH_ICON - 3} color={color} />, title: MODE_NAME[mode] });
}
