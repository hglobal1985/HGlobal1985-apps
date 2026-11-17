import { router } from "expo-router";
import { Linking, Pressable, type ViewStyle } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { minutesText, sharerLine } from "@/features/format";
import { engine } from "@/features/player/engine";
import { lessonHref, lessonShareHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { Card, ListRow, SaplingIcon, ShareIcon } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { flashText } from "@/ui/flash-notice";
import { SpeakerLead } from "./speaker-mark";
import { SummaryLead } from "./summary-mark";

/**
 * 章節清單（學員看到的樣子）：課程介紹頁與中心頁「點課程彈出的選單」共用同一個元件，
 * 格式永遠一致；要改章節的呈現只改這裡。
 * 課程有兩堂以上章節時，每一列最右側有「分享」鈕（分享這一堂；姓名、職稱、主題取章節自己的設定，文字範本在「設定 > 分享預設值」）。
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
                icon={soon ? "hourglass-outline" : lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
                leading={!soon && lesson.completed ? <SaplingIcon /> : !soon && !lesson.locked ? (lesson.isSpeaker ? <SpeakerLead /> : lesson.isSummary ? <SummaryLead /> : undefined) : undefined}
                playing={playingId === lesson.id}
                playingLesson={lesson.id}
                highlight={playingId === lesson.id}
                note={minutesText(lesson.minutes)}
                title={`${lesson.position}. ${lesson.title}`}
                subtitle={soon ? "敬請期待" : [sharerLine(lesson), lesson.completed ? "已完成" : ""].filter(Boolean).join(" · ") || undefined}
                dense
                compact
                right={chapters.length >= 2 && !soon ? <ChapterShare course={course} lesson={lesson} /> : undefined}
                onPress={lesson.locked || soon ? undefined : playingId === lesson.id ? () => engine.toggle() : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))} // 正在播放的這一列再點一下＝暫停／繼續播放
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
            playingLesson={lesson.id}
            highlight={!link && playingId === lesson.id}
            note=""
            title={lesson.title}
            subtitle={link ? TYPE_INFO[link.linkType!].label : sharerLine(lesson) || undefined}
            right={link?.linkUrl ? <MaterialShare course={course} lesson={link} /> : course.isList && !lesson.full && lesson.ready && !lesson.locked ? <ListItemShare course={course} lesson={lesson} /> : undefined}
            onPress={
              link
                ? link.linkUrl
                  ? () => void Linking.openURL(link.linkUrl!).catch(() => flashText("無法開啟連結"))
                  : undefined
                : lesson.locked
                  ? undefined
                  : playingId === lesson.id
                    ? () => engine.toggle()
                    : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))
            }
          />
        );
      })}
    </Card>
  );
}

/** 清單每列最右側的「分享」小按鈕（系統預設分享圖示）。 */
export function RowShare({ label, onShare }: { label: string; onShare: () => Promise<"shared" | "copied" | "cancelled"> }) {
  const { c } = useTheme();
  const press = async () => {
    if ((await onShare()) === "copied") flashText("已複製連結");
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={press} hitSlop={6} style={({ pressed }) => [{ width: 34, height: 44, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}>
      <ShareIcon size={22} color={c.accent} />
    </Pressable>
  );
}

/** 教材最右側的「分享」鈕：分享出去的是外部連結本身（文字範本見「設定 > 分享預設值」的教材分享文字）。 */
function MaterialShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  return <RowShare label={`分享教材：${lesson.title}`} onShare={() => shareLink(lesson.title, lesson.linkUrl!, { teacher: course.teacher ?? "", teacherTitle: course.teacherTitle ?? "", title: course.title }, { title: lesson.title })} />;
}

/** 素材清單裡每段影片最右側的「分享」鈕：網址＝清單網址?N（點開直接播放這一段），文字用「設定 > 分享預設值」的清單影片範本。 */
function ListItemShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  return <RowShare label={`分享影片：${lesson.title}`} onShare={() => shareLink(lesson.title, lessonShareHref(course, lesson.position), undefined, undefined, undefined, { title: course.title, item: lesson.title })} />;
}

/** 章節最右側的「分享」鈕：分享這一堂（網址帶 ?lesson=，點開直接停在這一堂）；分享者姓名、職稱、章節名稱一律取這一堂章節自己的設定，不用課程的。 */
function ChapterShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  return (
    <RowShare
      label={`分享章節：${lesson.title}`}
      onShare={() => shareLink(lesson.title, lessonShareHref(course, lesson.position), { teacher: course.teacher ?? "", title: course.title }, undefined, { sharer: lesson.sharer ?? "", sharerTitle: lesson.sharerTitle ?? "", title: lesson.title })}
    />
  );
}
