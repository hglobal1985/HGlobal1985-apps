import { useThumb } from "@/lib/thumb";
import { BLOCK_BEHAVIOR } from "@/features/courses/block-module";
import { useEffect } from "react";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, View, type ViewStyle } from "react-native";
import { resolveUrl, type CourseDetail, type Lesson } from "@/api/client";
import { eventDays, minutesText, sharerLine } from "@/features/format";
import { engine } from "@/features/player/engine";
import { lessonHref, lessonShareHref } from "@/lib/lesson-href";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { CourseCover } from "@/ui/course-cover";
import { AppText, BrandCover, Card, ListRow, LockMask, SaplingIcon } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";
import { SpeakerLead } from "./speaker-mark";
import { SummaryLead } from "./summary-mark";
import { ExpandGrid } from "./expand-grid";
import { CompactRow, LIST_CARD, ListSection, MetaLine } from "./compact-row";
import { NowPlayingIcon } from "@/ui/now-playing-icon";
import { UI_SCALE } from "@/theme/ui-scale";
import { MaterialRow, RowActions, RowShare, SectionActions } from "./material-rows";
import { BlockPhotos, blockPhotoCount, hasBlockPhotos } from "./block-photos";
import { BlockAlbum, BrowsePhotosRow } from "./block-album";
export { RowShare } from "./material-rows";

/**
 * 章節清單（學員看到的樣子）：課程介紹頁與中心頁「點課程彈出的選單」共用同一個元件，
 * 格式永遠一致；要改章節的呈現只改這裡。
 * 課程有兩堂以上章節時，每一列最右側有「分享」鈕（分享這一堂；姓名、職稱、主題取章節自己的設定，文字範本在「設定 > 分享預設值」）。
 * 課程介紹頁傳 onPlay／playingId＝點章節原地播放、正在播放那列顯示動畫三角形；沒傳（中心頁選單）＝進該課程頁並開始播放。
 */
export type LessonPlayProps = { playingId?: string | null; onPlay?: (lessonId: string) => void };
export function ChapterList({ course, style, playingId, onPlay, onBlockedPress }: { course: CourseDetail; style?: ViewStyle; /** 沒有權限（鎖住、準備中）的章節點下去的動作 */ onBlockedPress?: () => void } & LessonPlayProps) {
  const { c } = useTheme();
  const chapters = course.lessons.filter((l) => !l.material);
  const anyReady = chapters.some((l) => l.ready);
  return (
    <Card style={chapters.length === 0 || !anyReady ? { paddingVertical: 0, paddingHorizontal: space.sm, ...style } : { ...LIST_CARD, ...style }}>
      {chapters.length === 0 || !anyReady ? (
        <ListRow icon="hourglass-outline" title="敬請期待" subtitle="課程內容準備中" />
      ) : (
        // 章節列＝全站清單列 CompactRow（杜杜龍 2026-11-22：課程頁章節清單與「清單」頁同一套）：縮圖／圖示、第一行標題、第二行日期膠囊＋分鐘數＋主講人、右側分享鈕。
        chapters.map((lesson) => {
          const soon = !lesson.ready;
          const playing = playingId === lesson.id;
          const icon = soon ? "hourglass-outline" : lesson.locked ? "lock-closed-outline" : lesson.kind === "audio" ? "musical-notes-outline" : "play-circle-outline";
          const lead = !soon && lesson.completed ? <SaplingIcon /> : !soon && !lesson.locked ? (lesson.isSpeaker ? <SpeakerLead /> : lesson.isSummary ? <SummaryLead /> : undefined) : undefined;
          const text = soon ? "敬請期待" : [minutesText(lesson.minutes), sharerLine(lesson), lesson.completed ? "已完成" : ""].filter(Boolean).join(" · ");
          return (
            <CompactRow
              key={lesson.id}
              leading={
                <View style={{ width: Math.round(42 * UI_SCALE), alignItems: "center" }}>
                  {playing ? <NowPlayingIcon lessonId={lesson.id} /> : lead ?? <Ionicons name={icon} size={28} color={c.textMuted} />}
                </View>
              }
              highlight={playing}
              title={`${lesson.position}. ${lesson.title}`}
              meta={<MetaLine date={lesson.eventDate ? eventDays(lesson.eventDate, null) : undefined} text={text || undefined} />}
              actions={soon ? undefined : <RowActions course={course} lesson={lesson}>{chapters.length >= 2 ? <ChapterShare course={course} lesson={lesson} /> : null}</RowActions>}
              onPress={lesson.locked || soon ? onBlockedPress : playing ? () => engine.toggle() : () => (onPlay ? onPlay(lesson.id) : router.push(lessonHref(course.id, lesson.id) as never))} // 正在播放的這一列再點一下＝暫停／繼續
            />
          );
        })
      )}
    </Card>
  );
}

/**
 * 「其他教材」區塊的清單：外部連結教材（杜杜龍 2026-11-16）——最左側是連結類型的官方 Logo（取代播放鈕）、點一下開啟外部連結、
 * 最右側有「分享」鈕（系統分享選單；文字範本在「設定 > 分享預設值」）。沒有連結的列（完整版課程影片、尚未改版的舊教材）維持原本的播放樣子。
 */
export function FullVersionList({ course, playingId, onPlay, openBlock, layout = "thumb", onBrowsePhotos, albumOpen, onPhotosChanged }: { course: CourseDetail; /** 從上拉選單點某個區塊進來：該區塊展開並捲到它，其他區塊維持收起。 */ openBlock?: string; /** 清單卡頁右上角的切換（杜杜龍 2026-11-19）：縮圖＝區塊封面格；詳細列表＝全部教材一列一列（區塊名稱＋數量當分隔）。 */ layout?: "thumb" | "detail" | "album"; /** 區塊照片（杜杜龍 2026-11-24）：「瀏覽本區照片」跳到相簿分頁（要展開的區塊編號）。 */ onBrowsePhotos?: (blockId: string) => void; /** 相簿分頁要自動展開的區塊。 */ albumOpen?: string | null; onPhotosChanged?: () => void } & LessonPlayProps) {
  const thumb = useThumb();
  const { c } = useTheme();
  const isBlocks = course.lessons.some((l) => l.section);
  // 清單的區塊：預設全部收起（杜杜龍 2026-11-18）；點一張區塊卡才在下方展開教材，只展開一個；從上拉選單指定的那個一進來就展開。
  useEffect(() => {
    if (!openBlock || typeof document === "undefined") return;
    const t = setTimeout(() => document.getElementById(`blk-${openBlock}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    return () => clearTimeout(t);
  }, [openBlock]);
  const canEdit = !!course.can?.edit;
  const all = course.lessons.filter((l) => l.material);
  // 學員只看得到「有內容的項目」；區塊底下沒有任何可看項目就整個隱藏（管理者全部都看得到）。
  const shown = (l: Lesson) => l.ready || canEdit;
  const itemRow = (lesson: Lesson) => <MaterialRow key={lesson.id} course={course} lesson={lesson} playingId={playingId} onPlay={onPlay} />;
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
    if (layout === "album") return <BlockAlbum course={course} openId={albumOpen} onChanged={onPhotosChanged} />;
    const full = all.filter((l) => l.full && shown(l));
    const visibleBlocks = blocks.filter((b) => canEdit || b.items.some(shown) || hasBlockPhotos(b.head));
    const leadShown = lead.filter(shown);
    if (!visibleBlocks.length && !leadShown.length && !full.length) return null;
    // 欄數隨螢幕寬度自動變：手機 2 欄，越寬越多，最多 5 欄（杜杜龍 2026-11-18）。
    const GAP = space.sm;
    if (layout === "detail") {
      return (
        <View style={{ gap: space.sm }}>
          {leadShown.length ? <Card style={LIST_CARD}>{leadShown.map(itemRow)}</Card> : null}
          {visibleBlocks.map((b) => (
            <Card key={b.head.id} style={{ paddingVertical: 0, paddingHorizontal: space.sm, ...(b.head.blockLocked ? { position: "relative", minHeight: 230, overflow: "hidden" } : {}) }}>
              <ListSection title={b.head.title} count={b.items.filter(shown).length + blockPhotoCount(b.head)} actions={<SectionActions courseId={course.id} blockId={b.head.id} title={b.head.title} path={course.shortPath} />} />
              {onBrowsePhotos ? <BrowsePhotosRow head={b.head} onPress={() => onBrowsePhotos(b.head.id)} /> : <BlockPhotos head={b.head} />}
              {b.items.filter(shown).length ? b.items.filter(shown).map(itemRow) : hasBlockPhotos(b.head) ? null : <AppText tone="muted" style={{ padding: space.md }}>這個區塊還沒有教材</AppText>}
              {b.head.blockLocked ? <LockMask lines={b.head.lockLines ?? ["目前無法使用"]} /> : null}
            </Card>
          ))}
          {full.length ? <Card style={LIST_CARD}>{full.map(itemRow)}</Card> : null}
        </View>
      );
    }
    return (
      <View style={{ gap: space.sm }}>
        {leadShown.length ? <Card style={LIST_CARD}>{leadShown.map(itemRow)}</Card> : null}
        <ExpandGrid
          items={visibleBlocks}
          keyOf={(b) => b.head.id}
          cols={BLOCK_BEHAVIOR.columns}
          gap={GAP}
          defaultOpenId={openBlock}
          renderCell={(b, { on, dimmed, toggle, width: cell }) => (
            <Pressable nativeID={`blk-${b.head.id}`} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${b.head.title}，${on ? "點一下收合" : "點一下展開"}`} onPress={toggle} style={({ pressed }) => [{ width: cell, scrollMarginTop: 72 } as ViewStyle, dimmed || (!b.items.some(shown) && !hasBlockPhotos(b.head)) ? fadedStyle : null, pressed && { opacity: 0.75 }]}>
              <View style={{ width: cell, aspectRatio: 16 / 9, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#fff", borderWidth: on ? 3 : 1, borderColor: on ? c.accent : c.border }}>
                {b.head.coverUrl ? (
                  <Image source={{ uri: thumb(resolveUrl(b.head.coverUrl), 240) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
                ) : b.head.brand ? (
                  <BrandCover brand={b.head.brand} fill />
                ) : (
                  // 沒有封面圖：直接用文字當封面（杜杜龍 2026-11-18）
                  <CourseCover theme="" label="" title={b.head.title} fill />
                )}
                {/* 素材數＋展開／收起箭頭膠囊（杜杜龍 2026-11-18 款式 5） */}
                <View style={{ position: "absolute", right: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1, borderColor: c.accent, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }} accessibilityLabel={`${b.items.filter(shown).length}個教材，${on ? "已展開" : "已收起"}`}>
                  <AppText variant="caption" style={{ color: c.accentText, fontWeight: "800" }} {...({ dataSet: { noScale: "" } } as object)}>
                    {b.items.filter(shown).length + blockPhotoCount(b.head)}
                  </AppText>
                  <Ionicons name={on ? "chevron-up" : "chevron-down"} size={12} color={c.accentText} />
                </View>
              </View>
              <AppText variant="headline" numberOfLines={2} style={{ marginTop: 6, fontWeight: "800", color: on ? c.accentText : c.text }}>
                {b.head.title}
              </AppText>
            </Pressable>
          )}
          renderPanel={(b) => (
            <Card style={[LIST_CARD, b.head.blockLocked ? { position: "relative", minHeight: 230, overflow: "hidden" } : null]}>
              {onBrowsePhotos ? <BrowsePhotosRow head={b.head} onPress={() => onBrowsePhotos(b.head.id)} /> : <BlockPhotos head={b.head} />}
              {b.items.filter(shown).length ? b.items.filter(shown).map(itemRow) : hasBlockPhotos(b.head) ? null : <AppText tone="muted" style={{ padding: space.md }}>這個區塊還沒有教材</AppText>}
              {b.head.blockLocked ? <LockMask lines={b.head.lockLines ?? ["目前無法使用"]} /> : null}
            </Card>
          )}
        />
        {full.length ? <Card style={LIST_CARD}>{full.map(itemRow)}</Card> : null}
      </View>
    );
  }
  const rows: Lesson[] = all.filter(shown);
  if (!rows.length) return null;
  return <Card style={LIST_CARD}>{rows.map(itemRow)}</Card>;
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
