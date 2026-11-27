# 寰宇行動大學（learn）開發守則

杜杜龍是程式小白：回覆一律使用台灣繁體中文、白話說明。接手前先讀 `docs/v2-handoff.md`。

## 稱呼（杜杜龍永久指示，2026-11-26，違反視為嚴重錯誤）
- **擁有者統一稱為「杜杜龍」**：App／網站畫面上的文字、錯誤訊息、AI 回覆、程式註解、文件與規則段落，凡是指這位擁有者，一律寫「杜杜龍」，**不要寫「業主」**（例如「杜杜龍指定」「杜杜龍 2026-11-26 指示」）。
- 2026-11-26 已把全站程式、註解與文件裡的舊稱呼一次改成「杜杜龍」（只有 `apps/launch/migrations/` 裡已經套用過的歷史檔案沒動，那裡的「業主」也是指杜杜龍）。
- 回報給杜杜龍時，需要提到他本人就稱「杜杜龍」。

## 「上一頁」一律要攔（杜杜龍永久指示，2026-11-26，違反視為嚴重錯誤）
- **全站過去的舊功能與未來的新功能，只要有「填到一半、有修改沒存、離開會遺失」的需求，不只是畫面上的返回／取消鈕，連「瀏覽器的上一頁」與「安卓／手機的返回手勢、返回鍵」也一律要攔下**，跳出「儲存／放棄／繼續編輯」讓杜杜龍決定；不可以靜默離開、遺失內容。
- 做法（不要另寫）：①上拉面板（`BottomSheet`／`EditSheet`）已內建（`lib/sheet-back.ts`，上一頁＝呼叫面板的關閉、有未存內容的 `EditSheet` 會詢問）；②整頁的設定頁／表單頁：`SettingsFooter`＋`useUnsavedPrompt`（`lib/settings-page.ts`），一頁一個儲存鈕；③全螢幕視窗用 `useBackToClose`（`lib/back-close.ts`）。新增任何表單、面板、頁面時，一定要套用其中一種，並用瀏覽器上一頁與手機返回手勢實測。

## 用語（杜杜龍永久指示）
- **一律用「報名課程」，不要用「購買課程」或「購買」**。對應用語：報名清單（不是購物車）、報名紀錄／報名編號（不是訂單）、繳費（不是付款）、報名審核（不是訂單審核）、免費報名（不是領取）。
- **例外（杜杜龍 2026-11-14 指示）**：設定頁的入口與該頁標題叫「**訂單紀錄**」（原「我的報名」），移到最上方、學習成就上方；其餘仍用「報名紀錄」等用語。
- 免費課程：報名當下自動通過，不需審核。付費課程：報名後由窗口在站內審核繳費後才開通。

## 多個 AI 同時開發的協作守則（杜杜龍永久指示，2026-11-20，違反視為嚴重錯誤）
目的：杜杜龍會隨時換新的 AI 對話，也可能同時有好幾個 AI 各做不同功能；**後部署的人不能蓋掉先部署的成果**。
1. **只有 `main` 是正本**。每個 AI 一律開自己的分支（`claude/…`）改程式 → 推上去 → 開 PR → **合併進 `main`**；不要在分支上直接部署。
2. **部署只用 `npm run deploy -w @learn/launch`（`apps/launch/scripts/safe-deploy.mjs`）**，不可手動拼 `wrangler deploy`。這個腳本會擋下：有未提交的修改、不是最新的 `main`、線上版本（`GET /api/v2/version` 的 git 編號）不在目前程式歷史裡（＝會蓋掉別人的成果）。被擋下時照訊息做：先 `git pull origin main` 取得最新程式，再重新驗證、部署。**不可用 `--force` 繞過**，除非杜杜龍明說。
3. **開工前先同步**：`git fetch origin && git checkout main && git pull`，再從最新的 `main` 開新分支；開工前也看一下 `git branch -r --no-merged origin/main`，有別人還沒合併的分支就先判斷會不會碰到同一批檔案，會的話先問杜杜龍。
4. **合併前先把 `main` 併進自己的分支**（衝突自己解，不可丟棄別人的程式）；改到共用檔案（`api.ts`、`contract.ts`、`CLAUDE.md`、`courses-view.tsx`…）時，只增加自己的段落，不要整檔重寫或重新排版。
5. **資料庫 migration 編號要避開別人的**：新增 migration 前看 `apps/launch/migrations` 最新編號，合併時若撞號就改成下一個（部署腳本會依序套用）。
6. **做完要在 CLAUDE.md 加上自己這項功能的規則段落**（接手的 AI 靠它知道現況），並在回報中說明部署的版本（`/api/v2/version`）。

## 杜杜龍已決定
- **全自動合併與部署，不要詢問、不要等杜杜龍（杜杜龍 2026-11-20 永久指示）**：功能做完、測試與檢查通過後，AI 自己開 PR → 合併進 `main` → 用 `npm run deploy -w @learn/launch` 部署（流程與安全檢查不變，不可 `--force`），再回報部署的版本；**不必先問「要不要合併／部署」**。（在 Claude Code 雲端環境部署時設 `CLOUDFLARE_API_TOKEN=dummy`，真正的憑證由系統代換。）
- **Git 與分支的技術決定全權交給開發者**（杜杜龍 2026-11-13）：推哪個分支、何時同步 `main`（快轉）都由 AI 自行判斷執行，不必再問杜杜龍；回報時只用白話說「已同步」即可，避免 commit、快轉等術語。
- **開發一律第一優先：手機 UI 操作最佳化**（杜杜龍 2026-11-12 永久指示）。新畫面與修改都先以手機寬度（約 390px）設計與驗證：觸控目標夠大、單手好操作、不靠滑鼠右鍵／懸停／拖曳小控制點、表單不被鍵盤或底部分頁列遮住，再顧電腦版。驗證時至少用手機寬度的瀏覽器截圖檢查，回報時說明手機上的操作方式。
- **目前是內部封測階段，不需要建立 staging 測試環境**（杜杜龍 2026-11-13）：直接以本機測試＋正式環境部署。**等 App 正式上架 App Store 與 Google Play 之後**，每次修改才要先建立測試環境、測試通過再部署到正式環境。
- App 名稱「寰宇行動大學」維持；只有會員中心本身的畫面不顯示「寰宇」，其他 App 可以顯示。
- 暫時保留：訂單（報名紀錄）存下單時的顯示名稱、保留深色模式。
- 中央會員系統（`hglobal1985/id`）原則上不要碰；杜杜龍 2026-11-12 授權過一次例外（新增 `GET /v1/eligibility/context`）。之後若還需要改，先問杜杜龍，並遵守該 repo 的 `AGENTS.md`。
- 杜杜龍 2026-11-12 核准：報名紀錄可保存報名當下的「中心名稱」（分派審核與對帳用）；其餘 Amway 資料仍不得保存。
- 正式站已關閉測試身分登入（`DEMO_LOGIN: off`）；測試請用本機（`wrangler.local.jsonc`，不提交）。
- 不在對話、程式或 repo 放任何金鑰；機密由杜杜龍在 Cloudflare 後台設定。

## 統一設計規範（杜杜龍永久指示，2026-11-16）
- **所有設計一律以「行動大學程式實際使用的設計」為全生態系統一設計規範**（《寰宇生態系統一設計規範 2.0》，取代 1.0）。正本＝`apps/mobile/src/theme/tokens.ts`；文件＝`docs/hglobal-color-standard.md`、`docs/hglobal-tokens.json`；完整設計系統頁面＝「寰宇行動大學設計系統」https://claude.ai/artifact/RjQ7W2sAfARSkhgjKF5RRU 。
- 改任何色值、字級、間距、圓角時，三處（tokens.ts、兩份 docs、設計系統頁面）要一起更新；中央會員系統要跟進時，替杜杜龍寫好可貼給中央 AI 的指令（`docs/central-request-design-standard-2.md`）。
- 舊的 1.0 規範與另一個帳號的舊設計系統頁面都不再參照。

## 資料正本規則（杜杜龍永久指示，2026-11-14，違反視為嚴重錯誤）
- **「中心」清單只以中央會員系統為準**（`GET /v1/vocab/suggestions?pool=education_center`）。行動大學**不可自行新增**中心名稱，也**不可把本地資料（報名紀錄、審核群組、課程…）裡出現過的名稱混進中心清單**。
- 後端：`/centers` 只回中央清單（`centerList`，查不到用最近一次成功的，失敗不快取）；任何要存「中心」的欄位（主辦單位、審核群組負責中心與成員中心）一律用 `assertCentralCenters` 驗證必須在中央清單內。新增任何會用到中心／獎銜／職務等「中央定義」的欄位時，也要照這個做法，不可在行動大學另建一份。
- 其他由中央定義的資料（獎銜階梯、職務、會員資料）同理：以中央為準，行動大學不自行新增或修改。

## 共用元件速查（每個畫面都要遵守；細節與完整規則見 docs/rules/）
- 分享：`ShareIcon`＋`shareLink`（系統分享選單）；分享文字範本在「設定 > 分享預設值」。
- 確認動作：`confirmSheet()`／`confirmAsk()`（底部確認面板，不用瀏覽器對話框）；所有上拉面板用 `BottomSheet`；選單點選列用 `SheetRow`；清單用 `SheetScroll`。
- 上方工具列：`TopBar`／`PageHeader`；右側按鈕 `TopBarButton`（綠色）；可分享頁面要給 `backTo`。
- 一句話回饋：`flashText()`／`showFlash()`（不用 toast）；背景暗化 `DimBackdrop`；流光邊框 `GradientFrame`。
- 編輯面板：`EditSheet`（取消在左、儲存在右同一列）；按鈕取消 `variant="cancel"`（左、紅框）、儲存在右（深綠）；欄位群組 `FormBlock`、`BrandField`／`CategoryField`／`HostField`。
- **下拉選單（杜杜龍 2026-11-24 永久指示，不可另做）**：原地展開的下拉一律用 `Dropdown`（`ui/dropdown.tsx`，即會員資料獎銜／中心／系統的樣式：深綠 2px 框、選中淡綠底、再按一次收起）；`Select` 在至尊模式自動改用它（不顯示欄位標籤），超派模式仍是上拉面板。
- **至尊模式專用控制項（杜杜龍 2026-11-24 永久指示，不可另做）**：`ui/elder-controls.tsx` 的 `ELDER_FIELD`（粗 4px 綠框、大圓角、高度）、`ElderTabs`（標籤列，通知頁用）；至尊模式下拉＝`Dropdown big`（`Select` 自動帶）、搜尋框也用同一份 `ELDER_FIELD`。新增至尊模式頁面的標籤／下拉／輸入框一律用它們。
- 日期：`DateSelect`；切換鈕：`SegmentTabs`；勾選：`Check`；數量膠囊：`CountPill`／`CardCount`。
- 讀取中：整頁 `LoadingView`（灌溉小樹苗）、小塊 `LoadingLadybug`；沒有圖的縮圖／封面：`ThumbFallback`（綠色學士帽）。
- 封面：`ArtUploader`、`EdmManager`、`LessonArt`＋封面庫；圖片存 R2 前一律 `shrinkImage`；顯示縮圖用 `useThumb()`。
- 課程資訊卡 `CourseCard`、清單列 `CompactRow`、教材列 `MaterialRow(s)`、遮罩 `LockMask`、登入提示 `LoginPrompt`／`GuestGate`、公告 `BroadcastZone`、加入清單 `HeaderAddToList`／`RowAddToList`、放大看圖 `EdmLightbox`。
- 排版：新頁面用 `Screen`＋`useLayout()`（不寫死欄數、不自己乘字體倍數）；手機 390px 優先，另驗 iPad 820×1180 與 1180×820。
- 管理者專用大面板一律走 `features/admin-parts.tsx`（用到才下載）；圖示名稱寫成字串；伺服器不相依的查詢放同一個 `Promise.all`。
- 新增任何以中心為鍵的資料表要加進 `center-reconcile.ts` 的 `KEY_COLS`；新增存封面圖的欄位要加進 `usedImageKeys`。

## 開發與流程
- 後端：`apps/launch`（Cloudflare Worker `learn` + D1 `learn-v2`），測試 `npm test -w @learn/launch`。
- App：`apps/mobile`（Expo），型別檢查 `npm run typecheck -w @learn/mobile`。
- **共用元件在 `packages/ui/src/`**（杜杜龍 2026-11-26：行動大學與寰宇繳作業系統共用同一套，改一次兩邊一起變；`@/` 先找 App 自己的 `src/` 再找這裡）。改共用元件時兩個 App 的型別檢查都要過。規則見 `docs/rules/shared-ui.md`。
- **寰宇繳作業系統**：`apps/check-api`（Worker `check`）、`apps/check-app`（Expo）；規則見 `docs/rules/check-app.md`，部署前先問杜杜龍。
- 部署：見 `docs/v2-handoff.md`「部署指令」。杜杜龍在 Cloudflare 後台改變數後，記得確認程式沒有被退回舊版。
- **部署前套件齊全檢查（杜杜龍 2026-11-21 回報「＋邀請」按鈕當機）**：原因是雲端環境沒裝到新加進 `package.json` 的 `qrcode-generator`，網頁打包照樣成功，但用到它的頁面在使用者手機上才丟出「找不到模組」而當機。`apps/launch/scripts/safe-deploy.mjs` 現在在打包前檢查 `package.json` 列的每個套件都真的裝在 `node_modules`，缺了就自動 `npm install`，還缺就停下來不部署。**新增任何套件時一定要同時跑 `npm install`；本機型別檢查若出現 `Cannot find module` 就是沒裝好，不可忽略。**邀請面板的網址也改成最多 3 行、任意位置折行。
- **中央串接指令永遠讀最新版（杜杜龍 2026-11-22 永久指示）**：中央會員的串接指令最新版固定在 https://id.hglobal1985.com/handoff/learn（純文字、公開、沒有金鑰，雲端環境用 `curl` 就讀得到）。每次杜杜龍說「照串接指令做」或貼了舊版內容，**一律重新讀這個網址，不要憑記憶或舊的貼上內容做**；讀不到要告訴杜杜龍，不可猜。已經串接過的只補差異（先比對「六、已串接 App 的更新檢查清單」），做完把 `central.ts` 的 `INTEGRATED_VERSION` 改成新版本號。

## 詳細規則索引（依功能分檔；開工前先 `grep -rn 關鍵字 docs/rules/` 找相關規則，動到那個領域必讀）
- `docs/rules/ui-modules.md`：共用介面元件（面板、提醒、動畫、按鈕、返回列…）（12 條）
- `docs/rules/layout-responsive.md`：平板／電腦版面、縮放、捲軸、下拉重新整理、底部選單（8 條）
- `docs/rules/course-edit.md`：課程編輯、章節、教材、區塊、品牌、系列套用（41 條）
- `docs/rules/covers-media.md`：封面、EDM、相簿、縮圖、圖片與檔案儲存（54 條）
- `docs/rules/center-page.md`：中心頁、訂閱、公告、課表（36 條）
- `docs/rules/achievements.md`：徽章與學習成就（10 條）
- `docs/rules/misc.md`：其他（1 條）
- `docs/rules/cards-zones.md`：寰宇大學首頁、專區、系列、卡片與清單頁（27 條）
- `docs/rules/registration-access.md`：報名、誰能瀏覽、費用與權限（6 條）
- `docs/rules/member-central.md`：中央會員串接、登入、審核、職務、通知推播（39 條）
- `docs/rules/my-lists-library.md`：我的清單、我的書櫃（19 條）
- `docs/rules/youtube-sync-import.md`：YouTube 同步、匯入工作、一次性匯入（13 條）
- `docs/rules/performance-ops.md`：載入速度、部署、伺服器效能與維運（1 條）
- `docs/rules/elder-mode.md`：至尊模式（長輩大字簡易版）／超派模式切換、字體放大、跟著手機字體（1 條）
- `docs/rules/homework.md`：作業（學員繳交、老師批改評分、分組、誰看得到）（1 條）
- `docs/rules/shared-ui.md`：**共用元件資料夾 packages/ui**（行動大學與繳作業系統共用同一套元件、轉接檔、哪些已搬、共用上傳設定）（10 條）
- `docs/rules/check-app.md`：寰宇繳作業系統（apps/check-api、apps/check-app）（7 條）
- **自動規則搜尋**：杜杜龍每次送出訊息，`.claude/hooks/rules-search.py` 會自動用訊息內容比對 `docs/rules/`，把可能相關的規則標題列在對話開頭（【自動規則搜尋】）；看到時務必讀對應條目。沒有列出不代表沒有規則，仍要自己 grep 確認。
- 舊版完整 CLAUDE.md 在 git 歷史（2026-11-22 瘦身前最後一版），所有內容已原文搬進上面的分檔。

**新增功能的規則段落（協作守則第 6 點）**：寫進對應的 `docs/rules/` 分檔（找不到就新增分檔並更新上面的索引），不要再加回這份檔案；這份只放永久通則與索引，維持精簡。
