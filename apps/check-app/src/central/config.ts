/** 中央會員登記資料（串接指令 https://id.hglobal1985.com/handoff/check；都不是秘密）。 */
import Constants from "expo-constants";

export const CENTRAL_URL = "https://id.hglobal1985.com";
export const APP_ID = "check";
/** 採用的串接指令版本（每次依新版指令更新完才改）。 */
export const INTEGRATED_VERSION = "2026-11-24.3";
export const WEB_ORIGIN = "https://check.hglobal1985.com";
export const NATIVE_RETURN = "check://auth/google";
export const PRIVACY_URL = `${CENTRAL_URL}/privacy`;
export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";
/** iPhone 共用登入的 Keychain 群組（$(AppIdentifierPrefix)＝Apple 開發團隊代碼）。沒有團隊代碼時先不啟用共用登入。 */
const team = (Constants.expoConfig?.extra as { appleTeamId?: string } | undefined)?.appleTeamId ?? "";
export const SSO_ACCESS_GROUP = team ? `${team}.com.hglobal1985.shared` : "";
export const SSO_KEY = "hglobal.sso";
