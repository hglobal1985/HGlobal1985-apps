-- 舊的 EDM 辨識文字含 AI 自己加的話（開場白、「今天是…」、猜測的日期）；改成不放今天日期的新提示後，全部清掉重新辨識（背景慢慢跑，額度用完隔天續）。
UPDATE cover_media SET ocr_status = '', ocr_text = '', ocr_fields = '', ocr_fmt = '' WHERE scope = 'edm' AND kind = 'image' AND ocr_status IN ('done', 'failed');
