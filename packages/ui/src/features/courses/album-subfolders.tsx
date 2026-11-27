import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { api, resolveUrl, type AlbumSubfolders } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { AppText } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import { Sheet } from "./album-admin";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

/**
 * 區塊相簿的子資料夾【共用模組】（杜杜龍 2026-11-26，照互動示意）：相簿瀏覽器（`LightboxLibrary`，深色）與課程卡「相簿」分頁（`BlockAlbum`，淺色）共用同一份資料與同一組操作。
 * 規則：只有區塊相簿有、最多一層；沒分資料夾的照片是「未分類」；資料夾按張數多到少排、「未分類」固定最後；名稱最多 20 字、同一區塊不可重複；刪除資料夾＝照片回到未分類。
 * 有權限的人（管理員、獎銜達標者）才能建立／重新命名／刪除／移動（`canManage` 由伺服器給）。
 */
export const FOLDER_NAME_MAX = 20;

export function useSubfolders(key: string | null | undefined) {
  const r = useApi<AlbumSubfolders>(key ? `/albums/subfolders?key=${encodeURIComponent(key)}` : null);
  return { subs: r.data, reload: r.reload, loading: r.loading };
}

export type FolderSheetState = null | { t: "new"; move: boolean } | { t: "move" } | { t: "menu"; id: string } | { t: "rename"; id: string } | { t: "manage" };

/** 資料夾操作（呼叫伺服器；失敗用一句話提示）。 */
export function useFolderActions(blockKey: string, done: () => void) {
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const r = await fn();
      done();
      return r;
    } catch (e) {
      flashText((e as Error).message);
      return null;
    }
  };
  return {
    create: (name: string) => run(() => api<{ id: string }>("POST", "/admin/album-folders", { key: blockKey, name })),
    rename: (id: string, name: string) => run(() => api("PUT", `/admin/album-folders/${id}`, { name })),
    remove: (id: string) => run(() => api("DELETE", `/admin/album-folders/${id}`)),
    move: (ids: string[], folderId: string | null) => run(() => api("POST", "/admin/album-folders/move", { key: blockKey, ids, folderId: folderId ?? "" })),
  };
}

/** 4 格預覽（資料夾卡與標籤旁的縮圖共用）。 */
export function Mosaic({ thumbs, size, radiusPx = 9 }: { thumbs: string[]; size: number; radiusPx?: number }) {
  const thumb = useThumb();
  const half = Math.floor((size - 2) / 2);
  return (
    <View style={{ width: size, height: size, borderRadius: radiusPx, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2, backgroundColor: "#1a1a1c" }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: half, height: half, backgroundColor: "#2e2e31" }}>
          {thumbs[i] ? <Image source={{ uri: thumb(resolveUrl(thumbs[i]!), 200) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * 子資料夾的面板（新增、移到、選項、重新命名、管理清單）：dark＝疊在全黑相簿畫面上（`album-admin` 的 `Sheet`）；淺色＝課程頁的 `BottomSheet`。
 * 面板狀態由呼叫端持有（`sheet`／`setSheet`），selIds＝要移動的照片編號（「移到」用）。
 */
export function SubfolderSheet(p: { sheet: FolderSheetState; setSheet: (s: FolderSheetState) => void; blockKey: string; subs: AlbumSubfolders | undefined; selIds: string[]; dark: boolean; onChanged: () => void; onMoved?: () => void }) {
  if (!p.sheet) return null;
  const k = p.sheet.t === "menu" || p.sheet.t === "rename" ? `${p.sheet.t}${p.sheet.id}` : p.sheet.t;
  return <SheetBody key={k} {...p} sheet={p.sheet} />;
}

function SheetBody({ sheet, setSheet, blockKey, subs, selIds, dark, onChanged, onMoved }: { sheet: NonNullable<FolderSheetState>; setSheet: (s: FolderSheetState) => void; blockKey: string; subs: AlbumSubfolders | undefined; selIds: string[]; dark: boolean; onChanged: () => void; onMoved?: () => void }) {
  const { c } = useTheme();
  const act = useFolderActions(blockKey, onChanged);
  const folders = subs?.folders ?? [];
  const target = sheet.t === "rename" || sheet.t === "menu" ? folders.find((f) => f.id === sheet.id) : undefined;
  const [name, setName] = useState(sheet.t === "rename" ? (target?.name ?? "") : "");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const onClose = () => setSheet(null);
  const rowStyle = dark ? { backgroundColor: "#262629" } : { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border };
  const fg = dark ? "#fff" : c.text;
  const muted = dark ? "#9a9aa0" : c.textMuted;
  const row = (label: string, onPress: () => void, o: { danger?: boolean; right?: string; icon?: string } = {}) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={[{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, borderRadius: dark ? 10 : radius.md, paddingHorizontal: 14, marginBottom: 8 }, rowStyle]}>
      <Ionicons name={(o.icon ?? "folder-outline") as never} size={20} color={o.danger ? "#ff8a80" : fg} {...UI_ONLY} />
      <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: o.danger ? "#ff8a80" : fg, fontSize: 16, fontWeight: "700" }}>{label}</AppText>
      {o.right ? <AppText {...UI_ONLY_TEXT} style={{ color: muted, fontSize: 14 }}>{o.right}</AppText> : null}
    </Pressable>
  );
  const finish = (msg: string) => {
    flashText(msg);
    onMoved?.();
    onClose();
  };
  const doMove = async (fid: string | null, label: string) => {
    if (await act.move(selIds, fid)) finish(`已移動 ${selIds.length} 張到「${label}」`);
  };
  let title = "";
  let body: ReactNode = null;
  if (sheet.t === "move") {
    title = "移到資料夾";
    body = (
      <>
        {folders.map((f) => row(f.name, () => void doMove(f.id, f.name), { right: String(f.count) }))}
        {row("未分類（移出資料夾）", () => void doMove(null, "未分類"), { right: String(subs?.uncat.count ?? 0) })}
        {row("＋ 新增資料夾…", () => setSheet({ t: "new", move: true }), { icon: "add-circle-outline" })}
      </>
    );
  } else if (sheet.t === "new" || sheet.t === "rename") {
    title = sheet.t === "new" ? "新增資料夾" : "重新命名";
    const go = async () => {
      const v = name.trim();
      if (!v) return setErr("請輸入名稱");
      if (v === "未分類") return setErr("不能叫「未分類」");
      if (folders.some((f) => f.name === v && f.id !== target?.id)) return setErr("這個區塊已經有同名的資料夾");
      if (sheet.t === "rename") {
        if (await act.rename(sheet.id, v)) finish(`已重新命名為「${v}」`);
        return;
      }
      const r = await act.create(v);
      if (!r) return;
      if (sheet.move && selIds.length) {
        if (await act.move(selIds, r.id)) finish(`已移動 ${selIds.length} 張到新資料夾「${v}」`);
      } else finish(`已建立資料夾「${v}」`);
    };
    body = (
      <>
        <TextInput
          value={name}
          onChangeText={(t) => (setName(t), setErr(""))}
          maxLength={FOLDER_NAME_MAX}
          placeholder={`資料夾名稱（最多 ${FOLDER_NAME_MAX} 字）`}
          placeholderTextColor={muted}
          accessibilityLabel="資料夾名稱"
          autoFocus
          style={[{ minHeight: 50, borderRadius: dark ? 10 : radius.md, paddingHorizontal: 12, fontSize: 16, color: fg, marginBottom: 6 }, dark ? { backgroundColor: "#0f0f10", borderWidth: 1, borderColor: "#3a3a3f" } : { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }]}
        />
        <AppText {...UI_ONLY_TEXT} style={{ color: "#ff8a80", fontSize: 13, minHeight: 20, marginBottom: 6 }}>{err}</AppText>
        {row(sheet.t === "new" ? (sheet.move ? "建立並移入選取的照片" : "建立") : "儲存", () => void go(), { icon: "checkmark-circle-outline" })}
      </>
    );
  } else if (sheet.t === "menu") {
    title = target?.name ?? "資料夾";
    body = confirmDel ? (
      <>
        <AppText {...UI_ONLY_TEXT} style={{ color: muted, fontSize: 14, marginBottom: 10 }}>{`刪除「${target?.name}」？裡面的 ${target?.count ?? 0} 張照片會回到「未分類」，不會刪除照片。`}</AppText>
        {row("確定刪除資料夾", async () => { if (target && (await act.remove(target.id))) finish("已刪除資料夾，照片已回到「未分類」"); }, { danger: true, icon: "trash-outline" })}
        {row("取消", () => setConfirmDel(false), { icon: "close-outline" })}
      </>
    ) : (
      <>
        {row("重新命名", () => setSheet({ t: "rename", id: sheet.id }), { icon: "create-outline" })}
        {row(`刪除資料夾（${target?.count ?? 0} 張照片回到未分類）`, () => setConfirmDel(true), { danger: true, icon: "trash-outline" })}
      </>
    );
  } else {
    title = "管理資料夾";
    body = (
      <>
        {folders.map((f) => row(f.name, () => setSheet({ t: "menu", id: f.id }), { right: `${f.count}・設定` }))}
        {row("＋ 新增資料夾", () => setSheet({ t: "new", move: false }), { icon: "add-circle-outline" })}
      </>
    );
  }
  return dark ? (
    <Sheet title={title} onClose={onClose}>{body}</Sheet>
  ) : (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">{title}</AppText>
      <SheetScroll>{body}</SheetScroll>
    </BottomSheet>
  );
}

/**
 * 區塊相簿的資料夾總覽（相簿瀏覽器用，深色）：兩欄資料夾卡（4 格預覽、名稱、張數；有管理權限的有 ⋯ 選項）＋「＋新增資料夾」＋「未分類」。
 * 資料夾已由伺服器按張數多到少排，「未分類」固定最後。
 */
export function SubfolderHome({ subs, onOpen, onNew, onMenu, bottomPad }: { subs: AlbumSubfolders; onOpen: (id: string) => void; onNew: () => void; onMenu: (id: string) => void; bottomPad: number }) {
  const [w, setW] = useState(0);
  const gap = 12;
  const cw = w ? Math.floor((w - gap) / 2) : 0;
  const card = (key: string, label: string, count: number, thumbs: string[], onPress: () => void, menu?: () => void) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${label}，${count} 張`} onPress={onPress} style={{ width: cw, backgroundColor: "#1c1c1f", borderRadius: 14, padding: 10, gap: 8 }}>
      <Mosaic thumbs={thumbs} size={cw - 20} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText numberOfLines={2} {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{label}</AppText>
          <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 13 }}>{`${count} 張`}</AppText>
        </View>
        {menu ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label} 選項`} onPress={menu} hitSlop={6} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" }}>
            <Ionicons name="ellipsis-horizontal" size={20} color="#fff" {...UI_ONLY} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      {cw ? (
        <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap, paddingBottom: bottomPad }}>
          {subs.folders.map((f) => card(f.id, f.name, f.count, f.thumbs, () => onOpen(f.id), subs.canManage ? () => onMenu(f.id) : undefined))}
          {subs.canManage ? (
            <Pressable accessibilityRole="button" accessibilityLabel="新增資料夾" onPress={onNew} style={{ width: cw, minHeight: 150, borderRadius: 14, borderWidth: 2, borderStyle: "dashed", borderColor: "#4a4a50", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Ionicons name="add-circle-outline" size={34} color="#cfcfd4" {...UI_ONLY} />
              <AppText {...UI_ONLY_TEXT} style={{ color: "#cfcfd4", fontWeight: "800", fontSize: 15 }}>新增資料夾</AppText>
            </Pressable>
          ) : null}
          {subs.uncat.count ? card("uncat", "未分類", subs.uncat.count, subs.uncat.thumbs, () => onOpen("")) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}
