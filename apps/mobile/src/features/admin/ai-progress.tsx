import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Switch, Text, View } from "react-native";
import { api } from "@/api/client";
import { flashText } from "@/ui/flash-notice";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card } from "@/ui";

type Pack = { total: number; done: number; failed: number; pending: number; groups: { label: string; total: number; done: number; failed: number }[] };
type JobRow = { key: "edm" | "photoOcr" | "scene"; label: string; on: boolean; prio: number };
type Progress = { jobs?: JobRow[]; ocr: Pack; scene: Pack; photoOcr?: Pack; ai: { capEnabled: boolean; dailyCap: number; used: number; remaining: number } };

function Bar({ done, total }: { done: number; total: number }) {
  const { c } = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.accent }} />
    </View>
  );
}

/** 失敗張數一律用醒目的紅色粗體＋淺紅底標記（業主 2026-11-26）；0 張時用一般灰字，不搶眼。 */
function Failed({ n, lead = "" }: { n: number; lead?: string }) {
  const { c } = useTheme();
  if (!n) return <Text>{`${lead}失敗 0 張`}</Text>;
  return (
    <>
      {lead}
      <Text style={{ color: c.danger, fontWeight: "900", backgroundColor: c.dangerSoft }}>{` 失敗 ${n} 張 `}</Text>
    </>
  );
}

function PackCard({ title, rule, pack }: { title: string; rule: string; pack: Pack }) {
  return (
    <Card>
      <AppText variant="headline">{title}</AppText>
      <AppText variant="caption" tone="muted">{rule}</AppText>
      <Bar done={pack.done} total={pack.total} />
      <AppText variant="callout">
        {`完成 ${pack.done} / ${pack.total} 張（${pack.total ? Math.round((pack.done / pack.total) * 100) : 0}%）・等待 ${pack.pending} 張・`}
        <Failed n={pack.failed} />
      </AppText>
      {pack.groups.length ? (
        pack.groups.map((g) => (
          <View key={g.label} style={{ gap: 4 }}>
            <AppText variant="callout" numberOfLines={2}>{g.label}</AppText>
            <Bar done={g.done} total={g.total} />
            <AppText variant="caption" tone="muted">
              {`完成 ${g.done} / ${g.total} 張`}
              {g.failed ? <Failed n={g.failed} lead="・" /> : null}
            </AppText>
          </View>
        ))
      ) : (
        <AppText tone="muted">還沒有照片。</AppText>
      )}
    </Card>
  );
}

const PRIO_KEY = { edm: "aiPrioEdm", photoOcr: "aiPrioPhotoOcr", scene: "aiPrioScene" } as const;
const ON_KEY = { edm: "aiOnEdm", photoOcr: "photoOcrEnabled", scene: "aiOnScene" } as const;

/** 辨識來源的優先順序與開關（業主 2026-11-26）：排在上面的先辨識；關掉的來源排程不處理。▲▼ 調整順序、開關即時儲存。 */
function JobOrder({ jobs, reload }: { jobs: JobRow[]; reload: () => void }) {
  const { c } = useTheme();
  const save = async (values: Record<string, number | boolean>) => {
    try {
      await api("PUT", "/admin/search-settings", { values });
      reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const move = (i: number, d: number) => {
    const next = [...jobs];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void save(Object.fromEntries(next.map((x, n) => [PRIO_KEY[x.key], n + 1])));
  };
  return (
    <Card>
      <AppText variant="headline">辨識優先順序與開關</AppText>
      <AppText variant="caption" tone="muted">排在上面的先辨識；額度或時間不夠時，後面的會等前面的做完。關掉開關＝排程不再辨識這一類圖檔（已辨識的不受影響）。</AppText>
      {jobs.map((j, i) => (
        <View key={j.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, opacity: j.on ? 1 : 0.55 }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
            <AppText variant="callout" style={{ color: c.textOnAccent, fontWeight: "800" }}>{i + 1}</AppText>
          </View>
          <AppText variant="callout" style={{ flex: 1, fontWeight: "700" }}>{j.label}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={`${j.label} 往前`} disabled={i === 0} onPress={() => move(i, -1)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceMuted, alignItems: "center", justifyContent: "center", opacity: i === 0 ? 0.35 : 1 }}>
            <Ionicons name="arrow-up" size={20} color={c.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${j.label} 往後`} disabled={i === jobs.length - 1} onPress={() => move(i, 1)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceMuted, alignItems: "center", justifyContent: "center", opacity: i === jobs.length - 1 ? 0.35 : 1 }}>
            <Ionicons name="arrow-down" size={20} color={c.text} />
          </Pressable>
          <Switch accessibilityLabel={`${j.label} 開關`} value={j.on} onValueChange={(v) => void save({ [ON_KEY[j.key]]: v })} />
        </View>
      ))}
    </Card>
  );
}

/**
 * AI 辨識進度與額度（設定 › AI 文字辨識，業主 2026-11-24）：中心 EDM 文字辨識、相簿場景辨識各自的完成張數與進度（依中心／依區塊），
 * 以及今天的 AI 總額度、已用、剩餘（兩種辨識和其他 AI 工作共用每日免費額度，用完自動停、隔天續辨）。
 */
export function AiProgressPanel() {
  const { data, reload } = useApi<Progress>("/admin/ai/progress");
  if (!data) return null;
  const a = data.ai;
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <AppText variant="headline">今天的 AI 額度</AppText>
        <Bar done={a.used} total={a.dailyCap} />
        <AppText variant="callout">{a.capEnabled ? `已用 ${a.used} 點／上限 ${a.dailyCap} 點・剩餘 ${a.remaining} 點` : `已用 ${a.used} 點（額度限制已關閉）`}</AppText>
        <AppText variant="caption" tone="muted">優先順序可在下方「辨識優先順序與開關」自訂。封面（課程、系列、中心照片）不辨識。每天台灣時間早上 8:00 重置。</AppText>
      </Card>
      {data.jobs ? <JobOrder jobs={data.jobs} reload={reload} /> : null}
      <PackCard title="中心 EDM 文字辨識" rule="只辨識中心 EDM；套用「欄位格式範本」，可被文字搜尋。" pack={data.ocr} />
      <PackCard title="相簿場景辨識" rule="只辨識其他相簿（例如成交百寶箱）；認出行為、場景、物品，搜尋時分類標籤＝「場景」。" pack={data.scene} />
      <PackCard title="相簿照片文字辨識（OCR）" rule="只辨識相簿（區塊）照片；讀出照片裡的文字（招牌、白板、包裝…），相簿搜尋與場景搜尋都能用文字找到。可在「搜尋與 AI 設定」開關。" pack={data.photoOcr ?? { total: 0, done: 0, failed: 0, pending: 0, groups: [] }} />
    </View>
  );
}
