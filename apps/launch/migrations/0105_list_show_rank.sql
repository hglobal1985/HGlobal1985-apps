-- 清單分享者名片是否顯示獎銜與獎章（業主 2026-11-22；中央建議分享前讓會員勾選同意，中央不替 App 檢查）。預設勾選，清單主人可在清單設定取消。
ALTER TABLE my_lists ADD COLUMN show_rank INTEGER NOT NULL DEFAULT 1;
