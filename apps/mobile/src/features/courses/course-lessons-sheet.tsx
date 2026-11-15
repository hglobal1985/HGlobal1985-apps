import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, space } from "@/theme/tokens";
import { AppText, ErrorView, LoadingView } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { ChapterList, FullVersionList } from "./lesson-list";

/**
 * 中心頁點某一門課：從下方彈出這門課的章節（與課程介紹頁的章節清單是同一個元件 ChapterList，內容格式一致），
 * 右上角「查看詳細介紹」進入課程介紹頁。
 */
export function CourseLessonsSheet({ course, onClose }: { course: CourseSummary; onClose: () => void }) {
  const { c } = useTheme();
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const goDetail = () => {
    onClose();
    router.push(`/course/${course.id}`);
  };
  return (
    <BottomSheet onClose={onClose}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline" numberOfLines={2}>
            {course.title}
          </AppText>
          {course.eventStart ? (
            <AppText variant="caption" tone="muted">
              {eventDays(course.eventStart, course.eventEnd)}
            </AppText>
          ) : null}
        </View>
        <Pressable accessibilityRole="link" accessibilityLabel="查看詳細介紹" onPress={goDetail} hitSlop={8} style={styles.link}>
          <AppText variant="callout" style={{ color: c.accentText, fontWeight: "700" }}>
            查看詳細介紹
          </AppText>
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.md }}>
        {loading && !data ? <LoadingView /> : null}
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {data ? (
          <>
            <ChapterList course={data} />
            <FullVersionList course={data} />
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  link: { minHeight: minTouch, justifyContent: "center" },
});
