# 給中央會員 AI 的指令：開放「App 內直接刪除帳號」給所有串接的 App（業主 2026-11-23 指示，請貼給中央會員那邊的 AI）

業主決定：**會員在任何串接中央會員的 App 內按「刪除帳號」，就直接刪除並清空所有資料（包含中央會員的資料），不用再被帶去中央會員網站重新按一次刪除。** 這是全生態系統的標準，請中央先改、更新串接指令（`https://id.hglobal1985.com/handoff/learn`）。

## 現況（我們查到的）
- `POST /v1/me/delete-account`：OpenAPI 寫明 **member site only; needs a sign-in within 10 minutes**，認證方式是會員網站的 `session`，App 的 Bearer Access Token 無法呼叫。
- 串接指令三、9 目前規定：App 只放一個按鈕「用瀏覽器開啟 `https://id.hglobal1985.com/my/edit`」，會員要在那裡重新登入再按「刪除帳號」。業主要求取消這個二次跳轉。
- 其他可用的是 `POST /v1/admin/members/{member_id}/delete`，僅限總部管理員，不適用。

## 請中央做的事
1. **開放 App 呼叫刪除帳號**：`POST /v1/me/delete-account` 除了會員網站的 session，也接受**該會員自己、由已登記 App 取得的 Access Token（Bearer）**。只能刪除「token 本人」，不能指定別人。
2. **重新驗證（安全必要）**：維持「需要 10 分鐘內的重新登入」，但要有 App 能完成的方式。建議做法（請中央決定細節，只要 App 能走完即可）：
   - 登入中繼（`/auth/google/start`）新增參數 `purpose=delete_account`（或 `reauth=1`），會員在瀏覽器再按一次 Google 登入；回傳的 `id_token` 照原流程用 `POST /v1/auth/google`（帶 `purpose`）換成一張**標記「剛重新驗證過」（例如 claim `reauth_at`）的 Access Token**；
   - `POST /v1/me/delete-account` 檢查 `reauth_at` 在 10 分鐘內，否則回 `401 reauth_required`（App 會再引導重新登入一次）。
3. **效果與網站按鈕完全一致**：帳號匿名化並關閉、所有裝置登出、Google 帳號釋放、**Amway 資料一併清除**（會員中心的個人資料、Amway 欄位、審核申請、社群連結、頭像等）；成功回 `{"deleted": true}`。
4. **照常通知各 App**：刪除成功後照原本機制對所有已串接 App 送 `member.deleted` webhook（各 App 用它清掉自己的副本，包含呼叫的這款 App）。呼叫的 App 不用等 webhook，成功回應後會自己先清。
5. **錯誤碼維持**：`401 unauthenticated／reauth_required`、`403 forbidden`、`409 last_super_admin`（最後一位超級管理員要先移交職務；請把 `message` 寫成可直接顯示給會員的白話文）。App 只負責把訊息顯示出來。
6. **防濫用**：只接受已登記且狀態 active 的 App；加上頻率限制；每次刪除寫稽核紀錄（不記信箱）。被暫停（paused／killed）的 App 不可呼叫。
7. **更新串接指令**：
   - 三、9 改成：App 內放「刪除帳號」按鈕，流程＝**二次確認（寫明「會刪除你在所有寰宇 App 的帳號與資料，無法復原」）→ 重新驗證 → `POST /v1/me/delete-account` → 成功後清除本機資料與 Token、回到登入畫面**。不再要求開啟 `/my/edit`。
   - `/my/edit` 的刪除帳號按鈕保留（網頁版會員仍可用）。
   - 六、檢查清單加一項，並新增標準代碼 **`in_app_delete`**（App 內可直接刪除帳號），納入 `GET /v1/apps/{app_id}/handoff?...&standards=` 的符合度回報，後台 App 清單顯示。
   - 版本號升級，讓各 App 重新讀取後只補差異。

## 驗收方式
- 用測試會員：App 內走完「確認 → 重新登入 → 刪除」，帳號立刻無法再登入，其他已串接 App 收到 `member.deleted`。
- 超過 10 分鐘才呼叫 → `reauth_required`；用別人的 token 無法刪除別人；最後一位超級管理員 → `409`。

## 行動大學這邊的對應（中央完成後做，不需要中央處理）
行動大學收到新版指令後會把「刪除帳號」改成：確認 → 重新登入 → 呼叫中央刪除 → 成功才清除本 App 的所有資料並登出；中央刪除失敗就不動本 App 的資料，並把原因顯示給會員。
