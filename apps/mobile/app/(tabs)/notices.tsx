import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { api, type Notice } from "@/api/client";
import { dateTime, noticeTarget } from "@/features/format";
import { NoticeSheet } from "@/features/notices/notice-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { GuestGate, Button, Card, EmptyState, ErrorView, ListRow, LoadingView, Screen } from "@/ui";

export default function NoticesScreen() {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const { data, error, loading, reload } = useApi<Notice[]>(member ? "/notifications" : null);
  const unread = (data ?? []).filter((n) => !n.read).length;
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
      {data && !data.length ? <EmptyState icon="notifications-outline" title="目前沒有通知" body="報名課程或報名有進度時，會在這裡通知你。" /> : null}
      {data?.length ? (
        <Card style={{ paddingVertical: 0 }}>
          {data.map((n) => (
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
