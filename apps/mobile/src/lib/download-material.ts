import { Linking, Platform } from "react-native";
import { api, resolveUrl } from "@/api/client";
import { flashText } from "@/ui/flash-notice";

/** 教材檔案的「網址」其實是 dl://附件編號（真正的檔案網址不外露）。 */
export const isDownloadUrl = (url?: string | null): url is string => !!url && url.startsWith("dl://");

/**
 * 下載教材檔案（業主 2026-11-18）：先向伺服器要「一次性下載連結」——伺服器會依這份課程／清單的規則檢查權限
 * （誰能瀏覽、獎銜、報名、付費審核），沒有權限就回覆原因；通過後連結約 2 分鐘內有效、只能用一次，轉傳給別人打開無效。
 */
export async function downloadMaterial(url: string): Promise<void> {
  try {
    const { url: ticket } = await api<{ url: string; name: string }>("POST", `/materials/${encodeURIComponent(url.slice("dl://".length))}/ticket`);
    flashText("開始下載");
    const href = resolveUrl(ticket);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const a = document.createElement("a");
      a.href = href;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      await Linking.openURL(href);
    }
  } catch (e) {
    flashText((e as Error).message || "下載失敗，請稍後再試");
  }
}
