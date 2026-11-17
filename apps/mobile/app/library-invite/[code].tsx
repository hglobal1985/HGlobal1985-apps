import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { AppText, Button, Card, EmptyState, LoadingView, NoticeBox, Screen } from "@/ui";

/** 「我的書櫃」邀請（業主 2026-11-17）：超級管理員產生的 24 小時一次性網址；登入後按「接受」就有自己的書櫃（網址＝會員編號）。 */
export default function LibraryInvite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { member, ready, invalidate } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <Screen header={false}><LoadingView /></Screen>;
  if (!member)
    return (
      <Screen header={false}>
        <EmptyState icon="library-outline" title="我的書櫃邀請" body="請先登入，登入後會回到這一頁。" />
        <Button label="前往登入" onPress={() => router.push({ pathname: "/me", params: { next: `/library-invite/${code}` } })} fullWidth />
      </Screen>
    );
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/library-invites/${code}/accept`);
      invalidate();
      router.replace("/library");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={false}>
      <Card>
        <AppText variant="title">我的書櫃</AppText>
        <AppText variant="callout" tone="muted">
          接受後你會有一座個人專屬的書櫃，網址是 learn.hglobal1985.com/你的會員編號。不會出現在行動大學的任何清單，只有拿到網址的人才能進去；你可以設定密碼。
        </AppText>
      </Card>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      <Button label={busy ? "建立中…" : "接受邀請"} icon="checkmark" onPress={accept} disabled={busy} fullWidth />
    </Screen>
  );
}
