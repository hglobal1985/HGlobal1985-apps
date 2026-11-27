import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { api, clearApiCache, LIST_COVER_COLORS, resolveUrl } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { FormBlock } from "@/ui/form-block";
import { ListItemRow, type ListItem } from "@/features/my-lists/item-row";
import { coverFill, ListCover, type ListCoverMode } from "@/features/my-lists/list-cover";
import { SOURCE_LABEL } from "@/features/my-lists/links";
import { bumpMark, resetMarks } from "@/features/my-lists/store";
import { trackFeature } from "@/lib/feature-track";
import { absoluteUrl, shareLink } from "@/lib/share";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, ErrorView, Field, LoadingView, Screen, SegmentTabs, ShareIcon } from "@/ui";
import { DIM_COLOR } from "@/ui/dim-backdrop";
import { flashText } from "@/ui/flash-notice";

type Detail = { id: string; title: string; slug: string; url: string; coverItemId: string | null; coverMode: ListCoverMode; coverUrl: string | null; coverBgUrl: string | null; coverBgId: string | null; coverColor: string | null; coverText: string | null; coverTextRaw: string; itemCoverUrl: string | null; coverBgChoiceUrl: string | null; clicks: number; items: ListItem[]; stats: { clicks: number; people: number; bySource: Record<string, number>; days: { day: string; n: number }[]; shares: number; copies: number; items: { id: string; title: string; n: number; missing: boolean }[] } };

/**
 * 我的清單內頁（杜杜龍 2026-11-22 改版：大圖封面首頁＋三個分頁）：上方是清單封面大圖（名稱、點閱數疊在圖上）與「分享／複製網址」，
 * 下面「內容｜成效｜設定」三個分頁一次只看一件事：內容只有項目列（右邊「⋯」才有備註、設為封面、移除）、成效是點閱統計、設定是名稱、網址與刪除。
 */
export default function MyListScreen() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Detail>(id ? `/my-lists/${id}` : null);
  const [d, setD] = useState<Detail | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"items" | "stats" | "settings">("items");
  const [editing, setEditing] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
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
      setD((x) => (x ? { ...x, ...r } : x));
      clearApiCache(); // 清單列表（設定 › 我的清單）的縮圖要跟著同步
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
    void api("POST", `/my-lists/${d.id}/share`).catch(() => undefined);
    if (r === "copied") flashText("已複製連結");
  };
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(full);
      trackFeature("list_share");
      void api("POST", `/my-lists/${d.id}/share`).catch(() => undefined);
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
  const editItem = d.items.find((x) => x.id === editing) ?? null;
  const settingsDirty = title !== d.title || slug !== d.slug;
  const saveSettings = async () => {
    const body: Record<string, unknown> = {};
    if (title !== d.title) body.title = title;
    if (slug !== d.slug) body.slug = slug;
    await patch("settings", body, "已儲存設定");
  };
  return (
    <Screen header={false}>
      <ListCover mode={d.coverMode} imageUrl={d.coverUrl} bgUrl={d.coverBgUrl} color={d.coverColor} title={d.title} text={d.coverText} height={190}>
        <View style={[styles.heroText, { backgroundColor: DIM_COLOR }]}>
          {d.coverMode === "item" ? (
            <AppText variant="title" numberOfLines={2} style={{ color: "#fff" }}>
              {d.title}
            </AppText>
          ) : null}
          <View style={styles.heroStat}>
            <Ionicons name="eye-outline" size={15} color="#fff" />
            <AppText variant="caption" style={{ color: "#fff", fontWeight: "800" }}>
              {d.stats.clicks} 次點閱・{d.stats.people} 人
            </AppText>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="更換清單封面" onPress={() => setCoverOpen(true)} style={styles.coverBtn}>
          <Ionicons name="image-outline" size={18} color="#1F3A2E" />
          <AppText variant="callout" style={{ color: "#1F3A2E", fontWeight: "800" }}>
            更換封面
          </AppText>
        </Pressable>
      </ListCover>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="分享" onPress={() => void share()} style={[styles.shareBtn, { backgroundColor: c.accent }]}>
          <ShareIcon size={20} color="#fff" />
          <AppText variant="headline" style={{ color: "#fff" }}>
            分享
          </AppText>
        </Pressable>
        {Platform.OS === "web" ? (
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="複製網址" icon="copy-outline" onPress={() => void copy()} fullWidth />
          </View>
        ) : null}
      </View>

      <SegmentTabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "items", label: `內容 ${d.items.length}` },
          { key: "stats", label: "成效" },
          { key: "settings", label: "設定" },
        ]}
      />

      {tab === "items" ? (
        <>
          <Card style={{ paddingVertical: 0 }}>
            {d.items.length === 0 ? (
              <AppText variant="callout" tone="muted" style={{ paddingVertical: space.md }}>
                還沒有內容。到任何課程、教材、系列或中心，按「加入我的清單」。
              </AppText>
            ) : null}
            {d.items.map((it) => (
              <ListItemRow
                key={it.id}
                item={it}
                actions={
                  <Pressable accessibilityRole="button" accessibilityLabel={`${it.title} 的更多選項`} onPress={() => setEditing(it.id)} hitSlop={8} style={styles.more}>
                    <Ionicons name="ellipsis-horizontal" size={22} color={c.textMuted} />
                  </Pressable>
                }
              />
            ))}
          </Card>
          {d.items.length ? (
            <AppText variant="caption" tone="muted">
              按列右邊的「⋯」可以寫備註、設為清單封面或移除。封面預設用第一個有封面的內容。
            </AppText>
          ) : null}
        </>
      ) : null}

      {tab === "stats" ? (
        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <AppText variant="display">{d.stats.clicks}</AppText>
              <AppText variant="caption" tone="muted">
                累計點閱
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="display">{d.stats.people}</AppText>
              <AppText variant="caption" tone="muted">
                不同的人
              </AppText>
            </View>
          </View>
          <AppText variant="caption" tone="muted">
            你自己打開不計入。每天的點閱（近 14 天）：
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
            <View style={{ gap: 6 }}>
              <AppText variant="caption" tone="muted">
                從哪裡點進來：
              </AppText>
              {Object.entries(d.stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => {
                  const pct = Math.round((n / Math.max(1, d.stats.clicks)) * 100);
                  return (
                    <View key={k} style={styles.barRow}>
                      <AppText variant="caption" style={{ width: 84, fontWeight: "700" }}>
                        {SOURCE_LABEL[k] ?? k}
                      </AppText>
                      <View style={{ flex: 1, height: 14, borderRadius: 7, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
                        <View style={{ height: 14, borderRadius: 7, backgroundColor: c.accent, width: `${Math.max(3, Math.min(100, pct))}%` }} />
                      </View>
                      <AppText variant="caption" style={{ fontWeight: "800", width: 64, textAlign: "right" }}>
                        {pct}%・{n}
                      </AppText>
                    </View>
                  );
                })}
            </View>
          ) : null}
          <View style={{ height: 1, backgroundColor: c.border }} />
          <AppText variant="callout" style={{ fontWeight: "800" }}>
            分享與複製
          </AppText>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <AppText variant="display">{d.stats.shares}</AppText>
              <AppText variant="caption" tone="muted">
                你按分享的次數
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="display">{d.stats.copies}</AppText>
              <AppText variant="caption" tone="muted">
                別人複製成自己的清單
              </AppText>
            </View>
          </View>
          {d.stats.shares > 0 && d.stats.clicks > 0 ? (
            <AppText variant="caption" tone="muted">
              平均每次分享帶來約 {Math.round((d.stats.clicks / d.stats.shares) * 10) / 10} 次點閱（分享次數從 2026/11/22 開始統計，點閱含更早的）。
            </AppText>
          ) : (
            <AppText variant="caption" tone="muted">
              分享次數從 2026/11/22 開始統計。
            </AppText>
          )}
          {d.stats.items.length ? (
            <>
              <View style={{ height: 1, backgroundColor: c.border }} />
              <AppText variant="callout" style={{ fontWeight: "800" }}>
                最受歡迎的項目
              </AppText>
              {d.stats.items.some((x) => x.n > 0) ? (
                d.stats.items
                  .filter((x) => x.n > 0)
                  .sort((a, b) => b.n - a.n)
                  .slice(0, 5)
                  .map((x, i) => (
                    <View key={x.id} style={styles.barRow}>
                      <AppText variant="caption" style={{ width: 20, fontWeight: "800" }}>
                        {i + 1}
                      </AppText>
                      <AppText variant="callout" numberOfLines={2} style={{ flex: 1 }}>
                        {x.title}
                      </AppText>
                      <AppText variant="caption" style={{ fontWeight: "800" }}>
                        {x.n} 次
                      </AppText>
                    </View>
                  ))
              ) : (
                <AppText variant="caption" tone="muted">
                  還沒有人點開過裡面的項目（從 2026/11/22 開始統計）。
                </AppText>
              )}
              {d.stats.items.some((x) => x.n > 0) && d.stats.items.some((x) => x.n === 0 && !x.missing) ? (
                <>
                  <AppText variant="callout" style={{ fontWeight: "800", marginTop: space.xs }}>
                    還沒人點過的項目
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    可以考慮調整順序、換掉，或在備註寫一句推薦。
                  </AppText>
                  {d.stats.items
                    .filter((x) => x.n === 0 && !x.missing)
                    .map((x) => (
                      <AppText key={x.id} variant="callout" numberOfLines={2}>
                        ・{x.title}
                      </AppText>
                    ))}
                </>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {tab === "settings" ? (
        <>
          <Card style={{ gap: space.md }}>
            <Field label="清單名稱" value={title} onChange={setTitle} />
            <Field label="自訂網址名稱" value={slug} onChange={(v) => setSlug(v.toLowerCase())} hint={`網址：${d.url.split("/").slice(0, 2).join("/")}/${slug || "…"}（英文、數字、連字號，3～30 字）`} />
            <AppText variant="caption" tone="muted" selectable style={Platform.OS === "web" ? ({ wordBreak: "break-all" } as object) : undefined}>
              {full}
            </AppText>
            <Button label="儲存設定" onPress={() => void saveSettings()} loading={busy === "settings"} disabled={!settingsDirty || !title.trim() || slug.length < 3} fullWidth />
          </Card>
          <Button variant="cancel" label="刪除這份清單" icon="trash-outline" onPress={() => void del()} fullWidth />
        </>
      ) : null}

      {coverOpen ? <CoverSheet d={d} onClose={() => setCoverOpen(false)} onDone={(r) => { setD((x) => (x ? { ...x, ...r } : x)); clearApiCache(); }} /> : null}
      {editItem ? <ItemSheet key={editItem.id} item={editItem} cover={d.coverItemId === editItem.id} onClose={() => setEditing(null)} onNote={(n) => saveNote(editItem, n)} onCover={() => void patch("cover", { coverItemId: d.coverItemId === editItem.id ? "" : editItem.id }, d.coverItemId === editItem.id ? "已改用文字封面" : "已設為清單封面")} onRemove={() => { setEditing(null); void remove(editItem); }} /> : null}
    </Screen>
  );
}

/**
 * 清單封面設定（杜杜龍 2026-11-22）：兩種——
 * ① 內容封面（用清單內容的圖）；
 * ② 自訂封面＝「背景」（管理員提供的底圖，或 10 種單色，會員不能上傳圖片）＋「文字」（預設清單名稱、可自訂、可關閉），文字疊在背景上。
 * 上面有即時預覽；「儲存」才套用。
 */
function CoverSheet({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (r: Detail) => void }) {
  const { c } = useTheme();
  const bgs = useApi<{ id: string; name: string; url: string }[]>("/list-cover-bgs");
  const [isCustom, setIsCustom] = useState(d.coverMode !== "item");
  const [bgId, setBgId] = useState<string | null>(d.coverBgId);
  const [color, setColor] = useState<string | null>(d.coverColor);
  const [textRaw, setTextRaw] = useState(d.coverTextRaw);
  const [busy, setBusy] = useState(false);
  const bgUrl = bgs.data?.find((x) => x.id === bgId)?.url ?? null;
  const mode: ListCoverMode = isCustom ? "text" : "item";
  const previewText = textRaw.trim() || d.title;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<Detail>("PATCH", `/my-lists/${d.id}`, { coverMode: mode, coverBgId: bgId ?? "", coverColor: bgId ? "" : (color ?? ""), coverText: textRaw.trim() });
      onDone(r);
      flashText("已儲存封面");
      onClose();
    } catch (e) {
      flashText(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };
  const dirty = mode !== d.coverMode || bgId !== d.coverBgId || (bgId ? false : color !== d.coverColor) || textRaw.trim() !== d.coverTextRaw;
  return (
    <EditSheet title="清單封面" onClose={onClose} onSave={save} busy={busy} dirty={dirty}>
      <ListCover mode={mode} imageUrl={d.itemCoverUrl} bgUrl={bgUrl} color={color} title={d.title} text={previewText} height={150} />
      <SegmentTabs
        value={isCustom ? "custom" : "item"}
        onChange={(k) => setIsCustom(k === "custom")}
        options={[
          { key: "item", label: "內容封面" },
          { key: "custom", label: "自訂封面" },
        ]}
      />
      {!isCustom ? (
        <AppText variant="callout" tone="muted">
          用清單內容的封面圖。要指定哪一個內容當封面：回到「內容」分頁，按那一列右邊的「⋯」→「設為封面」；再按一次「目前封面」就取消指定、回到自訂封面。
        </AppText>
      ) : (
        <View style={{ gap: space.md }}>
          <FormBlock title="文字">
            <Field label="封面文字（留空就用清單名稱）" value={textRaw} onChange={(v) => setTextRaw(v.slice(0, 40))} placeholder={d.title} />
            <AppText variant="caption" tone="muted">
              文字會自動放到適當大小，並加上陰影，疊在圖片或底色上都看得清楚。
            </AppText>
          </FormBlock>
          {bgs.data?.length ? (
            <FormBlock title="圖庫底圖">
              <View style={styles.bgGrid}>
                {bgs.data.map((b) => (
                  <Pressable key={b.id} accessibilityRole="radio" accessibilityState={{ selected: bgId === b.id }} accessibilityLabel={`底圖 ${b.name}`} onPress={() => setBgId(b.id)} style={[styles.bgCell, { borderColor: bgId === b.id ? c.accent : c.border }]}>
                    <Image source={{ uri: resolveUrl(b.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
                    {bgId === b.id ? <Ionicons name="checkmark-circle" size={22} color="#fff" /> : null}
                  </Pressable>
                ))}
              </View>
            </FormBlock>
          ) : null}
          <FormBlock title="背景漸層色">
            <View style={styles.bgGrid}>
              {LIST_COVER_COLORS.map((x) => {
                const on = !bgId && (color ?? LIST_COVER_COLORS[0]!.hex).toUpperCase() === x.hex;
                return (
                  <Pressable key={x.hex} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`單色 ${x.name}`} onPress={() => { setBgId(null); setColor(x.hex); }} style={[styles.bgCell, { borderColor: on ? c.accent : c.border, ...coverFill(x.hex) }]}>
                    {on ? <Ionicons name="checkmark-circle" size={22} color="#fff" /> : null}
                    <AppText variant="caption" style={{ color: "#fff", fontWeight: "800" }} {...({ dataSet: { noScale: "" } } as object)}>
                      {x.name}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </FormBlock>
        </View>
      )}
    </EditSheet>
  );
}

/** 項目的編輯面板：備註（按「儲存」）、設為封面、移除。儲存與關閉永遠在下方同一列（EditSheet）。 */
function ItemSheet({ item, cover, onClose, onNote, onCover, onRemove }: { item: ListItem; cover: boolean; onClose: () => void; onNote: (n: string) => Promise<void>; onCover: () => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [note, setNote] = useState(item.note);
  const [busy, setBusy] = useState(false);
  return (
    <EditSheet
      title={item.title}
      onClose={onClose}
      dirty={note.trim() !== item.note}
      busy={busy}
      onSave={async () => {
        setBusy(true);
        await onNote(note.trim());
        setBusy(false);
        onClose();
      }}
    >
      <Field label="個人備註" value={note} onChange={setNote} placeholder="例如：下次小組聚會用" />
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="設為清單封面" onPress={onCover} style={[styles.chip, { borderColor: cover ? "#FFD43B" : c.border, backgroundColor: cover ? "#FFD43B" : "transparent" }]}>
          <Ionicons name="image-outline" size={18} color={cover ? "#1F1A00" : c.textMuted} />
          <AppText variant="callout" style={{ fontWeight: "800", color: cover ? "#1F1A00" : c.textMuted }}>
            {cover ? "目前封面" : "設為封面"}
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="從清單移除" onPress={onRemove} style={[styles.chip, { borderColor: c.danger }]}>
          <Ionicons name="trash-outline" size={18} color={c.danger} />
          <AppText variant="callout" style={{ fontWeight: "800", color: c.danger }}>
            移除
          </AppText>
        </Pressable>
      </View>
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  coverBtn: { position: "absolute", top: 10, right: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: "#FFFFFFE6", flexDirection: "row", alignItems: "center", gap: 6 },
  bgGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bgCell: { width: "31%", aspectRatio: 16 / 9, borderRadius: radius.md, borderWidth: 3, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  heroText: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2 },
  heroStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  shareBtn: { flex: 1, minHeight: 44, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bar: { height: 10, borderRadius: 5 },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16 },
});
