import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { shareLink } from "@/lib/share";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, BrandCover, Card, CountPill, ListRow } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";
import { RowShare } from "./lesson-list";

/**
 * 中心頁「清單」分頁（業主 2026-11-21，格式比照教材清單）：一張卡，上方標題＋數量，下面一列一張 EDM 卡片——
 * 左側封面縮圖、日期膠囊接在標題最前面、標題最多 2 行、右側分享鈕；點一列進該卡片。
 */
export function CenterListCard({ title, courses }: { title: string; courses: CourseSummary[] }) {
  const { c } = useTheme();
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      <View style={[styles.head, { borderBottomColor: c.border }]}>
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </AppText>
        <CountPill count={courses.length} />
      </View>
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
  const share = () => shareLink(course.title, course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`, course.isList ? undefined : { teacher: course.teacher, teacherTitle: course.teacherTitle, title: course.title }, undefined, undefined, course.isList ? { title: course.title } : undefined);
  return (
    <View style={course.materialCount === 0 ? fadedStyle : undefined}>
      <ListRow
        compact
        leading={
          <View style={styles.thumb}>
            {course.brand ? <BrandCover brand={course.brand} fill /> : img ? <Image source={{ uri: thumb(resolveUrl(img), 160) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }]}><Ionicons name="school-outline" size={22} color={c.accent} /></View>}
          </View>
        }
        note=""
        title={course.title}
        titleLines={2}
        dateChip={date}
        right={<RowShare label={`分享：${course.title}`} onShare={share} />}
        onPress={() => router.push(`/course/${course.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 56, height: 36, borderRadius: 6, overflow: "hidden", backgroundColor: "#fff" },
});
