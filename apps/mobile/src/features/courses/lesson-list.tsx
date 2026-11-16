import { router } from "expo-router";
import type { ViewStyle } from "react-native";
import type { CourseDetail } from "@/api/client";
import { eventDays, sharerLine } from "@/features/format";
import { AppText, Card, ListRow } from "@/ui";
import { SpeakerLead } from "./speaker-mark";

/**
 * 章節清單（學員看到的樣子）：課程介紹頁與中心頁「點課程彈出的選單」共用同一個元件，
 * 格式永遠一致；要改章節的呈現只改這裡。
 */
export function ChapterList({ course, style }: { course: CourseDetail; style?: ViewStyle }) {
  const chapters = course.lessons.filter((l) => !l.material);
  const anyReady = chapters.some((l) => l.ready);
  return (
    <Card style={{ paddingVertical: 0, ...style }}>
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
                title={`${lesson.position}. ${lesson.title}`}
                subtitle={soon ? "敬請期待" : [sharerLine(lesson), lesson.minutes ? `${lesson.minutes} 分鐘` : "", lesson.completed ? "已完成" : ""].filter(Boolean).join(" · ") || undefined}
                right={lesson.eventDate ? <AppText variant="callout" tone="muted">{eventDays(lesson.eventDate, null)}</AppText> : undefined}
                dense
                onPress={lesson.locked || soon ? undefined : () => router.push(`/learn/${course.id}/${lesson.id}`)}
              />
            );
          })
      )}
    </Card>
  );
}

/** 「其他教材」區塊的清單：管理者新增的教材；「完整版課程影片」固定排在最後一列。 */
export function FullVersionList({ course }: { course: CourseDetail }) {
  const full = course.lessons.filter((l) => l.material && (l.ready || !!course.can?.edit));
  if (!full.length) return null;
  return (
    <Card style={{ paddingVertical: 0 }}>
      {full.map((lesson) => (
        <ListRow
          key={lesson.id}
          icon={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
          title={lesson.title}
          subtitle={[sharerLine(lesson), lesson.minutes ? `${lesson.minutes} 分鐘` : ""].filter(Boolean).join(" · ") || undefined}
          onPress={lesson.locked ? undefined : () => router.push(`/learn/${course.id}/${lesson.id}`)}
        />
      ))}
    </Card>
  );
}
