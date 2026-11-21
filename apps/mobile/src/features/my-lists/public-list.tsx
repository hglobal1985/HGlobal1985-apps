import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { api, type Member } from "@/api/client";
import { MemberHeader } from "@/features/member-header";
import { PageHeader } from "@/features/page-header";
import { trackFeature } from "@/lib/feature-track";
import { useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { LoginPrompt } from "@/ui/login-prompt";
import { ListItemRow, type ListItem } from "./item-row";
import { clickSource, visitorId } from "./links";

type Pub = { title: string; ownerSub: string; ownerName: string; ownerAvatar: string | null; number: string; slug: string; count: number; clicks: number; items: ListItem[] };

/**
 * 別人分享的清單（/會員編號/網址名稱，所有清單都公開，訪客也能看；業主 2026-11-21）。
 * 最上面是分享者名片：用首頁同一個 MemberHeader 元件（頭像、姓名；獎銜與徽章等 Amway 資料不保存，需要中央支援才能顯示，見 docs/central-request-list-sharer.md）。
 * 每次進入點擊 +1（自己看不算）；登入的人可以「複製到我的清單」。
 */
export function PublicListScreen({ number, slug }: { number: string; slug: string }) {
  const { member, ready } = useSession();
  const path = usePathname();
  const [data, setData] = useState<Pub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    api<Pub>("POST", `/my-lists/view/${number}/${slug}`, { vid: visitorId(), ...clickSource() })
      .then((r) => alive && setData(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [number, slug, ready]);
  if (error && !data) return <Screen header={false}>{/找不到|not_found|404/.test(error) ? <EmptyState icon="list-outline" title="找不到這份清單" /> : <ErrorView message={error} onRetry={() => setError(null)} />}</Screen>;
  if (!data) return <Screen header={false}><LoadingView /></Screen>;
  const mine = member?.sub === data.ownerSub;
  const copy = async () => {
    if (!member) {
      router.push({ pathname: "/me", params: { next: Platform.OS === "web" && typeof window !== "undefined" ? window.location.pathname : path } });
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/my-lists/view/${number}/${slug}/copy`);
      trackFeature("list_copy");
      flashText("已複製到我的清單");
      router.push("/my-lists");
    } catch (e) {
      flashText(e instanceof Error ? e.message : "複製失敗");
    } finally {
      setBusy(false);
    }
  };
  const sharer = { sub: data.ownerSub, name: data.ownerName || "會員", role: "student", demo: false, rank: null, avatarUrl: data.ownerAvatar } as unknown as Member;
  return (
    <>
      <PageHeader title={data.title} path={`/${data.number}/${data.slug}`} backTo="/courses" />
      <Screen header={false}>
        <LoginPrompt />
        <MemberHeader member={sharer} />
        <View style={{ alignItems: "center", gap: 2 }}>
          <AppText variant="title" style={{ textAlign: "center" }}>
            {data.title}
          </AppText>
          <AppText variant="callout" tone="muted">
            {data.count} 個內容・{data.clicks} 次點閱
          </AppText>
        </View>
        {data.items.length === 0 ? <EmptyState icon="list-outline" title="這份清單還沒有內容" /> : <Card style={{ paddingVertical: 0 }}>{data.items.map((it) => <ListItemRow key={it.id} item={{ ...it, note: it.note }} />)}</Card>}
        {!mine ? <Button label="複製到我的清單" icon="copy-outline" onPress={() => void copy()} loading={busy} fullWidth /> : null}
        <View style={{ height: space.lg }} />
      </Screen>
    </>
  );
}
