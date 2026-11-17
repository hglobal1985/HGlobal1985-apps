import { trackFeature } from "@/lib/feature-track";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { DEFAULT_SHARE_SETTINGS, resolveUrl, reviewerInviteMessage, shareMessage, type UiConfig } from "@/api/client";

/** 絕對網址（分享與下載用）。 */
const absolute = (url: string) => {
  const u = resolveUrl(url);
  return /^https?:/.test(u) || typeof location === "undefined" ? u : `${location.origin}${u.startsWith("/") ? "" : "/"}${u}`;
};

/** 分享選單的文字設定（超級管理員在「設定 > 分享預設值」調整；UiConfigProvider 載入後更新這裡）。 */
let shareSettings: UiConfig["share"] = DEFAULT_SHARE_SETTINGS;
export const setShareSettings = (s: UiConfig["share"]) => {
  shareSettings = s;
};

/**
 * 分享：一律呼叫手機的系統分享選單（網頁用 Web Share、App 用系統 Share）。
 * 分享出去的內容＝文字（一般：邀請文字；單堂課程傳 course：「我剛聽完這場 {主講人}的這場精彩演講 {課程名稱}…」）＋「按此開啟網址 👉」＋網址（範本在 shareSettings）。
 * 回傳 "shared"＝已叫出選單；"copied"＝這個瀏覽器沒有分享選單（例如電腦），已改為複製連結（含邀請文字）。
 */
export async function shareLink(title: string, url: string, course?: { teacher: string; teacherTitle?: string; title: string }, material?: { title: string }, chapter?: { sharer: string; sharerTitle?: string; title: string }, list?: { title: string; item?: string }): Promise<"shared" | "copied" | "cancelled"> {
  return shareText(title, shareMessage(shareSettings, absolute(url), course, material, chapter, list));
}

/** 邀請特定會員擔任課程審核人員：文字範本在「設定 > 分享預設值」的 reviewerInviteText。 */
export function shareReviewerInvite(courseTitle: string, path: string): Promise<"shared" | "copied" | "cancelled"> {
  return shareText(`審核人員邀請：${courseTitle}`, reviewerInviteMessage(shareSettings, absolute(path), courseTitle));
}

/** 叫出系統分享選單，送出已組好的整段文字（網頁沒有分享選單時改為複製）。 */
async function shareText(title: string, message: string): Promise<"shared" | "copied" | "cancelled"> {
  const r = await shareTextCore(title, message);
  if (r === "shared") trackFeature("share");
  else if (r === "copied") trackFeature("copy_link");
  return r;
}
async function shareTextCore(title: string, message: string): Promise<"shared" | "copied" | "cancelled"> {
  if (Platform.OS !== "web") {
    try {
      await Share.share({ title, message });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      // 只送文字：網頁分享若同時帶 title，LINE 等 App 會把它另外當成第一行貼出來（課程名稱就重複兩次）。
      await navigator.share({ text: message });
      return "shared";
    } catch {
      return "cancelled"; // 使用者關掉選單
    }
  }
  await navigator.clipboard?.writeText(message).catch(() => undefined);
  return "copied";
}

/**
 * 分享「圖片本身」（不是網址）：呼叫系統分享選單，直接把圖片檔傳出去。
 * 網頁：Web Share 的檔案分享（手機瀏覽器支援）；這個瀏覽器不能傳檔案時退而求其次分享連結，連分享選單都沒有（電腦）就複製連結。
 * App：先下載到暫存，再交給系統分享選單。
 */
export async function shareImage(title: string, url: string, fileName = "poster.jpg"): Promise<"shared" | "copied" | "cancelled"> {
  const link = absolute(url);
  if (Platform.OS !== "web") {
    try {
      const file = await File.downloadFileAsync(link, new Directory(Paths.cache));
      await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", dialogTitle: title });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  try {
    const blob = await (await fetch(link)).blob();
    const file = new window.File([blob], fileName, { type: blob.type || "image/jpeg" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") return "cancelled"; // 使用者關掉選單
  }
  return shareLink(title, url);
}

/** 下載圖片：網頁直接觸發瀏覽器下載；App 交給系統分享選單（可選「儲存圖片」）。 */
export async function downloadImage(url: string, fileName: string): Promise<void> {
  if (Platform.OS !== "web") {
    await shareImage(fileName, url, fileName);
    return;
  }
  trackFeature("download_image");
  const blob = await (await fetch(absolute(url))).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
