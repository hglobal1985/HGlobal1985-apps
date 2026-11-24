import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, Card } from "@/ui";
import { LockMask } from "@/ui";
import { blockPhotoCount } from "./block-photos";
import { CoverAlbum } from "./album";

/** 有照片的區塊（相簿分頁、「瀏覽本區照片」都以這份為準）。 */
export const albumBlocks = (course: CourseDetail): Lesson[] => course.lessons.filter((l) => l.section && !!l.photoKey && blockPhotoCount(l) > 0);
export const albumTotal = (course: CourseDetail) => albumBlocks(course).reduce((n, l) => n + blockPhotoCount(l), 0);

/**
 * 相簿分頁（業主 2026-11-24）：不論照片存在哪個區塊，全部彙整在這裡，用區塊名稱當簡易分類標題，預設全部收起；一次展開一個。
 * 「瀏覽本區照片」（區塊第一列）跳到這裡：openId＝要自動展開並捲到的區塊。照片格與中心 EDM 相簿同一個元件（CoverAlbum）。
 */
export function BlockAlbum({ course, openId, onChanged }: { course: CourseDetail; openId?: string | null; onChanged?: () => void }) {
  const { c } = useTheme();
  const all = albumBlocks(course);
  const [open, setOpen] = useState<string | null>(openId ?? null);
  // 場景搜尋（業主 2026-11-24）：AI 辨識出的行為、場景、物品標籤；有搜尋時只列出符合的照片，符合的區塊自動展開。
  const [q, setQ] = useState("");
  const key = q.trim().toLowerCase();
  const hasScene = all.some((g) => g.photos!.some((p) => p.scene));
  const groups = key ? all.map((g) => ({ ...g, photos: g.photos!.filter((p) => (p.scene ?? "").toLowerCase().includes(key)) })).filter((g) => g.photos.length) : all;
  useEffect(() => {
    if (!openId) return;
    setOpen(openId);
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const t = setTimeout(() => document.getElementById(`alb-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return () => clearTimeout(t);
  }, [openId]);
  if (!groups.length) return <AppText tone="muted">還沒有照片</AppText>;
  return (
    <View style={{ gap: space.sm }}>
      {hasScene ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accent }}>
            <AppText variant="caption" style={{ color: c.textOnAccent, fontWeight: "800" }}>場景</AppText>
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="搜尋照片裡的場景、行為、物品" placeholderTextColor={c.textMuted} accessibilityLabel="搜尋照片場景" style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: space.md, color: c.text, backgroundColor: c.surface, ...type.body }} />
        </View>
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
              {on && g.blockLocked ? (
                <View style={{ position: "relative", minHeight: 200, marginBottom: space.sm }}>
                  <LockMask lines={g.lockLines ?? ["目前無法使用"]} />
                </View>
              ) : on ? (
                <View style={{ paddingBottom: space.sm, gap: space.sm }}>
                  {sceneTags(g.photos!).length ? <AppText variant="caption" tone="muted">{`場景：${sceneTags(g.photos!).join("、")}`}</AppText> : null}
                  <CoverAlbum kind="course" ownerKey={g.photoKey!} title={g.title} items={g.photos!} canEdit={!!course.can?.edit && !key} onChanged={onChanged ?? (() => undefined)} />
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
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
