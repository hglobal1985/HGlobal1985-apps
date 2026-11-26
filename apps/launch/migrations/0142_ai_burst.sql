-- 業主 2026-11-26（付費方案，同意花錢）：EDM 重新辨識要一次大量同時跑完，不要分批好幾個小時。
-- 把 AI 辨識排程調到上限：每輪 24 張、同時 8 張、每次排程最多 600 秒（下一次排程最晚 10 分鐘內開始，168 張 EDM 預計在這一次排程內做完）。
INSERT INTO ui_settings (key, value, updated_at) VALUES ('search_settings', '{"aiBatchSize":24,"aiConcurrency":8,"aiBudgetSec":600}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = json_patch(value, '{"aiBatchSize":24,"aiConcurrency":8,"aiBudgetSec":600}'), updated_at = excluded.updated_at;
