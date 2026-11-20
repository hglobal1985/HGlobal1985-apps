import { router } from "expo-router";
import { View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { Card, ErrorView, LoadingLadybug } from "@/ui";
import { SheetRow } from "@/ui/sheet-row";
import { ChapterList, FullVersionList } from "./lesson-list";

/**
 * 系列頁縮圖：點一張卡後在那一列下方原地展開的內容（業主 2026-11-20）＝該教材卡的章節與教材
 * （和教材卡頁同一組元件 ChapterList、FullVersionList），有區塊時只列區塊名稱（純文字列，點一列進該卡並展開該區塊）。
 */
export function SeriesCardPanel({ course }: { course: CourseSummary }) {
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const hasChapters = !!data?.lessons.some((l) => !l.material);
  const hasMaterials = !!data?.lessons.some((l) => l.material && !l.section);
  // 有區塊：只列區塊名稱，一列一列純文字（不放封面圖、不重複課程名稱；業主 2026-11-20），點一列進該課程並展開那個區塊。
  const blocks: { id: string; title: string; n: number }[] = [];
  for (const l of data?.lessons ?? []) {
    if (l.full) continue;
    if (l.section) blocks.push({ id: l.id, title: l.title, n: 0 });
    else if (l.material && blocks.length && (l.ready || data?.can?.edit)) blocks[blocks.length - 1]!.n++;
  }
  return (
    <View style={{ gap: space.sm }}>
      {loading && !data ? <LoadingLadybug /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data && blocks.length ? (
        <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
          {blocks.map((b) => (
            <SheetRow key={b.id} title={b.title} count={b.n} faded={b.n === 0} onPress={() => router.push(`/course/${course.id}?block=${b.id}` as never)} />
          ))}
        </Card>
      ) : data ? (
        <>
          {hasChapters || !hasMaterials ? <ChapterList course={data} /> : null}
          <FullVersionList course={data} />
        </>
      ) : null}
    </View>
  );
}
