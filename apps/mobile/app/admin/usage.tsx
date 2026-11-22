import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Card, ErrorView, LoadingView, Screen } from "@/ui";
import Ionicons from "@expo/vector-icons/Ionicons";

/**
 * 管理員 > 使用統計（業主 2026-11-22）：手機／電腦／平板、iOS／Android、一天中的時段、首頁卡片點閱，
 * 可交叉統計（選「列」和「欄」兩個維度）並用裝置、系統、時段篩選。資料來自 App 匿名回報（`lib/usage.ts`），不含會員身分。
 */
type Table = { since: string; rows: { label: string; cells: number[]; total: number }[]; cols: string[]; total: number; truncated: boolean };
type Dim = "device" | "os" | "slot" | "hour" | "day" | "kind" | "item";
const KINDS = [
  { key: "visit", label: "開啟網站／App" },
  { key: "card_course", label: "課程卡" },
  { key: "card_series", label: "系列卡" },
  { key: "card_center", label: "中心卡" },
];
const DIMS: { key: Dim; label: string }[] = [
  { key: "device", label: "裝置" },
  { key: "os", label: "系統" },
  { key: "slot", label: "時段" },
  { key: "hour", label: "每小時" },
  { key: "day", label: "日期" },
  { key: "kind", label: "統計項目" },
  { key: "item", label: "卡片" },
];
const PRESETS: { label: string; kinds: string[]; rows: Dim; cols: Dim | null }[] = [
  { label: "手機／電腦／平板", kinds: ["visit"], rows: "device", cols: null },
  { label: "iOS／Android", kinds: ["visit"], rows: "os", cols: null },
  { label: "哪個時段最多人", kinds: ["visit"], rows: "slot", cols: null },
  { label: "首頁卡片點閱", kinds: ["card_course", "card_series", "card_center"], rows: "item", cols: null },
  { label: "裝置 × 系統", kinds: ["visit"], rows: "device", cols: "os" },
  { label: "裝置 × 時段", kinds: ["visit"], rows: "device", cols: "slot" },
];
const DEVICE = [["", "全部"], ["mobile", "手機"], ["tablet", "平板"], ["desktop", "電腦"]] as const;
const OS = [["", "全部"], ["ios", "iOS"], ["android", "Android"], ["other", "其他"]] as const;
const SLOT = [["", "全部"], ["0", "凌晨"], ["1", "早上"], ["2", "下午"], ["3", "晚上"]] as const;
const DAYS = [7, 30, 90];

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }]}>
      <AppText variant="callout" style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}
const ChipRow = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ gap: 6 }}>
    <AppText variant="caption" tone="muted" style={{ fontWeight: "800" }}>
      {title}
    </AppText>
    <View style={styles.wrap}>{children}</View>
  </View>
);

function Custom() {
  const { c } = useTheme();
  const [kinds, setKinds] = useState<string[]>(["visit"]);
  const [rows, setRows] = useState<Dim>("device");
  const [cols, setCols] = useState<Dim | null>(null);
  const [device, setDevice] = useState("");
  const [os, setOs] = useState("");
  const [slot, setSlot] = useState("");
  const [days, setDays] = useState(30);
  const qs = `kinds=${kinds.join(",")}&rows=${rows}${cols ? `&cols=${cols}` : ""}&days=${days}${device ? `&device=${device}` : ""}${os ? `&os=${os}` : ""}${slot ? `&slot=${slot}` : ""}`;
  const { data, error, loading, reload } = useApi<Table>(`/admin/usage?${qs}`);
  const toggle = (k: string) => setKinds((v) => (v.includes(k) ? (v.length > 1 ? v.filter((x) => x !== k) : v) : [...v, k]));
  const max = Math.max(1, ...(data?.rows.flatMap((r) => (data.cols.length ? r.cells : [r.total])) ?? [1]));
  return (
    <View style={{ gap: space.md }}>
      <ChipRow title="快速看">
        {PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} on={p.rows === rows && p.cols === cols && p.kinds.join() === kinds.join()} onPress={() => (setKinds(p.kinds), setRows(p.rows), setCols(p.cols))} />
        ))}
      </ChipRow>
      <Card style={{ gap: space.md }}>
        <ChipRow title="統計什麼（可複選）">
          {KINDS.map((k) => (
            <Chip key={k.key} label={k.label} on={kinds.includes(k.key)} onPress={() => toggle(k.key)} />
          ))}
        </ChipRow>
        <ChipRow title="列（表格往下）">
          {DIMS.map((d) => (
            <Chip key={d.key} label={d.label} on={rows === d.key} onPress={() => (setRows(d.key), cols === d.key && setCols(null))} />
          ))}
        </ChipRow>
        <ChipRow title="欄（交叉統計，可不選）">
          <Chip label="不交叉" on={cols === null} onPress={() => setCols(null)} />
          {DIMS.filter((d) => d.key !== rows).map((d) => (
            <Chip key={d.key} label={d.label} on={cols === d.key} onPress={() => setCols(d.key)} />
          ))}
        </ChipRow>
        <ChipRow title="只看">
          {DEVICE.map(([k, l]) => (
            <Chip key={`d${k}`} label={l === "全部" ? "全部裝置" : l} on={device === k} onPress={() => setDevice(k)} />
          ))}
        </ChipRow>
        <View style={styles.wrap}>
          {OS.map(([k, l]) => (
            <Chip key={`o${k}`} label={l === "全部" ? "全部系統" : l} on={os === k} onPress={() => setOs(k)} />
          ))}
        </View>
        <View style={styles.wrap}>
          {SLOT.map(([k, l]) => (
            <Chip key={`s${k}`} label={l === "全部" ? "全部時段" : l} on={slot === k} onPress={() => setSlot(k)} />
          ))}
        </View>
        <ChipRow title="期間">
          {DAYS.map((n) => (
            <Chip key={n} label={`近 ${n} 天`} on={days === n} onPress={() => setDays(n)} />
          ))}
        </ChipRow>
      </Card>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">
            合計 {data.total.toLocaleString("en-US")}　<AppText variant="caption" tone="muted">{`（${data.since.slice(5).replace("-", "/")} 起）`}</AppText>
          </AppText>
          {data.rows.length === 0 ? (
            <AppText variant="callout" tone="muted">
              這個條件下還沒有資料。
            </AppText>
          ) : data.cols.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                <View style={styles.tr}>
                  <View style={styles.th0} />
                  {data.cols.map((l) => (
                    <AppText key={l} variant="caption" style={[styles.cell, { fontWeight: "800" }]} numberOfLines={2}>
                      {l}
                    </AppText>
                  ))}
                  <AppText variant="caption" style={[styles.cell, { fontWeight: "800" }]}>
                    合計
                  </AppText>
                </View>
                {data.rows.map((r) => (
                  <View key={r.label} style={styles.tr}>
                    <AppText variant="callout" numberOfLines={2} style={styles.th0}>
                      {r.label}
                    </AppText>
                    {r.cells.map((n, i) => (
                      <View key={i} style={[styles.cell, { backgroundColor: n ? `rgba(12,96,60,${0.08 + 0.5 * (n / max)})` : "transparent" }]}>
                        <AppText variant="callout" style={{ textAlign: "center", fontWeight: n ? "800" : "400", color: n ? c.text : c.textMuted }}>
                          {n}
                        </AppText>
                      </View>
                    ))}
                    <AppText variant="callout" style={[styles.cell, { fontWeight: "800", textAlign: "center" }]}>
                      {r.total}
                    </AppText>
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            data.rows.map((r) => (
              <View key={r.label} style={{ gap: 2 }}>
                <View style={styles.between}>
                  <AppText variant="callout" numberOfLines={2} style={{ flex: 1 }}>
                    {r.label}
                  </AppText>
                  <AppText variant="callout" style={{ fontWeight: "800" }}>
                    {r.total.toLocaleString("en-US")}　<AppText variant="caption" tone="muted">{Math.round((r.total / Math.max(1, data.total)) * 100)}%</AppText>
                  </AppText>
                </View>
                <View style={[styles.track, { backgroundColor: c.surfaceMuted }]}>
                  <View style={{ height: 10, borderRadius: 5, backgroundColor: c.accent, width: `${Math.max(2, (r.total / max) * 100)}%` }} />
                </View>
              </View>
            ))
          )}
          {data.truncated ? (
            <AppText variant="caption" tone="muted">
              只顯示前 40 列，請用上方條件縮小範圍。
            </AppText>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

/** 現成問題（業主 2026-11-22 選定「點問題看答案」）：每題＝一組固定查詢＋一句白話答案。 */
type Q = { icon: string; title: string; qs: string; view: "bars" | "table" | "trend"; answer: (d: Table) => string };
const pct = (n: number, total: number) => Math.round((n / Math.max(1, total)) * 100);
const top = (d: Table, what: string, noun = "最多") => {
  const r = [...d.rows].sort((a, b) => b.total - a.total)[0];
  return r && d.total ? `答：${r.label}${noun}，${what}佔 ${pct(r.total, d.total)}%（${r.total} 次）` : "還沒有資料（從 2026/11/22 開始累計）";
};
const CARDS = "kinds=card_course,card_series,card_center";
const QUESTIONS: Q[] = [
  { icon: "phone-portrait-outline", title: "大家用手機、電腦還是平板？", qs: "kinds=visit&rows=device&days=30", view: "bars", answer: (d) => top(d, "") },
  { icon: "logo-apple", title: "iPhone 和 Android 各幾成？", qs: "kinds=visit&rows=os&days=30", view: "bars", answer: (d) => top(d, "") },
  { icon: "time-outline", title: "一天中哪個時段最多人看？", qs: "kinds=visit&rows=slot&days=30", view: "bars", answer: (d) => top(d, "") },
  { icon: "logo-apple", title: "iPhone 用戶都在幾點看？", qs: "kinds=visit&rows=slot&os=ios&device=mobile&days=30", view: "bars", answer: (d) => top(d, "iPhone 用戶的") },
  { icon: "swap-horizontal-outline", title: "手機和電腦，看的時段有差別嗎？", qs: "kinds=visit&rows=device&cols=slot&days=30", view: "table", answer: (d) => "顏色越深＝越多人，直接比較每一列" },
  { icon: "flame-outline", title: "首頁哪種卡最多人點？", qs: `${CARDS}&rows=kind&days=30`, view: "bars", answer: (d) => top(d, "") },
  { icon: "trophy-outline", title: "首頁哪張卡最多人點？", qs: `${CARDS}&rows=item&days=30`, view: "bars", answer: (d) => (d.rows[0] && d.total ? `答：第一名是「${d.rows[0].label}」（${d.rows[0].total} 次）` : "還沒有資料（從 2026/11/22 開始累計）") },
  { icon: "tablet-portrait-outline", title: "平板最常點哪張系列卡？", qs: "kinds=card_series&rows=item&device=tablet&days=30", view: "bars", answer: (d) => (d.rows[0] && d.total ? `答：「${d.rows[0].label.replace(/^系列｜/, "")}」（${d.rows[0].total} 次）` : "平板還沒有資料") },
  {
    icon: "trending-up-outline",
    title: "這週比上週多還是少？",
    qs: "kinds=visit&rows=day&days=14",
    view: "trend",
    answer: (d) => {
      const [a, b] = weekSums(d);
      if (!a && !b) return "還沒有資料（從 2026/11/22 開始累計）";
      if (!b) return `這 7 天共 ${a} 次（上週還沒有資料可比）`;
      const diff = a - b;
      return `答：這 7 天 ${a} 次，上週 ${b} 次，${diff >= 0 ? "多" : "少"}了 ${Math.abs(diff)} 次（${diff >= 0 ? "+" : "-"}${pct(Math.abs(diff), b)}%）`;
    },
  },
];
/** 這 7 天與前 7 天的合計（日期標籤是「月/日」，以台灣今天為準）。 */
function weekSums(d: Table): [number, number] {
  const tw = new Date(Date.now() + 8 * 3600_000);
  const today = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate());
  let a = 0;
  let b = 0;
  for (const r of d.rows) {
    const [m, day] = r.label.split("/").map(Number);
    const ago = Math.round((today - Date.UTC(tw.getUTCFullYear(), (m ?? 1) - 1, day ?? 1)) / 86_400_000);
    if (ago >= 0 && ago < 7) a += r.total;
    else if (ago >= 7 && ago < 14) b += r.total;
  }
  return [a, b];
}

function Bars({ d }: { d: Table }) {
  const { c } = useTheme();
  const max = Math.max(1, ...d.rows.map((r) => r.total));
  return (
    <View style={{ gap: space.sm }}>
      {d.rows.slice(0, 10).map((r) => (
        <View key={r.label} style={{ gap: 2 }}>
          <View style={styles.between}>
            <AppText variant="callout" numberOfLines={2} style={{ flex: 1 }}>
              {r.label}
            </AppText>
            <AppText variant="callout" style={{ fontWeight: "800" }}>
              {r.total.toLocaleString("en-US")}　<AppText variant="caption" tone="muted">{pct(r.total, d.total)}%</AppText>
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: c.surfaceMuted }]}>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: c.accent, width: `${Math.max(2, (r.total / max) * 100)}%` }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Question({ q, open, onToggle }: { q: Q; open: boolean; onToggle: () => void }) {
  const { c } = useTheme();
  const { data, error, loading, reload } = useApi<Table>(open ? `/admin/usage?${q.qs}` : null);
  const max = Math.max(1, ...(data?.rows.flatMap((r) => r.cells) ?? [1]));
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={[styles.q, { backgroundColor: open ? c.accentSoft : c.surface, borderColor: open ? c.accent : c.border }]}>
        <View style={[styles.qIcon, { backgroundColor: open ? c.surface : c.accentSoft }]}>
          <Ionicons name={q.icon as never} size={20} color={c.accentText} />
        </View>
        <AppText variant="body" style={{ flex: 1, fontWeight: "800" }}>
          {q.title}
        </AppText>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={18} color={c.textMuted} />
      </Pressable>
      {open ? (
        <Card style={{ gap: space.sm, borderColor: c.accent }}>
          {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
          {loading && !data ? <LoadingView /> : null}
          {data ? (
            <>
              <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
                {q.answer(data)}
              </AppText>
              {data.rows.length && data.total ? (
                q.view === "table" ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                      <View style={styles.tr}>
                        <View style={styles.th0} />
                        {data.cols.map((l) => (
                          <AppText key={l} variant="caption" style={[styles.cell, { fontWeight: "800" }]} numberOfLines={2}>
                            {l}
                          </AppText>
                        ))}
                      </View>
                      {data.rows.map((r) => (
                        <View key={r.label} style={styles.tr}>
                          <AppText variant="callout" style={styles.th0}>
                            {r.label}
                          </AppText>
                          {r.cells.map((n, i) => (
                            <View key={i} style={[styles.cell, { borderRadius: 6, backgroundColor: n ? `rgba(12,96,60,${0.08 + 0.5 * (n / max)})` : "transparent" }]}>
                              <AppText variant="callout" style={{ textAlign: "center", fontWeight: n ? "800" : "400", color: n ? c.text : c.textMuted }}>
                                {n}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                ) : q.view === "trend" ? null : (
                  <Bars d={data} />
                )
              ) : null}
              <AppText variant="caption" tone="muted">
                近 30 天・{data.since.slice(5).replace("-", "/")} 起・匿名統計
              </AppText>
            </>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

/**
 * 管理員 > 使用統計（業主 2026-11-22）：點一個問題直接看答案（每題一組固定查詢，答案用一句白話）；
 * 最下面「自己組合（進階）」才是自選列、欄、篩選的交叉表。資料來自 App 匿名回報（`lib/usage.ts`），不含會員身分。
 */
export default function UsageScreen() {
  const { c } = useTheme();
  const [openQ, setOpenQ] = useState<string | null>(QUESTIONS[0]!.title);
  const [custom, setCustom] = useState(false);
  return (
    <Screen>
      <AppText variant="caption" tone="muted">
        點一個問題，直接看答案。資料從 2026/11/22 開始累計，時間是台灣時間。
      </AppText>
      {QUESTIONS.map((q) => (
        <Question key={q.title} q={q} open={openQ === q.title} onToggle={() => setOpenQ(openQ === q.title ? null : q.title)} />
      ))}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: custom }} onPress={() => setCustom((v) => !v)} style={[styles.q, { borderStyle: "dashed", borderColor: c.accent, backgroundColor: c.surface }]}>
        <View style={[styles.qIcon, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="create-outline" size={20} color={c.accentText} />
        </View>
        <AppText variant="body" style={{ flex: 1, fontWeight: "800", color: c.accentText }}>
          自己組合（進階）
        </AppText>
        <Ionicons name={custom ? "chevron-down" : "chevron-forward"} size={18} color={c.accentText} />
      </Pressable>
      {custom ? <Custom /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  q: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1 },
  qIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: minTouch - 4, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  between: { flexDirection: "row", alignItems: "center", gap: space.sm },
  track: { height: 10, borderRadius: 5, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 4 },
  th0: { width: 112 },
  cell: { width: 68, minHeight: 36, textAlign: "center", justifyContent: "center" },
});
