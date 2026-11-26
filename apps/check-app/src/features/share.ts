/** 分享：一律呼叫系統分享選單（網頁 Web Share，不支援就複製連結）。 */
import { Platform, Share } from "react-native";
import { WEB_ORIGIN } from "@/central/config";
import { flash } from "@/kit";

export async function shareLink(path: string, text: string): Promise<void> {
  const url = WEB_ORIGIN + path;
  if (Platform.OS === "web") {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "寰宇繳作業系統", text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      flash("已複製連結", "貼到 LINE 傳給學員");
    } catch {
      flash("請手動複製連結", url);
    }
    return;
  }
  await Share.share({ message: `${text}\n${url}` });
}
