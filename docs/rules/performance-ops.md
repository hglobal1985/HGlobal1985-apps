# 業主規則：載入速度、部署、伺服器效能與維運

> 從 CLAUDE.md 原文搬來，內容一字未改（2026-11-22 瘦身）。動到這個領域的功能前請先讀；規則依時間順序，後面的條目常會「取代」前面的。

- **載入速度與程式整理（2026-11-21，業主授權夜間整理）**：
  ① **管理者專用的編輯工具「用到才下載」**：課程編輯（設定、章節、教材、區塊、EDM）、中心編輯面板、系列封面與「套用到全系列」、新增課程、時間軸、系列 EDM，一律從 `features/admin-parts.tsx` import（底下是 `lib/lazy-part.tsx` 的 `lazyPart`，全部經由同一包 `features/admin-bundle.ts`）；**不可**在一般頁面直接 import `course-edit/lessons`、`course-sections`、`material-sheet`、`admin/edm-manager` 等檔案，否則學員又要多下載約 200KB。新增管理者專用的大面板：在 `admin-bundle.ts` 與 `admin-parts.tsx` 各加一行。打包工具會把「被兩個以上按需下載包共用」的檔案搬回主程式，所以一定要經由同一包。驗證方式：`npx expo export --platform web` 後看 `__common-*.js` 大小（2026-11-21：836KB → 629KB）。
  ② **共用小元件搬到 `ui/`**：勾選框 `Check`（`ui/check.tsx`，也從 `@/ui` 匯出）、編輯清單的小方形按鈕 `IconButton`（`ui/icon-button.tsx`，外觀 28 但觸控範圍 44）、數字調整列 `Stepper`（`ui/stepper.tsx`）。不要再從 `course-sections`、`lessons`、`app/admin/storage` 匯入它們。
  ③ **圖示字型自動瘦身**：部署打包時（`apps/launch/scripts/embed-static.mjs` → `subset-icons.mjs`）掃描 App 原始碼裡用到的 Ionicons 名稱，只保留那些圖示（壓縮後 185KB → 41KB）。圖示名稱一律寫成字串（`name="play"`、`ok ? "a" : "b"`），**不可用程式拼出圖示名稱**（例如 `` `${x}-outline` ``），否則那個圖示會被瘦身掉變空白。
  ④ **QR Code 產生器、App 專用的檔案分享工具**改為用到才載入（`invite-button.tsx`、`lib/share.ts`）。
  ⑤ **伺服器查資料庫要「同時查」**：每次資料庫來回在台灣約 30～70ms；彼此不相依的查詢一律放進同一個 `Promise.all`，寫入用 `db.batch` 一次送出。課程頁 `courseDetail` 已從 12 趟減為 4 趟、`/me` 4→3、`/courses` 少 1 趟。新增查詢先加進現有的 `Promise.all`，不要在後面再 `await` 一次。
  ⑥ **中央查詢共用的錯誤**：`central.ts` 的 `cached()` 讓同一人同時的多個請求共用一次中央查詢；先發起的請求若被瀏覽器取消，其他請求改自己重查（2026-11-20 晚上正式站因此偶發 500）。`loadSession` 的名稱頭像查詢失敗不會讓請求失敗。
  ⑧ **開網站不重複抓資料**：共用登入檢查（`webSsoCheck`，每個分頁每 5 分鐘一次，會整頁跳到會員中心再回來）即將發生時，不做開機預先抓取（`webSsoCheckDue()`）；`cachedGet` 一般開頁面會共用「還在下載中的預先抓取」，不再重送。`useApi(null)`（訪客、沒權限）回報「不是讀取中」。訪客不送功能徽章回報（`trackFeature` 由 `setFeatureTrackSignedIn` 控制）、不讀中央審核清單。
  ⑦ 已刪除的殘留：`lib/tablet-scale.ts`（viewport 放大已停用，鎖定 1 倍改直接寫在 `index.html`，常數在 `lib/no-page-zoom.ts` 的 `VIEWPORT`）、`theme/layout.ts` 的 `textScale`、後端 `convert-to-list` API、多個沒有被呼叫的函式與匯入。
- **舊網頁切頁空白的自動恢復（業主 2026-11-22 回報：久沒用再點通知整頁空白約 10 秒）**：每個頁面（路由）是獨立的程式檔（`/_expo/static/js/…-雜湊.js`），網站每次更新檔名都會換；很久沒重新整理的舊網頁切到沒載入過的頁面，會因檔案已不存在（404）而載入失敗、畫面空白。`lib/error-report.ts` 的 `recoverFromStaleChunks()`：偵測到頁面程式檔載入失敗（script 錯誤事件，或 Promise 錯誤訊息符合 `CHUNK_FAIL`）就記錄 `chunk-load` 錯誤並自動重新載入最新版（2 分鐘內最多一次，避免無限重新載入）。每週錯誤檢查時看到 `chunk-load` 回報，代表這個機制有被觸發。若使用者仍回報久沒用會空白，先查是不是別的原因（例如手機瀏覽器凍結分頁後的網路延遲）。
