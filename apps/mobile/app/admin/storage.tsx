import { StyleSheet, View } from "react-native";
import { centerTitle } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Card, EmptyState, ErrorView, LoadingView, Screen, Section } from "@/ui";

type Kind = "image" | "doc" | "audio" | "other";
type Storage = { totalBytes: number; objectCount: number; byType: Record<Kind, number>; byCenter: ({ center: string; total: number } & Record<Kind, number>)[] };
const KINDS: { key: Kind; label: string; color: string }[] = [
  { key: "image", label: "圖片（封面、EDM、照片）", color: "#2E7D5B" },
  { key: "doc", label: "文件檔案（PDF、簡報…）", color: "#E0A91A" },
  { key: "audio", label: "音檔", color: "#3B6FB6" },
  { key: "other", label: "其他／沒有歸屬", color: "#9A9A9A" },
];

export const sizeText = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const pct = (n: number, t: number) => (t ? `${Math.round((n / t) * 1000) / 10}%` : "0%");

/** 一條分段長條：每段依佔比著色。 */
function StackBar({ parts, total }: { parts: { color: string; value: number }[]; total: number }) {
  const { c } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: c.surfaceMuted }]} accessibilityRole="image">
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <View key={i} style={{ flex: p.value / (total || 1), backgroundColor: p.color }} />
      ))}
    </View>
  );
}

/**
 * 設定 > 儲存空間管理（超級管理員，業主 2026-11-18）：整個網站雲端儲存已使用的容量、
 * 各類型檔案的佔比，以及各中心（含寰宇總部）各自佔用多少、裡面各類型各多少。大小是雲端的實際大小。
 */
export default function StorageScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<Storage>(isSuper ? "/admin/storage" : null);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以查看" /></Screen>;
  return (
    <Screen header={false}>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data ? (
        <>
          <Card>
            <AppText variant="caption" tone="muted">
              已使用的儲存空間
            </AppText>
            <AppText variant="title" style={{ fontWeight: "900" }}>
              {sizeText(data.totalBytes)}
            </AppText>
            <AppText variant="caption" tone="muted">
              共 {data.objectCount} 個檔案
            </AppText>
            <StackBar total={data.totalBytes} parts={KINDS.map((k) => ({ color: k.color, value: data.byType[k.key] }))} />
            {KINDS.map((k) => (
              <View key={k.key} style={styles.legend}>
                <View style={[styles.dot, { backgroundColor: k.color }]} />
                <AppText variant="callout" style={{ flex: 1 }}>
                  {k.label}
                </AppText>
                <AppText variant="callout" style={{ fontWeight: "700" }}>
                  {sizeText(data.byType[k.key])}・{pct(data.byType[k.key], data.totalBytes)}
                </AppText>
              </View>
            ))}
          </Card>
          <Section title="各中心使用量">
            {data.byCenter.length ? (
              data.byCenter.map((r) => (
                <Card key={r.center}>
                  <View style={styles.legend}>
                    <AppText variant="headline" style={{ flex: 1 }}>
                      {r.center.startsWith("（") || r.center === "寰宇總部" ? r.center : centerTitle(r.center)}
                    </AppText>
                    <AppText variant="headline" style={{ fontWeight: "900" }}>
                      {sizeText(r.total)}
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="muted">
                    佔全部 {pct(r.total, data.totalBytes)}
                  </AppText>
                  <StackBar total={r.total} parts={KINDS.map((k) => ({ color: k.color, value: r[k.key] }))} />
                  <View style={styles.chips}>
                    {KINDS.filter((k) => r[k.key] > 0).map((k) => (
                      <View key={k.key} style={[styles.chip, { borderColor: c.border }]}>
                        <View style={[styles.dot, { backgroundColor: k.color }]} />
                        <AppText variant="caption">
                          {k.label.split("（")[0]} {sizeText(r[k.key])}（{pct(r[k.key], r.total)}）
                        </AppText>
                      </View>
                    ))}
                  </View>
                </Card>
              ))
            ) : (
              <EmptyState icon="cloud-outline" title="還沒有任何檔案" />
            )}
          </Section>
          <AppText variant="caption" tone="muted">
            歸屬依檔案所屬的課程主辦中心計算；系列、品牌 logo 算在寰宇總部；沒有被任何資料使用的檔案列在「沒有歸屬」。
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 14, borderRadius: radius.pill, overflow: "hidden", marginVertical: space.xs },
  legend: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
