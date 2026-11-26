import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, resolveUrl, type CoverMediaItem, type RecipeCategory, type RecipeDetail } from "@/api/client";
import { choiceSheet, confirmAsk, confirmSheet } from "@/features/confirm";
import { centerTitle } from "@/features/format";
import { Sheet } from "@/features/courses/album-admin";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { youtubeIdOfLine } from "@/lib/recipe-text";
import { useInsets } from "@/lib/inline-page";
import { usePageBack } from "@/lib/page-back";
import { useSheetBack } from "@/lib/sheet-back";
import { barHeight } from "@/theme/tokens";
import { useThumb } from "@/lib/thumb";
import { useApi } from "@/state/session";
import { AppText } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;
const TITLE_MAX = 60;
const BODY_MAX = 20000;
const CAT_MAX = 10;

/** 疊在全黑相簿畫面上的面板；上一頁／返回手勢＝關閉（呼叫端自己決定要不要詢問）。 */
export function RecipeSheet({ title, onClose, children }: { title: string; onClose: () => unknown; children: React.ReactNode }) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useSheetBack(ref);
  return (
    <Sheet title={title} onClose={() => void onClose()}>
      {children}
    </Sheet>
  );
}

/**
 * 整頁編輯畫面（杜杜龍 2026-11-26：編輯模式不要只有半頁、儲存鈕固定在最上面不要跟著捲動跑掉）：
 * 蓋滿整個螢幕（網頁用 fixed，蓋過相簿自己的上方工具列），最上面固定一列「取消（左）｜標題｜儲存（右）」，內容在下面捲動。
 * 上一頁／返回手勢＝呼叫 `onCancel`（有未存內容的會問「儲存／放棄／繼續編輯」）。
 */
export function RecipeFullPage({ title, onCancel, onSave, saving, children, overlay }: { title: string; onCancel: () => unknown; onSave: () => unknown; saving?: boolean; children: React.ReactNode; /** 疊在整頁上面的面板（要放在這裡才不會被整頁蓋住）。 */ overlay?: React.ReactNode }) {
  const insets = useInsets();
  const safe = useSafeAreaInsets();
  const ref = useRef(onCancel);
  ref.current = onCancel;
  useSheetBack(ref);
  usePageBack(() => (void onCancel(), true), 5); // 上方工具列的返回鍵＝取消（有未存內容會問儲存／放棄／繼續編輯）
  // 整頁編輯：網頁用 fixed 蓋住內容區，但要留出上方工具列（TopBar）的高度，取消／儲存鈕才不會被工具列遮住（杜杜龍 2026-11-26）。
  const frame = Platform.OS === "web" ? ({ position: "fixed", top: safe.top + barHeight, left: 0, right: 0, bottom: 0 } as object) : StyleSheet.absoluteFill;
  return (
    <View style={[frame, { zIndex: 40, backgroundColor: "#101010" }]}>
      <View style={{ paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#333", backgroundColor: "#101010" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={() => void onCancel()} style={{ minHeight: 48, minWidth: 84, paddingHorizontal: 16, borderRadius: 24, borderWidth: 2, borderColor: "#ff6b6b", alignItems: "center", justifyContent: "center" }}>
          <AppText {...UI_ONLY_TEXT} style={{ color: "#ff6b6b", fontWeight: "800", fontSize: 16 }}>取消</AppText>
        </Pressable>
        <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "800", fontSize: 18, textAlign: "center" }}>{title}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="儲存" disabled={saving} onPress={() => void onSave()} style={[{ minHeight: 48, minWidth: 84, paddingHorizontal: 16, borderRadius: 24, backgroundColor: "#0c603c", alignItems: "center", justifyContent: "center" }, saving && { opacity: 0.5 }]}>
          <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{saving ? "儲存中…" : "儲存"}</AppText>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60, gap: 16 }}>{children}</ScrollView>
      {overlay}
    </View>
  );
}

const chip = (label: string, on: boolean, onPress: () => void, key = label) => (
  <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: "center", backgroundColor: on ? "#2e7d32" : "#2e2e31" }}>
    <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{label}</AppText>
  </Pressable>
);

/**
 * 新增／修改一道食譜（杜杜龍 2026-11-26）：名稱、分類、照片（可一次選很多張，第一張＝封面）、一篇食譜文字（一鍵貼上整篇；獨立一行的 YouTube 網址＝影片卡片）。
 * 新增時先建一筆草稿（照片要有地方放）：按「儲存」才送出（管理者直接發佈、會員進待審核）；取消／放棄會刪掉草稿。有改動就離開（取消、上一頁、返回手勢）會問「儲存／放棄／繼續編輯」。
 */
export function RecipeEditor({ id, isNew, cats, manager, onClose, onCatsChanged, onDeleted }: { id: string; isNew: boolean; cats: RecipeCategory[]; manager: boolean; onClose: (saved: boolean) => void; onCatsChanged: () => void; /** 在編輯頁刪除這道食譜之後（呼叫端要把食譜頁一起關掉）。 */ onDeleted?: () => void }) {
  const thumb = useThumb();
  const detail = useApi<RecipeDetail>(isNew ? null : `/recipes/${id}`);
  const photos = useApi<CoverMediaItem[]>(`/cover-media?kind=course&key=${encodeURIComponent(`rcp:${id}`)}`);
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("");
  const [body, setBody] = useState("");
  const [init, setInit] = useState({ title: "", cat: "", body: "" });
  const [ready, setReady] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [yt, setYt] = useState<string | null>(null); // 插入影片連結的輸入列（null＝收起）
  const [newCat, setNewCat] = useState<string | null>(null);
  const [authorOpen, setAuthorOpen] = useState(false);

  useEffect(() => {
    const d = detail.data;
    if (ready || !d) return;
    setTitle(d.title);
    setCat(d.categoryId);
    setBody(d.body);
    setInit({ title: d.title, cat: d.categoryId, body: d.body });
    setReady(true);
  }, [detail.data, ready]);

  const photoList = (photos.data ?? []).filter((p) => p.kind === "image");
  const dirty = ready && (title !== init.title || cat !== init.cat || body !== init.body || (isNew && photoList.length > 0));

  const finish = (saved: boolean) => onClose(saved);
  const dropDraft = async () => {
    if (isNew) await api("DELETE", `/recipes/${id}`).catch(() => undefined);
  };
  const save = async (): Promise<boolean> => {
    if (!title.trim()) return void flashText("請輸入食譜名稱"), false;
    setBusy(true);
    try {
      const r = await api<RecipeDetail>("PUT", `/recipes/${id}`, { title, categoryId: cat, body, finish: true });
      flashText(r.status === "pending" ? "已送出，等待管理者審核" : "已儲存");
      return true;
    } catch (e) {
      flashText((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const removeRecipe = async () => {
    if (!(await confirmAsk("刪除食譜", `「${detail.data?.title ?? title}」與它的所有照片會一起刪除，無法復原。`, "刪除"))) return;
    try {
      await api("DELETE", `/recipes/${id}`);
      flashText("已刪除");
      (onDeleted ?? (() => finish(false)))();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const requestClose = async () => {
    if (busy) return;
    if (!dirty) {
      await dropDraft();
      return finish(false);
    }
    const pick = await choiceSheet({
      title: "有修改還沒儲存",
      message: "這道食譜的修改還沒有存檔。要儲存、放棄修改，還是繼續編輯？",
      options: [
        { key: "save", label: "儲存", variant: "primary" },
        { key: "discard", label: "放棄修改", variant: "dangerSolid" },
        { key: "stay", label: "繼續編輯", variant: "cancel" },
      ],
    });
    if (pick === "save") {
      if (await save()) finish(true);
    } else if (pick === "discard") {
      await dropDraft();
      finish(false);
    }
  };

  const insertAt = (text: string) => {
    const a = Math.min(sel.start, sel.end);
    const b = Math.max(sel.start, sel.end);
    const next = body.slice(0, a) + text + body.slice(b);
    setBody(next.slice(0, BODY_MAX));
    const at = a + text.length;
    setSel({ start: at, end: at });
  };
  const paste = async () => {
    try {
      const t = (await Clipboard.getStringAsync()).replace(/\r\n?/g, "\n");
      if (!t.trim()) return void flashText("剪貼簿裡沒有內容，請先複製食譜");
      // 名稱與文字都還是空的：第一行自動當作食譜名稱，其餘是食譜文字。
      if (!title.trim() && !body.trim()) {
        const lines = t.trim().split("\n");
        const first = lines[0]!.trim();
        if (lines.length > 1 && first.length <= TITLE_MAX && !youtubeIdOfLine(first)) {
          setTitle(first);
          setBody(lines.slice(1).join("\n").trim().slice(0, BODY_MAX));
          flashText("已貼上，並把第一行當作食譜名稱");
          return;
        }
      }
      insertAt(t);
    } catch {
      flashText("無法讀取剪貼簿，請長按文字框手動貼上");
    }
  };
  const addVideo = (raw: string) => {
    const link = raw.trim();
    if (!youtubeIdOfLine(link)) return void flashText("請貼上 YouTube 影片網址");
    const before = body.slice(0, Math.min(sel.start, sel.end));
    insertAt(`${before && !before.endsWith("\n") ? "\n" : ""}${link}\n`);
    setYt(null);
    flashText("已插入影片連結，看食譜時會變成影片卡片");
  };
  const pasteYt = async () => {
    try {
      setYt((await Clipboard.getStringAsync()).trim());
    } catch {
      flashText("無法讀取剪貼簿，請長按輸入框手動貼上");
    }
  };
  const addCategory = async () => {
    const name = (newCat ?? "").trim();
    if (!name) return void flashText("請輸入分類名稱");
    try {
      const r = await api<{ id: string }>("POST", "/recipes/categories", { name });
      onCatsChanged();
      setCat(r.id);
      setNewCat(null);
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const removePhoto = async (p: CoverMediaItem) => {
    if (!(await confirmSheet({ title: "刪除照片", message: "這張照片會從這道食譜移除。", confirmLabel: "刪除", danger: true }))) return;
    try {
      await api("DELETE", `/admin/cover-media/${p.id}`);
      photos.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const makeCover = async (p: CoverMediaItem) => {
    try {
      await api("POST", "/admin/cover-media/order", { kind: "course", key: `rcp:${id}`, ids: [p.id, ...photoList.filter((x) => x.id !== p.id).map((x) => x.id)] });
      photos.reload();
      flashText("已設為封面");
    } catch (e) {
      flashText((e as Error).message);
    }
  };

  const field = { borderWidth: 2, borderColor: "#2e7d32", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#fff", backgroundColor: "#0b0b0b" } as const;
  const label = (t: string, hint?: string) => (
    <AppText {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontSize: 14, fontWeight: "700" }}>{t}{hint ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontWeight: "400" }}>{`　${hint}`}</AppText> : null}</AppText>
  );
  const tool = (text: string, icon: string, onPress: () => void) => (
    <Pressable key={text} accessibilityRole="button" accessibilityLabel={text} onPress={onPress} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1f3d2d" }}>
      <Ionicons name={icon as never} size={18} color="#9fe3b8" {...UI_ONLY} />
      <AppText {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontSize: 15, fontWeight: "700" }}>{text}</AppText>
    </Pressable>
  );

  return (
    <RecipeFullPage title={isNew ? "新增食譜" : "修改食譜"} onCancel={requestClose} onSave={() => void save().then((ok) => ok && finish(true))} saving={busy} overlay={authorOpen && detail.data ? <AuthorSheet recipeId={id} current={detail.data.authorName} onClose={() => setAuthorOpen(false)} onChanged={() => (detail.reload(), onCatsChanged())} /> : null}>
      {!ready ? (
        <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>讀取中…</AppText>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            {label("食譜名稱", "必填")}
            <TextInput value={title} onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))} placeholder="例如：瑪格麗特披薩" placeholderTextColor="#6f6f75" accessibilityLabel="食譜名稱" style={field} />
          </View>
          <View style={{ gap: 6 }}>
            {label("分類")}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {chip("未分類", cat === "", () => setCat(""))}
              {cats.map((c) => chip(c.name, cat === c.id, () => setCat(c.id), c.id))}
              {manager ? chip("＋ 新分類", newCat !== null, () => setNewCat(newCat === null ? "" : null)) : null}
            </ScrollView>
            {newCat !== null ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={newCat} onChangeText={(t) => setNewCat(t.slice(0, CAT_MAX))} placeholder={`新分類名稱（最多 ${CAT_MAX} 字）`} placeholderTextColor="#6f6f75" autoFocus accessibilityLabel="新分類名稱" style={[field, { flex: 1 }]} />
                <Pressable accessibilityRole="button" onPress={() => void addCategory()} style={{ minHeight: 50, paddingHorizontal: 18, borderRadius: 12, backgroundColor: "#2e7d32", justifyContent: "center" }}>
                  <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>新增</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
          <View style={{ gap: 8 }}>
            {label("照片", "可一次選很多張，第一張是封面")}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {photoList.map((p, i) => (
                <View key={p.id} style={{ width: 96 }}>
                  <View style={{ width: 96, height: 96, borderRadius: 10, overflow: "hidden", backgroundColor: "#2e2e31" }}>
                    <Image source={{ uri: thumb(resolveUrl(p.url), 240) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
                    <Pressable accessibilityRole="button" accessibilityLabel="刪除這張照片" onPress={() => void removePhoto(p)} style={{ position: "absolute", top: 4, right: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={18} color="#fff" {...UI_ONLY} />
                    </Pressable>
                  </View>
                  {i === 0 ? <AppText {...UI_ONLY_TEXT} style={{ color: "#F5C842", fontSize: 13, textAlign: "center", marginTop: 4, fontWeight: "700" }}>封面</AppText> : (
                    <Pressable accessibilityRole="button" accessibilityLabel="設為封面" onPress={() => void makeCover(p)} style={{ minHeight: 32, justifyContent: "center" }}>
                      <AppText {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontSize: 13, textAlign: "center" }}>設為封面</AppText>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
            <AlbumUploadButton kind="course" ownerKey={`rcp:${id}`} count={photoList.length} onDone={() => photos.reload()} label={photoList.length ? "再加照片" : "上傳照片"} />
          </View>
          <View style={{ gap: 8 }}>
            {label("食譜文字", "只有一篇")}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {tool("貼上", "clipboard-outline", () => void paste())}
              {tool("插入影片連結", "logo-youtube", () => setYt(yt === null ? "" : null))}
              {body ? tool("清空", "trash-outline", () => void confirmSheet({ title: "清空食譜文字", message: "整篇文字會被清掉。", confirmLabel: "清空", danger: true }).then((ok) => ok && setBody(""))) : null}
            </View>
            {yt !== null ? (
              <View style={{ gap: 8, borderRadius: 12, backgroundColor: "#262629", padding: 10 }}>
                <AppText {...UI_ONLY_TEXT} style={{ color: "#cfcfd4", fontSize: 14 }}>貼上 YouTube 網址，會插在文字游標的位置（獨立一行）。</AppText>
                <TextInput value={yt} onChangeText={setYt} placeholder="https://youtu.be/…" placeholderTextColor="#6f6f75" autoCapitalize="none" autoCorrect={false} accessibilityLabel="YouTube 網址" style={field} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {tool("貼上網址", "clipboard-outline", () => void pasteYt())}
                  <Pressable accessibilityRole="button" onPress={() => addVideo(yt)} style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: "#2e7d32", justifyContent: "center" }}>
                    <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>插入</AppText>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <TextInput
              value={body}
              onChangeText={(t) => setBody(t.slice(0, BODY_MAX))}
              onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
              multiline
              textAlignVertical="top"
              placeholder={"從 LINE 或備忘錄複製整篇食譜後按「貼上」，或直接輸入。\n獨立一行的 YouTube 網址會變成影片卡片。"}
              placeholderTextColor="#6f6f75"
              accessibilityLabel="食譜文字"
              style={[field, { minHeight: 260, fontSize: 16, lineHeight: 26 }]}
            />
            <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 13, textAlign: "right" }}>{`${body.length} / ${BODY_MAX}`}</AppText>
          </View>
          {/* 管理（杜杜龍 2026-11-26，從單道食譜頁上方移到這裡）：更換上傳者（超級管理員）、刪除這道食譜（有權限者；新增中的草稿用「取消」就會丟掉，不顯示） */}
          {!isNew && (detail.data?.admin || detail.data?.canEdit) ? (
            <View style={{ gap: 10 }}>
              {label("管理", "")}
              {detail.data?.admin ? <ManageButton icon="person-circle-outline" text={`更換上傳者（目前：${detail.data.authorName || "沒有"}）`} onPress={() => setAuthorOpen(true)} /> : null}
              {detail.data?.canEdit ? <ManageButton danger icon="trash-outline" text="刪除這道食譜" onPress={() => void removeRecipe()} /> : null}
            </View>
          ) : null}
          {!manager && isNew ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 13, textAlign: "center" }}>會員投稿的食譜會先送給管理者審核，通過後所有人才看得到。</AppText> : null}
        </>
      )}
    </RecipeFullPage>
  );
}

function ManageButton({ icon, text, onPress, danger = false }: { icon: string; text: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onPress} style={{ minHeight: 52, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, backgroundColor: danger ? "#3a1c1c" : "#262629" }}>
      <Ionicons name={icon as never} size={22} color={danger ? "#ff8a80" : "#fff"} {...UI_ONLY} />
      <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: danger ? "#ff8a80" : "#fff", fontWeight: "700", fontSize: 16 }}>{text}</AppText>
    </Pressable>
  );
}

type AuthorHit = { sub: string; name: string; legalName: string; avatar: string | null; center: string };
/**
 * 更換食譜上傳者（只有超級管理員，杜杜龍 2026-11-26）：從行動大學已註冊的會員直接輸入名字挑選，暱稱與本名都能搜尋；
 * 換了以後，上傳者暱稱與所屬中心跟著變（中心取自會員中心，不能手動填）。本名只給超級管理員在這裡辨識同名的人，不存進資料庫。
 */
function AuthorSheet({ recipeId, current, onClose, onChanged }: { recipeId: string; current: string; onClose: () => void; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AuthorHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) return void setHits(null);
    let alive = true;
    const timer = setTimeout(() => {
      api<{ members: AuthorHit[] }>("GET", `/admin/recipe-authors?q=${encodeURIComponent(t)}`)
        .then((r) => alive && setHits(r.members))
        .catch((e: Error) => alive && (setHits([]), flashText(e.message)));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);
  const pick = async (m: AuthorHit) => {
    if (busy) return;
    if (!(await confirmAsk("更換上傳者", `這道食譜的上傳者改成「${m.name}」？所屬中心會跟著換成他的中心。`, "更換"))) return;
    setBusy(true);
    try {
      await api("PUT", `/admin/recipes/${recipeId}/author`, { sub: m.sub, name: m.name });
      flashText(`已更換上傳者為「${m.name}」`);
      onChanged();
      onClose();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <RecipeSheet title="更換上傳者" onClose={onClose}>
      <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14 }}>{`目前上傳者：${current || "（沒有）"}。暱稱可以搜尋所有會員中心的會員（2 個字以上）；本名只找得到用過行動大學的會員。`}</AppText>
      <TextInput value={q} onChangeText={setQ} autoFocus placeholder="輸入暱稱或本名" placeholderTextColor="#6f6f75" accessibilityLabel="搜尋會員" style={{ borderWidth: 2, borderColor: "#2e7d32", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#fff", backgroundColor: "#0b0b0b" }} />
      {q.trim() && hits === null ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>搜尋中…</AppText> : null}
      {hits && !hits.length ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>找不到符合的會員</AppText> : null}
      {(hits ?? []).map((m) => (
        <Pressable key={m.sub} accessibilityRole="button" accessibilityLabel={`選擇 ${m.name}`} onPress={() => void pick(m)} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderRadius: 12, backgroundColor: "#262629", paddingHorizontal: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, overflow: "hidden", backgroundColor: "#3a3a3d", alignItems: "center", justifyContent: "center" }}>
            {m.avatar ? <Image source={{ uri: m.avatar }} style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors /> : <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800" }}>{m.name.slice(0, 1)}</AppText>}
          </View>
          <View style={{ flex: 1 }}>
            <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{m.name}</AppText>
            {m.center ? <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#9fe3b8", fontSize: 13 }}>{centerTitle(m.center)}</AppText> : null}
            {m.legalName ? <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 13 }}>{`本名：${m.legalName}`}</AppText> : null}
          </View>
        </Pressable>
      ))}
    </RecipeSheet>
  );
}

