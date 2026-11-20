import { router } from "expo-router";
import { View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { ErrorView, LoadingLadybug } from "@/ui";
import { ChapterList } from "./lesson-list";
import { MaterialRows } from "./material-rows";

/**
 * 系列頁縮圖：點一張卡後在那一列下方原地展開的內容（業主 2026-11-20）：不顯示區塊，只顯示教材，
 * 教材列的呈現＝教材列模組包 `MaterialRows`（YouTube 圖示、日期膠囊、分享鈕、字級與列高，和安麗直播清單一致）。
 */
export function SeriesCardPanel({ course }: { course: CourseSummary }) {
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const goCourse = () => router.push(`/course/${course.id}`); // 沒有權限時點任何教材標題，都跳到該課程詳細頁（業主 2026-11-21）
  const hasChapters = !!data?.lessons.some((l) => !l.material);
  const hasMaterials = !!data?.lessons.some((l) => l.material && !l.section && !l.full && (l.ready || data.can?.edit));
  return (
    <View style={{ gap: space.sm }}>
      {loading && !data ? <LoadingLadybug /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          {hasChapters || !hasMaterials ? <ChapterList course={data} onBlockedPress={goCourse} /> : null}
          <MaterialRows course={data} onBlockedPress={goCourse} />
        </>
      ) : null}
    </View>
  );
}
