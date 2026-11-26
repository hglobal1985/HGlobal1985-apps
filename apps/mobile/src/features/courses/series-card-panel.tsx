import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { CourseDetail, CourseSummary } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { ErrorView, LoadingLadybug, LockMask, SegmentTabs } from "@/ui";
import { DOWNLOAD_TAB, DownloadList, downloadItems } from "./download-tab";
import { ChapterList } from "./lesson-list";
import { MaterialRows } from "./material-rows";

/**
 * 系列頁縮圖：點一張卡後在那一列下方原地展開的內容（杜杜龍 2026-11-20）：不顯示區塊，只顯示教材，
 * 教材列的呈現＝教材列模組包 `MaterialRows`（YouTube 圖示、日期膠囊、分享鈕、字級與列高，和安麗直播清單一致）。
 */
export function SeriesCardPanel({ course }: { course: CourseSummary }) {
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${course.id}`);
  const [tab, setTab] = useState<"all" | "download">("all");
  const goCourse = () => router.push(`/course/${course.id}`); // 沒有權限時點任何教材標題，都跳到該課程詳細頁（杜杜龍 2026-11-21）
  const items = (data?.lessons ?? []).filter((l) => !l.section && !l.full);
  const allLocked = !data?.can?.edit && items.length > 0 && items.every((l) => l.locked);
  const hasChapters = !!data?.lessons.some((l) => !l.material);
  const hasMaterials = !!data?.lessons.some((l) => l.material && !l.section && !l.full && (l.ready || data.can?.edit));
  return (
    <View style={{ gap: space.sm }}>
      {loading && !data ? <LoadingLadybug /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data ? (
        // 全部沒有權限：蓋一個半透明灰色大鎖頭（共用 LockMask），點整片進該課程頁（杜杜龍 2026-11-21）
        <View style={allLocked ? { minHeight: 230, gap: space.sm } : { gap: space.sm }}>
          {/* 「下載」標籤（杜杜龍 2026-11-26，共用模組 download-tab.tsx）：有影片以外的檔案／連結才出現。 */}
          {downloadItems(data).length ? <SegmentTabs options={[{ key: "all" as const, label: "全部教材" }, DOWNLOAD_TAB]} value={tab} onChange={setTab} /> : null}
          {tab === "download" && downloadItems(data).length ? (
            <DownloadList course={data} onBlockedPress={goCourse} />
          ) : (
            <>
              {hasChapters || !hasMaterials ? <ChapterList course={data} onBlockedPress={goCourse} /> : null}
              <MaterialRows course={data} onBlockedPress={goCourse} />
            </>
          )}
          {allLocked ? <LockMask lines={["按此開啟課程頁面", "開通報名"]} onPress={goCourse} /> : null}
        </View>
      ) : null}
    </View>
  );
}
