import { isSuperAdmin } from "@/lib/roles";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type CourseDetail, type Lesson } from "@/api/client";
import { LessonArt } from "@/features/admin/lesson-art";
import { TYPE_INFO } from "@/features/link-types";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { SuggestField, SuggestList, useSuggestions } from "@/features/admin/suggest-input";
import { commitMediaDraft, emptyMediaDraft, MediaUploadModule, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, type MediaDraft } from "@/features/uploads";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { eventDays, minutesText, sharerLine } from "@/features/format";
import { AppText, Button, Card, DateSelect, Icon, NoticeBox, todayStr } from "@/ui";
import { Check } from "./course-sections";
import { EditSheet } from "./edit-sheet";
import { EditMaterialSheet } from "./material-sheet";

/** YouTube 影片沒有長度時（章節顯示 0 分鐘），自動偵測並寫回（只有網頁版的管理者畫面做）。 */
export function useYoutubeLengthFix(course: CourseDetail | null | undefined, enabled: boolean) {
  const { invalidate } = useSession();
  const [detecting, setDetecting] = useState(false);
  const detected = useRef(new Set<string>());
  useEffect(() => {
    const lessons = course?.lessons ?? [];
    const todo = lessons.filter((l) => l.media?.type === "youtube" && l.media.ref && l.minutes === 0 && !detected.current.has(l.id));
    if (!todo.length || !enabled) return;
    let alive = true;
    setDetecting(true);
    (async () => {
      let changed = false;
      for (const l of todo) {
        detected.current.add(l.id);
        const secs = await detectYoutubeSeconds(l.media!.ref!);
        if (!alive || !secs) continue;
        const len = l.end != null ? l.end - (l.start ?? 0) : secs - (l.start ?? 0);
        if (len > 0) {
          await api("PATCH", `/admin/lessons/${l.id}`, { minutes: Math.max(1, Math.ceil(len / 60)) }).catch(() => undefined);
          changed = true;
        }
      }
      if (alive) setDetecting(false);
      if (changed && alive) invalidate();
    })();
    return () => {
      alive = false;
    };
  }, [course, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return detecting;
}

/** 章節面板：新增與編輯同一個畫面（業主 2026-11-16）。教材（material）另有 material-sheet.tsx。 */
export function LessonSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  if (lesson.material) return <EditMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
  return <ChapterSheet course={course} lesson={lesson} onClose={onClose} />;
}

/** 新增章節：與編輯同一個面板，名稱、分享者、日期、影音、時間軸一次設定完，按「新增」後依序送出。 */
export function NewLessonSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  return <ChapterSheet course={course} onClose={onClose} />;
}

/** 一個章節的完整設定（分享者、名稱、日期、影片／音檔、時間軸、封面、逐字稿）；沒傳 lesson＝新增。 */
function ChapterSheet({ course, lesson, onClose }: { course: CourseDetail; lesson?: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const rankOptions = useRankOptions();
  const isNew = !lesson;
  const otherSpeaker = course.lessons.find((l) => !l.material && l.isSpeaker && l.id !== lesson?.id);
  const otherSummary = course.lessons.find((l) => !l.material && l.isSummary && l.id !== lesson?.id);
  const courseDate = course.eventStart ?? undefined;
  const allowMux = isSuperAdmin(member);

  const [title, setTitle] = useState(lesson?.title ?? "");
  const [sharer, setSharer] = useState(lesson?.sharer ?? "");
  const [sharerRank, setSharerRank] = useState(lesson?.sharerRank ?? "");
  const [sharerTitle, setSharerTitle] = useState(lesson?.sharerTitle ?? "");
  const [media, setMedia] = useState<MediaDraft>(() => (lesson ? mediaDraftOf(lesson) : emptyMediaDraft()));
  // 章節日期預設「同課程」（follow，業主 2026-11-16：勾選框一律顯示、預設打勾）：課程日期改了這堂跟著變；取消勾選才自己選日期。
  const [follow, setFollow] = useState(isNew ? true : !!lesson.dateFollows);
  const [eventDate, setEventDate] = useState(lesson?.eventDate ?? courseDate ?? todayStr());
  const ownDate = follow ? "" : eventDate;
  const [isSpeaker, setIsSpeaker] = useState(!!lesson?.isSpeaker);
  const [isSummary, setIsSummary] = useState(!!lesson?.isSummary);
  // 主講人與「總結與銷售課程」互斥：勾一個，另一個自動取消。
  const pickSpeaker = (v: boolean) => (setIsSpeaker(v), v && setIsSummary(false));
  // 勾「總結」：章節名稱鎖住、固定是「總結」（伺服器也會強制）。
  const pickSummary = (v: boolean) => {
    setIsSummary(v);
    if (v) {
      setIsSpeaker(false);
      setTitle(SUMMARY_TITLE);
    }
  };
  const sameAsCourse = follow;
  const [sharerFocus, setSharerFocus] = useState(false);
  const sharerHints = useSuggestions(sharer, "sharer_name", sharerFocus);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const mediaDone = useRef(false);
  const id = lesson?.id ?? createdId ?? undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  // 影片來源／長度等在別處（上傳音檔、選 Mux）改變後，欄位跟著重設成最新內容。
  const sig = `${lesson?.media?.type}:${lesson?.media?.ref}:${lesson?.coverUrl}:${lesson?.posterUrl}:${lesson?.minutes}`;
  useEffect(() => {
    if (lesson) setMedia(mediaDraftOf(lesson));
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeError = mediaDraftError(media);
  const currentKind = lesson?.media?.type ?? "demo";
  const dirty = lesson
    ? (!isSpeaker && (title !== lesson.title || sharer !== (lesson.sharer ?? "") || sharerRank !== (lesson.sharerRank ?? "") || sharerTitle !== (lesson.sharerTitle ?? ""))) ||
      ownDate !== (lesson.dateFollows ? "" : lesson.eventDate ?? "") ||
      isSpeaker !== !!lesson.isSpeaker ||
      isSummary !== !!lesson.isSummary ||
      mediaDraftDirty(media, lesson)
    : !!createdId || !!title || !!sharer || !!sharerRank || !!sharerTitle || isSpeaker || isSummary || mediaDraftDirty(media);

  const save = async () => {
    if (!lesson) return;
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, unknown> = { ...(isSpeaker ? {} : { title: isSummary ? SUMMARY_TITLE : title, sharer, sharerRank, sharerTitle }), eventDate: ownDate || null, isSpeaker, isSummary, ...mediaDraftBody(media) };
      await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      setMsg({ tone: "success", text: "已儲存" });
      invalidate();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // 新增：先建立章節，再依序送出影音設定與音檔。中途失敗時章節已建立，再按「新增」只補沒完成的部分（不會重複建立）。
  const create = async () => {
    if (!isSpeaker && !isSummary && !title.trim()) return setMsg({ tone: "danger", text: "請輸入章節名稱" });
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("create");
    setMsg(null);
    let made = !!createdId;
    try {
      let lessonId = createdId ?? undefined;
      if (!lessonId) {
        const before = new Set(course.lessons.map((l) => l.id));
        const detail = await api<CourseDetail>("POST", `/admin/courses/${course.id}/lessons`, { ...(isSpeaker ? {} : { title: isSummary ? SUMMARY_TITLE : title, sharer, sharerRank, sharerTitle }), ...(ownDate ? { eventDate: ownDate } : {}), isSpeaker, isSummary });
        lessonId = detail.lessons.find((l) => !before.has(l.id))?.id;
        if (!lessonId) throw Error("新增失敗，請重新整理後再試");
        setCreatedId(lessonId);
        made = true;
      }
      if (!mediaDone.current) {
        if (mediaDraftDirty(media)) await api("PATCH", `/admin/lessons/${lessonId}`, mediaDraftBody(media));
        await commitMediaDraft(lessonId, media);
        mediaDone.current = true;
      }
      invalidate();
      onClose();
    } catch (e) {
      invalidate();
      setMsg({ tone: "danger", text: `${made ? "章節已建立，但後續設定沒有全部完成：" : ""}${(e as Error).message}${made ? "。可再按「新增」補完。" : ""}` });
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    if (!lesson) return;
    setBusy("check");
    try {
      const r = await api<{ ok: boolean; message: string }>("GET", `/admin/lessons/${lesson.id}/check`);
      setMsg({ tone: r.ok ? "success" : "danger", text: r.message });
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const who = lesson ? `第 ${lesson.position} 堂` : "新章節";
  return (
    <EditSheet
      title={lesson ? `第 ${lesson.position} 堂：${lesson.title}` : "新增章節"}
      onClose={onClose}
      onSave={isNew ? create : undefined}
      saveLabel="新增"
      hideSave={!isNew}
      dirty={dirty}
      busy={busy === "create"}
      error={isNew && msg?.tone === "danger" ? msg.text : null}
    >
      {/* 「主講」「總結」兩個勾選同一列（業主 2026-11-16）；每門課各只能一堂、兩者互斥。 */}
      <View style={styles.checkRow}>
        <View style={{ flex: 1 }}>
          <Check label="主講" value={isSpeaker} onChange={pickSpeaker} />
        </View>
        <View style={{ flex: 1 }}>
          <Check label="總結" value={isSummary} onChange={pickSummary} />
        </View>
      </View>
      {isSpeaker && otherSpeaker ? <NoticeBox text={`目前「${otherSpeaker.title}」是主講，儲存後會改成這一堂。`} /> : null}
      {isSummary && otherSummary ? <NoticeBox text={`目前「${otherSummary.title}」是總結，儲存後會改成這一堂。`} /> : null}
      {isSpeaker ? (
        <SpeakerApplied course={{ title: course.title, teacher: course.teacher ?? "", teacherRank: course.teacherRank ?? "", teacherTitle: course.teacherTitle ?? "" }} />
      ) : (
        <>
          <View style={styles.twoCol}>
            <View style={{ flex: 2, gap: space.xs }}>
              <AppText variant="callout" tone="muted">
                分享者
              </AppText>
              <SuggestField value={sharer} onChange={setSharer} onFocusChange={setSharerFocus} placeholder="選填，輸入一個字出現建議" accessibilityLabel={`${who}分享者`} maxLength={60} />
            </View>
            <View style={{ flex: 3, gap: space.xs }}>
              <AppText variant="callout" tone="muted">
                章節名稱
              </AppText>
              <TextInput
                value={isSummary ? SUMMARY_TITLE : title}
                onChangeText={setTitle}
                editable={!isSummary}
                placeholder={isNew ? "例如：第 2 段 Q&A" : undefined}
                placeholderTextColor={c.textMuted}
                accessibilityLabel={`${who}名稱`}
                style={[styles.input, type.body, { color: isSummary ? c.textMuted : c.text, borderColor: c.border, backgroundColor: isSummary ? c.surfaceMuted : c.surface }]}
              />
            </View>
          </View>
          {sharerFocus ? <SuggestList list={sharerHints} q={sharer} onPick={(x) => (setSharer(x), setSharerFocus(false))} /> : null}
          <RankTitleRow rank={sharerRank} title={sharerTitle} onRank={setSharerRank} onTitle={setSharerTitle} rankOptions={rankOptions} who={`${who}分享者`} />
        </>
      )}
      {lesson && course.chapterCovers ? <LessonArt lesson={lesson} onChanged={invalidate} /> : null}
      <View style={styles.dateHead}>
        <AppText variant="callout" style={{ flex: 1 }}>
          活動日期
        </AppText>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sameAsCourse }} accessibilityLabel="日期同課程" onPress={() => (sameAsCourse ? setFollow(false) : (setFollow(true), courseDate && setEventDate(courseDate)))} style={styles.sameCheck}>
          <Icon name={sameAsCourse ? "checkbox" : "square-outline"} size={28} color={sameAsCourse ? c.accent : c.textMuted} />
          <AppText variant="body">同課程</AppText>
        </Pressable>
      </View>
      {sameAsCourse ? (
        <AppText variant="body" tone="muted">
          {courseDate ? `${courseDate.replace(/-/g, "/")}（同課程日期）` : "同課程日期（課程還沒設定日期；課程設定後這堂自動跟著）"}
        </AppText>
      ) : (
        <DateSelect value={eventDate} onChange={setEventDate} />
      )}
      <MediaUploadModule draft={media} onChange={setMedia} allowMux={allowMux} lesson={lesson} lessonId={id} onUploaded={invalidate} onBusyChange={(b) => setBusy(b ? "upload" : null)} lengthLabel="本堂長度" />
      {isNew && (allowMux || course.chapterCovers) ? (
        <AppText variant="caption" tone="muted">
          {[allowMux ? "Mux 影片" : "", course.chapterCovers ? "章節封面" : ""].filter(Boolean).join("、")}要在章節建立後，再點章節旁的鉛筆設定。
        </AppText>
      ) : null}
      {!isNew && msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      {!isNew ? (
        <View style={styles.row}>
          <Button label="儲存" icon="save-outline" loading={busy === "save"} disabled={!!busy} onPress={save} />
          {currentKind === "mux" || currentKind === "audio" ? <Button variant="secondary" label="播放檢查" icon="pulse-outline" loading={busy === "check"} disabled={!!busy} onPress={check} /> : null}
        </View>
      ) : null}
    </EditSheet>
  );
}

/** 勾了「總結」的章節，名稱固定為這兩個字（伺服器也會強制）。 */
const SUMMARY_TITLE = "總結";

/** 勾了主講人：名稱、分享者、獎銜、職稱欄位隱藏，直接套用課程基本資料（伺服器也會強制同步），這裡只顯示套用結果。 */
function SpeakerApplied({ course }: { course: { title: string; teacher: string; teacherRank: string; teacherTitle: string } }) {
  // 課程基本資料沒填主講人時，章節就沒有名字、獎銜、職稱可以顯示：直接提醒去填。
  if (!course.teacher.trim()) return <NoticeBox tone="danger" text="課程基本資料還沒填「主講人」，所以這一堂不會顯示名字、獎銜、職稱。請先到課程的「基本資料」填寫主講人，章節會自動同步。" />;
  return <NoticeBox text={`章節名稱、分享者、獎銜、職稱直接套用課程基本資料：${[course.title, course.teacher, course.teacherTitle].filter(Boolean).join("・")}`} />;
}

/** 課程頁編輯模式的章節／教材清單（同一個元件，兩組共用）：每列＝名稱（點了編輯）＋小按鈕 ↑ ↓ 複製 編輯 刪除（32px，讓名稱有空間）。 */
export function EditLessonRows({ group, word, onEdit, onMove, onCopy, onDelete, busy }: { group: Lesson[]; word: string; onEdit: (l: Lesson) => void; onMove: (from: number, to: number) => void; onCopy: (l: Lesson) => void; onDelete: (l: Lesson) => void; busy: boolean }) {
  const { c } = useTheme();
  // 「完整版課程影片」永遠在最後一列：不能上下移、不能複製；其他列的上下移只在它們之間進行。
  const movable = group.filter((l) => !l.full).length;
  return (
    <Card style={{ paddingVertical: 0 }}>
      {group.map((lesson, i) => (
        <View key={lesson.id} style={[styles.lessonRow, { borderBottomColor: c.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`編輯${word} ${lesson.position}`} onPress={() => onEdit(lesson)} style={styles.lessonMain}>
            <AppText variant="body" numberOfLines={2}>
              {lesson.full ? lesson.title : `${lesson.position}. ${lesson.title}`}
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {[lesson.linkType ? TYPE_INFO[lesson.linkType].label : lesson.ready ? (lesson.kind === "audio" ? "音檔" : lesson.media?.type === "youtube" ? "YouTube" : lesson.media?.type === "mux" ? "Mux" : "影片") : "尚未設定內容", sharerLine(lesson), minutesText(lesson.minutes), lesson.eventDate ? eventDays(lesson.eventDate, null) : ""].filter(Boolean).join(" · ")}
            </AppText>
          </Pressable>
          {lesson.full ? null : (
            <>
              <IconButton icon="arrow-up" label="上移" onPress={i > 0 ? () => onMove(i, i - 1) : undefined} disabled={busy} />
              <IconButton icon="arrow-down" label="下移" onPress={i < movable - 1 ? () => onMove(i, i + 1) : undefined} disabled={busy} />
              <IconButton icon="copy-outline" label={`複製${word} ${lesson.position}`} onPress={() => onCopy(lesson)} disabled={busy} />
            </>
          )}
          <IconButton icon="create-outline" label={`編輯${word} ${lesson.position}`} onPress={() => onEdit(lesson)} disabled={busy} />
          <IconButton icon="trash-outline" label={`刪除${word} ${lesson.position}`} onPress={() => onDelete(lesson)} disabled={busy} danger />
        </View>
      ))}
    </Card>
  );
}

export function IconButton({ icon, label, onPress, disabled, danger }: { icon: "arrow-up" | "arrow-down" | "trash-outline" | "create-outline" | "copy-outline"; label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  const { c } = useTheme();
  const off = disabled || !onPress;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} style={[styles.iconBtn, { borderColor: c.border, opacity: off ? 0.35 : 1 }]}>
      <Icon name={icon} size={16} color={danger ? c.danger : c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  twoCol: { flexDirection: "row", gap: space.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dateHead: { flexDirection: "row", alignItems: "center" },
  sameCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingLeft: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  iconBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  lessonMain: { flex: 1, minWidth: 0, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm },
});
