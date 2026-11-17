import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { View } from "react-native";
import { api } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, ErrorView, ListRow, LoadingView, Screen, Section } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Row = { sub: string; number: string; title: string; owner: string; views: number; books: number };

/** 圖書館管理（超級管理員，業主 2026-11-17）：產生「我的圖書館」邀請網址（24 小時、一次有效）、查看與移除圖書館。 */
export default function AdminLibraries() {
  const { data, error, loading, reload } = useApi<Row[]>("/admin/libraries");
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api<{ code: string }>("POST", "/admin/library-invites");
      const link = `https://learn.hglobal1985.com/library-invite/${r.code}`;
      setInvite(link);
      await Clipboard.setStringAsync(link).catch(() => undefined);
      flashText("邀請網址已複製");
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={false}>
      <Card>
        <AppText variant="headline">指定圖書館擁有者</AppText>
        <AppText variant="callout" tone="muted">
          產生一個 24 小時有效、只能一個人使用的邀請網址，傳給要擁有「我的圖書館」的會員；對方登入後按「接受」，圖書館網址就是他在會員中心的會員編號。
        </AppText>
        <Button label="產生邀請網址" icon="link-outline" onPress={make} disabled={busy} fullWidth />
        {invite ? (
          <AppText variant="callout" selectable style={{ fontWeight: "700" }}>
            {invite}
          </AppText>
        ) : null}
      </Card>
      <Section title="已建立的圖書館">
        {loading && !data ? <LoadingView /> : null}
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {data && !data.length ? <AppText variant="callout" tone="muted">還沒有人。</AppText> : null}
        {data?.length ? (
          <Card style={{ paddingVertical: 0 }}>
            {data.map((r) => (
              <ListRow key={r.sub} icon="library-outline" title={`${r.owner}｜/${r.number}`} subtitle={`${r.title}　${r.books} 本書　${r.views} 次翻閱`} onPress={async () => { if (await confirmAsk("移除圖書館", `確定移除 ${r.owner} 的圖書館？裡面所有書架與書都會刪除，無法復原。`, "移除")) { await api("DELETE", `/admin/libraries/${r.sub}`).catch((e) => flashText((e as Error).message)); reload(); } }} />
            ))}
          </Card>
        ) : null}
        <View style={{ height: space.md }} />
        <AppText variant="caption" tone="muted">
          點一列可以移除該圖書館。
        </AppText>
      </Section>
    </Screen>
  );
}
