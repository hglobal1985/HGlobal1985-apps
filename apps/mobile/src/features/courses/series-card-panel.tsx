import { router } from "expo-router";
import { View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, ErrorView, LoadingLadybug, SheetAction } from "@/ui";
import { ChapterList, FullVersionList } from "./lesson-list";

/**
 * 系列頁縮圖：點一張卡後在那一列下方原地展開的內容（業主 2026-11-20）＝該教材卡的章節與教材
 * （和教材卡頁同一組元件 ChapterList、FullVersionList），右上「完整介紹」進入該卡詳細頁。
 */
export function SeriesCardPanel({ course }: { course: CourseSummary }) {
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const hasChapters = !!data?.lessons.some((l) => !l.material);
  const hasMaterials = !!data?.lessons.some((l) => l.material && !l.section);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <AppText variant="headline" numberOfLines={2} style={{ flex: 1 }}>
          {course.title}
        </AppText>
        <SheetAction label="完整介紹" accessibilityLabel={`完整介紹：進入${course.title}`} onPress={() => router.push(`/course/${course.id}`)} />
      </View>
      {loading && !data ? <LoadingLadybug /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          {hasChapters || !hasMaterials ? <ChapterList course={data} /> : null}
          <FullVersionList course={data} />
        </>
      ) : null}
    </View>
  );
}
