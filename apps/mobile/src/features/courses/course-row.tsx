import { router } from "expo-router";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { centerTitle, eventDays } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { BrandCover, AppText, CountPill, CourseCover } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";
import { styles } from "./chapter-list";
import { shareLink } from "@/lib/share";
import { RowShare } from "./lesson-list";
import { ribbonsFor } from "./ribbons";
import { displayName } from "./sort";

/** 連在一起的清單列（業主 2026-11-19）：沒有外框、沒有圓角、列與列之間不留空，只有一條細分隔線（同教材清單、課程章節清單）；外層放進同一張 Card。 */
const joined = { borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 0, marginBottom: 0, paddingHorizontal: 0, paddingVertical: space.sm, backgroundColor: "transparent" } as const;

/**
 * 系列頁（顯示全部）的課程列：版型與「單元」模式的窄列完全相同（左邊 16:9 縮圖，右邊文字），高度比課程卡矮很多。
 * 標題＝活動日期（同系列的課名通常一樣，用日期區分），下方是課程名稱與狀態（可以報名、倒數、學習中…）。
 */
export function CourseRow({ course, last }: { course: CourseSummary; last?: boolean }) {
  const { c } = useTheme();
  const { member } = useSession();
  const { config } = useUiConfig();
  const thumb = useThumb();
  useCenterNames();
  const r = ribbonsFor(course, member, config);
  const rb = r.left ?? r.right;
  const date = course.eventStart && !course.isList ? eventDays(course.eventStart, course.eventEnd) : "";
  const img = course.coverUrl || course.edmUrl;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${date} ${course.title}`} onPress={() => router.push(`/course/${course.id}`)} style={[styles.row, joined, { borderBottomColor: c.border }, last && { borderBottomWidth: 0 }, ...(course.materialCount === 0 ? fadedStyle : []), course.seriesHidden && { opacity: 0.4 }]}>
      <View style={styles.thumb}>
        {course.brand ? <BrandCover brand={course.brand} fill /> : img ? <Image source={{ uri: thumb(resolveUrl(img), 96) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <CourseCover theme={course.theme} label="" title={displayName(course)} fill />}
      </View>
      <View style={styles.mid}>
        <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={2}>
          {course.title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {date || (course.hostCenter ? centerTitle(course.hostCenter) : "")}
        </AppText>
        {rb ? (
          <View style={[styles.chip, { backgroundColor: rb.bg }]}>
            <AppText variant="caption" style={{ color: rb.fg, fontWeight: "800" }} numberOfLines={1}>
              {rb.label}
            </AppText>
          </View>
        ) : null}
      </View>
      <CountPill count={course.materialCount} />
      <RowShare label={`分享：${course.title}`} onShare={() => shareLink(course.title, course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`, course.isList ? undefined : { teacher: course.teacher, teacherTitle: course.teacherTitle, title: course.title }, undefined, undefined, course.isList ? { title: course.title } : undefined)} />
    </Pressable>
  );
}
