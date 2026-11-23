-- 同步 YouTube 清單：命名時要從名稱中移除的文字（業主 2026-11-23）。多個用逗號、頓號或換行分開。
ALTER TABLE youtube_syncs ADD COLUMN strip_text TEXT NOT NULL DEFAULT '';
