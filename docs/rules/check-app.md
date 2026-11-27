# 杜杜龍規則：寰宇繳作業系統（check）

- **寰宇繳作業系統（杜杜龍 2026-11-26）**：獨立 App（iOS、Android、網頁），專門繳作業；第一份作業是「美力之星 第二屆」。完整需求在 `docs/check/spec.md`。原本放在 GitHub `hglobal1985/check`，杜杜龍 2026-11-26 決定併進 `learn` 專案（保留修改紀錄），舊專案封存。對外仍是兩個獨立的 App：網址 https://check.hglobal1985.com、Cloudflare Worker `check`（D1 `check`、R2 `check`）、中央會員登記 `check`、商店上各自一個 App（套件名稱 `com.hglobal1985.check`）。
- **程式位置**：後端 `apps/check-api`（測試 `npm test -w @check/api`；本機 `apps/check-api/wrangler.local.jsonc`，不提交，`DEV_LOGIN=on` 才能用「dev:代號」登入，admin 開頭＝超級管理員）；App `apps/check-app`（型別檢查 `npx tsc --noEmit -p apps/check-app/tsconfig.json`；前後端共用格式用 `@check/contract`＝`apps/check-api/src/contract.ts`）。建立美力之星各堂與項目：`node apps/check-api/scripts/seed-meili.mjs <網址> <Token> [作業編號]`。
- **畫面一律用共用元件**（見 `docs/rules/shared-ui.md`）：`apps/check-app/src/kit.tsx` 只是把繳作業系統原本的元件名稱接到共用元件上，不可在裡面另畫樣式；新畫面直接 import 共用元件。
- **中央會員**：串接指令永遠以 https://id.hglobal1985.com/handoff/check 最新版為準，只補差異；版本寫在 `apps/check-api/src/central.ts` 與 `apps/check-app/src/central/config.ts` 的 `INTEGRATED_VERSION`。登入只走中央登入中繼（網頁 Refresh Token 放 sessionStorage，照串接指令）；會員主鍵只用 member_id；不保存 Amway 資料；顯示名稱是必要副本（表 `people`），中央 webhook `member.deleted` 會連同作業檔案全部刪除（`deleteMemberData`）。webhook 網址 `https://check.hglobal1985.com/api/central/webhook`，金鑰 `CENTRAL_WEBHOOK_SECRET` 由杜杜龍在 Cloudflare 後台設定。
- **權限**：活動管理員＝中央超級管理員或活動 manager；老師＝管理員或活動 teacher；只有老師能評分；組長只能確認／退回（要寫原因）、留言、編自己這組；同組組員互看已送出的作業，預設看不到分數。作業檔案沒有公開網址，一律用 10 分鐘有效的下載憑證（`/f/<憑證>`）。
- **部署（2026-11-27 已上線 https://check.hglobal1985.com）**：在最新的 `main` 執行 `CLOUDFLARE_API_TOKEN=dummy npm run deploy -w @check/api`（先打包網頁版 → `scripts/embed-static.mjs` 把網頁檔包進 Worker〔雲端環境上傳靜態資源會被代理擋下，與行動大學同一做法〕→ 套用 migration → 部署）。送審 App Store／Google Play 前要先問杜杜龍。「美力之星 第二屆」已建立（草稿，6 堂 17 項）。從中央登入回來的 `/auth/done` 由 `app/auth/done.tsx` 依 `useSession().returnTo` 導回原頁（不可在根版面把 /auth 路徑一直顯示讀取中）。
- **第二批共用（2026-11-27）**：繳作業系統的底部主選單改用共用 `BottomBar`（分頁在 `apps/check-app/src/lib/nav-tabs.tsx`：作業、批改〔只給老師、管理員、組長〕、通知、我的＋至尊／超派模式鍵）；作業照片點開用共用看圖程式 `EdmLightbox`；照片壓縮用共用 `cropCompress`、網頁版短影片在瀏覽器裡用共用的影片壓縮模組壓縮，畫質依「上傳設定」（與行動大學共用的 KV）；進度條用共用 `UploadProgress`。`api()` 的參數順序已改成與行動大學相同：`api("POST", "/路徑", 內容)`。`/api/me` 多回 `staff`、`toReview`（底部選單用）。
- **手機推播與影片（2026-11-27）**：繳作業系統的站內通知（`notify()`）新增後在背景推到手機（`flushPushes`，排程每小時補推），訂閱存在 `push_subs`（migration 0002）；「我的」頁有「加入主畫面」卡片與「手機推播」開關（`features/push-card.tsx`，共用的 `lib/web-push.ts`）。推播金鑰在 Cloudflare Worker `check` 的 Secret `VAPID_PRIVATE_JWK`（沒設定時開關顯示「推播功能還在設定中」；換金鑰後學員要重新開一次推播）。學員的短影片點了在畫面內播放（共用 `VideoViewer`＋與行動大學同一條播放控制列 `ControlsBar`；App 版用 expo-video 在 App 內播放）。推播金鑰 `VAPID_PRIVATE_JWK` 已設定（2026-11-27）。中央 webhook 金鑰已設定（2026-11-27 收到中央測試通知）。
- **行動大學原本的作業功能已徹底刪除（杜杜龍 2026-11-27）**：程式（`homework.ts`、`app/homework/*`、`features/homework/*`、學習中的「我的作業」卡、課程頁的作業入口、課程設定的「作業與批改」「學員分組」）與資料表（migration 0154 刪除 `hw_*`，刪除前確認正式資料全是空的）都已移除。作業一律在寰宇繳作業系統，行動大學不要再做作業功能。

## 測試推播按鈕（杜杜龍 2026-11-27）
- 「我的」頁的推播卡改用共用元件 `PushCard`（見 shared-ui.md 第四批）：開關開啟後有「傳一則測試通知給我」（`POST /push/test`，只推給自己帳號開過推播的裝置，回報送到幾支）與手機端排查步驟。
- iPhone 共用登入用的 Apple 開發團隊代碼已填在 `apps/check-app/app.json` 的 `extra.appleTeamId`（4W7QRTXN5Y，不是秘密）。

## 先建組別、組長邀組員（杜杜龍 2026-11-27）
- 流程：老師以上在「分組」頁按「＋新增組」（新增後直接取組名）→ 每組按「邀請組長」產生組長邀請連結（`POST /activities/:id/invites {role:"leader", groupId}`，7 天內有效、只能一人使用，`invites.group_id`）→ 組長接受（`/invite/<code>` 頁，`GET /invite/:code` 顯示是哪一組）後直接成為該組組長（不必等核准；原本的組長會被換掉；已經是老師／管理員的人不能接受）→ 組長在分組頁按「分享連結」邀組員。
- 組員用本組連結申請加入（作業設定「加入要核准」時）：組長和管理員都會收到通知；**組長可以自己核准或拒絕本組的申請**（`personAction` approve／reject 允許本組組長；移出作業仍只有管理員）。

## 作業檔案備份（杜杜龍 2026-11-27）
- **刪除日期**：管理頁有填「自動刪除日期」就用它；沒填就是「活動結束日後 2 個月」（`retentionOf`）。兩個都沒有就不自動刪。只刪檔案，成績與評語保留。
- **提醒**：活動結束隔天通知一次「已結束，請下載作業備份」，刪除前 30／7／1 天再提醒；**站內通知＋手機推播＋Email**，通知管理員、老師與全體組員。老師以上的連結開「全部檔案」（`/files/:id?all=1`），學員開自己的（`/files/:id`）。
- **Email**：只寄 `notices.email = 1` 的通知（目前只有備份提醒），寄信當下才用中央「聯絡查詢」拿信箱（伺服器共用模組 `packages/server-shared/src/central-service.ts`，用途 `course_notice`，用完即丟）。需要：Worker `check` 的 Secret `CENTRAL_SERVICE_SECRET`（杜杜龍在中央後台替 check 建立服務金鑰並核准 course_notice 用途）＋ `send_email` 綁定（寄件人借用 `noreply@learn.hglobal1985.com`，顯示名稱「寰宇繳作業系統」）。缺一個就不寄 Email，站內通知與推播照常。
- **一鍵下載備份**：備份頁最上面的按鈕（`GET /activities/:id/backup` 產生 1 小時有效的下載連結 `/z/<憑證>`）。伺服器邊讀邊打包成 ZIP（共用模組 `packages/server-shared/src/zip-stream.ts`，不壓縮、UTF-8 中文檔名、重複檔名加 (2)），每包最多 400MB，太大自動分成好幾包。資料夾：`作業名稱/課程/作業項目/（全部時加學員名_）檔名`；文字作業存成 .txt，連結收在「連結.txt」。學員只能下載自己的，老師以上可以下載全部。

## 錯誤回報（杜杜龍 2026-11-27）
- 用共用元件 `lib/error-report.ts`（與行動大學同一份；送到 `@/lib/app-assets` 的 `APP_ORIGIN`＋`ERROR_REPORT_PATH`）。繳作業系統的伺服器 `POST /api/client-errors`（不用登入、同一來源每分鐘最多 10 則）只寫進 Cloudflare 的錯誤紀錄，不存資料庫、不含會員身分。舊版網頁檔案失效時自動重新載入。

## 後端拆檔（杜杜龍 2026-11-27，做法同行動大學）
- `apps/check-api/src/core.ts`：型別、權限、資料轉換、通知推播 Email、保存期限、路由表 `routes` 與登記函式 `on`。
- `routes/*.ts`：account（我的、首頁、推播、上傳設定）、activities（作業、堂與項目、加入）、people（分組）、submissions（繳交、批改、留言）、files（通知、檔案保存、一鍵下載備份）、system（錯誤回報）。每個檔被載入時用 `on()` 登記網址。
- `api.ts`：依序載入 routes 檔（**載入順序＝網址比對順序，不要隨意調換**）、`handleApi`、檔案下載、webhook、排程；`export *` 轉出全部，舊的 import 不用改。
- 「新增通知後背景推播」用 `setPushSoon()` 設定（拆檔後不能跨檔案直接改值）。拆檔時比對過 54 個網址的登記順序與拆檔前完全相同。
- **每週備份（杜杜龍 2026-11-27）**：`apps/check-api/src/weekly-backup.ts`（排程 `scheduled` 呼叫）；備份哪些表見 `BACKUP_TABLES`，通用規則見 `docs/rules/performance-ops.md`「每週備份」。新增資料表預設不備份；超級管理員名單存在 `super_admins`（`superAdmin()` 驗證成功時記一筆、一天最多更新一次），只為了備份失敗時通知得到人。
