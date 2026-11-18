-- Email 通知依情境開關（業主 2026-11-18）：JSON，只存會員改過的項目（沒存的用預設：只有「付費課程相關的審核通知」預設要寄）。
ALTER TABLE member_contacts ADD COLUMN email_kinds TEXT;
