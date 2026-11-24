import { useElderOn } from "@/lib/elder-mode";
import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api, type Notice, type NoticeCategory } from "@/api/client";
import { noticeTarget } from "@/features/format";
import { CentralReviewList, groupByDay, hhmm, useCentralReviews } from "@/features/notices/central-reviews";
import { NoticeSheet } from "@/features/notices/notice-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { AppText, GuestGate, Button, Card, EmptyState, ErrorView, LoadingView, Screen } from "@/ui";
import { radius, space } from "@/theme/tokens";

export default function NoticesScreen() {
  const elder = useElderOn();
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const { data, error, loading, reload } = useApi<Notice[]>(member ? "/notifications" : null);
  const unread = (data ?? []).filter((n) => !n.read).length;
  // 檢視模式（業主 2026-11-17）：全部、審核、訂閱、留言。審核裡另外會顯示中央的獎銜、中心新申請（沒有權限就不顯示）。
  const [mode, setMode] = useState<"all" | NoticeCategory>("all");
  const central = useCentralReviews();
  const centralCount = central.data?.available ? central.data.reviews.length : 0;
  const count = (cat: NoticeCategory) => (data ?? []).filter((n) => n.category === cat && !n.read).length + (cat === "review" ? centralCount : 0);
  const list = (data ?? []).filter((n) => mode === "all" || n.category === mode);
  // 審核相關而且還沒處理的置頂（伺服器標 pending）；訂閱、留言分頁不需要。
  const pinned = mode === "all" || mode === "review" ? list.filter((n) => n.pending) : [];
  const rest = pinned.length ? list.filter((n) => !n.pending) : list;
  const MODES: { key: "all" | NoticeCategory; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "review", label: "審核" },
    { key: "subscribe", label: "訂閱" },
    { key: "comment", label: "留言" },
  ];
  // 點一則通知：先標為已讀並彈出摘要（完整內容），再由摘要的「前往查看」（或往上拉到最高處）進入對應頁面。
  const [preview, setPreview] = useState<Notice | null>(null);
  const open = async (n: Notice) => {
    setPreview(n);
    if (!n.read) await api("POST", `/notifications/${n.id}/read`).catch(() => undefined);
    invalidate();
  };
  const markAll = async () => {
    await api("POST", "/notifications/read-all").catch(() => undefined);
    invalidate();
  };
  const renderRow = (n: Notice, i: number) => (
      <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.title}${n.read ? "" : "，未讀"}`} onPress={() => open(n)} style={({ pressed }) => [{ flexDirection: elder ? "column" : "row", alignItems: elder ? "stretch" : "center", gap: elder ? 8 : 10, paddingVertical: 12, minHeight: 64 }, i > 0 && { borderTopWidth: 1, borderColor: c.border }, pressed && { opacity: 0.7 }]}>
        <View style={elder ? { flexDirection: "row", alignItems: "center", gap: 10 } : { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: n.read ? c.surfaceMuted : c.accentSoft }}>
          <Ionicons name={n.category === "review" ? "ribbon-outline" : n.category === "comment" ? "chatbubble-outline" : "notifications-outline"} size={20} color={n.read ? c.textMuted : c.accentText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="body" numberOfLines={elder ? undefined : 2} style={{ fontWeight: n.read ? "600" : "800" }}>
            {n.title}
          </AppText>
          {n.body && !elder ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {n.body}
            </AppText>
          ) : null}
        </View>
        </View>
        {n.body && elder ? (
          <AppText variant="caption" tone="muted">
            {n.body}
          </AppText>
        ) : null}
        <View style={elder ? { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } : { alignItems: "flex-end", gap: 4 }}>
          <AppText variant="caption" tone="muted">
            {hhmm(n.createdAt)}
          </AppText>
          {!n.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} /> : <View style={{ width: 10, height: 10 }} />}
        </View>
      </Pressable>
  );
  if (!member)
    return (
      <Screen>
        <GuestGate icon="notifications-outline" body="登入後可在這裡收到開課、報名審核等通知。" />
      </Screen>
    );
  return (
    <Screen
      title="通知"
      subtitle={data ? (unread ? `${unread} 則未讀` : "全部已讀") : undefined}
      right={elder ? undefined : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {unread ? <Button variant="ghost" label="全部標為已讀" onPress={markAll} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="通知設定" onPress={() => router.push("/settings/notifications")} hitSlop={8} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="settings-outline" size={26} color={c.text} />
          </Pressable>
        </View>
      )}
    >
      {elder ? (
        // 至尊模式：標題下面一欄排「全部標為已讀」「通知設定」，不擠在標題右邊（業主 2026-11-24）。
        <View style={{ gap: space.sm }}>
          {unread ? <Button variant="secondary" label="全部標為已讀" onPress={markAll} fullWidth /> : null}
          <Button variant="secondary" icon="settings-outline" label="通知設定" onPress={() => router.push("/settings/notifications")} fullWidth />
        </View>
      ) : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      <View style={{ flexDirection: "row", gap: elder ? 6 : 8, marginBottom: space.sm }} accessibilityRole="radiogroup">
        {MODES.map((m) => {
          const on = mode === m.key;
          const n = m.key === "all" ? unread : count(m.key);
          return (
            <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${m.label}${n ? `，${n} 則未處理` : ""}`} onPress={() => (trackFeature("notices_filter"), setMode(m.key))} style={{ flex: 1, minWidth: 0, minHeight: elder ? 56 : 44, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }}>
              <AppText variant="callout" numberOfLines={1} style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
                {m.label}
              </AppText>
              {n ? (
                <View style={[{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: on ? c.textOnAccent : c.danger, alignItems: "center", justifyContent: "center" }, elder && { position: "absolute", top: -6, right: -2 }]}>
                  <AppText variant="caption" style={{ color: on ? c.accent : "#fff", fontWeight: "800", fontSize: 11, lineHeight: 14 }}>
                    {n > 99 ? "99+" : n}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {mode === "review" && central.data?.available ? <CentralReviewList data={central.data} onChanged={central.reload} /> : null}
      {data && !list.length && !(mode === "review" && centralCount) ? <EmptyState icon="notifications-outline" title={mode === "all" ? "目前沒有通知" : "這個分類目前沒有通知"} body={mode === "all" ? "報名課程或報名有進度時，會在這裡通知你。" : undefined} /> : null}
      {/* 審核相關而且還沒處理的一律置頂（業主 2026-11-23）：在「全部」與「審核」都放在最上面，處理完（或已讀）才回到下面依日期排列。 */}
      {mode === "all" && centralCount ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`有 ${centralCount} 筆獎銜或中心申請等待你審核`} onPress={() => setMode("review")} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: c.accent, backgroundColor: c.accentSoft, marginTop: space.xs }, pressed && { opacity: 0.7 }]}>
          <Ionicons name="pin" size={20} color={c.accentText} />
          <AppText variant="body" style={{ flex: 1, fontWeight: "800", color: c.accentText }}>{`有 ${centralCount} 筆獎銜／中心申請等待你審核`}</AppText>
          <Ionicons name="chevron-forward" size={20} color={c.accentText} />
        </Pressable>
      ) : null}
      {pinned.length ? (
        <View style={{ gap: 6, marginTop: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="pin" size={14} color={c.accentText} />
            <AppText variant="caption" style={{ fontWeight: "800", color: c.accentText }}>{`等待處理的審核（${pinned.length}）`}</AppText>
          </View>
          <Card style={{ paddingVertical: 4, borderWidth: 2, borderColor: c.accent }}>{pinned.map((n, i) => renderRow(n, i))}</Card>
        </View>
      ) : null}
      {groupByDay(rest, (n) => n.createdAt).map((g) => (
        <View key={g.day} style={{ gap: 6, marginTop: space.xs }}>
          <AppText variant="caption" tone="muted" style={{ fontWeight: "800" }}>
            {g.day}
          </AppText>
          <Card style={{ paddingVertical: 4 }}>{g.rows.map((n, i) => renderRow(n, i))}</Card>
        </View>
      ))}
      {preview ? (
        <NoticeSheet notice={preview} onClose={() => setPreview(null)} onOpen={preview.link ? () => router.push(noticeTarget(preview.link) as Href) : undefined} />
      ) : null}
    </Screen>
  );
}
