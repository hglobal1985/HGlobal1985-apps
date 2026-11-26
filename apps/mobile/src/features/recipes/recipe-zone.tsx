import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, TextInput, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, resolveUrl, type CoverMediaItem, type RecipeCard, type RecipeDetail, type RecipesResponse } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { AddToListSheet } from "@/features/my-lists/add-to-list";
import { useMark } from "@/features/my-lists/store";
import { useFeature } from "@/lib/app-mode";
import { shareRecipeText } from "@/lib/share";
import { useSheetBack } from "@/lib/sheet-back";
import { trackUsage } from "@/lib/usage";
import { useThumb } from "@/lib/thumb";
import { useApi, useSession } from "@/state/session";
import { AppText } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { RecipeBody } from "./recipe-body";
import { RecipeEditor, RecipeSheet } from "./recipe-editor";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

const round = (label: string, icon: string, onPress: () => void) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
    <Ionicons name={icon as never} size={24} color="#fff" {...UI_ONLY} />
  </Pressable>
);

/**
 * 相簿專區的「食譜」（杜杜龍 2026-11-26）：一道食譜＝名稱＋分類＋多張照片＋一篇純文字（獨立一行的 YouTube 網址＝站內播放的影片卡片）。
 * 列表（分類標籤、搜尋名稱與整篇文字、右下「＋新增食譜」）→ 單道食譜（可左右滑的照片、文字、影片、複製／分享）。
 * 所有會員都能投稿（進「待審核」）；管理者（超級管理員、總部管理員、相簿齒輪「食譜」上傳獎銜達標者）直接發佈、審核、管理分類。
 */
export function RecipeZone({ onBack, onOpenPhotos }: { onBack: () => void; onOpenPhotos: (title: string, items: CoverMediaItem[], index: number) => void }) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const thumb = useThumb();
  const { member } = useSession();
  const [q, setQ] = useState("");
  const [qs, setQs] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQs(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, error, reload } = useApi<RecipesResponse>(`/recipes${qs ? `?q=${encodeURIComponent(qs)}` : ""}`);
  const [cat, setCat] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; isNew: boolean } | null>(null);
  const [catSheet, setCatSheet] = useState(false);
  useEffect(() => trackUsage("album_folder", "食譜"), []);

  const recipes = data?.recipes ?? [];
  const cats = data?.categories ?? [];
  const pendingN = recipes.filter((r) => r.status === "pending").length;
  const shown = recipes.filter((r) => (cat === "all" ? true : cat === "pending" ? r.status === "pending" : cat === "none" ? !r.categoryId : r.categoryId === cat));
  const gap = 12;
  const cols = win.width >= 1000 ? 4 : win.width >= 700 ? 3 : 2;
  const w = Math.min(win.width, 1100) - 32;
  const cardW = Math.floor((w - gap * (cols - 1)) / cols);

  const startNew = async () => {
    if (!member) return void flashText("請先登入才能新增食譜");
    try {
      const r = await api<{ id: string }>("POST", "/recipes");
      setEdit({ id: r.id, isNew: true });
    } catch (e) {
      flashText((e as Error).message);
    }
  };

  const chipBtn = (id: string, label: string) => {
    const on = cat === id;
    return (
      <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCat(id)} style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: "center", backgroundColor: on ? "#0c603c" : "#1b1b1b", borderWidth: 1, borderColor: on ? "#0c603c" : "#333" }}>
        <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 15, fontWeight: on ? "800" : "500" }}>{label}</AppText>
      </Pressable>
    );
  };
  const card = (r: RecipeCard) => (
    <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.title}，${r.photos} 張照片${r.videos ? "，有影片" : ""}${r.status === "pending" ? "，待審核" : ""}`} onPress={() => setOpenId(r.id)} style={({ pressed }) => ({ width: cardW, borderRadius: 14, backgroundColor: "#262629", padding: 6, opacity: pressed ? 0.75 : 1 })}>
      <View style={{ width: cardW - 12, height: cardW - 12, borderRadius: 9, overflow: "hidden", backgroundColor: "#1a1a1c", alignItems: "center", justifyContent: "center" }}>
        {r.thumb ? <Image source={{ uri: thumb(resolveUrl(r.thumb), 360) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <Ionicons name="restaurant-outline" size={40} color="#6f6f75" {...UI_ONLY} />}
        {r.status === "pending" ? (
          <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: "#F5C842", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 }}>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#1F1A00", fontSize: 12, fontWeight: "800" }}>待審核</AppText>
          </View>
        ) : null}
      </View>
      <AppText numberOfLines={2} {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 16, marginTop: 8, marginHorizontal: 4 }}>{r.title}</AppText>
      <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 13, margin: 4 }}>{[`${r.photos} 張`, r.videos ? `${r.videos} 影片` : "", r.categoryName].filter(Boolean).join("　")}</AppText>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {round("回相簿首頁", "chevron-back", onBack)}
        <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "900", fontSize: 20 }}>🍳 食譜</AppText>
        {data?.manager ? round("管理分類", "settings-outline", () => setCatSheet(true)) : null}
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ minHeight: 46, borderRadius: 23, backgroundColor: "#1b1b1b", borderWidth: 1, borderColor: "#333", flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 }}>
          <Ionicons name="search" size={18} color="#9a9aa0" {...UI_ONLY} />
          <TextInput value={q} onChangeText={setQ} placeholder="搜尋料理名稱、食材…" placeholderTextColor="#6f6f75" accessibilityLabel="搜尋食譜" style={{ flex: 1, color: "#fff", fontSize: 16, paddingVertical: 10 }} />
          {q ? <Pressable accessibilityRole="button" accessibilityLabel="清除搜尋" onPress={() => setQ("")} style={{ padding: 6 }}><Ionicons name="close-circle" size={20} color="#9a9aa0" {...UI_ONLY} /></Pressable> : null}
        </View>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          {chipBtn("all", `全部 ${recipes.length}`)}
          {cats.map((c) => chipBtn(c.id, `${c.name} ${recipes.filter((r) => r.categoryId === c.id).length}`))}
          {recipes.some((r) => !r.categoryId) ? chipBtn("none", "未分類") : null}
          {pendingN ? chipBtn("pending", `待審核 ${pendingN}`) : null}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110, paddingTop: 2 }}>
        {error && !data ? <AppText {...UI_ONLY_TEXT} style={{ color: "#fff" }}>讀取失敗，請稍後再試</AppText> : null}
        {loading && !data ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>讀取中…</AppText> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{shown.map(card)}</View>
        {data && !shown.length ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 16, lineHeight: 26 }}>{qs ? "沒有符合的食譜" : "這裡還沒有食譜。按右下角的「＋ 新增食譜」分享第一道吧！"}</AppText> : null}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="新增食譜" onPress={() => void startNew()} style={{ position: "absolute", right: 16, bottom: insets.bottom + 24, minHeight: 56, paddingHorizontal: 22, borderRadius: 28, backgroundColor: "#0c603c", flexDirection: "row", alignItems: "center", gap: 8, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 8, elevation: 6 }}>
        <Ionicons name="add" size={24} color="#fff" {...UI_ONLY} />
        <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>新增食譜</AppText>
      </Pressable>
      {openId ? <RecipeDetailView id={openId} onClose={() => setOpenId(null)} onOpenPhotos={onOpenPhotos} onChanged={reload} onEdit={() => (setEdit({ id: openId, isNew: false }), setOpenId(null))} /> : null}
      {edit ? <RecipeEditor id={edit.id} isNew={edit.isNew} cats={cats} manager={!!data?.manager} onCatsChanged={reload} onClose={() => (setEdit(null), reload())} /> : null}
      {catSheet ? <CategorySheet cats={cats} admin={!!data?.admin} onClose={() => setCatSheet(false)} onChanged={reload} /> : null}
    </View>
  );
}

/** 單道食譜：可左右滑的照片（點照片放大看圖）、名稱、分類、文字與影片、複製／分享；管理者與投稿者（待審核時）可修改、刪除，管理者可核准。 */
export function RecipeDetailView({ id, onClose, onOpenPhotos, onChanged, onEdit }: { id: string; onClose: () => void; onOpenPhotos: (title: string, items: CoverMediaItem[], index: number) => void; onChanged: () => void; onEdit: () => void }) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const thumb = useThumb();
  const { member } = useSession();
  const detail = useApi<RecipeDetail>(`/recipes/${id}`);
  const inList = useMark({ kind: "recipe", ref: id });
  const listOn = useFeature("addToList");
  const [listOpen, setListOpen] = useState(false);
  const photosApi = useApi<CoverMediaItem[]>(`/cover-media?kind=course&key=${encodeURIComponent(`rcp:${id}`)}`);
  const closeRef = useRef<() => unknown>(onClose);
  closeRef.current = onClose;
  useSheetBack(closeRef); // 瀏覽器上一頁／返回手勢＝回食譜列表
  const scroller = useRef<ScrollViewInstance | null>(null);
  const [idx, setIdx] = useState(0);
  const d = detail.data;
  const photos = (photosApi.data ?? []).filter((p) => p.kind === "image");
  const w = Math.min(win.width, 720) - 32;
  const h = Math.round(w * 0.75);
  const go = (n: number) => {
    const i = Math.max(0, Math.min(photos.length - 1, n));
    scroller.current?.scrollTo({ x: i * w, animated: true });
    setIdx(i);
  };
  const text = d ? `${d.title}\n\n${d.body}` : "";
  const act = (label: string, icon: string, onPress: () => void, bg = "#262629", fg = "#fff") => (
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: bg }}>
      <Ionicons name={icon as never} size={20} color={fg} {...UI_ONLY} />
      <AppText {...UI_ONLY_TEXT} style={{ color: fg, fontWeight: "800", fontSize: 15 }}>{label}</AppText>
    </Pressable>
  );
  const share = async () => {
    if ((await shareRecipeText({ title: d!.title, body: d!.body, path: d!.shortPath ?? `/recipe/${id}` })) === "copied") flashText("已複製食譜文字與連結");
  };
  const approve = async () => {
    try {
      await api("POST", `/recipes/${id}/approve`);
      flashText("已核准，所有人都看得到了");
      detail.reload();
      onChanged();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const remove = async () => {
    if (!(await confirmAsk("刪除食譜", `「${d!.title}」與它的所有照片會一起刪除，無法復原。`, "刪除"))) return;
    try {
      await api("DELETE", `/recipes/${id}`);
      flashText("已刪除");
      onChanged();
      onClose();
    } catch (e) {
      flashText((e as Error).message);
    }
  };

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#000", zIndex: 10 }}>
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
        {round("回食譜列表", "chevron-back", onClose)}
        <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "900", fontSize: 19 }}>{d?.title ?? "食譜"}</AppText>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40, alignItems: "center" }}>
        <View style={{ width: w, gap: 14 }}>
          {!d ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>{detail.error ? "找不到這道食譜" : "讀取中…"}</AppText> : null}
          {d ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {d.body ? act("複製文字", "copy-outline", () => void Clipboard.setStringAsync(text).then(() => flashText("已複製食譜文字"))) : null}
                {act("分享", "share-outline", () => void share())}
                {d.status === "published" && listOn ? act(inList ? `已加入 ${inList} 份清單` : "加入我的清單", "bookmark-outline", () => (member ? setListOpen(true) : flashText("請先登入才能加入我的清單")), inList ? "#FFD43B" : "#262629", inList ? "#1F1A00" : "#fff") : null}
                {d.manager && d.status === "pending" ? act("核准", "checkmark-circle-outline", () => void approve(), "#0c603c") : null}
                {d.canEdit ? act("編輯", "create-outline", onEdit) : null}
                {d.canEdit ? act("刪除", "trash-outline", () => void remove(), "#3a1c1c", "#ff8a80") : null}
            </View>
          ) : null}
          {photos.length ? (
            <View>
              <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / w))} style={{ width: w, height: h, borderRadius: 12 }}>
                {photos.map((p, i) => (
                  <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`第 ${i + 1} 張照片，點一下放大`} onPress={() => onOpenPhotos(d?.title ?? "食譜", photos, i)} style={{ width: w, height: h, backgroundColor: "#111" }}>
                    <Image source={{ uri: thumb(resolveUrl(p.url), 900) }} style={{ width: w, height: h }} resizeMode="cover" accessibilityIgnoresInvertColors />
                  </Pressable>
                ))}
              </ScrollView>
              {photos.length > 1 ? (
                <>
                  <View style={{ position: "absolute", top: 10, right: 10, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 13 }}>{`${idx + 1}／${photos.length}`}</AppText>
                  </View>
                  {idx > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="上一張" onPress={() => go(idx - 1)} style={{ position: "absolute", left: 8, top: h / 2 - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}><Ionicons name="chevron-back" size={24} color="#fff" {...UI_ONLY} /></Pressable> : null}
                  {idx < photos.length - 1 ? <Pressable accessibilityRole="button" accessibilityLabel="下一張" onPress={() => go(idx + 1)} style={{ position: "absolute", right: 8, top: h / 2 - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}><Ionicons name="chevron-forward" size={24} color="#fff" {...UI_ONLY} /></Pressable> : null}
                </>
              ) : null}
            </View>
          ) : null}
          {d ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {d.categoryName ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontSize: 14, fontWeight: "700" }}>{d.categoryName}</AppText> : null}
                {d.authorName ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14 }}>{`分享：${d.authorName}`}</AppText> : null}
                {d.status === "pending" ? <View style={{ backgroundColor: "#F5C842", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 2 }}><AppText {...UI_ONLY_TEXT} style={{ color: "#1F1A00", fontSize: 12, fontWeight: "800" }}>待審核</AppText></View> : null}
              </View>
              {d.body ? <RecipeBody text={d.body} /> : <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>這道食譜還沒有文字。</AppText>}
            </>
          ) : null}
        </View>
      </ScrollView>
      {listOpen && d ? <AddToListSheet target={{ kind: "recipe", ref: id }} title={d.title} onClose={() => setListOpen(false)} /> : null}
    </View>
  );
}

/** 分類管理（有權限的人）：新增、改名；刪除分類只有超級管理員（裡面的食譜變成未分類）。 */
function CategorySheet({ cats, admin, onClose, onChanged }: { cats: { id: string; name: string; count: number }[]; admin: boolean; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null); // 分類編號；"new"＝新增
  const [name, setName] = useState("");
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      flashText(done);
      setEditing(null);
      onChanged();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const field = { flex: 1, borderWidth: 2, borderColor: "#2e7d32", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: "#fff", backgroundColor: "#0b0b0b" } as const;
  const inputRow = (onSave: () => void) => (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput value={name} onChangeText={(t) => setName(t.slice(0, 10))} autoFocus placeholder="分類名稱（最多 10 字）" placeholderTextColor="#6f6f75" accessibilityLabel="分類名稱" style={field} />
      <Pressable accessibilityRole="button" onPress={onSave} style={{ minHeight: 48, paddingHorizontal: 18, borderRadius: 12, backgroundColor: "#2e7d32", justifyContent: "center" }}><AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>儲存</AppText></Pressable>
    </View>
  );
  return (
    <RecipeSheet title="食譜分類" onClose={onClose}>
      {cats.map((c) => (
        <View key={c.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, borderRadius: 10, backgroundColor: "#262629", paddingLeft: 14, paddingRight: 6 }}>
            <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 16, fontWeight: "700" }}>{c.name}</AppText>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14 }}>{`${c.count} 道`}</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel={`重新命名 ${c.name}`} onPress={() => (setEditing(editing === c.id ? null : c.id), setName(c.name))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="create-outline" size={22} color="#fff" {...UI_ONLY} /></Pressable>
            {admin ? <Pressable accessibilityRole="button" accessibilityLabel={`刪除 ${c.name}`} onPress={() => void confirmAsk("刪除分類", `「${c.name}」裡的 ${c.count} 道食譜會變成未分類。`, "刪除").then((ok) => void (ok && run(() => api("DELETE", `/recipes/categories/${c.id}`), "已刪除分類")))} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="trash-outline" size={22} color="#ff8a80" {...UI_ONLY} /></Pressable> : null}
          </View>
          {editing === c.id ? inputRow(() => void run(() => api("PUT", `/recipes/categories/${c.id}`, { name }), "已改名")) : null}
        </View>
      ))}
      {editing === "new" ? inputRow(() => void run(() => api("POST", "/recipes/categories", { name }), "已新增分類")) : (
        <Pressable accessibilityRole="button" onPress={() => (setEditing("new"), setName(""))} style={{ minHeight: 50, borderRadius: 10, borderWidth: 2, borderStyle: "dashed", borderColor: "#2e7d32", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Ionicons name="add-circle-outline" size={22} color="#9fe3b8" {...UI_ONLY} />
          <AppText {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontWeight: "800", fontSize: 16 }}>新增分類</AppText>
        </Pressable>
      )}
    </RecipeSheet>
  );
}
