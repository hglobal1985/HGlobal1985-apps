import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { download, type RegistrationReport, type ReportBy } from "@/api/client";
import { ntd } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, DateSelect, EmptyState, ErrorView, LoadingView, NoticeBox, Screen, Section } from "@/ui";

const tw = (d: Date) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const monthEnd = (y: number, m: number) => tw(new Date(Date.UTC(y, m, 0, 0)));

/**
 * 設定 > 報名與營收報表（杜杜龍 2026-11-17）：選期間（台灣日期）與統計方式（中心／課程／月份），看報名數、開通、待審核、免費報名與繳費金額，可匯出 Excel（CSV）。
 * 看得到的範圍與「報名審核」相同：總部全部、會長自己中心學員、審核群組與課程指定的審核人員各自的範圍。
 */
export default function ReportScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const today = tw(new Date());
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [by, setBy] = useState<ReportBy>("center");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const allowed = !!member?.reviewer;
  const qs = `from=${from}&to=${to}&by=${by}`;
  const r = useApi<RegistrationReport>(allowed && from && to ? `/admin/reports/registrations?${qs}` : null);
  if (!allowed) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="需要審核權限" /></Screen>;

  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const presets: { key: string; label: string; range: [string, string] }[] = [
    { key: "this", label: "本月", range: [monthStart(today), today] },
    { key: "last", label: "上個月", range: [`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`, monthEnd(y, m - 1)] },
    { key: "year", label: "今年", range: [`${y}-01-01`, today] },
  ];
  const preset = presets.find((p) => p.range[0] === from && p.range[1] === to)?.key ?? "";
  const exportCsv = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await download(`/admin/reports/registrations.csv?${qs}`, `報名與營收報表-${from}至${to}.csv`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const t = r.data?.total;
  const tile = (label: string, value: string, tone?: "accent" | "warning") => (
    <View style={[styles.tile, { backgroundColor: tone === "accent" ? c.accentSoft : tone === "warning" ? c.warningSoft : c.surface, borderColor: c.border }]}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="title" style={{ color: tone === "accent" ? c.accentText : tone === "warning" ? c.warning : c.text, fontVariant: ["tabular-nums"] }}>
        {value}
      </AppText>
    </View>
  );
  return (
    <Screen header={false}>
      <Section fold title="期間">
        <Chips label="快速選擇" options={presets.map((p) => ({ key: p.key, label: p.label }))} value={preset} onChange={(k) => { const p = presets.find((x) => x.key === k)!; setFrom(p.range[0]); setTo(p.range[1]); }} />
        <DateSelect label="開始日期" value={from} clearable={false} onChange={setFrom} />
        <DateSelect label="結束日期" value={to} clearable={false} onChange={setTo} />
      </Section>
      <Chips label="統計方式" options={[{ key: "center", label: "依中心" }, { key: "course", label: "依課程" }, { key: "month", label: "依月份" }]} value={by} onChange={setBy} />
      {r.error && !r.data ? <ErrorView message={r.error} onRetry={r.reload} /> : null}
      {r.loading && !r.data ? <LoadingView /> : null}
      {t ? (
        <>
          <View style={styles.tiles}>
            {tile("報名數", String(t.registrations))}
            {tile("已開通", String(t.opened), "accent")}
            {tile("待審核", String(t.pending), t.pending ? "warning" : undefined)}
            {tile("繳費金額", ntd(t.amountTwd), "accent")}
          </View>
          <AppText variant="caption" tone="muted">
            免費報名 {t.free} 筆・已退回／撤銷 {t.rejected} 筆。繳費金額只算「已開通」的付費報名（有實收金額用實收）。
          </AppText>
          {r.data!.rows.length ? (
            <Card style={{ paddingVertical: 0 }}>
              {r.data!.rows.map((x, i) => (
                <View key={x.key} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="headline" numberOfLines={2}>
                      {x.label}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      報名 {x.registrations}・開通 {x.opened}・待審核 {x.pending}{x.free ? `・免費 ${x.free}` : ""}
                    </AppText>
                  </View>
                  <AppText variant="headline" style={{ fontVariant: ["tabular-nums"], color: x.amountTwd ? c.text : c.textMuted }}>
                    {ntd(x.amountTwd)}
                  </AppText>
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState icon="document-text-outline" title="這段期間沒有報名" />
          )}
        </>
      ) : null}
      {Platform.OS === "web" ? (
        <Button variant="secondary" icon="download-outline" label="匯出 Excel（CSV）" loading={busy} disabled={!r.data} onPress={exportCsv} fullWidth />
      ) : (
        <NoticeBox text="匯出 Excel 請在網頁版操作。" />
      )}
      {msg ? <NoticeBox tone="danger" text={msg} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
});
