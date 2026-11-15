import { router } from "expo-router";
import { Image, Pressable, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { centerTitle, eventDays } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { AppText, CourseCover } from "@/ui";
import { styles } from "./chapter-list";
import { ribbonsFor } from "./ribbons";

/**
 * 系列頁（顯示全部）的課程列：版型與「單元」模式的窄列完全相同（左邊 16:9 縮圖，右邊文字），高度比課程卡矮很多。
 * 標題＝活動日期（同系列的課名通常一樣，用日期區分），下方是課程名稱與狀態（可以報名、倒數、學習中…）。
 */
export function CourseRow({ course }: { course: CourseSummary }) {
  const { c } = useTheme();
  const { member } = useSession();
  const { config } = useUiConfig();
  useCenterNames();
  const r = ribbonsFor(course, member, config);
  const rb = r.left ?? r.right;
  const date = course.eventStart ? eventDays(course.eventStart, course.eventEnd) : "";
  const img = course.coverUrl || course.edmUrl;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${date} ${course.title}`} onPress={() => router.push(`/course/${course.id}`)} style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.thumb}>
        {img ? <Image source={{ uri: resolveUrl(img) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <CourseCover theme={course.theme} label="" title={course.series || course.title} fill />}
      </View>
      <View style={styles.mid}>
        <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={2}>
          {date || course.title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {date ? course.title : course.hostCenter ? centerTitle(course.hostCenter) : ""}
        </AppText>
        {rb ? (
          <View style={[styles.chip, { backgroundColor: rb.bg }]}>
            <AppText variant="caption" style={{ color: rb.fg, fontWeight: "800" }} numberOfLines={1}>
              {rb.label}
            </AppText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
