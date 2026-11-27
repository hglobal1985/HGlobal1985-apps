/**
 * 共用元件（看圖程式）用的「分享圖片／下載圖片」：一律呼叫系統分享選單（網頁 Web Share 傳檔案，不能傳就複製連結）。
 * 作業照片的網址是 10 分鐘有效的下載憑證（/f/…），分享出去的是圖片檔本身，不是網址。
 */
import { Platform, Share } from "react-native";
import { resolveUrl } from "@/api/client";

const absolute = (u: string) => {
  const r = resolveUrl(u);
  return /^https?:/.test(r) || typeof location === "undefined" ? r : `${location.origin}${r}`;
};

export async function shareImage(title: string, url: string, fileName = "photo.jpg"): Promise<"shared" | "copied" | "cancelled"> {
  const link = absolute(url);
  if (Platform.OS !== "web") {
    await Share.share({ message: link, title });
    return "shared";
  }
  try {
    const blob = await (await fetch(link)).blob();
    const file = new window.File([blob], fileName, { type: blob.type || "image/jpeg" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") return "cancelled";
  }
  try {
    await navigator.clipboard.writeText(link);
    return "copied";
  } catch {
    return "cancelled";
  }
}

export async function downloadImage(url: string, fileName: string): Promise<void> {
  if (Platform.OS !== "web") {
    await shareImage(fileName, url, fileName);
    return;
  }
  const blob = await (await fetch(absolute(url))).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function shareImages(title: string, urls: string[]): Promise<"shared" | "copied" | "cancelled"> {
  if (urls.length === 1) return shareImage(title, urls[0]!, `${title}.jpg`);
  if (Platform.OS === "web") {
    try {
      const files = await Promise.all(urls.map(async (u, i) => {
        const blob = await (await fetch(absolute(u))).blob();
        return new window.File([blob], `${title}-${i + 1}.jpg`, { type: blob.type || "image/jpeg" });
      }));
      if (typeof navigator.canShare === "function" && navigator.canShare({ files })) {
        await navigator.share({ files, title });
        return "shared";
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return "cancelled";
    }
  }
  await Share.share({ message: urls.map(absolute).join("\n"), title });
  return "shared";
}

export async function downloadImages(urls: string[], baseName: string): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    await downloadImage(urls[i]!, `${baseName}-${i + 1}.jpg`);
    await new Promise((r) => setTimeout(r, 350));
  }
}
