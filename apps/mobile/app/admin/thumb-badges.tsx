import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ThumbBadgeKind, ThumbBadgeRow } from "@/api/client";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { ThumbBadgeEditor } from "@/features/admin/thumb-badge-editor";
import { centerTitle } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, CardThumb, EmptyState, ErrorView, LoadingView, Screen, SegmentTabs, ThumbBadgeView, ThumbFallback } from "@/ui";

const TABS: { key: ThumbBadgeKind; label: string }[] = [
  { key: "center", label: "中心卡" },
  { key: "series", label: "系列卡" },
  { key: "course", label: "課程卡" },
];

/**
 * 設定 › 縮圖符號（超級管理員，杜杜龍 2026-11-23）：所有中心卡、系列卡、課程卡的小縮圖符號總覽。
 * 每列左邊就是目前的縮圖（沒指定＝預設圖示），點一列開編輯面板（即時預覽、符號、文字色、底色）。同一個編輯元件也放在各卡的編輯封面處。
 */
export default function ThumbBadgesScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<ThumbBadgeRow[]>(isSuper ? "/admin/thumb-badges" : null);
  const [tab, setTab] = useState<ThumbBadgeKind>("center");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ThumbBadgeRow | null>(null);
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (data ?? []).filter((r) => r.kind === tab && (!k || `${r.label} ${r.sub}`.toLowerCase().includes(k)));
  }, [data, tab, q]);
  const count = (kind: ThumbBadgeKind) => (data ?? []).filter((r) => r.kind === kind).length;
  const set = (kind: ThumbBadgeKind) => (data ?? []).filter((r) => r.kind === kind && r.badge).length;
  if (!isSuper)
    return (
      <Screen header={false}>
        <EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定縮圖符號" />
      </Screen>
    );
  return (
    <Screen>
      <AppText variant="caption" tone="muted">
        清單列與選單裡的小縮圖。點一列可以輸入 emoji 或短文字、選文字色與底色，並即時預覽；沒指定的顯示預設圖示。
      </AppText>
      <SegmentTabs options={TABS.map((t) => ({ key: t.key, label: `${t.label} ${set(t.key)}/${count(t.key)}` }))} value={tab} onChange={(k) => setTab(k as ThumbBadgeKind)} />
      <TextInput value={q} onChangeText={setQ} placeholder="搜尋名稱" placeholderTextColor={c.textMuted} accessibilityLabel="搜尋名稱" style={[styles.search, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data && !rows.length ? <EmptyState icon="search-outline" title="沒有符合的項目" /> : null}
      <View style={[styles.list, { borderColor: c.border, backgroundColor: c.surface }]}>
        {rows.map((r, i) => (
          <Pressable key={`${r.kind}:${r.key}`} accessibilityRole="button" accessibilityLabel={`編輯「${r.label}」的縮圖符號`} onPress={() => setEditing(r)} style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }, pressed && { opacity: 0.7 }]}>
            <View style={[styles.thumb, { borderColor: c.border }]}>{r.badge ? <ThumbBadgeView symbol={r.badge.symbol} fg={r.badge.fg} bg={r.badge.bg} /> : <ThumbFallback />}</View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={2}>
                {r.kind === "center" ? centerTitle(r.label) : r.label}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {r.sub}
                {r.badge ? "" : "・預設"}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
          </Pressable>
        ))}
      </View>
      {editing ? (
        <EditSheet title="縮圖符號" onClose={() => setEditing(null)} hideSave>
          <ThumbBadgeEditor kind={editing.kind} id={editing.key} label={editing.kind === "center" ? centerTitle(editing.label) : editing.label} bare onChanged={reload} />
        </EditSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  list: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: minTouch + 20, paddingVertical: space.sm, paddingHorizontal: space.md },
  thumb: { width: 96, height: 54, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1 },
});
