import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { api, type Member } from "@/api/client";
import { MemberHeader } from "@/features/member-header";
import { PageHeader } from "@/features/page-header";
import { trackFeature } from "@/lib/feature-track";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, EmptyState, ErrorView, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { ListItemRow, type ListItem } from "./item-row";
import { clickSource, visitorId } from "./links";

type Pub = { sharer: { rankLabel: string; rankBadge: string | null; rankBadgeArt: { width: number; height: number; top: number; bottom: number } | null } | null; sharerError?: string; title: string; ownerSub: string; ownerName: string; ownerAvatar: string | null; number: string; slug: string; count: number; clicks: number; items: ListItem[] };

/**
 * 別人分享的清單（/會員編號/網址名稱，所有清單都公開，訪客也能看；業主 2026-11-21）。
 * 最上面是分享者名片：用首頁同一個 MemberHeader 元件（頭像、姓名；獎銜與徽章等 Amway 資料不保存，需要中央支援才能顯示，見 docs/central-request-list-sharer.md）。
 * 每次進入點擊 +1（自己看不算）；登入的人可以「複製到我的清單」（低調的小文字鈕）。清單名稱只放在上方工具列，頁面裡不重複；不放「尚未登入」提示鈕（業主 2026-11-21）。
 */
export function PublicListScreen({ number, slug }: { number: string; slug: string }) {
  const { c } = useTheme();
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
  const sharer = { sub: data.ownerSub, name: data.ownerName || "會員", role: "student", demo: false, rank: null, avatarUrl: data.ownerAvatar, rankLabel: data.sharer?.rankLabel ?? null, rankBadge: data.sharer?.rankBadge ?? null, rankBadgeArt: data.sharer?.rankBadgeArt ?? null } as unknown as Member;
  return (
    <>
      <PageHeader title={data.title} path={`/${data.number}/${data.slug}`} backTo="/courses" />
      <Screen header={false}>
        <MemberHeader member={sharer} />
        {data.sharerError ? (
          <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
            （只有你看得到）獎銜查不到：{data.sharerError}
          </AppText>
        ) : null}
        {data.items.length === 0 ? <EmptyState icon="list-outline" title="這份清單還沒有內容" /> : <View>{data.items.map((it) => <ListItemRow key={it.id} item={it} />)}</View>}
        {!mine ? (
          <Pressable accessibilityRole="button" accessibilityLabel="複製到我的清單" onPress={() => void copy()} disabled={busy} hitSlop={8} style={styles.copy}>
            <Ionicons name="copy-outline" size={16} color={c.textMuted} />
            <AppText variant="callout" tone="muted" style={{ fontWeight: "600" }}>
              {busy ? "複製中…" : "複製到我的清單"}
            </AppText>
          </Pressable>
        ) : null}
        <View style={{ height: space.lg }} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  copy: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: space.md },
});
