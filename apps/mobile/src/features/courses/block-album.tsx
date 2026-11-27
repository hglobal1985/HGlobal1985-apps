import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Card } from "@/ui";
import { LockMask } from "@/ui";
import { blockPhotoCount } from "./block-photos";
import { CoverAlbum } from "@/features/courses/album";
import { trackUsage } from "@/lib/usage";
import { SubfolderSheet, useSubfolders, type FolderSheetState } from "@/features/courses/album-subfolders";
import { AlbumSearchBar, albumSearchable, matchAlbumItem, useAlbumSearch } from "@/features/courses/album-search";

/** 有照片的區塊（相簿分頁、「瀏覽本區照片」都以這份為準）。 */
export const albumBlocks = (course: CourseDetail): Lesson[] => course.lessons.filter((l) => l.section && !!l.photoKey && blockPhotoCount(l) > 0);
export const albumTotal = (course: CourseDetail) => albumBlocks(course).reduce((n, l) => n + blockPhotoCount(l), 0);

/**
 * 相簿分頁（杜杜龍 2026-11-24）：不論照片存在哪個區塊，全部彙整在這裡，用區塊名稱當簡易分類標題，預設全部收起；一次展開一個。
 * 「瀏覽本區照片」（區塊第一列）跳到這裡：openId＝要自動展開並捲到的區塊。照片格與中心 EDM 相簿同一個元件（CoverAlbum）。
 */
export function BlockAlbum({ course, openId, onChanged }: { course: CourseDetail; openId?: string | null; onChanged?: () => void }) {
  const { c } = useTheme();
  const all = albumBlocks(course);
  const [open, setOpen] = useState<string | null>(openId ?? null);
  // 場景搜尋（杜杜龍 2026-11-24）：AI 辨識出的行為、場景、物品標籤；有搜尋時只列出符合的照片，符合的區塊自動展開。
  // 搜尋改用共用模組 album-search.tsx（場景標籤＋照片裡的文字 OCR；杜杜龍 2026-11-25，與中心 EDM 一致）。
  const { q, setQ, key, sem } = useAlbumSearch();
  const hasScene = all.some((g) => albumSearchable(g.photos!));
  const groups = key ? all.map((g) => ({ ...g, photos: g.photos!.filter((p) => matchAlbumItem(p, key, sem)) })).filter((g) => g.photos.length) : all;
  useEffect(() => {
    if (!openId) return;
    setOpen(openId);
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const t = setTimeout(() => document.getElementById(`alb-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return () => clearTimeout(t);
  }, [openId]);
  if (!all.length) return <AppText tone="muted">還沒有照片</AppText>;
  return (
    <View style={{ gap: space.sm }}>
      {hasScene ? (
        <AlbumSearchBar q={q} setQ={setQ} />
      ) : null}
      {key && !groups.length ? <AppText tone="muted">沒有符合的照片</AppText> : null}
      {groups.map((g) => {
        const on = key ? true : open === g.id;
        return (
          <Card key={g.id} style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
            <View nativeID={`alb-${g.id}`}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${g.title}，${blockPhotoCount(g)} 張照片，${on ? "點一下收合" : "點一下展開"}`} onPress={() => (key ? undefined : setOpen(on ? null : g.id))} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52 }}>
                <Ionicons name="images-outline" size={20} color={c.accentText} />
                <AppText variant="headline" numberOfLines={2} style={{ flex: 1, fontWeight: "800" }}>
                  {g.title}
                </AppText>
                <AppText variant="callout" tone="muted">{`${blockPhotoCount(g)} 張`}</AppText>
                <Ionicons name={on ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
              </Pressable>
              {on ? (
                <View style={{ paddingBottom: space.sm, gap: space.sm, ...(g.blockLocked ? { position: "relative", minHeight: 200, overflow: "hidden", borderRadius: radius.md } : {}) }}>
                  {/* 沒有權限：照樣顯示全部預覽縮圖，上面蓋鎖頭遮罩＋原因（LockMask，與課程沒報名同一個模組；杜杜龍 2026-11-24）。 */}
                  {sceneTags(g.photos!).length ? <AppText variant="caption" tone="muted">{`場景：${sceneTags(g.photos!).join("、")}`}</AppText> : null}
                  <BlockBody group={g} canEdit={!!course.can?.edit && !key} searching={!!key} onChanged={onChanged ?? (() => undefined)} />
                  {/* 遮罩一定要放在最後一個子元素才蓋得住上面的縮圖（LockMask 的用法）。 */}
                  {g.blockLocked ? <LockMask lines={g.lockLines ?? ["目前無法使用"]} /> : null}
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

/**
 * 區塊相簿的內容（杜杜龍 2026-11-26，與相簿瀏覽器共用子資料夾資料與面板 `album-subfolders.tsx`）：
 * 有子資料夾時，照片上方多一排標籤「全部／各資料夾（按張數多到少）／未分類」；有權限者多「＋新增」「管理」，每張照片可「移到資料夾」。
 * 只有「全部」標籤可排序／刪除（排序是整本的順序）。
 */
function BlockBody({ group: g, canEdit, searching, onChanged }: { group: Lesson; canEdit: boolean; searching: boolean; onChanged: () => void }) {
  const { c } = useTheme();
  const { subs, reload } = useSubfolders(g.photoKey);
  const [chip, setChip] = useState<string>("all"); // all／""（未分類）／資料夾編號
  const [sheet, setSheet] = useState<FolderSheetState>(null);
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const folders = subs?.folders ?? [];
  const manage = !!subs?.canManage && !searching;
  const shownChip = chip === "all" || (chip !== "" && !folders.some((f) => f.id === chip)) ? "all" : chip === "" && !subs?.uncat.count ? "all" : chip;
  const items = shownChip === "all" ? g.photos! : g.photos!.filter((p) => (p.folderId ?? "") === shownChip);
  const done = () => (reload(), onChanged());
  const pill = (id: string, label: string, n: number | null, on: boolean, onPress: () => void, icon?: string) => (
    <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={n === null ? label : `${label}，${n} 張`} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: on ? c.accent : c.surfaceMuted }}>
      {icon ? <Ionicons name={icon as never} size={16} color={on ? "#fff" : c.accentText} /> : null}
      <AppText variant="callout" style={{ color: on ? "#fff" : c.text, fontWeight: "800" }}>{label}</AppText>
      {n !== null ? <AppText variant="caption" style={{ color: on ? "#fff" : c.textMuted }}>{n}</AppText> : null}
    </Pressable>
  );
  const hasChips = folders.length > 0 && !searching;
  return (
    <View style={{ gap: space.sm }}>
      {hasChips || manage ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {hasChips ? pill("all", "全部", g.photos!.length, shownChip === "all", () => setChip("all")) : null}
          {hasChips ? folders.map((f) => pill(f.id, f.name, f.count, shownChip === f.id, () => setChip(f.id))) : null}
          {hasChips && subs!.uncat.count ? pill("uncat", "未分類", subs!.uncat.count, shownChip === "", () => setChip("")) : null}
          {manage ? pill("new", "新增", null, false, () => setSheet({ t: "new", move: false }), "add") : null}
          {manage && folders.length ? pill("manage", "管理", null, false, () => setSheet({ t: "manage" }), "settings-outline") : null}
        </ScrollView>
      ) : null}
      <CoverAlbum kind="course" ownerKey={g.photoKey!} title={g.title} items={items} canEdit={canEdit && shownChip === "all"} onChanged={onChanged} onMovePhoto={manage ? (id) => (setMoveIds([id]), setSheet({ t: "move" })) : undefined} />
      <SubfolderSheet dark={false} sheet={sheet} setSheet={setSheet} blockKey={g.photoKey!} subs={subs} selIds={moveIds} onChanged={done} onMoved={() => (trackUsage("album_move", "課程相簿分頁"), setMoveIds([]))} />
    </View>
  );
}

/** 這批照片的場景標籤（不重複，最多 8 個）。 */
const sceneTags = (items: { scene?: string }[]) => [...new Set(items.flatMap((p) => (p.scene ?? "").split("，").filter(Boolean)))].slice(0, 8);

/** 區塊展開後第一列「瀏覽本區照片」：點一下跳到相簿分頁、自動展開這個區塊。 */
export function BrowsePhotosRow({ head, onPress }: { head: Lesson; onPress: () => void }) {
  const { c } = useTheme();
  const n = blockPhotoCount(head);
  if (!head.photoKey || !n) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`瀏覽本區照片，共 ${n} 張`} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: space.md, backgroundColor: c.accentSoft }}>
      <Ionicons name="images-outline" size={20} color={c.accentText} />
      <AppText variant="headline" style={{ flex: 1, color: c.accentText, fontWeight: "800" }}>
        瀏覽本區照片
      </AppText>
      <AppText variant="callout" style={{ color: c.accentText }}>{`${n} 張`}</AppText>
      <Ionicons name="chevron-forward" size={18} color={c.accentText} />
    </Pressable>
  );
}
