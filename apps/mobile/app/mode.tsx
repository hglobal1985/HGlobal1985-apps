import { Redirect } from "expo-router";
import { ModePage } from "@/features/elder/mode-page";
import { useModeProfile } from "@/lib/app-mode";

/** 模式頁（/mode）：只有「按模式鍵進整頁」的模式（至尊）才有；其他模式回首頁。 */
export default function ModeRoute() {
  return useModeProfile().modeKey === "page" ? <ModePage /> : <Redirect href="/" />;
}
