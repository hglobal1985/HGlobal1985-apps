import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { accountCenterUrl } from "@/api/central";

/** 開啟完整版會員中心（基本資料編輯）：已登入直接進入，不再選 Google 帳號（杜杜龍 2026-11-24）。 */
export async function openAccountCenter(): Promise<void> {
  const url = await accountCenterUrl();
  if (Platform.OS === "web") globalThis.location.assign(url) // 整頁導向（非同步取碼之後開新分頁會被瀏覽器擋）;
  else await WebBrowser.openBrowserAsync(url);
}
