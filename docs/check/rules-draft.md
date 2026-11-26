# 寰宇繳作業系統（check）開發守則

業主是程式小白：回覆一律使用台灣繁體中文、白話說明。業主稱呼「杜杜龍」。

## 這是什麼
獨立的繳作業 App（iOS、Android、網頁），第一份作業是「美力之星 第二屆」。完整需求見 `docs/spec.md`。

## 專案結構
- `apps/api`：Cloudflare Worker `check`（D1 `check`、R2 `check`、網址 https://check.hglobal1985.com）。測試 `npm test`。
- `apps/app`：Expo App（網頁版由 `expo export` 產生，Worker 以靜態檔提供）。型別檢查 `npm run typecheck -w @check/app`。
- 前後端共用格式：`apps/api/src/contract.ts`（App 直接 import）。

## 中央會員（必讀）
- 串接指令永遠以 https://id.hglobal1985.com/handoff/check 最新版為準；每次更新**只補差異**。採用的版本寫在 `apps/api/src/central.ts` 的 `INTEGRATED_VERSION` 與 `apps/app/src/central/config.ts`。
- 登入只走中央「登入中繼」（Google），App 不持有密碼或 client secret；不使用原生 Google SDK。
- 會員主鍵只用 member_id；**不保存任何 Amway 資料**；日誌不得有 Token、信箱、姓名。
- 顯示名稱是「必要副本」（表 `people`）：本人使用時從中央讀取更新；中央通知改名標記重讀、刪帳號就連同作業檔案全部刪除（`deleteMemberData`）。
- 不可修改中央會員的程式、資料庫或設定；需要中央配合時寫好說明請業主處理。

## 業主已決定
- Git 與分支由開發者自行決定，回報時白話說「已同步」即可。
- 手機優先（約 390px）：觸控目標至少 44、單手好操作、表單不被鍵盤或底部分頁列遮住。
- 需要確認的動作一律用「底部確認面板」；按鈕位置：左「取消／關閉」（紅框）、右主要動作。
- 設計：亮色與中央視覺規範相同（`apps/app/src/theme.ts`）；深色依中央視覺規範 1.5。
- 正式環境部署、App Store／Google Play 送審、可能產生費用的操作：先問業主。
- 不在對話、程式或 repo 放任何金鑰；機密由業主在 Cloudflare 後台設定（`CENTRAL_WEBHOOK_SECRET`）。
- 本機測試用 `apps/api/wrangler.local.jsonc`（不提交，`DEV_LOGIN=on` 才允許 `dev:代號` 登入）；正式環境一律 `DEV_LOGIN=off`。
