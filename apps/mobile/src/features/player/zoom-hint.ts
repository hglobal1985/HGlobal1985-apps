import { trackFeature } from "@/lib/feature-track";
import { flashText } from "@/ui/flash-notice";

/** 「可拖曳或放大縮小、點兩下復原」提示：改用全螢幕提醒（業主 2026-11-17）；整個網站每次開啟只提醒一次，免得每換一堂都跳出來。 */
let shown = false;
export function zoomHintOnce() {
  trackFeature("video_zoom");
  if (shown) return;
  shown = true;
  flashText("可拖曳或放大縮小，點兩下復原");
}
