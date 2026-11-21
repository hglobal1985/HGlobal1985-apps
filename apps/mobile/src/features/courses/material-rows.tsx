import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { downloadMaterial, isDownloadUrl } from "@/lib/download-material";
import { trackFeature } from "@/lib/feature-track";
import { TYPE_INFO } from "@/features/link-types";
import { eventDays, sharerLine } from "@/features/format";
import { engine } from "@/features/player/engine";
import { RowAddToList } from "@/features/my-lists/add-to-list";
import { lessonHref, lessonShareHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { Card, ListRow, ShareIcon } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { flashText } from "@/ui/flash-notice";
import { SpeakerMark } from "./speaker-mark";

/**
 * 「教材列」模組包（業主 2026-11-20）：教材一列的呈現只有這一份——左側連結類型的官方圖示（YouTube 紅色圖示…）、
 * 日期膠囊接在標題最前面、標題最多 2 行、右側分享鈕、列高與字級統一。
 * 用在：教材卡頁的「其他教材」（`FullVersionList`）、寰宇大學系列頁點卡展開的內容（`SeriesCardPanel`）。
 * `MaterialRow`＝單列；`MaterialRows`＝把一份課程所有教材（不含區塊標題、完整版影片）排成一張卡；
 * `listStyle`（預設跟著 `course.isList`）＝清單樣式（日期膠囊、2 行標題、影片分享鈕）；要改教材列的樣子只改這個檔案。
 */

/** 教材標了「主題」（業主 2026-11-19）：圖示右下角加學士帽小徽章；沒有自訂圖示時用預設播放圖示加徽章。 */
function themeBadge(lesson: Lesson, icon: React.ReactElement | undefined, color: string): React.ReactElement | undefined {
  if (!lesson.isSpeaker || lesson.full) return icon;
  return (
    <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
      {icon ?? <Ionicons name={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"} size={32} color={color} />}
      <View style={{ position: "absolute", right: -6, bottom: -6, backgroundColor: "#fff", borderRadius: 11, padding: 2 }}>
        <SpeakerMark size={14} />
      </View>
    </View>
  );
}

/** `onBlockedPress`：這一列沒有權限（鎖住、沒有連結）時點下去的動作；系列頁展開內容用它跳到該課程詳細頁（業主 2026-11-21）。 */
export function MaterialRow({ course, lesson, listStyle, playingId, onPlay, onBlockedPress }: { course: CourseDetail; lesson: Lesson; listStyle?: boolean; playingId?: string | null; onPlay?: (lessonId: string) => void; onBlockedPress?: () => void }) {
  const { c } = useTheme();
  const ls = listStyle ?? course.isList;
  const link = lesson.linkType && !lesson.full ? lesson : null;
  return (
    <ListRow
      icon={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
      leading={themeBadge(lesson, lesson.iconType && !lesson.locked ? <BrandIcon type={lesson.iconType} fallback={TYPE_INFO[lesson.iconType].icon as never} size={36} /> : undefined, c.accent)}
      compact
      playing={!link && playingId === lesson.id}
      playingLesson={lesson.id}
      highlight={!link && playingId === lesson.id}
      note=""
      title={lesson.title}
      titleLines={ls ? 2 : undefined}
      dateChip={ls && lesson.eventDate ? eventDays(lesson.eventDate, null) : undefined}
      subtitle={ls ? undefined : [link ? TYPE_INFO[link.linkType!].label : sharerLine(lesson)].filter(Boolean).join(" · ") || undefined}
      right={<RowActions course={course} lesson={lesson}>{link?.linkUrl && !isDownloadUrl(link.linkUrl) ? <MaterialShare course={course} lesson={link} /> : ls && !lesson.full && lesson.ready && !lesson.locked ? <ListItemShare course={course} lesson={lesson} /> : null}</RowActions>}
      onPress={
        (link
          ? link.linkUrl
            ? isDownloadUrl(link.linkUrl)
              ? () => (trackFeature("open_material"), void downloadMaterial(link.linkUrl!))
              : () => (trackFeature("open_material"), void Linking.openURL(link.linkUrl!).catch(() => flashText("無法開啟連結")))
            : undefined
          : lesson.locked
            ? undefined
            : playingId === lesson.id
              ? () => engine.toggle()
              : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))) ?? onBlockedPress
      }
    />
  );
}

/** 這份課程所有教材排成一張卡（不顯示區塊標題；學員只看得到有內容的項目，管理者全部都看得到）。沒有任何教材回 null。 */
export function MaterialRows({ course, listStyle = true, playingId, onPlay, onBlockedPress }: { course: CourseDetail; listStyle?: boolean; playingId?: string | null; onPlay?: (lessonId: string) => void; onBlockedPress?: () => void }) {
  const items = course.lessons.filter((l) => l.material && !l.section && !l.full && (l.ready || course.can?.edit));
  if (!items.length) return null;
  return (
    <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
      {items.map((l) => (
        <MaterialRow key={l.id} course={course} lesson={l} listStyle={listStyle} playingId={playingId} onPlay={onPlay} onBlockedPress={onBlockedPress} />
      ))}
    </Card>
  );
}

/** 教材列最右側：「加入我的清單」圓鈕＋分享鈕（業主 2026-11-21 配方案 1）；鎖住或完整版影片不放加入鈕。 */
function RowActions({ course, lesson, children }: { course: CourseDetail; lesson: Lesson; children: ReactNode }) {
  const canAdd = !lesson.full && !lesson.locked && (lesson.linkUrl || lesson.ready);
  if (!canAdd && !children) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {canAdd ? <RowAddToList target={{ kind: "lesson", ref: lesson.id, ref2: course.id }} title={lesson.title} /> : null}
      {children}
    </View>
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

/** 清單卡裡每段影片最右側的「分享」鈕：網址＝清單網址?N（點開直接播放這一段），文字用「設定 > 分享預設值」的清單影片範本。 */
function ListItemShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  return <RowShare label={`分享影片：${lesson.title}`} onShare={() => shareLink(lesson.title, lessonShareHref(course, lesson.position), undefined, undefined, undefined, { title: course.title, item: lesson.title })} />;
}

