import { View } from "react-native";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card } from "@/ui";

/**
 * 「特殊辨識規則」清單（業主 2026-11-26：業主要求過的特殊規則，一律列在設定 › AI 文字辨識讓他看得到）。
 * 這裡是白話版；程式裡實際執行的位置寫在括號。**之後業主再指定任何辨識相關的特殊規則，除了寫進程式與 docs/rules/，也要在這裡加一條。**
 */
const RULES: { title: string; body: string; where: string }[] = [
  { title: "活動日期沒寫年份 → 一律用上傳當年", body: "EDM 上的日期通常只有月和日。系統一律用「這張 EDM 上傳當下的年份」補上建檔；海報上明確寫了完整年份才照海報。舊的 EDM 也已依這條補齊，而且每次排程都會自動校正。", where: "edm-vision.ts inferDate／fixEdmYears" },
  { title: "辨識文字只能是海報上的原文", body: "AI 不可以寫自己的話、開場白、判斷或猜測；提示裡也不放「今天日期」，避免被當成海報內容寫出來。「今天是…」「活動日期應該是…」這類句子會被自動刪掉。", where: "edm-vision.ts／edm-structure.ts cleanOcrText" },
  { title: "不使用 Markdown 符號", body: "辨識結果會去掉 ** ### 與條列符號，只留純文字。", where: "cleanOcrText" },
  { title: "套入欄位格式：不可加字、不可加年份", body: "文字整理時，每個欄位只能放海報原有的字句；歸不進任何欄位的內容，固定放最後的「其他內容」。欄位格式可在本頁自訂。", where: "edm-structure.ts" },
  { title: "AI 卡住亂重複就清掉", body: "AI 偶爾會包出 JSON 外殼、或一直重複同一行（例如一堆 title:）。系統會拆掉外殼、刪掉重複行；清完幾乎沒剩的，視為沒有文字。", where: "cleanOcrText／photo-ocr.ts" },
  { title: "中心 EDM 只做文字辨識，不做場景辨識", body: "場景標籤只給相簿（區塊）照片，例如成交百寶箱；中心 EDM 沒有場景辨識。", where: "ai-batch.ts" },
  { title: "辨識順序可自訂", body: "預設：中心 EDM 文字 ＞ 相簿照片文字 ＞ 相簿場景。可在本頁上方用 ▲▼ 調整、個別開關。", where: "ai-batch.ts" },
  { title: "AI 看圖前先轉成 JPEG", body: "站內圖片存成 AVIF 省空間，但 AI 看不懂 AVIF，所以送去辨識前會暫時轉成 JPEG（不改站內檔案）。", where: "ai-image.ts prepareVisionImage" },
  { title: "辨識失敗用紅色標示、不默默卡住", body: "失敗的張數與狀態一律用紅色粗體；處理出錯會直接標為失敗，不會一直停在「處理中」。", where: "ai-progress.tsx／edm-info.tsx" },
  { title: "辨識結果所有人都看得到", body: "圖片資訊（驚嘆號）裡的辨識文字、狀態、儲存格式，所有人都能看。", where: "edm-info.tsx" },
];

export function AiSpecialRulesPanel() {
  const { c } = useTheme();
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="headline">特殊辨識規則（你指定過的）</AppText>
      <AppText variant="caption" tone="muted">這些規則已經寫進系統，每次辨識都會照做。之後你再指定新的規則，我會加在這裡。</AppText>
      {RULES.map((r, i) => (
        <View key={r.title} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
            <AppText variant="caption" style={{ color: c.accentText, fontWeight: "800" }}>{i + 1}</AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="callout" style={{ fontWeight: "800" }}>{r.title}</AppText>
            <AppText variant="callout">{r.body}</AppText>
            <AppText variant="caption" tone="muted">{`執行位置：${r.where}`}</AppText>
          </View>
        </View>
      ))}
    </Card>
  );
}
