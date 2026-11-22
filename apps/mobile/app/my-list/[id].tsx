import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { ListItemRow, type ListItem } from "@/features/my-lists/item-row";
import { SOURCE_LABEL } from "@/features/my-lists/links";
import { bumpMark, resetMarks } from "@/features/my-lists/store";
import { trackFeature } from "@/lib/feature-track";
import { absoluteUrl, shareLink } from "@/lib/share";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Check, ErrorView, Field, LoadingView, Screen, Section, ShareIcon } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Detail = { showRank: boolean; id: string; title: string; slug: string; url: string; coverItemId: string | null; clicks: number; items: ListItem[]; stats: { clicks: number; people: number; bySource: Record<string, number>; days: { day: string; n: number }[] } };

/** 我的清單內頁：改名稱、自訂網址、選封面、每個項目的備註與移除、點擊人數與每天／各來源統計、分享、刪除。 */
export default function MyListScreen() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(id ? `/my-lists/${id}` : null);
  const [d, setD] = useState<Detail | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (data) {
      setD(data);
      setTitle(data.title);
      setSlug(data.slug);
    }
  }, [data]);
  if (error && !d) return <Screen header={false}><ErrorView message={error} onRetry={reload} /></Screen>;
  if (!d || loading) return <Screen header={false}><LoadingView /></Screen>;

  const patch = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      const r = await api<Detail>("PATCH", `/my-lists/${d.id}`, body);
      setD((x) => (x ? { ...x, title: r.title, slug: r.slug, url: r.url, coverItemId: r.coverItemId, items: r.items, showRank: r.showRank } : x));
      setTitle(r.title);
      setSlug(r.slug);
      flashText(ok);
    } catch (e) {
      flashText(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(null);
    }
  };
  const full = absoluteUrl(d.url);
  const share = async () => {
    const r = await shareLink(d.title, d.url);
    trackFeature("list_share");
    if (r === "copied") flashText("已複製連結");
  };
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(full);
      trackFeature("list_share");
      flashText("已複製連結");
    } catch {
      flashText("無法複製，請長按網址自行複製");
    }
  };
  const remove = async (it: ListItem) => {
    if (!(await confirmSheet({ title: "從清單移除", message: `把「${it.title}」從這份清單移除？`, confirmLabel: "移除", danger: true }))) return;
    setD((x) => (x ? { ...x, items: x.items.filter((y) => y.id !== it.id) } : x));
    bumpMark({ kind: it.kind, ref: it.ref }, -1);
    api("PUT", `/my-lists/${d.id}/item`, { kind: it.kind, ref: it.ref, ref2: it.ref2, on: false }).catch(() => {
      flashText("移除失敗，已還原");
      reload();
    });
  };
  const saveNote = async (it: ListItem, note: string) => {
    if (note === it.note) return;
    try {
      await api("PATCH", `/my-lists/${d.id}/items/${it.id}`, { note });
      setD((x) => (x ? { ...x, items: x.items.map((y) => (y.id === it.id ? { ...y, note } : y)) } : x));
      flashText(note ? "已儲存備註" : "已清除備註");
    } catch (e) {
      flashText(e instanceof Error ? e.message : "儲存失敗");
    }
  };
  const del = async () => {
    if (!(await confirmSheet({ title: "刪除清單", message: `刪除「${d.title}」？清單裡的內容不會被刪除，但分享網址會失效，點擊紀錄也會清除。`, confirmLabel: "刪除", danger: true }))) return;
    try {
      await api("DELETE", `/my-lists/${d.id}`);
      resetMarks();
      flashText("已刪除清單");
      router.replace("/my-lists");
    } catch (e) {
      flashText(e instanceof Error ? e.message : "刪除失敗");
    }
  };
  const max = Math.max(1, ...d.stats.days.map((x) => x.n));
  return (
    <Screen header={false}>
      <Section title="分享">
        <Card style={{ gap: space.sm }}>
          <AppText variant="callout" selectable style={Platform.OS === "web" ? ({ wordBreak: "break-all" } as object) : undefined}>
            {full}
          </AppText>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {Platform.OS === "web" ? (
              <View style={{ flex: 1 }}>
                <Button variant="secondary" label="複製網址" icon="copy-outline" onPress={() => void copy()} fullWidth />
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="分享" onPress={() => void share()} style={[styles.shareBtn, { backgroundColor: c.accent }]}>
              <ShareIcon size={20} color="#fff" />
              <AppText variant="headline" style={{ color: "#fff" }}>
                分享
              </AppText>
            </Pressable>
          </View>
        </Card>
      </Section>
      <Section title="點擊統計">
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">
            {d.stats.people} 人・{d.stats.clicks} 次點擊
          </AppText>
          <AppText variant="caption" tone="muted">
            你自己打開不計入。每天的點擊（近 14 天）：
          </AppText>
          {d.stats.days.length === 0 ? (
            <AppText variant="callout" tone="muted">
              還沒有人點開過
            </AppText>
          ) : (
            d.stats.days.map((x) => (
              <View key={x.day} style={styles.barRow}>
                <AppText variant="caption" tone="muted" style={{ width: 84 }}>
                  {x.day.slice(5).replace("-", "/")}
                </AppText>
                <View style={[styles.bar, { backgroundColor: c.accent, width: `${Math.max(4, (x.n / max) * 100)}%` }]} />
                <AppText variant="caption" style={{ fontWeight: "800" }}>
                  {x.n}
                </AppText>
              </View>
            ))
          )}
          {Object.keys(d.stats.bySource).length ? (
            <View style={{ gap: 2 }}>
              <AppText variant="caption" tone="muted">
                從哪裡點進來：
              </AppText>
              <AppText variant="callout">
                {Object.entries(d.stats.bySource)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`)
                  .join("・")}
              </AppText>
            </View>
          ) : null}
        </Card>
      </Section>
      <Section title="清單設定">
        <Card style={{ gap: space.md }}>
          <Field label="清單名稱" value={title} onChange={setTitle} />
          <Button label="儲存名稱" onPress={() => void patch("title", { title }, "已儲存名稱")} loading={busy === "title"} disabled={!title.trim() || title === d.title} fullWidth />
          <Field label="自訂網址名稱" value={slug} onChange={(v) => setSlug(v.toLowerCase())} hint={`網址：${d.url.split("/").slice(0, 2).join("/")}/${slug || "…"}（英文、數字、連字號，3～30 字）`} />
          <Button label="儲存網址" onPress={() => void patch("slug", { slug }, "已儲存網址")} loading={busy === "slug"} disabled={slug === d.slug || slug.length < 3} fullWidth />
          <Check label="在清單名片顯示我的獎銜與獎章" value={d.showRank} onChange={(v) => void patch("rank", { showRank: v }, v ? "名片會顯示獎銜與獎章" : "名片不再顯示獎銜與獎章")} />
        </Card>
      </Section>
      <Section title={`內容（${d.items.length}）`}>
        <Card style={{ paddingVertical: 0 }}>
          {d.items.length === 0 ? (
            <AppText variant="callout" tone="muted" style={{ paddingVertical: space.md }}>
              還沒有內容。到任何課程、教材、系列或中心，按「加入我的清單」。
            </AppText>
          ) : null}
          {d.items.map((it) => (
            <ListItemRow key={it.id} item={it}>
              <ItemTools item={it} cover={d.coverItemId === it.id} onCover={() => void patch("cover", { coverItemId: d.coverItemId === it.id ? "" : it.id }, d.coverItemId === it.id ? "已改用預設封面" : "已設為清單封面")} onNote={(n) => void saveNote(it, n)} onRemove={() => void remove(it)} />
            </ListItemRow>
          ))}
        </Card>
        <AppText variant="caption" tone="muted">
          清單封面預設用第一個有封面的內容；點「設為封面」可以改選。
        </AppText>
      </Section>
      <Button variant="cancel" label="刪除這份清單" icon="trash-outline" onPress={() => void del()} fullWidth />
    </Screen>
  );
}

/** 每個項目的工具列：備註（改完離開輸入框就儲存）、設為封面、移除。 */
function ItemTools({ item, cover, onCover, onNote, onRemove }: { item: ListItem; cover: boolean; onCover: () => void; onNote: (n: string) => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [note, setNote] = useState(item.note);
  return (
    <View style={{ gap: space.xs, paddingLeft: 72 }}>
      <Field label="" value={note} onChange={setNote} placeholder="個人備註，例如：下次小組聚會用" />
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        {note !== item.note ? <Button variant="secondary" label="儲存備註" onPress={() => onNote(note.trim())} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="設為清單封面" onPress={onCover} style={[styles.chip, { borderColor: cover ? "#FFD43B" : c.border, backgroundColor: cover ? "#FFD43B" : "transparent" }]}>
          <Ionicons name="image-outline" size={16} color={cover ? "#1F1A00" : c.textMuted} />
          <AppText variant="caption" style={{ fontWeight: "800", color: cover ? "#1F1A00" : c.textMuted }}>
            {cover ? "目前封面" : "設為封面"}
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="從清單移除" onPress={onRemove} style={[styles.chip, { borderColor: c.danger }]}>
          <Ionicons name="trash-outline" size={16} color={c.danger} />
          <AppText variant="caption" style={{ fontWeight: "800", color: c.danger }}>
            移除
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shareBtn: { flex: 1, minHeight: 44, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bar: { height: 10, borderRadius: 5 },
  chip: { minHeight: 36, borderWidth: 1, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12 },
});
