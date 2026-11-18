/**
 * 「從我的 Google 雲端硬碟選擇」（業主 2026-11-18，只有網頁版）：使用者用自己的 Google 帳號授權一次性的存取權杖（只有 drive.file 權限＝只能讀他親手挑的檔案），
 * 在 Google 自己的檔案挑選視窗（Picker）選檔案；之後由行動大學伺服器用這個權杖把檔案轉存到自己的儲存空間。權杖只在記憶體裡，不保存。
 */
type PickerConfig = { clientId: string; apiKey: string; appId: string };
export type PickedFile = { id: string; name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = () => window as any;
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((ok, fail) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => ok();
      el.onerror = () => {
        scripts.delete(src);
        fail(new Error("無法載入 Google 服務，請檢查網路後再試"));
      };
      document.head.appendChild(el);
    });
    scripts.set(src, p);
  }
  return p;
}

/** 可挑的檔案類型（與伺服器接受的一致：圖片、PDF、Office、文字檔，以及會自動轉檔的 Google 文件／試算表／簡報）。 */
const MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
].join(",");

let ready: Promise<void> | null = null;
/**
 * 先把 Google 的程式載好（只載入程式，不要任何權限，也不讀任何資料）。手機瀏覽器只有在「按下按鈕的當下」才允許跳出授權視窗，
 * 所以要在使用者按按鈕之前就準備好，按下去才能立刻跳出；真正的授權（索取雲端硬碟讀取權限）一律等到使用者按下按鈕才發生。
 */
export function preloadGooglePicker(): Promise<void> {
  ready ??= Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")])
    .then(() => new Promise<void>((ok) => win().gapi.load("picker", { callback: ok })))
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** Google 選檔視窗預設圖層只有 1000 多，會被上拉面板（圖層 9999）蓋住、看不到，所以把它拉到最上層。 */
function raisePicker() {
  if (document.getElementById("hg-picker-z")) return;
  const el = document.createElement("style");
  el.id = "hg-picker-z";
  el.textContent = ".picker-dialog-bg{z-index:100000 !important}.picker-dialog{z-index:100001 !important}";
  document.head.appendChild(el);
}

/** 回傳 null＝使用者按了取消。呼叫時才會向使用者索取權限。 */
export async function pickFromMyDrive(cfg: PickerConfig): Promise<{ token: string; files: PickedFile[] } | null> {
  await preloadGooglePicker();
  const token = await new Promise<string | null>((ok, fail) => {
    const client = win().google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (r: { access_token?: string; error?: string }) => (r.access_token ? ok(r.access_token) : r.error === "access_denied" ? ok(null) : fail(new Error("Google 授權失敗，請再試一次"))),
      error_callback: (e: { type?: string }) => (e?.type === "popup_closed" ? ok(null) : fail(new Error("無法開啟 Google 授權視窗。若你在 LINE 等 App 內建瀏覽器，請改用系統瀏覽器開啟"))),
    });
    client.requestAccessToken();
  });
  if (!token) return null;
  const g = win().google;
  raisePicker();
  return new Promise((ok) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true).setMimeTypes(MIME);
    new g.picker.PickerBuilder()
      .setAppId(cfg.appId)
      .setDeveloperKey(cfg.apiKey)
      .setOAuthToken(token)
      .setLocale("zh-TW")
      .addView(view)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((d: { action: string; docs?: { id: string; name: string }[] }) => {
        if (d.action === g.picker.Action.PICKED) ok({ token, files: (d.docs ?? []).map((x) => ({ id: x.id, name: x.name })) });
        else if (d.action === g.picker.Action.CANCEL) ok(null);
      })
      .build()
      .setVisible(true);
  });
}
