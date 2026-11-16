import { router } from "expo-router";
import type { ViewStyle } from "react-native";
import type { CourseDetail } from "@/api/client";
import { minutesText, sharerLine } from "@/features/format";
import { lessonHref } from "@/lib/lesson-href";
import { space } from "@/theme/tokens";
import { Card, ListRow } from "@/ui";
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

/** 「其他教材」區塊的清單：管理者新增的教材；「完整版課程影片」固定排在最後一列。 */
export function FullVersionList({ course, playingId, onPlay }: { course: CourseDetail } & LessonPlayProps) {
  const full = course.lessons.filter((l) => l.material && (l.ready || !!course.can?.edit));
  if (!full.length) return null;
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {full.map((lesson) => (
        <ListRow
          key={lesson.id}
          icon={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
          compact
          playing={playingId === lesson.id}
          highlight={playingId === lesson.id}
          note={minutesText(lesson.minutes)}
          title={lesson.title}
          subtitle={sharerLine(lesson) || undefined}
          onPress={lesson.locked || playingId === lesson.id ? undefined : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))}
        />
      ))}
    </Card>
  );
}
