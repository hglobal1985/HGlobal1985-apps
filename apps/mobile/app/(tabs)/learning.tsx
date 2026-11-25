import { useModeProfile } from "@/lib/app-mode";
import { lessonHref } from "@/lib/lesson-href";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { loadLastLesson, type LastLesson } from "@/lib/last-lesson";
import { StyleSheet, View } from "react-native";
import { api, type CourseSummary } from "@/api/client";
import { SaplingBar } from "@/features/achievements/sapling-bar";
import { confirmSheet } from "@/features/confirm";
import { ElderCourseRow } from "@/features/elder/elder-search";
import { CourseCard } from "@/features/courses/course-card";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { CardGrid, GuestGate, AppText, Button, Card, EmptyState, ErrorView, LoadingView, NoticeBox, Screen, Section, Select } from "@/ui";
import { flashText } from "@/ui/flash-notice";

export default function LearningScreen() {
  const profile = useModeProfile();
  const elder = profile.bigLayout;
  const seriesFilter = profile.features.seriesFilter;
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<CourseSummary[]>(member ? "/courses" : null);
  const [last, setLast] = useState<LastLesson | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (member) loadLastLesson(member.sub).then(setLast);
    }, [member?.sub]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** 免費課程可以從「學習中」隱藏（付費課程沒有這顆 X）。 */
  const hide = async (course: CourseSummary) => {
    if (!(await confirmSheet({ title: "從學習中隱藏", message: "這門免費課程會從「學習中」消失，之後再打開課程頁就會回來。", confirmLabel: "隱藏", cancelLabel: "先不要" }))) return;
    try {
      await api("POST", `/courses/${course.id}/hide-learning`);
      reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  /** 免費課程可以隱藏；沒報名紀錄、只是播放過的課程（管理員或公開課程）也可以隱藏。 */
  const canHide = (c: CourseSummary) => (c.enrollment === "opened" && (c.watchFree || c.isPublic)) || (c.enrollment !== "opened" && c.started);
  // 學習中＝已開通的課程，或播放超過 1% 的課程（含免費、沒有報名紀錄的）；等待審核的另外顯示。
  // 清單類別（清單卡）不列入學習中（業主 2026-11-16）。
  const inLearning = (c: CourseSummary) => !c.isList && (c.enrollment === "opened" || c.started) && !c.hiddenFromLearning;
  const [kind, setKind] = useState("");
  const [seriesSel, setSeriesSel] = useState("");
  const enrolled = useMemo(() => (data ?? []).filter((c) => inLearning(c) || c.enrollment === "pending"), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 系列篩選：列出學習中課程所屬的系列。
  const seriesList = useMemo(() => [...new Set(enrolled.map((c) => c.series).filter(Boolean))], [enrolled]);
  const shown = (data ?? []).filter((c) => (kind === "" || (kind === "free" ? c.free : !c.free)) && (!seriesFilter || seriesSel === "" || c.series === seriesSel));
  // 依最近一次學習的時間排序（最近的在上面）；還沒學習過的排後面。
  const byRecent = (a: CourseSummary, b: CourseSummary) => (b.lastLearnedAt ?? "").localeCompare(a.lastLearnedAt ?? "");
  const mine = shown.filter(inLearning).sort(byRecent);
  const pending = shown.filter((c) => c.enrollment === "pending");
  const inProgress = mine.filter((c) => c.completedLessons < c.lessonCount);
  const finished = mine.filter((c) => c.lessonCount > 0 && c.completedLessons >= c.lessonCount);
  const resume = last && mine.some((c) => c.id === last.courseId) ? last : null;
  if (!member)
    return (
      <Screen>
        <GuestGate body="登入後，這裡會列出你已開通的課程與學習進度。" />
      </Screen>
    );
  return (
    <Screen
      wide
      top={
        enrolled.length ? (
          <View style={[styles.filters, elder && { flexDirection: "column" }]}>
            <Select label="費用" value={kind} options={[{ key: "", label: "全部（免費與付費）" }, { key: "free", label: "免費" }, { key: "paid", label: "付費" }]} onChange={setKind} />
            {!seriesFilter ? null : <Select label="系列" value={seriesSel} options={[{ key: "", label: "全部系列" }, ...seriesList.map((x) => ({ key: x, label: x }))]} onChange={setSeriesSel} />}
          </View>
        ) : undefined
      }
    >
      <SaplingBar saplings={(data ?? []).reduce((n, x) => n + x.completedLessons, 0)} />
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {pending.length ? <NoticeBox tone="warning" text={`${pending.length} 堂課程等待管理員確認，開通後會通知你。`} /> : null}
      {data && !mine.length && enrolled.some(inLearning) ? <EmptyState icon="library-outline" title="沒有符合條件的課程" /> : null}
      {data && !enrolled.some(inLearning) ? (
        <EmptyState
          icon="play-circle-outline"
          title="還沒有開通的課程"
          body="到課程頁挑一門免費課程，報名後立刻就能開始。"
          action={<Button label="去找課程" onPress={() => router.navigate("/courses")} />}
        />
      ) : null}
      {resume ? (
        <Card>
          <AppText variant="caption" tone="muted">{resume.courseTitle}</AppText>
          <AppText variant="callout" numberOfLines={2} style={{ fontWeight: "700" }}>{resume.lessonTitle}</AppText>
          <Button label="回到剛才的學習" icon="play-circle-outline" onPress={() => router.push(lessonHref(resume.courseId, resume.lessonId) as never)} fullWidth />
        </Card>
      ) : null}
      {/* 至尊模式：清單展示跟首頁搜尋結果一樣（ElderCourseRow，業主 2026-11-25） */}
      {elder && inProgress.length ? <View>{inProgress.map((course) => <ElderCourseRow key={course.id} course={course} />)}</View> : null}
      {!elder && inProgress.length ? (
        <CardGrid>
          {inProgress.map((course) => (
            <CourseCard key={course.id} course={course} onHide={canHide(course) ? () => hide(course) : undefined} />
          ))}
        </CardGrid>
      ) : null}
      {finished.length ? (
        <Section title="已完成">
          {elder ? <View>{finished.map((course) => <ElderCourseRow key={course.id} course={course} />)}</View> : null}
          <CardGrid>
            {(elder ? [] : finished).map((course) => (
              <CourseCard key={course.id} course={course} onHide={canHide(course) ? () => hide(course) : undefined} />
            ))}
          </CardGrid>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ filters: { flexDirection: "row", gap: space.sm } });
