import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card } from "@/ui";
import { CoverAlbum } from "./album";

/** 有照片的區塊（相簿分頁、「瀏覽本區照片」都以這份為準）。 */
export const albumBlocks = (course: CourseDetail): Lesson[] => course.lessons.filter((l) => l.section && !!l.photoKey && !!l.photos?.length);
export const albumTotal = (course: CourseDetail) => albumBlocks(course).reduce((n, l) => n + (l.photos?.length ?? 0), 0);

/**
 * 相簿分頁（業主 2026-11-24）：不論照片存在哪個區塊，全部彙整在這裡，用區塊名稱當簡易分類標題，預設全部收起；一次展開一個。
 * 「瀏覽本區照片」（區塊第一列）跳到這裡：openId＝要自動展開並捲到的區塊。照片格與中心 EDM 相簿同一個元件（CoverAlbum）。
 */
export function BlockAlbum({ course, openId, onChanged }: { course: CourseDetail; openId?: string | null; onChanged?: () => void }) {
  const { c } = useTheme();
  const groups = albumBlocks(course);
  const [open, setOpen] = useState<string | null>(openId ?? null);
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
      {groups.map((g) => {
        const on = open === g.id;
        return (
          <Card key={g.id} style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
            <View nativeID={`alb-${g.id}`}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${g.title}，${g.photos!.length} 張照片，${on ? "點一下收合" : "點一下展開"}`} onPress={() => setOpen(on ? null : g.id)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52 }}>
                <Ionicons name="images-outline" size={20} color={c.accentText} />
                <AppText variant="headline" numberOfLines={2} style={{ flex: 1, fontWeight: "800" }}>
                  {g.title}
                </AppText>
                <AppText variant="callout" tone="muted">{`${g.photos!.length} 張`}</AppText>
                <Ionicons name={on ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
              </Pressable>
              {on ? (
                <View style={{ paddingBottom: space.sm }}>
                  <CoverAlbum kind="course" ownerKey={g.photoKey!} title={g.title} items={g.photos!} canEdit={!!course.can?.edit} onChanged={onChanged ?? (() => undefined)} />
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

/** 區塊展開後第一列「瀏覽本區照片」：點一下跳到相簿分頁、自動展開這個區塊。 */
export function BrowsePhotosRow({ head, onPress }: { head: Lesson; onPress: () => void }) {
  const { c } = useTheme();
  const n = head.photos?.length ?? 0;
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
