import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api } from "@/api/client";
import { dateTime } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, LoadingView, NoticeBox, Screen } from "@/ui";

type Invite = { courseId: string; courseTitle: string; expiresAt: string; state: "open" | "mine" | "used" | "expired" };

/**
 * 審核人員邀請（業主 2026-11-16）：課程「費用與審核 > 審核窗口」產生的 24 小時一次性網址。
 * 對方登入後打開，按「接受」就成為這門課的報名審核人員（之後在「設定 > 報名審核」處理報名）。
 */
export default function ReviewInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { member, ready, invalidate } = useSession();
  const inv = useApi<Invite>(member ? `/review-invites/${token}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/review-invites/${token}/accept`);
      setDone(true);
      invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!ready) return <Screen header={false}><LoadingView /></Screen>;
  if (!member)
    return (
      <Screen header={false}>
        <EmptyState icon="person-add-outline" title="審核人員邀請" body="請先登入寰宇行動大學，登入後會回到這一頁。" />
        <Button label="登入" icon="log-in-outline" onPress={() => router.push({ pathname: "/me", params: { next: `/review-invite/${token}` } })} fullWidth />
      </Screen>
    );
  if (inv.error && !inv.data) return <Screen header={false}><ErrorView message={inv.error} onRetry={inv.reload} /></Screen>;
  if (!inv.data) return <Screen header={false}><LoadingView /></Screen>;
  const d = inv.data;
  const joined = done || d.state === "mine";
  return (
    <Screen header={false}>
      <Card>
        <AppText variant="caption" tone="muted">
          報名審核人員邀請
        </AppText>
        <AppText variant="title">{d.courseTitle}</AppText>
        <AppText variant="callout" tone="muted">
          接受後，你可以審核這門課的付費報名（核對繳費、開通或退回）。
        </AppText>
      </Card>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      {joined ? (
        <View style={{ gap: space.sm }}>
          <NoticeBox tone="success" text="你已經是這門課的審核人員了。" />
          <Button label="前往報名審核" icon="checkmark-done-outline" onPress={() => router.replace("/admin/orders")} fullWidth />
          <Button variant="secondary" label="查看課程" onPress={() => router.replace(`/course/${d.courseId}`)} fullWidth />
        </View>
      ) : d.state === "open" ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="caption" tone="muted">
            這個邀請在 {dateTime(d.expiresAt)} 前有效，只能一個人使用。
          </AppText>
          <Button label="接受，成為審核人員" icon="checkmark-circle-outline" loading={busy} disabled={busy} onPress={accept} fullWidth />
        </View>
      ) : (
        <NoticeBox tone="warning" text={d.state === "expired" ? "這個邀請已超過 24 小時，請邀請你的人重新產生網址。" : "這個邀請已經被別人使用過了，請邀請你的人重新產生網址。"} />
      )}
    </Screen>
  );
}
