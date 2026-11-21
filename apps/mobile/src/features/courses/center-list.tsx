import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { shareLink } from "@/lib/share";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, BrandCover, Card } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";
import { RowShare } from "./lesson-list";

/**
 * 中心頁「清單」分頁（業主 2026-11-21，格式比照教材清單）：一張卡，一列一張 EDM 卡片，兩行緊密排列——
 * 第一行課程標題、第二行「日期 主講人 獎銜」；左側封面縮圖（左右留邊）、右側分享鈕；點一列進該卡片。
 * （業主 2026-11-21：卡片上方的「中心名稱＋教材數量」標題已刪除，所以 title 參數不再顯示。）
 */
export function CenterListCard({ courses }: { title?: string; courses: CourseSummary[] }) {
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {courses.map((course) => (
        <CenterListRow key={course.id} course={course} />
      ))}
    </Card>
  );
}

function CenterListRow({ course }: { course: CourseSummary }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const img = course.coverUrl || course.edmUrl;
  const date = course.eventStart && !course.isList ? eventDays(course.eventStart, course.eventEnd) : undefined;
  const who = [course.teacher, course.teacherRankName].filter(Boolean).join(" ");
  const share = () => shareLink(course.title, course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`, course.isList ? undefined : { teacher: course.teacher, teacherTitle: course.teacherTitle, title: course.title }, undefined, undefined, course.isList ? { title: course.title } : undefined);
  return (
    <View style={course.materialCount === 0 ? fadedStyle : undefined}>
      <Pressable onPress={() => router.push(`/course/${course.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.row, { borderBottomColor: c.border }, pressed && { opacity: 0.7 }]}>
        <View style={styles.thumb}>
          {course.brand ? <BrandCover brand={course.brand} fill /> : img ? <Image source={{ uri: thumb(resolveUrl(img), 160) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }]}><Ionicons name="school-outline" size={22} color={c.accent} /></View>}
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="headline" numberOfLines={1} style={styles.tight}>
            {course.title}
          </AppText>
          {date || who ? (
            <AppText variant="callout" tone="muted" numberOfLines={1} style={styles.tight}>
              {date ? <Text style={[styles.chip, { backgroundColor: c.accentSoft, color: c.accentText }]}>{` ${date} `}</Text> : null}
              {date && who ? "  " : ""}
              {who}
            </AppText>
          ) : null}
        </View>
        <RowShare label={`分享：${course.title}`} onShare={share} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 5, paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 56, height: 36, borderRadius: 6, overflow: "hidden", backgroundColor: "#fff" },
  tight: { lineHeight: 20 },
  chip: { fontSize: 12, lineHeight: 18, fontWeight: "700", borderRadius: 9, overflow: "hidden" },
});
