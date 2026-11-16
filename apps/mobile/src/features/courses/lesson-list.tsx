import { router } from "expo-router";
import { Linking, Pressable, type ViewStyle } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/attachments";
import { minutesText, sharerLine } from "@/features/format";
import { lessonHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { Card, ListRow, ShareIcon } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { showToast } from "@/ui/toast";
import { SpeakerLead } from "./speaker-mark";

/**
 * 章節清單（學員看到的樣子）：課程介紹頁與中心頁「點課程彈出的選單」共用同一個元件，
 * 格式永遠一致；要改章節的呈現只改這裡。
 * 課程介紹頁傳 onPlay／playingId＝點章節原地播放、正在播放那列顯示動畫三角形；沒傳（中心頁選單）＝進該課程頁並開始播放。
 */
export type LessonPlayProps = { playingId?: string | null; onPlay?: (lessonId: string) => void };
export function ChapterList({ course, style, playingId, onPlay }: { course: CourseDetail; style?: ViewStyle } & LessonPlayProps) {
  const chapters = course.lessons.filter((l) => !l.material);
  const anyReady = chapters.some((l) => l.ready);
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm, ...style }}>
      {chapters.length === 0 || !anyReady ? (
        <ListRow icon="hourglass-outline" title="敬請期待" subtitle="課程內容準備中" />
      ) : (
        chapters.map((lesson) => {
            const soon = !lesson.ready;
            return (
              <ListRow
                key={lesson.id}
                icon={soon ? "hourglass-outline" : lesson.completed ? "checkmark-circle" : lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
                leading={lesson.isSpeaker && !soon && !lesson.completed && !lesson.locked ? <SpeakerLead /> : undefined}
                playing={playingId === lesson.id}
                highlight={playingId === lesson.id}
                note={minutesText(lesson.minutes)}
                title={`${lesson.position}. ${lesson.title}`}
                subtitle={soon ? "敬請期待" : [sharerLine(lesson), lesson.completed ? "已完成" : ""].filter(Boolean).join(" · ") || undefined}
                dense
                compact
                onPress={lesson.locked || soon || playingId === lesson.id ? undefined : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))}
              />
            );
          })
      )}
    </Card>
  );
}

/**
 * 「其他教材」區塊的清單：外部連結教材（業主 2026-11-16）——最左側是連結類型的官方 Logo（取代播放鈕）、點一下開啟外部連結、
 * 最右側有「分享」鈕（系統分享選單；文字範本在「設定 > 分享預設值」）。沒有連結的列（完整版課程影片、尚未改版的舊教材）維持原本的播放樣子。
 */
export function FullVersionList({ course, playingId, onPlay }: { course: CourseDetail } & LessonPlayProps) {
  const full = course.lessons.filter((l) => l.material && (l.ready || !!course.can?.edit));
  if (!full.length) return null;
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {full.map((lesson) => {
        const link = lesson.linkType && !lesson.full ? lesson : null;
        return (
          <ListRow
            key={lesson.id}
            icon={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
            leading={link ? <BrandIcon type={link.linkType!} fallback={TYPE_INFO[link.linkType!].icon as never} size={36} /> : undefined}
            compact
            playing={!link && playingId === lesson.id}
            highlight={!link && playingId === lesson.id}
            note=""
            title={lesson.title}
            subtitle={link ? TYPE_INFO[link.linkType!].label : sharerLine(lesson) || undefined}
            right={link?.linkUrl ? <MaterialShare course={course} lesson={link} /> : undefined}
            onPress={
              link
                ? link.linkUrl
                  ? () => void Linking.openURL(link.linkUrl!).catch(() => showToast("無法開啟連結"))
                  : undefined
                : lesson.locked || playingId === lesson.id
                  ? undefined
                  : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))
            }
          />
        );
      })}
    </Card>
  );
}

/** 教材最右側的「分享」鈕：系統分享選單，分享出去的是外部連結本身（文字範本見「設定 > 分享預設值」的教材分享文字）。 */
function MaterialShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  const { c } = useTheme();
  const share = async () => {
    const r = await shareLink(lesson.title, lesson.linkUrl!, { teacher: course.teacher ?? "", teacherTitle: course.teacherTitle ?? "", title: course.title }, { title: lesson.title });
    if (r === "copied") showToast("已複製連結");
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`分享教材：${lesson.title}`} onPress={share} hitSlop={6} style={({ pressed }) => [{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}>
      <ShareIcon size={24} color={c.accent} />
    </Pressable>
  );
}
