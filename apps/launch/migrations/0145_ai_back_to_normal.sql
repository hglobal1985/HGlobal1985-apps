-- 業主 2026-11-26：EDM 全部辨識完成（168 張），AI 排程調回正常值，並把每日額度上限重新開啟。
UPDATE ui_settings SET value = json_patch(value, '{"aiBatchSize":12,"aiConcurrency":4,"aiBudgetSec":240}') WHERE key = 'search_settings' AND json_valid(value);
UPDATE ui_settings SET value = json_patch(value, '{"capEnabled":true,"dailyCap":9000}') WHERE key = 'ai_settings' AND json_valid(value);
