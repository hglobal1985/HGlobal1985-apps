/**
 * 共用登入（手機）的 sso_token 存放處：所有 H-Global1985 App 共用同一個 iPhone Keychain 群組（中央串接指令 三、2）。
 * 群組固定為「Apple 開發團隊代碼.com.hglobal1985.shared」，鍵名 hglobal.sso；團隊代碼寫在各 App 的 app.json → extra.appleTeamId（不是秘密）。
 * Android 為選做（目前略過）；網頁版不使用這裡（網頁的共用登入是整頁導向會員中心詢問）。
 * 行動大學與寰宇繳作業系統共用這一份（杜杜龍 2026-11-27）。
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const SSO_KEY = "hglobal.sso";
const team = (Constants.expoConfig?.extra as { appleTeamId?: string } | undefined)?.appleTeamId ?? "";
export const SSO_ACCESS_GROUP = team ? `${team}.com.hglobal1985.shared` : "";

/** 這支裝置能不能用手機共用登入（目前只有 iPhone／iPad，且已填團隊代碼）。 */
export const nativeSsoEnabled = () => Platform.OS === "ios" && !!SSO_ACCESS_GROUP;

export async function readNativeSso(): Promise<string | null> {
  if (!nativeSsoEnabled()) return null;
  try {
    return await SecureStore.getItemAsync(SSO_KEY, { accessGroup: SSO_ACCESS_GROUP });
  } catch {
    return null;
  }
}

export async function writeNativeSso(value: string | null): Promise<void> {
  if (!nativeSsoEnabled()) return;
  try {
    if (value) await SecureStore.setItemAsync(SSO_KEY, value, { accessGroup: SSO_ACCESS_GROUP });
    else await SecureStore.deleteItemAsync(SSO_KEY, { accessGroup: SSO_ACCESS_GROUP });
  } catch {
    /* 共用登入失敗不影響這個 App 自己的登入 */
  }
}

/** 從 Access Token 讀出會員編號（sub）；只用來比對是不是同一個人，不當作驗證。 */
export function memberOfToken(token: string): string | null {
  try {
    const p = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))))) as { sub?: string };
    return json.sub ?? null;
  } catch {
    return null;
  }
}
