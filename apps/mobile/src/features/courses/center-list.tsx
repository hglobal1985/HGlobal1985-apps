import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { router } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { shareLink } from "@/lib/share";
import { useThumb } from "@/lib/thumb";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { BrandCover, Card, LoadingLadybug } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { TYPE_INFO } from "@/features/link-types";
import { lessonHref } from "@/lib/lesson-href";
import { useApi } from "@/state/session";
import type { Attachment } from "@/api/client";
import { CompactRow, MetaLine, RowButtons } from "./compact-row";
import { RowAddToList } from "@/features/my-lists/add-to-list";
import { RowShare } from "./lesson-list";

/**
 * 全站「清單」格式唯一來源（業主 2026-11-21）：中心頁「清單」分頁、系列頁「清單」都用它（格式比照教材清單）：一張卡，一列一張 EDM 卡片，兩行緊密排列——
 * 第一行課程標題、第二行「日期 主講人 獎銜」；左側封面縮圖（左右留邊）、右側分享鈕；點一列進該卡片。
 * （業主 2026-11-21：卡片上方的「中心名稱＋教材數量」標題已刪除，所以 title 參數不再顯示。）
 */
export function CenterListCard({ courses, trailing }: { title?: string; courses: CourseSummary[]; /** 有給就取代右側分享鈕（系列頁編輯模式放排序／隱藏鈕）。 */ trailing?: (course: CourseSummary, index: number) => ReactNode }) {
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {courses.map((course, i) => (
        <CenterListRow key={course.id} course={course} trailing={trailing?.(course, i)} />
      ))}
    </Card>
  );
}

function CenterListRow({ course, trailing }: { course: CourseSummary; trailing?: ReactNode }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const img = course.coverUrl || course.edmUrl;
  const date = course.eventStart && !course.isList ? eventDays(course.eventStart, course.eventEnd) : undefined;
  const who = [course.teacher, course.teacherRankName].filter(Boolean).join(" ");
  const share = () => shareLink(course.title, course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`, course.isList ? undefined : { teacher: course.teacher, teacherTitle: course.teacherTitle, title: course.title }, undefined, undefined, course.isList ? { title: course.title } : undefined);
  return (
    <CompactRow
      faded={course.materialCount === 0}
      label={course.title}
      onPress={() => router.push(`/course/${course.id}`)}
      leading={
        <View style={styles.thumb}>
          {course.brand ? <BrandCover brand={course.brand} fill /> : img ? <Image source={{ uri: thumb(resolveUrl(img), 160) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }]}><Ionicons name="school-outline" size={22} color={c.accent} /></View>}
        </View>
      }
      title={course.title}
      meta={<MetaLine date={date} text={who} />}
      actions={
        trailing ?? (
          <RowButtons>
            <RowAddToList target={{ kind: "course", ref: course.id }} title={course.title} />
            <RowShare label={`分享：${course.title}`} onShare={share} />
          </RowButtons>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  thumb: { width: 56, height: 36, borderRadius: 6, overflow: "hidden", backgroundColor: "#fff" },
});

/** 中心頁「清單」分頁裡的一筆教材（後端 GET /center-materials）。 */
type CenterMaterial = { id: string; courseId: string; courseTitle: string; title: string; kind: string; sharer: string; sharerRankName: string; eventDate: string | null; iconType?: Attachment["type"] };

/**
 * 中心頁「清單」分頁（業主 2026-11-21 更正）：列出這個中心所有課程裡的「每一個教材」（章節與其他教材，不只是課程本身），
 * 列的樣子用全站清單列模組（`CompactRow`）：縮圖／類型圖示、第一行教材名稱、第二行「日期 分享者 獎銜（沒有分享者就寫所屬課程）」。
 * 點一列進該課程（章節直接開始播放）。
 */
export function CenterMaterialsCard({ courseIds }: { courseIds: string[] }) {
  const { c } = useTheme();
  const key = courseIds.join(",");
  const { data, loading } = useApi<{ items: CenterMaterial[] }>(key ? `/center-materials?ids=${encodeURIComponent(key)}` : null);
  if (loading && !data) return <LoadingLadybug />;
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {items.map((m) => {
        const who = [m.sharer, m.sharerRankName].filter(Boolean).join(" ");
        return (
          <CompactRow
            key={m.id}
            label={m.title}
            onPress={() => router.push((m.kind === "chapter" ? lessonHref(m.courseId, m.id) : `/course/${m.courseId}`) as never)}
            leading={
              <View style={{ width: 40, alignItems: "center" }}>
                {m.iconType ? <BrandIcon type={m.iconType} fallback={TYPE_INFO[m.iconType].icon as never} size={36} /> : <Ionicons name="play-circle-outline" size={32} color={c.accent} />}
              </View>
            }
            title={m.title}
            meta={<MetaLine date={m.eventDate ? eventDays(m.eventDate, null) : undefined} text={who || m.courseTitle} />}
            actions={
              <RowButtons>
                <RowAddToList target={{ kind: "lesson", ref: m.id, ref2: m.courseId }} title={m.title} />
                <RowShare label={`分享：${m.title}`} onShare={() => shareLink(m.title, `/course/${m.courseId}`, undefined, { title: m.title })} />
              </RowButtons>
            }
          />
        );
      })}
    </Card>
  );
}
