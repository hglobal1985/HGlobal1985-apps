/** 上傳壓縮設定（與行動大學共用同一份；伺服器 GET /upload-settings）。一次開啟只讀一次，改了設定頁會清掉重讀。 */
import { api } from "@/api/client";
import { DEFAULT_SHARED_UPLOAD, type SharedUploadSettings } from "../../../../packages/server-shared/src/upload-settings";

export type UploadSettingsView = { settings: SharedUploadSettings; shared: boolean; canEdit: boolean };
let cached: Promise<UploadSettingsView> | null = null;
export function uploadSettings(): Promise<UploadSettingsView> {
  if (!cached) cached = api<UploadSettingsView>("GET", "/upload-settings").catch(() => ((cached = null), { settings: DEFAULT_SHARED_UPLOAD, shared: false, canEdit: false }));
  return cached;
}
export const forgetUploadSettings = () => void (cached = null);
