# 請中央會員系統新增：審核者直接修改申請人的獎銜／中心（給中央 AI 的指令）

行動大學（app_id=learn）通知頁的「審核」分頁，要讓有審核權限的人（超級管理員、秘書、審核員）在審核申請時，直接替申請人修改「獎銜／中心／系統」的內容並留下修改紀錄。

目前做不到的原因：
- `POST /v1/eligibility/reviews/{id}/decision` 只有 approve／reject，不能帶修改後的值。
- `PUT /v1/admin/members/{member_id}/amway/{field_key}` 需要會員中心網站的 session（Cookie），App 的會員 Token 不能用；而且審核名單（`GET /v1/eligibility/reviews`）沒有回傳 `member_id`。

建議（任一種即可）：
1. `POST /v1/eligibility/reviews/{id}/decision` 增加選填 `value`（修改後的值，格式同欄位定義）：`decision=approve` 且帶 `value` 時，以 `value` 核准，並寫入中央稽核紀錄（原申請值、修改後的值、審核者），同時通知會員。權限規則與現有相同（審核員只能處理自己中心）。
2. 同時在審核名單與決定回應中回傳 `member_id`、`field_key`，讓行動大學能通知申請人。

行動大學這邊接好之後，審核卡片會多一個「修改後通過」。
