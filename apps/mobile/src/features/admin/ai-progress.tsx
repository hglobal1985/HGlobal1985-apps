import { View } from "react-native";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card } from "@/ui";

type Pack = { total: number; done: number; failed: number; pending: number; groups: { label: string; total: number; done: number; failed: number }[] };
type Progress = { ocr: Pack; scene: Pack; photoOcr?: Pack; ai: { capEnabled: boolean; dailyCap: number; used: number; remaining: number } };

function Bar({ done, total }: { done: number; total: number }) {
  const { c } = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.accent }} />
    </View>
  );
}

function PackCard({ title, rule, pack }: { title: string; rule: string; pack: Pack }) {
  return (
    <Card>
      <AppText variant="headline">{title}</AppText>
      <AppText variant="caption" tone="muted">{rule}</AppText>
      <Bar done={pack.done} total={pack.total} />
      <AppText variant="callout">{`完成 ${pack.done} / ${pack.total} 張（${pack.total ? Math.round((pack.done / pack.total) * 100) : 0}%）・等待 ${pack.pending} 張・失敗 ${pack.failed} 張`}</AppText>
      {pack.groups.length ? (
        pack.groups.map((g) => (
          <View key={g.label} style={{ gap: 4 }}>
            <AppText variant="callout" numberOfLines={2}>{g.label}</AppText>
            <Bar done={g.done} total={g.total} />
            <AppText variant="caption" tone="muted">{`完成 ${g.done} / ${g.total} 張${g.failed ? `・失敗 ${g.failed}` : ""}`}</AppText>
          </View>
        ))
      ) : (
        <AppText tone="muted">還沒有照片。</AppText>
      )}
    </Card>
  );
}

/**
 * AI 辨識進度與額度（設定 › AI 文字辨識，業主 2026-11-24）：中心 EDM 文字辨識、相簿場景辨識各自的完成張數與進度（依中心／依區塊），
 * 以及今天的 AI 總額度、已用、剩餘（兩種辨識和其他 AI 工作共用每日免費額度，用完自動停、隔天續辨）。
 */
export function AiProgressPanel() {
  const { data } = useApi<Progress>("/admin/ai/progress");
  if (!data) return null;
  const a = data.ai;
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <AppText variant="headline">今天的 AI 額度</AppText>
        <Bar done={a.used} total={a.dailyCap} />
        <AppText variant="callout">{a.capEnabled ? `已用 ${a.used} 點／上限 ${a.dailyCap} 點・剩餘 ${a.remaining} 點` : `已用 ${a.used} 點（額度限制已關閉）`}</AppText>
        <AppText variant="caption" tone="muted">優先順序：中心 EDM 文字辨識（會列入文字搜尋、顯示在相簿的圖片資訊）＞ 相簿場景辨識。封面（課程、系列、中心照片）不辨識。每天台灣時間早上 8:00 重置。</AppText>
      </Card>
      <PackCard title="中心 EDM 文字辨識" rule="只辨識中心 EDM；套用「欄位格式範本」，可被文字搜尋。" pack={data.ocr} />
      <PackCard title="相簿場景辨識" rule="只辨識其他相簿（例如成交百寶箱）；認出行為、場景、物品，搜尋時分類標籤＝「場景」。" pack={data.scene} />
      <PackCard title="相簿照片文字辨識（OCR）" rule="只辨識相簿（區塊）照片；讀出照片裡的文字（招牌、白板、包裝…），相簿搜尋與場景搜尋都能用文字找到。可在「搜尋與 AI 設定」開關。" pack={data.photoOcr ?? { total: 0, done: 0, failed: 0, pending: 0, groups: [] }} />
    </View>
  );
}
