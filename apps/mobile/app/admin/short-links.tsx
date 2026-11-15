import { useState } from "react";
import { View } from "react-native";
import { api } from "@/api/client";
import { ShortLinkRow, type ShortLinkItem } from "@/features/course-edit/short-link-row";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, LoadingView, NoticeBox, Screen, Section } from "@/ui";

const GROUPS: { kind: ShortLinkItem["kind"]; title: string; hint: string }[] = [
  { kind: "center", title: "中心", hint: "中心專屬頁的短網址；也是課程專屬網址的前段（中心縮寫/主講人英文名-001）。" },
  { kind: "category", title: "分類", hint: "分類清單頁的短網址。" },
  { kind: "series", title: "系列", hint: "系列頁的短網址。" },
];

/** 設定 > 短網址（只有超級管理員）：所有分類、系列、中心的短網址集中在這裡設定；課程頁與中心編輯面板不再放短網址。 */
export default function ShortLinksScreen() {
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<ShortLinkItem[]>(isSuper ? "/admin/short-links" : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!isSuper)
    return (
      <Screen header={false}>
        <EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定短網址" />
      </Screen>
    );
  const backfill = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ total: number }>("POST", "/admin/course-urls/backfill");
      setMsg({ tone: "success", text: `已補齊，目前共有 ${r.total} 門課程有專屬網址` });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={false}>
      {loading && !data ? <LoadingView /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data
        ? GROUPS.map((g) => {
            const items = data.filter((i) => i.kind === g.kind);
            return (
              <Section key={g.kind} title={`${g.title}短網址`}>
                <AppText variant="callout" tone="muted">
                  {g.hint}
                </AppText>
                <Card>
                  <View style={{ gap: space.md }}>
                    {items.length ? items.map((i) => <ShortLinkRow key={`${i.kind}:${i.value}`} item={i} onChanged={reload} />) : <AppText variant="callout" tone="muted">還沒有{g.title}</AppText>}
                  </View>
                </Card>
              </Section>
            );
          })
        : null}
      {data ? (
        <Section title="課程專屬網址">
          <AppText variant="callout" tone="muted">
            課程專屬網址：中心縮寫/主講人英文名-001。設定中心縮寫時會自動補上該中心的課程；舊課程可在這裡一次補齊。
          </AppText>
          <Button variant="secondary" label="為舊課程補上專屬網址" icon="link-outline" loading={busy} onPress={backfill} fullWidth />
          {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
        </Section>
      ) : null}
    </Screen>
  );
}
