> **已完成（2026-11-22）**：中央已開放，串接指令 2026-11-22.1：`members/lookup` 的 fields 加 `rank`，直接回 `rank_label` 與 `rank_badge`；行動大學已照做。以下保留原始請求供參考。

# 請中央協助：開放「他人公開名片」的獎銜與獎章圖（app_id = learn）

> 這份說明可以單獨閱讀，不需要看行動大學（`hglobal1985/learn`）的程式。

## 1. 這是什麼功能
行動大學新增「加入我的清單」：會員自己建立清單、把課程或教材放進去，並**主動分享一個公開網址**（`https://learn.hglobal1985.com/{會員編號}/{名稱}`）給朋友。
打開這個網址的人（包含**還沒登入的訪客**）會在清單最上面看到「分享者名片」：**頭像、姓名、獎銜、獎章圖（含動畫）**，格式和行動大學首頁的會員名片完全一樣。

頭像與姓名行動大學已經取得。**獎銜與獎章圖現在顯示不出來**，原因見下一節。

## 2. 現況：行動大學目前怎麼呼叫中央
訪客打開清單時，行動大學後端用**服務 Token**（`POST /v1/service/token`，`app_id=learn`）做兩件事，**對象是清單的主人（不是打開網頁的人）**：

1. `POST /v1/apps/learn/members/lookup`
   ```json
   { "member_ids": ["<清單主人的 member_id>"], "fields": ["rank"], "use": "display" }
   ```
   期待回傳 `members[].fields.rank`（獎銜值，例如 `gold`、`none`）。
2. `GET /v1/amway/field-definitions`（同樣用服務 Token）取得獎銜選項名稱與 `badge_url`、`badge`（width／height／art_top／art_bottom），用來顯示中文獎銜名稱與獎章圖。

目前這個 lookup 只被用在「上手白金／鑽石」（`upline_platinum`、`upline_diamond`）。**我們不確定 `rank` 是否在 learn 的平台設定裡被勾選，也不確定服務 Token 可不可以讀 `field-definitions`。** 失敗時行動大學會優雅降級：名片只顯示頭像與姓名。

## 3. 請中央確認或開放
請回覆以下三點（可以只回答「可以／不行＋原因」）：

1. **`members/lookup` 能否對 learn 開放 `rank` 欄位**（平台設定勾選），並確認 `use: "display"` 是正確用途？回傳的 `fields.rank` 值格式是什麼（字串？還是 `{ option, custom_text }`）？
2. **服務 Token 能否讀 `GET /v1/amway/field-definitions`？** 如果不行，能否改成在 `lookup` 回應中直接多帶 `rank_label`（中文名稱）與 `rank_badge`（`badge_url`＋`width`／`height`／`art_top`／`art_bottom`）？
3. 是否需要**會員同意或額外 scope**？我們的情境是：會員自己建立並公開分享清單，名片是分享者自己選擇公開的內容。如果中央認為需要會員明確同意（例如分享清單前勾選「在我的清單名片顯示獎銜」），請告訴我們要用哪個旗標，我們會在行動大學加上勾選。

## 4. 行動大學這邊會遵守的規則（Amway 資料）
- **不寫資料庫、不寫日誌**，只放 Worker 記憶體快取 10 分鐘。
- 只在有人打開那份清單時查那一位清單主人；同一位主人 10 分鐘內最多查 1 次，流量遠低於 lookup 每分鐘 120 次的限制。
- 清單主人沒有開啟 Amway（`enabled=false`）、查不到、403、422、429、逾時，一律不顯示獎銜與獎章，只顯示頭像與姓名，不影響清單。
- 失敗原因只記狀態碼與中央的錯誤代碼，不含會員資料。

## 5. 怎麼驗收
用 learn 的服務 Token 呼叫：
```
POST /v1/apps/learn/members/lookup
{ "member_ids": ["<任一已啟用 Amway 的會員>"], "fields": ["rank"], "use": "display" }
```
應回 200 並帶 `fields.rank`。如果平台設定沒勾，會回 403 `field_not_allowed`，行動大學已經處理這個情況。

## 6. 如果中央不能開放
請告訴我們原因與替代做法，例如：改成「會員自己在行動大學按一下同意後，由行動大學存一個『要不要在名片顯示獎銜』的旗標，再由中央每次回傳」。在中央回覆前，公開清單的名片只顯示頭像與姓名。
