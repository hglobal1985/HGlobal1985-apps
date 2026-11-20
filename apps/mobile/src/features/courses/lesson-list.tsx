import { downloadMaterial, isDownloadUrl } from "@/lib/download-material";
import { useThumb } from "@/lib/thumb";
import { BLOCK_BEHAVIOR } from "@/features/courses/block-module";
import { trackFeature } from "@/lib/feature-track";
import { useEffect } from "react";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Linking, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { resolveUrl, type CourseDetail, type Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { eventDays, minutesText, sharerLine } from "@/features/format";
import { engine } from "@/features/player/engine";
import { lessonHref, lessonShareHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { CourseCover } from "@/ui/course-cover";
import { AppText, BrandCover, Card, CountPill, ListRow, SaplingIcon, ShareIcon } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { flashText } from "@/ui/flash-notice";
import { fadedStyle } from "@/ui/fade-style";
import { SpeakerLead, SpeakerMark } from "./speaker-mark";
import { SummaryLead } from "./summary-mark";
import { ExpandGrid } from "./expand-grid";

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

/**
 * 「其他教材」區塊的清單：外部連結教材（業主 2026-11-16）——最左側是連結類型的官方 Logo（取代播放鈕）、點一下開啟外部連結、
 * 最右側有「分享」鈕（系統分享選單；文字範本在「設定 > 分享預設值」）。沒有連結的列（完整版課程影片、尚未改版的舊教材）維持原本的播放樣子。
 */
export function FullVersionList({ course, playingId, onPlay, openBlock, layout = "thumb" }: { course: CourseDetail; /** 從上拉選單點某個區塊進來：該區塊展開並捲到它，其他區塊維持收起。 */ openBlock?: string; /** 清單卡頁右上角的切換（業主 2026-11-19）：縮圖＝區塊封面格；詳細列表＝全部教材一列一列（區塊名稱＋數量當分隔）。 */ layout?: "thumb" | "detail" } & LessonPlayProps) {
  const thumb = useThumb();
  const { c } = useTheme();
  const isBlocks = course.lessons.some((l) => l.section);
  // 清單的區塊：預設全部收起（業主 2026-11-18）；點一張區塊卡才在下方展開教材，只展開一個；從上拉選單指定的那個一進來就展開。
  useEffect(() => {
    if (!openBlock || typeof document === "undefined") return;
    const t = setTimeout(() => document.getElementById(`blk-${openBlock}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [openBlock]);
  const canEdit = !!course.can?.edit;
  const all = course.lessons.filter((l) => l.material);
  // 學員只看得到「有內容的項目」；區塊底下沒有任何可看項目就整個隱藏（管理者全部都看得到）。
  const shown = (l: Lesson) => l.ready || canEdit;
  const itemRow = (lesson: Lesson) => {
    const link = lesson.linkType && !lesson.full ? lesson : null;
    return (
      <ListRow
        key={lesson.id}
        icon={lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline"}
        leading={themeBadge(lesson, lesson.iconType && !lesson.locked ? <BrandIcon type={lesson.iconType} fallback={TYPE_INFO[lesson.iconType].icon as never} size={36} /> : undefined, c.accent)}
        compact
        playing={!link && playingId === lesson.id}
        playingLesson={lesson.id}
        highlight={!link && playingId === lesson.id}
        note=""
        title={lesson.title}
        titleLines={course.isList ? 2 : undefined}
        dateChip={course.isList && lesson.eventDate ? eventDays(lesson.eventDate, null) : undefined}
        subtitle={course.isList ? undefined : [link ? TYPE_INFO[link.linkType!].label : sharerLine(lesson)].filter(Boolean).join(" · ") || undefined}
        right={link?.linkUrl && !isDownloadUrl(link.linkUrl) ? <MaterialShare course={course} lesson={link} /> : course.isList && !lesson.full && lesson.ready && !lesson.locked ? <ListItemShare course={course} lesson={lesson} /> : undefined}
        onPress={
          link
            ? link.linkUrl
              ? isDownloadUrl(link.linkUrl)
                ? () => (trackFeature("open_material"), void downloadMaterial(link.linkUrl!))
                : () => (trackFeature("open_material"), void Linking.openURL(link.linkUrl!).catch(() => flashText("無法開啟連結")))
              : undefined
            : lesson.locked
              ? undefined
              : playingId === lesson.id
                ? () => engine.toggle()
                : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))
        }
      />
    );
  };
  if (isBlocks) {
    // 切成：區塊前面沒歸區塊的項目＋各區塊（標題＋底下的項目）。
    const lead: Lesson[] = [];
    const blocks: { head: Lesson; items: Lesson[] }[] = [];
    for (const l of all) {
      if (l.full) continue;
      if (l.section) blocks.push({ head: l, items: [] });
      else if (blocks.length) blocks[blocks.length - 1]!.items.push(l);
      else lead.push(l);
    }
    const full = all.filter((l) => l.full && shown(l));
    const visibleBlocks = blocks.filter((b) => canEdit || b.items.some(shown));
    const leadShown = lead.filter(shown);
    if (!visibleBlocks.length && !leadShown.length && !full.length) return null;
    // 欄數隨螢幕寬度自動變：手機 2 欄，越寬越多，最多 5 欄（業主 2026-11-18）。
    const GAP = space.sm;
    if (layout === "detail") {
      return (
        <View style={{ gap: space.sm }}>
          {leadShown.length ? <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>{leadShown.map(itemRow)}</Card> : null}
          {visibleBlocks.map((b) => (
            <Card key={b.head.id} style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
              <View style={[{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }, b.items.filter(shown).length === 0 && fadedStyle]}>
                <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
                  {b.head.title}
                </AppText>
                <CountPill count={b.items.filter(shown).length} />
              </View>
              {b.items.filter(shown).length ? b.items.filter(shown).map(itemRow) : <AppText tone="muted" style={{ padding: space.md }}>這個區塊還沒有教材</AppText>}
            </Card>
          ))}
          {full.length ? <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>{full.map(itemRow)}</Card> : null}
        </View>
      );
    }
    return (
      <View style={{ gap: space.sm }}>
        {leadShown.length ? <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>{leadShown.map(itemRow)}</Card> : null}
        <ExpandGrid
          items={visibleBlocks}
          keyOf={(b) => b.head.id}
          cols={BLOCK_BEHAVIOR.columns}
          gap={GAP}
          defaultOpenId={openBlock}
          renderCell={(b, { on, dimmed, toggle, width: cell }) => (
            <Pressable nativeID={`blk-${b.head.id}`} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${b.head.title}，${on ? "點一下收合" : "點一下展開"}`} onPress={toggle} style={({ pressed }) => [{ width: cell, scrollMarginTop: 72 } as ViewStyle, dimmed || !b.items.some(shown) ? fadedStyle : null, pressed && { opacity: 0.75 }]}>
              <View style={{ width: cell, aspectRatio: 16 / 9, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#fff", borderWidth: on ? 3 : 1, borderColor: on ? c.accent : c.border }}>
                {b.head.coverUrl ? (
                  <Image source={{ uri: thumb(resolveUrl(b.head.coverUrl), 240) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : b.head.brand ? (
                  <BrandCover brand={b.head.brand} fill />
                ) : (
                  // 沒有封面圖：直接用文字當封面（業主 2026-11-18）
                  <CourseCover theme="" label="" title={b.head.title} fill />
                )}
                {/* 素材數＋展開／收起箭頭膠囊（業主 2026-11-18 款式 5） */}
                <View style={{ position: "absolute", right: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }} accessibilityLabel={`${b.items.filter(shown).length}個教材，${on ? "已展開" : "已收起"}`}>
                  <AppText variant="caption" style={{ color: c.textOnAccent, fontWeight: "800" }} {...({ dataSet: { noScale: "" } } as object)}>
                    {b.items.filter(shown).length}
                  </AppText>
                  <Ionicons name={on ? "chevron-up" : "chevron-down"} size={12} color={c.textOnAccent} />
                </View>
              </View>
              <AppText variant="headline" numberOfLines={2} style={{ marginTop: 6, fontWeight: "800", color: on ? c.accentText : c.text }}>
                {b.head.title}
              </AppText>
            </Pressable>
          )}
          renderPanel={(b) => (
            <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
              {b.items.filter(shown).length ? b.items.filter(shown).map(itemRow) : <AppText tone="muted" style={{ padding: space.md }}>這個區塊還沒有教材</AppText>}
            </Card>
          )}
        />
        {full.length ? <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>{full.map(itemRow)}</Card> : null}
      </View>
    );
  }
  const rows: Lesson[] = all.filter(shown);
  if (!rows.length) return null;
  return <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>{rows.map(itemRow)}</Card>;
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

/** 章節最右側的「分享」鈕：分享這一堂（網址帶 ?lesson=，點開直接停在這一堂）；分享者姓名、職稱、章節名稱一律取這一堂章節自己的設定，不用課程的。 */
function ChapterShare({ course, lesson }: { course: CourseDetail; lesson: Lesson }) {
  return (
    <RowShare
      label={`分享章節：${lesson.title}`}
      onShare={() => shareLink(lesson.title, lessonShareHref(course, lesson.position), { teacher: course.teacher ?? "", title: course.title }, undefined, { sharer: lesson.sharer ?? "", sharerTitle: lesson.sharerTitle ?? "", title: lesson.title })}
    />
  );
}
