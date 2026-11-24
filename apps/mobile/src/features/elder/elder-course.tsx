import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import type { CourseDetail, Lesson } from "@/api/client";
import { centerTitle } from "@/features/format";
import { downloadMaterial, isDownloadUrl } from "@/lib/download-material";
import { trackFeature } from "@/lib/feature-track";
import { flashText } from "@/ui/flash-notice";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText, NoticeBox, Screen } from "@/ui";

/** 至尊模式課程頁要列的項目：有章節列章節；只有教材（清單卡）就列教材。分類標題、完整版不列。 */
export function elderItems(course: CourseDetail): Lesson[] {
  const chapters = course.lessons.filter((l) => !l.material && !l.section && !l.full);
  return chapters.length ? chapters : course.lessons.filter((l) => l.material && !l.section && !l.full);
}

/**
 * 有章節時，課程頁最後面另外列「其他教材」：完整版影片＋其他教材（簡報、文件、外部連結、下載）。
 * 超派模式的課程頁都有這一區，至尊模式原本漏掉（業主 2026-11-24 要求對照超派模式補齊）。分類標題不列。
 */
export function elderExtras(course: CourseDetail): Lesson[] {
  if (!course.lessons.some((l) => !l.material && !l.section && !l.full)) return [];
  return [...course.lessons.filter((l) => l.full && !l.section), ...course.lessons.filter((l) => l.material && !l.section && !l.full)];
}

type BlockGroup = { head: Lesson; items: Lesson[] };
/** 切成：區塊前面沒歸區塊的教材＋各區塊（標題＋底下的教材）；沒有可看教材的區塊不列。 */
function splitBlocks(course: CourseDetail, shown: (l: Lesson) => boolean): { lead: Lesson[]; blocks: BlockGroup[] } {
  const lead: Lesson[] = [];
  const blocks: BlockGroup[] = [];
  for (const l of course.lessons.filter((x) => x.material)) {
    if (l.full) continue;
    if (l.section) blocks.push({ head: l, items: [] });
    else if (blocks.length) blocks[blocks.length - 1]!.items.push(l);
    else lead.push(l);
  }
  return { lead: lead.filter(shown), blocks: blocks.map((b) => ({ ...b, items: b.items.filter(shown) })).filter((b) => b.items.length) };
}

/** 區塊清單：每個區塊一張大列（標題＋教材數＋展開箭頭），預設全部收起、同一時間只展開一個（與超派模式 BLOCK_BEHAVIOR 一致）。 */
function BlockList({ lead, blocks, playingId, renderRow }: { lead: Lesson[]; blocks: BlockGroup[]; playingId: string | null; renderRow: (l: Lesson) => ReactNode }) {
  const { c } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {lead.map(renderRow)}
      {blocks.map((b) => {
        const on = open === b.head.id;
        const hasPlaying = b.items.some((l) => l.id === playingId);
        return (
          <View key={b.head.id} style={{ gap: space.sm }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${b.head.title}，${b.items.length} 項教材，${on ? "點一下收起" : "點一下展開"}`} onPress={() => setOpen(on ? null : b.head.id)} style={[styles.block, { backgroundColor: on || hasPlaying ? c.accent : c.accentSoft }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="headline" style={{ color: on || hasPlaying ? c.textOnAccent : c.accentText, fontWeight: "800" }}>
                  {b.head.title}
                </AppText>
                <AppText variant="callout" style={{ color: on || hasPlaying ? c.textOnAccent : c.accentText }}>{`${b.items.length} 項教材`}</AppText>
              </View>
              <Ionicons name={on ? "chevron-up" : "chevron-down"} size={26} color={on || hasPlaying ? c.textOnAccent : c.accentText} />
            </Pressable>
            {on ? b.items.map(renderRow) : null}
          </View>
        );
      })}
    </>
  );
}

/** 其他教材若是外部連結／下載檔案，點下去開連結或下載（和超派模式的教材列一樣），不是播放。 */
function openMaterial(l: Lesson): boolean {
  if (!l.linkType || l.full || !l.linkUrl) return false;
  trackFeature("open_material");
  if (isDownloadUrl(l.linkUrl)) void downloadMaterial(l.linkUrl);
  else void Linking.openURL(l.linkUrl).catch(() => flashText("無法開啟連結"));
  return true;
}

/**
 * 至尊模式的課程頁（業主 2026-11-24，B 方案；課程頁採方案 2）：上方兩個大分頁「上課／介紹」。
 * 上課＝下一課排第一、最顯眼（正在播放的那一課優先），接著其他還沒上的，已上完的放最後（淡色）；整列都能點。
 * 介紹＝封面（EDM）、課程名稱、主講人、堂數與時間、費用、報名按鈕。沒有「唸給我聽」（教材本身都是影音）。
 * 播放中：播放器固定在分頁上方，兩頁都看得到。沒有編輯、留言板、加入我的清單。
 */
export function ElderCourse({
  course,
  player,
  cover,
  announce,
  playingId,
  onPlay,
  action,
  notice,
  message,
  locked,
  lockedLines,
}: {
  course: CourseDetail;
  /** 播放器（還沒播放為 null）。 */
  player: ReactNode;
  /** 介紹頁的封面（EDM）。 */
  cover: ReactNode;
  /** 主辦中心與所屬系列的公告（介紹頁最上面；和超派模式課程頁同一條）。 */
  announce?: ReactNode;
  playingId: string | null;
  onPlay: (id: string) => void;
  /** 報名／審核中按鈕（沒有為 null）。 */
  action: ReactNode;
  /** 不能報名時的說明（費用未公布、獎銜不符…）。 */
  notice: ReactNode;
  /** 報名結果、播放錯誤等訊息。 */
  message: ReactNode;
  locked: boolean;
  lockedLines: string[];
}) {
  const { c } = useTheme();
  const [tab, setTab] = useState<"learn" | "intro">(locked ? "intro" : "learn");
  const items = elderItems(course);
  const can = (l: Lesson) => !l.locked && (l.ready || !!l.linkUrl);
  const current = items.find((l) => l.id === playingId);
  const next = current ?? items.find((l) => can(l) && !l.completed) ?? null;
  const rest = items.filter((l) => l !== next);
  const extras = elderExtras(course);
  // 區塊（清單卡的「區塊 > 教材」，業主 2026-11-24：至尊模式也要顯示、預設收起）：區塊底下的教材＝排在它後面、下一個區塊之前；超派模式 `lesson-list.tsx` 同一規則。
  const blockMode = course.lessons.some((l) => l.section);
  const blocks = splitBlocks(course, (l) => l.ready || !!l.linkUrl);
  const ordered = [...(next ? [next] : []), ...rest.filter((l) => !l.completed), ...rest.filter((l) => l.completed)];
  const done = items.filter((l) => l.completed).length;
  const word = items.some((l) => !l.material) ? "課" : "部";
  const fee = course.isList ? null : course.priceTba ? "費用尚未公布" : course.free || course.freeNow || course.watchFree ? "免費" : course.priceTwd != null ? `NT$ ${course.priceTwd.toLocaleString()}` : "付費課程";
  const date = course.eventStart ? (course.eventEnd && course.eventEnd !== course.eventStart ? `${course.eventStart} ～ ${course.eventEnd}` : course.eventStart) : null;
  const teacher = course.noSpeaker ? "" : [course.teacherTitle, course.teacher].filter(Boolean).join(" ");
  return (
    <View style={{ flex: 1 }}>
      {player}
      <Screen header={false} footer={tab === "intro" ? action : null}>
        <View style={[styles.tabs, { backgroundColor: c.surfaceMuted }]} accessibilityRole="tablist">
          {(
            [
              { key: "learn", label: "上課", icon: "play" },
              { key: "intro", label: "介紹", icon: "book" },
            ] as const
          ).map((t) => {
            const on = tab === t.key;
            return (
              <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(t.key)} style={[styles.tab, on && { backgroundColor: c.accent }]}>
                <Ionicons name={t.icon} size={22} color={on ? c.textOnAccent : c.textMuted} />
                <AppText variant="headline" style={{ color: on ? c.textOnAccent : c.textMuted }}>
                  {t.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="title" accessibilityRole="header">
          {course.title}
        </AppText>
        {message}
        {tab === "learn" ? (
          <>
            {items.length ? (
              <AppText tone="muted">{done ? `已上完 ${done} ${word}，共 ${items.length} ${word}` : `共 ${items.length} ${word}`}</AppText>
            ) : (
              <NoticeBox text="課程內容準備中，敬請期待。" />
            )}
            {locked ? (
              <Pressable accessibilityRole="button" onPress={() => setTab("intro")} style={[styles.lockBox, { backgroundColor: c.warningSoft, borderColor: c.warning }]}>
                <Ionicons name="lock-closed" size={28} color={c.warning} />
                <View style={{ flex: 1 }}>
                  {lockedLines.map((t) => (
                    <AppText key={t} variant="headline" style={{ color: c.warning }}>
                      {t}
                    </AppText>
                  ))}
                  <AppText tone="muted">按這裡看介紹與報名</AppText>
                </View>
              </Pressable>
            ) : null}
            {blockMode ? (
              <BlockList
                lead={blocks.lead}
                blocks={blocks.blocks}
                playingId={playingId}
                renderRow={(l) => <LessonRow key={l.id} lesson={l} highlight={false} playing={l.id === playingId} onPress={() => (can(l) ? (openMaterial(l) ? undefined : onPlay(l.id)) : l.locked ? setTab("intro") : undefined)} />}
              />
            ) : null}
            {(blockMode ? [] : ordered).map((l) => (
              <LessonRow key={l.id} lesson={l} highlight={l === next} playing={l.id === playingId} onPress={() => (can(l) ? (openMaterial(l) ? undefined : onPlay(l.id)) : l.locked ? setTab("intro") : undefined)} />
            ))}
            {extras.length ? (
              <>
                <AppText variant="title" accessibilityRole="header" style={{ marginTop: space.md }}>
                  其他教材
                </AppText>
                {extras.map((l) => (
                  <LessonRow key={l.id} lesson={l} highlight={false} playing={l.id === playingId} onPress={() => (l.locked ? setTab("intro") : can(l) ? (openMaterial(l) ? undefined : onPlay(l.id)) : undefined)} />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <>
            {announce}
            {cover}
            <View style={[styles.info, { backgroundColor: c.surface, borderColor: c.border }]}>
              {teacher ? <InfoLine icon="person" text={`主講：${teacher}`} /> : null}
              {items.length ? <InfoLine icon="list" text={`${items.length} ${word}${course.totalMinutes ? `・約 ${Math.round(course.totalMinutes)} 分鐘` : ""}`} /> : null}
              {date ? <InfoLine icon="calendar" text={date} /> : null}
              {!course.isList && !course.locationNone && (course.isOnline || course.location) ? <InfoLine icon="location" text={course.isOnline ? "線上課程" : course.location} /> : null}
              {course.hostCenter ? <InfoLine icon="business" text={centerTitle(course.hostCenter)} /> : null}
              {fee ? <InfoLine icon="pricetag" text={`費用：${fee}`} /> : null}
              {course.enrollment === "opened" ? <InfoLine icon="checkmark-circle" text="你已報名，可以上課了" strong /> : null}
            </View>
            {notice}
            {course.enrollment === "opened" && items.some(can) ? (
              <Pressable accessibilityRole="button" onPress={() => setTab("learn")} style={[styles.go, { backgroundColor: c.accent }]}>
                <Ionicons name="play" size={26} color={c.textOnAccent} />
                <AppText variant="title" style={{ color: c.textOnAccent }}>
                  去上課
                </AppText>
              </Pressable>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}

function InfoLine({ icon, text, strong }: { icon: "person" | "list" | "calendar" | "location" | "business" | "pricetag" | "checkmark-circle"; text: string; strong?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={styles.infoLine}>
      <Ionicons name={icon} size={22} color={c.accent} />
      <AppText style={[{ flex: 1 }, strong && { color: c.accentText, fontWeight: "700" }]}>{text}</AppText>
    </View>
  );
}

/** 一課一列：下一課（或正在播放）是實心綠底大列；已上完的淡色打勾；鎖住的顯示鎖頭。 */
function LessonRow({ lesson: l, highlight, playing, onPress }: { lesson: Lesson; highlight: boolean; playing: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const fg = highlight ? c.textOnAccent : c.text;
  const circle = Math.round(44 * UI_SCALE);
  const link = !!l.linkType && !l.full && !!l.linkUrl;
  const status = !l.ready && !link ? "敬請期待" : l.locked ? "報名後才能看" : link ? (isDownloadUrl(l.linkUrl!) ? "按一下下載" : "按一下開啟") : playing ? "播放中" : l.minutes ? `${Math.max(1, Math.round(l.minutes))} 分鐘` : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`第 ${l.position} ${l.material ? "部" : "課"}：${l.title}${l.completed ? "，已上完" : ""}${status ? `，${status}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        highlight ? { backgroundColor: c.accent, borderColor: c.accent, minHeight: 96 } : { backgroundColor: c.surface, borderColor: c.border },
        l.completed && !highlight && { opacity: 0.6 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.num, { width: circle, height: circle, backgroundColor: highlight ? c.textOnAccent : c.accentSoft }]}>
        {l.completed ? <Ionicons name="checkmark" size={24} color={c.accent} /> : <AppText variant="headline" style={{ color: c.accent }}>{String(l.position)}</AppText>}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="headline" numberOfLines={3} style={{ color: fg }}>
          {l.title}
        </AppText>
        {status ? (
          <AppText variant="callout" style={{ color: highlight ? c.textOnAccent : c.textMuted }}>
            {status}
          </AppText>
        ) : null}
      </View>
      {l.locked ? <Ionicons name="lock-closed" size={26} color={c.textMuted} /> : l.ready || link ? <Ionicons name={link ? (isDownloadUrl(l.linkUrl!) ? "download-outline" : "open-outline") : playing ? "volume-high" : "play"} size={highlight ? 34 : 26} color={highlight ? c.navPill : c.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", borderRadius: radius.lg + 4, padding: 6, gap: 6 },
  tab: { flex: 1, minHeight: 60, borderRadius: radius.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 2, borderRadius: radius.lg + 4, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 76 },
  num: { borderRadius: 999, alignItems: "center", justifyContent: "center" },
  block: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: radius.lg + 4, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.md, minHeight: 76 },
  lockBox: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 2, borderRadius: radius.lg, padding: space.md },
  info: { borderWidth: 2, borderRadius: radius.lg + 4, padding: space.md, gap: space.sm },
  infoLine: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  go: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 76, borderRadius: radius.lg + 4 },
});
