/** 共用元件會用到的 App 圖檔與名稱（每個 App 各自提供）：APP_LOGO＝看圖程式左上角標誌、APP_NAME＝「加入主畫面」卡片上的 App 名稱。 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const APP_LOGO = require("../../../mobile/assets/logo.png");
export const APP_NAME = "寰宇繳作業系統";
/** 錯誤回報（共用元件 lib/error-report.ts）送到哪裡：手機 App 用完整網址、網頁版用同網站的路徑。 */
export const APP_ORIGIN = "https://check.hglobal1985.com";
export const ERROR_REPORT_PATH = "/api/client-errors";
