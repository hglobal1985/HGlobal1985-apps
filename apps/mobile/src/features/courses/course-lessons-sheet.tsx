import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, ErrorView, LoadingLadybug, SheetAction } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { ChapterList } from "./lesson-list";
import { afterSheetClose } from "@/lib/sheet-back";

/**
 * 中心頁點某一門課：從下方彈出這門課的章節（與課程介紹頁的章節清單是同一個元件 ChapterList，內容格式一致），
 * 右上角「完整介紹」膠囊進入課程介紹頁（按住面板往上拉到最高處也會進入）。選單一律不顯示「完整版」。
 */
export function CourseLessonsSheet({ course, onClose }: { course: CourseSummary; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const goDetail = () => {
    onClose();
    afterSheetClose(() => router.push(`/course/${course.id}`));
  };
  return (
    <BottomSheet onClose={onClose} onExpand={goDetail} expandLabel="繼續上拉進入完整介紹">
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
        <SheetAction label="完整介紹" accessibilityLabel="完整介紹：進入課程介紹頁" onPress={goDetail} />
      </View>
      <SheetScroll gap={space.md}>
        {loading && !data ? <LoadingLadybug /> : null}
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {data ? (
          <>
            <ChapterList course={data} />
          </>
        ) : null}
      </SheetScroll>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
});
