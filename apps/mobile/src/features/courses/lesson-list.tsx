import { trackFeature } from "@/lib/feature-track";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Linking, Pressable, type ViewStyle } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { eventDays, minutesText, sharerLine } from "@/features/format";
import { engine } from "@/features/player/engine";
import { lessonHref, lessonShareHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText, Card, Icon, ListRow, SaplingIcon, ShareIcon } from "@/ui";
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
export function FullVersionList({ course, playingId, onPlay, openBlock }: { course: CourseDetail; /** 從上拉選單點某個區塊進來：該區塊展開並捲到它，其他區塊維持收起。 */ openBlock?: string } & LessonPlayProps) {
  const { c } = useTheme();
  // 清單的區塊預設全部收起（業主 2026-11-18）；只有從上拉選單指定的那個區塊展開。
  const [folded, setFolded] = useState<Set<string>>(() => new Set(course.isList ? course.lessons.filter((l) => l.section && l.id !== openBlock).map((l) => l.id) : []));
  useEffect(() => {
    if (!openBlock || typeof document === "undefined") return;
    const t = setTimeout(() => document.getElementById(`blk-${openBlock}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [openBlock]);
  const canEdit = !!course.can?.edit;
  const all = course.lessons.filter((l) => l.material);
  // 學員只看得到「有內容的項目」；分類標題底下沒有任何可看項目就整個隱藏（管理者全部都看得到）。
  const shown = (l: Lesson) => l.ready || canEdit;
  const rows: Lesson[] = [];
  all.forEach((l, i) => {
    if (!l.section) return void (shown(l) && rows.push(l));
    const next = all.slice(i + 1);
    const end = next.findIndex((x) => x.section);
    const members = end < 0 ? next : next.slice(0, end);
    if (canEdit || members.some(shown)) rows.push(l);
  });
  if (!rows.length) return null;
  // 每個項目屬於它前面最近的分類標題；標題收合時底下的項目不顯示。
  let current: string | null = null;
  const visible = rows.filter((l) => {
    if (l.section) {
      current = l.id;
      return true;
    }
    return !(current && folded.has(current));
  });
  const toggle = (id: string) =>
    setFolded((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {visible.map((lesson) => {
        if (lesson.section) {
          const open = !folded.has(lesson.id);
          return (
            <Pressable key={lesson.id} nativeID={`blk-${lesson.id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${lesson.title}，${open ? "點一下收合" : "點一下展開"}`} onPress={() => toggle(lesson.id)} style={({ pressed }) => [{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.sm, paddingVertical: 8, scrollMarginTop: 72 } as ViewStyle, pressed && { opacity: 0.7 }]}>
              <Icon name={open ? "chevron-down" : "chevron-forward"} size={18} color={c.accentText} />
              <AppText variant="callout" style={{ flex: 1, fontWeight: "800", color: c.accentText }}>
                {lesson.title}
              </AppText>
            </Pressable>
          );
        }
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
            titleLines={course.isList ? 2 : undefined}
            dateChip={course.isList && lesson.eventDate ? eventDays(lesson.eventDate, null) : undefined}
            subtitle={course.isList ? undefined : [link ? TYPE_INFO[link.linkType!].label : sharerLine(lesson)].filter(Boolean).join(" · ") || undefined}
            right={link?.linkUrl ? <MaterialShare course={course} lesson={link} /> : course.isList && !lesson.full && lesson.ready && !lesson.locked ? <ListItemShare course={course} lesson={lesson} /> : undefined}
            onPress={
              link
                ? link.linkUrl
                  ? () => (trackFeature("open_material"), void Linking.openURL(link.linkUrl!).catch(() => flashText("無法開啟連結")))
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
