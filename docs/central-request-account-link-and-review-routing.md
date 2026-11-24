# 請中央會員系統配合：兩件事（行動大學 2026-11-24）

## 一、「前往完整版會員中心」不要再要求選 Google 帳號

業主要求：行動大學內按「前往完整版會員中心」（開啟 `https://id.hglobal1985.com/my/edit`）時，**不要再跳 Google 帳號選擇**，直接進入會員中心頁面。
登入一個 App，帳號狀態必須全寰宇 hglobal1985 App 生態系共用。

現況：會員已在行動大學登入（也已完成共用登入 `sso/start`），但開啟 `/my/edit` 時，中央網站自己的 session 不存在，所以又被帶去 Google 登入選帳號。

請中央提供「已登入會員直接進入會員中心」的標準做法，例如：
1. 用已有的共用登入 `sso_token` 換一次性代碼：`POST /v1/auth/sso/web-code {"sso_token"}` → `{code}`，再整頁導向 `https://id.hglobal1985.com/auth/sso/adopt?c=<code>&app_id=learn&return=https://id.hglobal1985.com/my/edit`（**請允許 `return` 指向中央自己的 `/my/edit`**，並且 adopt 之後直接建立中央網站的 session，不再問 Google）；或
2. 提供專用端點（例如 `GET /auth/open?c=<code>&to=/my/edit`），用 App 的 Access Token 換一次性代碼，開啟後直接登入並進入頁面。
手機 App（WebBrowser／系統瀏覽器）與網頁版（整頁導向）兩種情況都要能用。代碼要單次、短效。

請回覆行動大學：採用哪一種、要呼叫的端點與參數、`return`／`to` 可帶哪些路徑。行動大學這邊收到後才改程式（不要自己猜）。

## 二、獎銜／中心的新申請：審核通知的派送規則

業主要求：**中心若勾選「無」、或系統選「寰宇」以外的任何選項，這類申請一律把審核通知交給「寰宇秘書」和業主本人**（不要派給任何教育中心的審核員）。

審核佇列（`GET /v1/eligibility/reviews`）與「等待審核」通知目前由中央決定誰收到，行動大學只顯示中央回傳的內容，所以需要中央改派送規則：
- 申請當下的 `education_center` 是「無」，或 `education_system` 不是寰宇（含「無」「其他」自訂）→ 通知與審核權限只給 secretary（總部秘書）與業主（super_admin），中心審核員看不到、不會被通知。
- 其餘（系統是寰宇且有選中心）維持原規則：該中心的審核員＋秘書＋超級管理員。

請回覆行動大學：是否已調整；若「業主本人」要以 super_admin 之外的方式指定，請說明做法。
