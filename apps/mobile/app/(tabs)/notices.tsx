import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api, type Notice, type NoticeCategory } from "@/api/client";
import { dateTime, noticeTarget } from "@/features/format";
import { CentralReviewList, useCentralReviews } from "@/features/notices/central-reviews";
import { NoticeSheet } from "@/features/notices/notice-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { AppText, GuestGate, Button, Card, EmptyState, ErrorView, ListRow, LoadingView, Screen } from "@/ui";
import { radius, space } from "@/theme/tokens";

export default function NoticesScreen() {
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
  if (!member)
    return (
      <Screen>
        <GuestGate icon="notifications-outline" body="登入後可在這裡收到開課、報名審核等通知。" />
      </Screen>
    );
  return (
    <Screen
      subtitle={data ? (unread ? `${unread} 則未讀` : "全部已讀") : undefined}
      right={
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {unread ? <Button variant="ghost" label="全部標為已讀" onPress={markAll} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="通知設定" onPress={() => router.push("/settings/notifications")} hitSlop={8} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="settings-outline" size={26} color={c.text} />
          </Pressable>
        </View>
      }
    >
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: space.sm }} accessibilityRole="radiogroup">
        {MODES.map((m) => {
          const on = mode === m.key;
          const n = m.key === "all" ? unread : count(m.key);
          return (
            <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${m.label}${n ? `，${n} 則未處理` : ""}`} onPress={() => (trackFeature("notices_filter"), setMode(m.key))} style={{ flex: 1, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }}>
              <AppText variant="callout" style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
                {m.label}
              </AppText>
              {n ? (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: on ? c.textOnAccent : c.danger, alignItems: "center", justifyContent: "center" }}>
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
      {list.length ? (
        <Card style={{ paddingVertical: 0 }}>
          {list.map((n) => (
            <ListRow
              key={n.id}
              icon={n.read ? "mail-open-outline" : "mail-unread-outline"}
              title={n.title}
              subtitle={`${n.body}${n.body ? "\n" : ""}${dateTime(n.createdAt)}`}
              unread={!n.read}
              onPress={() => open(n)}
            />
          ))}
        </Card>
      ) : null}
      {preview ? (
        <NoticeSheet notice={preview} onClose={() => setPreview(null)} onOpen={preview.link ? () => router.push(noticeTarget(preview.link) as Href) : undefined} />
      ) : null}
    </Screen>
  );
}
