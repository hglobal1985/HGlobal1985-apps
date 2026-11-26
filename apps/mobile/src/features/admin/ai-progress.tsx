import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { api } from "@/api/client";
import { flashText } from "@/ui/flash-notice";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card, Fold } from "@/ui";

type Pack = { total: number; done: number; failed: number; pending: number; groups: { label: string; total: number; done: number; failed: number }[] };
export type JobRow = { key: "edm" | "photoOcr" | "scene"; label: string; on: boolean; prio: number };
export type Progress = { jobs?: JobRow[]; ocr: Pack; scene: Pack; photoOcr?: Pack; ai: { capEnabled: boolean; dailyCap: number; used: number; remaining: number } };

function Bar({ done, total }: { done: number; total: number }) {
  const { c } = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.accent }} />
    </View>
  );
}

/** 失敗張數一律用醒目的紅色粗體＋淺紅底標記（杜杜龍 2026-11-26）；0 張時用一般灰字，不搶眼。 */
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
    <Fold title={title}>
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
    </Fold>
  );
}

export const PRIO_KEY = { edm: "aiPrioEdm", photoOcr: "aiPrioPhotoOcr", scene: "aiPrioScene" } as const;
export const ON_KEY = { edm: "aiOnEdm", photoOcr: "photoOcrEnabled", scene: "aiOnScene" } as const;

/** 辨識來源設定（優先順序＋開關）轉成 search-settings 要存的值（杜杜龍 2026-11-26：隨頁面唯一的「儲存」一起存）。 */
export const jobsValues = (jobs: JobRow[]): Record<string, number | boolean> => ({
  ...Object.fromEntries(jobs.map((x, n) => [PRIO_KEY[x.key], n + 1])),
  ...Object.fromEntries(jobs.map((x) => [ON_KEY[x.key], x.on])),
});

/** 辨識來源的優先順序與開關（杜杜龍 2026-11-26）：排在上面的先辨識；關掉的來源排程不處理。▲▼ 調整順序、開關即時儲存。 */
function JobOrder({ jobs, setJobs, dirty, reload }: { jobs: JobRow[]; setJobs: (j: JobRow[]) => void; dirty: boolean; reload: () => void }) {
  const { c } = useTheme();
  // 立即開始辨識（杜杜龍 2026-11-26）：連續呼叫伺服器各跑一輪（約 70 秒），直到這一輪一張都沒處理（做完了或額度用完）；可隨時停止。
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const stop = useRef(false);
  const start = async () => {
    if (running) return;
    if (dirty) return void flashText("優先順序或開關還沒儲存，請先按下方「儲存」再開始辨識");
    stop.current = false;
    setRunning(true);
    setTotal(0);
    let sum = 0;
    try {
      for (let i = 0; i < 30 && !stop.current; i++) {
        const r = await api<{ done: number; stopped: boolean }>("POST", "/admin/ai/run-now");
        sum += r.done;
        setTotal(sum);
        reload();
        if (r.stopped) return void flashText("今天的 AI 額度或模型權限有問題，已停止");
        if (r.done === 0) break;
      }
      flashText(stop.current ? `已停止，這次共處理 ${sum} 張` : `辨識完成，這次共處理 ${sum} 張`);
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const move = (i: number, d: number) => {
    const next = [...jobs];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setJobs(next);
  };
  return (
    <Fold title="辨識優先順序與開關">
      <AppText variant="caption" tone="muted">排在上面的先辨識；額度或時間不夠時，後面的會等前面的做完。關掉開關＝排程不再辨識這一類圖檔（已辨識的不受影響）。</AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={running ? "停止辨識" : "立即開始辨識"} onPress={() => (running ? (stop.current = true) : void start())} style={{ flex: 1, minHeight: 50, borderRadius: 25, backgroundColor: running ? c.danger : c.accent, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}>
          <Ionicons name={running ? "stop-circle-outline" : "flash-outline"} size={22} color={running ? c.dangerSoft : c.textOnAccent} />
          <AppText variant="callout" style={{ color: running ? c.dangerSoft : c.textOnAccent, fontWeight: "800" }}>{running ? `辨識中…已處理 ${total} 張（點一下停止）` : "立即開始辨識"}</AppText>
        </Pressable>
      </View>
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
          <Switch accessibilityLabel={`${j.label} 開關`} value={j.on} onValueChange={(v) => setJobs(jobs.map((x) => (x.key === j.key ? { ...x, on: v } : x)))} />
        </View>
      ))}
    </Fold>
  );
}

/**
 * AI 辨識進度與額度（設定 › AI 文字辨識，杜杜龍 2026-11-24）：中心 EDM 文字辨識、相簿場景辨識各自的完成張數與進度（依中心／依區塊），
 * 以及今天的 AI 總額度、已用、剩餘（兩種辨識和其他 AI 工作共用每日免費額度，用完自動停、隔天續辨）。
 */
export function AiProgressPanel({ data, reload, jobs, setJobs, dirty }: { data: Progress | undefined; reload: () => void; jobs: JobRow[] | null; setJobs: (j: JobRow[]) => void; dirty: boolean }) {
  if (!data) return null;
  const a = data.ai;
  return (
    <View style={{ gap: space.md }}>
      <Fold title="今天的 AI 額度">
        <Bar done={a.used} total={a.dailyCap} />
        <AppText variant="callout">{a.capEnabled ? `已用 ${a.used} 點／上限 ${a.dailyCap} 點・剩餘 ${a.remaining} 點` : `已用 ${a.used} 點（額度限制已關閉）`}</AppText>
        <AppText variant="caption" tone="muted">優先順序可在下方「辨識優先順序與開關」自訂。封面（課程、系列、中心照片）不辨識。每天台灣時間早上 8:00 重置。</AppText>
      </Fold>
      {jobs ? <JobOrder jobs={jobs} setJobs={setJobs} dirty={dirty} reload={reload} /> : null}
      <PackCard title="中心 EDM 文字辨識" rule="只辨識中心 EDM；套用「欄位格式範本」，可被文字搜尋。" pack={data.ocr} />
      <PackCard title="相簿場景辨識" rule="辨識其他相簿（例如成交百寶箱）與「食譜」專區的照片；認出行為、場景、物品，搜尋時分類標籤＝「場景」，食譜搜尋也會比對這些標籤。" pack={data.scene} />
      <PackCard title="相簿照片文字辨識（OCR）" rule="只辨識相簿（區塊）照片，不含食譜照片（食譜只做場景辨識、不做文字辨識）；讀出照片裡的文字（招牌、白板、包裝…），相簿搜尋與場景搜尋都能用文字找到。可在「搜尋與 AI 設定」開關。" pack={data.photoOcr ?? { total: 0, done: 0, failed: 0, pending: 0, groups: [] }} />
    </View>
  );
}
