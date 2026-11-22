import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Card, ErrorView, LoadingView, Screen } from "@/ui";

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

export default function UsageScreen() {
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
    <Screen>
      <AppText variant="caption" tone="muted">
        資料從 2026/11/22 開始累計，匿名統計、不含會員身分。時間是台灣時間。
      </AppText>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: minTouch - 4, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  between: { flexDirection: "row", alignItems: "center", gap: space.sm },
  track: { height: 10, borderRadius: 5, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 4 },
  th0: { width: 112 },
  cell: { width: 68, minHeight: 36, textAlign: "center", justifyContent: "center" },
});
