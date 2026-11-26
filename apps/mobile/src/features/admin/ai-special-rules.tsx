import { View } from "react-native";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Fold } from "@/ui";

/**
 * 「特殊辨識規則」清單（業主 2026-11-26：業主要求過的特殊規則，一律列在設定 › AI 文字辨識讓他看得到）。
 * 這裡是白話版；程式裡實際執行的位置寫在括號。**之後業主再指定任何辨識相關的特殊規則，除了寫進程式與 docs/rules/，也要在這裡加一條。**
 */
const RULES: { title: string; body: string; where: string; setup?: string }[] = [
  { title: "活動日期沒寫年份 → 取離上傳日最近的年份", body: "EDM 上的日期通常只有月和日。系統會試「上傳前一年、當年、後一年」，挑和上傳日最接近的那一年建檔：1 月上傳 12 月的海報會是前一年，12 月上傳 1 月的活動會是隔年。海報上明確寫了完整年份才照海報。已經建檔的舊 EDM 不重算。", where: "edm-vision.ts inferDate／fillMissingEdmDates", setup: "不需要設定，自動套用。個別 EDM 的日期若不對，目前請找開發者；日後可能加手動修改。" },
  { title: "欄位格式只適用中心 EDM", body: "本頁下方「欄位格式」（日期、時間、主題、講師、地點…）只會套用在中心 EDM 的辨識文字。相簿（區塊）照片、課程封面等其他照片，辨識出來的文字不整理、不套欄位，直接顯示原文。", where: "edm-structure.ts（只處理 scope=edm）／edm-info.tsx", setup: "欄位名稱、順序、說明：本頁下方「欄位格式」自訂；換整理用的模型：設定 › AI 模型 › EDM 文字整理。" },
  { title: "辨識文字只能是海報上的原文", body: "AI 不可以寫自己的話、開場白、判斷或猜測；提示裡也不放「今天日期」，避免被當成海報內容寫出來。「今天是…」「活動日期應該是…」這類句子會被自動刪掉。", where: "edm-vision.ts／edm-structure.ts cleanOcrText", setup: "不需要設定，系統固定這樣做。" },
  { title: "不使用 Markdown 符號", body: "辨識結果會去掉 ** ### 與條列符號，只留純文字。", where: "cleanOcrText", setup: "不需要設定，系統固定這樣做。" },
  { title: "套入欄位格式：不可加字、不可加年份", body: "文字整理時，每個欄位只能放海報原有的字句；歸不進任何欄位的內容，固定放最後的「其他內容」。欄位格式可在本頁自訂。", where: "edm-structure.ts", setup: "欄位名稱與順序：本頁下方「欄位格式」；改完存檔後，舊 EDM 會在背景自動重新整理。" },
  { title: "AI 卡住亂重複就清掉", body: "AI 偶爾會包出 JSON 外殼、或一直重複同一行（例如一堆 title:）。系統會拆掉外殼、刪掉重複行；清完幾乎沒剩的，視為沒有文字。", where: "cleanOcrText／photo-ocr.ts", setup: "不需要設定，系統固定這樣做。" },
  { title: "中心 EDM 只做文字辨識，不做場景辨識", body: "場景標籤只給相簿（區塊）照片，例如成交百寶箱；中心 EDM 沒有場景辨識。", where: "ai-batch.ts", setup: "相簿場景辨識可在本頁上方「辨識優先順序與開關」整類關掉。" },
  { title: "辨識順序可自訂", body: "預設：中心 EDM 文字 ＞ 相簿照片文字 ＞ 相簿場景。可在本頁上方用 ▲▼ 調整、個別開關。", where: "ai-batch.ts", setup: "本頁上方「辨識優先順序與開關」：▲▼ 調順序、開關決定要不要辨識那一類。" },
  { title: "AI 看圖前先轉成 JPEG", body: "站內圖片存成 AVIF 省空間，但 AI 看不懂 AVIF，所以送去辨識前會暫時轉成 JPEG（不改站內檔案）。", where: "ai-image.ts prepareVisionImage", setup: "不需要設定，系統固定這樣做。" },
  { title: "辨識失敗用紅色標示、不默默卡住", body: "失敗的張數與狀態一律用紅色粗體；處理出錯會直接標為失敗，不會一直停在「處理中」。", where: "ai-progress.tsx／edm-info.tsx", setup: "不需要設定。失敗太多時，先看本頁上方失敗張數與原因，再到「設定 › AI 模型」確認模型能用。" },
  { title: "辨識結果所有人都看得到", body: "圖片資訊（驚嘆號）裡的辨識文字、狀態、儲存格式，所有人都能看。", where: "edm-info.tsx", setup: "不需要設定。" },
  { title: "「活動日期排序」鈕只出現在中心 EDM 相簿", body: "相簿裡日曆圖示的「活動日期排序」只在中心 EDM 的資料夾出現；課程、系列、區塊相簿（例如成交百寶箱）只有「上傳時間排序」。", where: "lightbox-library.tsx", setup: "不需要設定。" },
  { title: "AI 每日額度上限", body: "AI 辨識和其他 AI 工作共用每日額度，預設上限 9,000 點，用完自動停、隔天早上 8:00（台灣時間）自動續辨，避免出錯時一天燒掉大量點數。帳號是 Cloudflare Workers 付費方案（每月 US$5），超過免費額度的部分依用量計費。", where: "ai-models.ts reserveAi", setup: "設定 › AI 模型：「每日額度上限」開關與數字。要一次大量辨識時可暫時關閉，做完請記得重新開啟。" },
  { title: "AI 辨識排程的速度", body: "平常每 10 分鐘自動辨識一批：每輪 12 張、同時 4 張、最多跑 240 秒。大量辨識時可臨時調高（同時最多 8 張、600 秒），做完請調回。", where: "ai-batch.ts", setup: "設定 › 搜尋與 AI 設定 › AI 辨識排程（三個數字）。急的話可直接按本頁上方「立即開始辨識」。" },
  { title: "預設辨識模型", body: "中心 EDM 圖片辨識、相簿照片文字辨識，預設都用 Llama 4 Scout（繁體中文比 Llama 3.2 準）。Gemma 3 這個帳號沒有權限，選了會被擋下。", where: "ai-models.ts", setup: "設定 › AI 模型：每一類工作各自選模型。" },
];

export function AiSpecialRulesPanel() {
  const { c } = useTheme();
  return (
    <Fold title="特殊規則與設定說明（杜杜龍指定）">
      <AppText variant="caption" tone="muted">這些是杜杜龍指定、已經寫進系統的規則（給所有管理員看的說明）：每條說明規則內容、要去哪裡設定。之後有新的規則會加在這裡。</AppText>
      {RULES.map((r, i) => (
        <View key={r.title} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
            <AppText variant="caption" style={{ color: c.accentText, fontWeight: "800" }}>{i + 1}</AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="callout" style={{ fontWeight: "800" }}>{r.title}</AppText>
            <AppText variant="callout">{r.body}</AppText>
            {r.setup ? <AppText variant="callout" style={{ color: c.accentText, fontWeight: "700" }}>{`怎麼設定：${r.setup}`}</AppText> : null}
            <AppText variant="caption" tone="muted">{`執行位置：${r.where}`}</AppText>
          </View>
        </View>
      ))}
    </Fold>
  );
}
