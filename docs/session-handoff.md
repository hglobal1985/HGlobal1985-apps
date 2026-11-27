# 寰宇行動大學：新帳號／新對話「總交接包」（更新於 2026-11-16）

> 給接手的 AI（Claude Code）：**先完整讀完這份，再讀 `CLAUDE.md`（杜杜龍的永久規則，違反視為錯誤），最後需要細節時查 `docs/v2-handoff.md`（依日期往下加，最新在最後）。**
> 你是在接手一個「已經上線、杜杜龍天天在用」的專案。杜杜龍不是工程師，你的回報品質就是他的全部體驗。

---

## 一、杜杜龍是誰、怎麼合作（最重要，新帳號沒有任何紀錄）
- **杜杜龍＝程式小白**，用手機操作與審查。所有回覆：**台灣繁體中文、白話、先講結果**。不要用 commit、快轉、migration、API 等術語（杜杜龍明講 Git／分支細節交給你全權處理，回報只說「已同步」）。
- 杜杜龍常用**簡體字、錯字、口語**描述需求；若畫面文字與欄位實際用途不一致（例：「本姓」其實是「本名」），要**主動提醒**。
- **要他挑選設計時**：他喜歡「做出模擬圖（HTML 截成 PNG，手機寬度 390px）→ 編號 → 他回覆編號」。常見要求是「給我 5／10／20 款挑選」。流程：先出圖、**不改程式**，他回編號後才開工（歷史上他挑過：時間軸拖曳＝方案 3＋4 綜合、已完成圖示＝小樹苗第 12 號）。圖檔用 `SendUserFile` 傳給他。
- **他想先討論時會明講「先不要執行／先給建議」**——這時只給建議與取捨，等他回覆「同意」或「開工」再動手。
- **回報格式**（他每一輪都期待）：①本機實測（Playwright，手機寬度截圖）→ ②後端測試／型別檢查／eslint → ③部署到正式站 → ④**白話回報**：做了什麼、手機上怎麼操作、**誠實說明沒驗證到的部分**（iOS／Android 實機一律沒測過，要明講；模擬資料要標示）→ ⑤附帶「還在等你處理的事」。
- **未驗證不可說完成**；失敗要照實說。不要美化。
- 他會在你工作中途插話下新指令（訊息會夾在工具結果裡）：要**併入處理**，並在最後的回報中逐項回應。
- 長時間沒回應他會催；工作中要偶爾用一句話說明「正在做什麼」。
- **永久用語**：一律「報名課程」（不說購買／購物車／訂單／付款），「報名清單、報名紀錄／報名編號、繳費、報名審核、免費報名」；唯一例外：設定頁入口與標題叫「訂單紀錄」。完整規則見 `CLAUDE.md`。
- **手機 UI 第一優先**：任何新畫面先以 390px 設計與驗證（觸控目標夠大、單手好操作、不靠懸停／右鍵、不被鍵盤或底部分頁列擋住）。
- 目前是**內部封測階段，不建 staging**：本機測試後直接部署正式站。等 App 正式上架 App Store／Google Play 後，才改成「先測試環境、通過再正式」。
- 不在對話、程式、repo 放任何金鑰；機密由杜杜龍在 Cloudflare 後台設定。

## 二、專案一覽
- **寰宇行動大學**：Expo／React Native（iOS／Android／Web 共用一套程式）＋ Cloudflare Worker 後端。正式站：https://learn.hglobal1985.com
- GitHub：`hglobal1985/HGlobal1985-apps`（本專案）、`hglobal1985/id`（中央會員系統，**原則上不要改**；杜杜龍 2026-11-12 授權過一次例外 `GET /v1/eligibility/context`，之後要改要先問杜杜龍並遵守該 repo 的 `AGENTS.md`；需要中央改動時，替杜杜龍寫好「可貼給中央會員 AI 的指令」）。
- 分支：開發在 `claude/hglobal-learn-handoff-4bj5nb`，**`main` 與它保持同步（已授權 AI 自行快轉）**。每次做完：commit → push 開發分支 → `main` 快轉 → push。
- 專案結構：
  - `apps/launch`：後端 Worker `learn`（`src/api.ts` 路由全在這個大檔案、`contract.ts` 型別（App 直接引用）、`central.ts` 中央串接、`og.ts` 分享預覽、`ui-config.ts` 全站設定、`romanize.ts` 姓名轉拼音…）＋ D1 `learn-v2`（migrations 0001～0059）＋ R2 `learn`＋ Workers AI。測試 `tests/*.test.ts`（133 項，node:sqlite）。
  - `apps/mobile`：App（`app/` 路由、`src/features/*` 功能、`src/ui/*` 共用元件、`src/theme` 設計系統、`src/lib`、`src/state`）。
  - `apps/legal`：Worker `learn-legal`（`/privacy`、`/support`）。
  - `docs/`：交接與規格文件。`CLAUDE.md`：杜杜龍永久規則。
- Cloudflare：寰宇帳號（編號放在部署環境變數 `CLOUDFLARE_ACCOUNT_ID`，不寫進公開程式庫）、zone `1c9558ed07ec981a87ff0f9a005ec9c4`、網域 `learn.hglobal1985.com`（Worker 自訂網域）、Email Service 寄件 `noreply@learn.hglobal1985.com`。
- **Secrets／變數的「名稱」**（值都在 Cloudflare 後台，由杜杜龍管理，**你看不到也不可寫進任何地方**）：`MEDIA_URL_SECRET`、`MUX_SIGNING_PRIVATE_KEY`、`MUX_SIGNING_KEY_ID`、`MUX_TOKEN_ID`、`MUX_TOKEN_SECRET`、`CENTRAL_SERVICE_SECRET`、`CENTRAL_WEBHOOK_SECRET`、`CF_API_TOKEN`、`ANTHROPIC_API_KEY`（若有）、`LEARN_ADMIN_SUBS`、`DEMO_LOGIN`（正式站固定 `off`）。`wrangler.jsonc` 已設 `keep_vars: true`。

## 三、每天的標準作業流程
```bash
# 0) 取得程式（雲端環境已 clone 好時略過）
git clone https://github.com/hglobal1985/HGlobal1985-apps && cd HGlobal1985-apps && npm install

# 1) 本機測試用：複製 apps/launch/wrangler.jsonc → wrangler.local.jsonc（已 gitignore）：
#    DEMO_LOGIN 改 "on"、加 MEDIA_URL_SECRET 任意字串、拿掉 routes。然後
cd apps/launch && npx wrangler d1 migrations apply learn-v2 --local -c wrangler.local.jsonc
npm run build:web -w @learn/mobile && npm run embed      # 先 build 網頁再嵌入 Worker
npx wrangler dev -c wrangler.local.jsonc --port 8787
#   測試登入：POST /api/v2/auth/demo  {"sub":"demo-admin"|"demo-student"|"demo-outsider"}，
#   token 放 localStorage 鍵 hglobal:learn:session-token；用 Playwright（雲端已內建 chromium）390px 截圖。

# 2) 檢查
npm test -w @learn/launch            # 後端 133 項
npm run typecheck -w @learn/mobile
npx eslint apps                       # 另可跑 npx tsc --noEmit -p apps/mobile --noUnusedLocals

# 3) 部署（雲端環境的 Cloudflare 權限由 proxy 注入）
export CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=<寰宇帳號編號，已設定在雲端環境變數>
npm run build:web -w @learn/mobile && (cd apps/launch && npm run embed)
cd apps/launch && npx wrangler d1 migrations apply learn-v2 --remote   # 只有新增 migration 才需要
npx wrangler deploy                                                    # 看到 Current Version ID 即成功
# 注意：npm run deploy 在雲端環境曾因找不到 wrangler 失敗，改用上面的 npx 步驟。
```
- 最近一次部署版本：`6e94772e-fe13-47fa-bc5c-5a62d1da4d9e`（2026-11-16，含 migration 0059）。
- 杜杜龍若在 Cloudflare 後台改變數，頁面可能把程式退回舊版：事後要確認新功能仍正常，必要時重新 `wrangler deploy`。
- Cloudflare 偶爾回 code 971（太頻繁），等 4 分鐘再 deploy。
- 每個 migration 是新檔案，**D1 不能改 CHECK／NOT NULL**，要改只能重建資料表。

## 四、杜杜龍永久指示精華（完整版在 `CLAUDE.md`，這裡列「最常踩到」的）
1. **資料正本規則**：「中心」清單只以中央為準，不可自行新增或混入本地名稱；中心／獎銜／職務等中央定義的資料一律不在行動大學另建一份（後端用 `assertCentralCenters` 驗證）。Amway 資料即時讀寫中央、不保存（唯一例外：報名紀錄的「中心名稱」、付費報名的真實姓名快照，杜杜龍已核准）。
2. **共用元件是唯一來源，要改外觀只改那一個檔案，全站同步；不可各畫各的**：`BottomSheet`（上拉選單，下滑跟手收起）、`SheetAction`、`TopBar／PageHeader`、`EditSheet`、`CourseCard`、`ShareIcon＋shareLink`、`MediaUploadModule`（影音來源＋時間軸；含新的 `TimeRangePicker` 拖曳設定）、`ArtUploader`（EDM＋16:9 封面上傳，中心／系列共用）、`CenterHero`（中心頁與系列頁的照片區）、`PlayerControls`、`StageFrame`、`showFlash／FlashHost`（全螢幕文字提醒）、`SaplingIcon`（已完成＝小樹苗）。
3. **分享**：一律系統分享選單；文字範本全在「設定 > 分享預設值」；課程右上角分享只分享課程網址（不帶 `?lesson=`）；章節分享網址＝`課程網址?N`（N＝章節編號）；課程專屬網址 `/{中心縮寫或hq}/{主講人拼音}-{編號}`，編號從 1 起不補零（舊 `-001` 仍相容）。
4. **確認動作用底部彈出確認面板**，不用瀏覽器內建對話框。
5. **課程編輯一律原地編輯**（課程介紹頁），沒有獨立後台頁；章節在課程頁「原地播放」，沒有獨立上課頁。
6. 「已完成」章節（播放超過完成門檻，預設 95%）圖示＝小樹苗；累計與學習成就並排在「學習中」最上方。
7. **Mux 匯入只有超級管理員能看到與使用**（前後端都擋）。
8. 其餘（免費課程自動通過、付費課程站內審核、EDM 頁規則、課程資訊卡格式…）見 `CLAUDE.md`。

## 五、目前狀態（2026-11-16 全部已上線）
近期完成（細節都在 `v2-handoff.md` 最後幾節）：章節新增／編輯合併面板、總結章節、播放系統競態修正（點 2 播 3）、其他教材改「外部連結」、章節分享鈕、附件功能移除、分享網址整理、小樹苗＋學習成就移到「學習中」、全螢幕文字提醒模組（190×230 固定尺寸、點一下關閉）、Mux 限超級管理員、**系列頁改版**（照片區＋清單／EDM 兩種檢視＋課程分享）、封面上傳共用模組、**影片時間軸拖曳設定**。

## 六、等杜杜龍處理／確認的事（接手後第一輪就提醒他）
1. 到「設定 → 短網址 → 為舊課程補上專屬網址」按一次（會順便把舊 `-001` 改成 `-1`），並替約 17 門課補填「主講人」。
2. 「設定 → 分享預設值」的單堂課程文字，把 `{主講人}` 改成 `{主講人}{職稱}`。
3. 小樹苗累計的算法目前＝「所有課程已完成章節數加總」；請杜杜龍確認這是他要的意思。
4. 系列頁／拖曳設定的 YouTube 預覽，沙盒環境連不上外網，**尚未在正式站用真實 YouTube 驗證**，請杜杜龍實測一次。
5. 課程自己的 EDM 上傳（`EdmManager`，課程頁）版面與 `ArtUploader` 不同，尚未併入共用模組；要不要統一請問杜杜龍。
6. **iOS／Android 實機一律還沒測過**；App Store／Google Play 上架（需 Apple Team ID、Expo 帳號、12 位測試者 14 天封閉測試）尚未做。
7. 中央相關：聯絡查詢用途 `payment_notice`／`course_notice` 是否核准（杜杜龍未回覆）；講師名單功能需要「中央提供超級管理員搜尋會員」的新需求（見下）。

## 七、已討論、已同意、尚未開發
- **講師名單**：建在**行動大學自己管理**（杜杜龍 2026-11-16 同意）：新資料表，一人一筆（可有別名／多個職稱），只存「會員編號」配對，不複製中央資料；由超級管理員用手動方式把「分享者／主講人姓名」配對到註冊會員；會員的設定頁將彙整「我講過的課程」。需要中央提供「超級管理員搜尋會員」的 API——要先替杜杜龍寫給中央會員 AI 的需求單。章節分享者姓名目前只做「打字建議本系統用過的名字」（`GET /admin/sharer-names`）。
- 其他尚未做：手機推播、金流（`orders.pay_method` 已含 `online`）、EDM 裁切在手機 App 的支援（目前只有網頁版）。

## 八、容易踩到的坑
- `api.ts` 很大；路由是「陣列＋正則」，新增路由放在對應區塊，型別放 `contract.ts`。
- **React Hook 一律放元件最上方、所有提前 return 之前。**
- Playwright 測試中，YouTube iframe 在沙盒連不上外網（會報 localStorage 錯誤），那是環境問題不是程式錯。
- Web 版 `Animated` 用 `useNativeDriver: true` 動畫不會動，要用 `false`。
- 日期顯示台灣時間（UTC+8）；瀏覽次數「同人同日算一次」。
- 播放系統架構：`useLessonSession`（hook）→ 全域 `engine`（`engine.web.ts`／`engine.ts`）→ `PlayerLayer`；每個播放狀態都綁 `{courseId, lessonId}`，換章節靠 `loadId`／`requestSeq` 防競態。不要在別處另做播放狀態。
- 中央 `/v1/admin/*` 只接受會員中心網站自己的登入；App 只能用本人 Token 呼叫 `/v1/me/*`、`/v1/eligibility/*`、`/v1/vocab/*`。

## 九、新帳號怎麼開始（給杜杜龍的步驟）
1. 在新 Claude 帳號連結 GitHub（claude.ai 設定 → Connectors），並安裝 Claude GitHub App 到 `hglobal1985/HGlobal1985-apps` 與 `hglobal1985/id`（唯讀即可給 id）。
2. 新增 Claude Code（雲端）環境，Repository 選 `hglobal1985/HGlobal1985-apps`；網路政策要允許 Cloudflare API（部署用）；在環境裡設定 Cloudflare 的 API 權杖（用「network secret／request_credential」功能，**不要貼進對話**），權限需含 Workers、D1、R2、Email。
3. 開新 session，貼上 `docs/新帳號第一則訊息.md` 的內容。
4. 讓它先做一次「讀文件 → 跑測試 → 本機啟動 → 回報看懂了什麼」，再下新需求。
