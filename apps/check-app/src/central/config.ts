/** 中央會員登記資料（串接指令 https://id.hglobal1985.com/handoff/check；都不是秘密）。 */
import Constants from "expo-constants";

export const CENTRAL_URL = "https://id.hglobal1985.com";
export const APP_ID = "check";
/** 採用的串接指令版本（每次依新版指令更新完才改）。 */
export const INTEGRATED_VERSION = "2026-11-27.8";
export const WEB_ORIGIN = "https://check.hglobal1985.com";
export const NATIVE_RETURN = "check://auth/google";
export const PRIVACY_URL = `${CENTRAL_URL}/privacy`;
export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";
// iPhone 共用登入的 Keychain 群組與鍵名：改由共用元件 lib/sso-keychain.ts 提供（與行動大學同一份）。
