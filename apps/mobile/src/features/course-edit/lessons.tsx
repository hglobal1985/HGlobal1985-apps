import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type CourseDetail, type Lesson } from "@/api/client";
import { LessonArt } from "@/features/admin/lesson-art";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { commitMediaDraft, commitStagedAttachments, emptyMediaDraft, FileUploadModule, MediaUploadModule, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, mediaKindLabel, useStagedAttachments, type MediaDraft } from "@/features/uploads";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { eventDays, sharerLine } from "@/features/format";
import { AppText, Button, Card, DateSelect, Icon, NoticeBox, Pill, todayStr } from "@/ui";
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

/** 新增章節：與編輯同一個面板，名稱、分享者、日期、影音、時間軸、附件一次設定完，按「新增」後依序送出。 */
export function NewLessonSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  return <ChapterSheet course={course} onClose={onClose} />;
}

/** 一個章節的完整設定（名稱、分享者、日期、影片／音檔、時間軸、封面、附件、逐字稿）；沒傳 lesson＝新增。 */
function ChapterSheet({ course, lesson, onClose }: { course: CourseDetail; lesson?: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const rankOptions = useRankOptions();
  const isNew = !lesson;
  const chapters = course.lessons.filter((l) => !l.material);
  const idx = lesson ? chapters.findIndex((l) => l.id === lesson.id) : chapters.length;
  const prevDate = idx > 0 ? chapters[idx - 1]?.eventDate ?? undefined : undefined;
  const otherSpeaker = course.lessons.find((l) => !l.material && l.isSpeaker && l.id !== lesson?.id);
  const courseDate = course.eventStart ?? undefined;
  const allowMux = member?.role === "admin";

  const [title, setTitle] = useState(lesson?.title ?? "");
  const [sharer, setSharer] = useState(lesson?.sharer ?? "");
  const [sharerRank, setSharerRank] = useState(lesson?.sharerRank ?? "");
  const [sharerTitle, setSharerTitle] = useState(lesson?.sharerTitle ?? "");
  const [media, setMedia] = useState<MediaDraft>(() => (lesson ? mediaDraftOf(lesson) : emptyMediaDraft()));
  const kind = media.kind;
  // 章節日期預設「跟著課程日期」（follow）：課程日期改了這堂跟著變；自己選了日期就不再跟著。新增時預設也跟課程；課程沒設日期就預設今天。
  const [follow, setFollow] = useState(isNew ? !!courseDate : !!courseDate && !!lesson.dateFollows);
  const [eventDate, setEventDate] = useState(lesson?.eventDate ?? courseDate ?? todayStr());
  const ownDate = follow ? "" : eventDate;
  const [autoCover, setAutoCover] = useState(!!lesson?.autoCover);
  const [isSpeaker, setIsSpeaker] = useState(!!lesson?.isSpeaker);
  const sameAsPrev = !follow && !!prevDate && eventDate === prevDate;
  const sameAsCourse = follow;
  const staged = useStagedAttachments();
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
      autoCover !== !!lesson.autoCover ||
      mediaDraftDirty(media, lesson)
    : !!createdId || !!title || !!sharer || !!sharerRank || !!sharerTitle || isSpeaker || autoCover || mediaDraftDirty(media) || staged.items.length > 0;

  const save = async () => {
    if (!lesson) return;
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, unknown> = { ...(isSpeaker ? {} : { title, sharer, sharerRank, sharerTitle }), eventDate: ownDate || null, autoCover, isSpeaker, ...mediaDraftBody(media) };
      await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      setMsg({ tone: "success", text: "已儲存" });
      invalidate();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // 新增：先建立章節，再依序送出影音設定、音檔與附件。中途失敗時章節已建立，再按「新增」只補沒完成的部分（不會重複建立）。
  const create = async () => {
    if (!isSpeaker && !title.trim()) return setMsg({ tone: "danger", text: "請輸入章節名稱" });
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("create");
    setMsg(null);
    let made = !!createdId;
    try {
      let lessonId = createdId ?? undefined;
      if (!lessonId) {
        const before = new Set(course.lessons.map((l) => l.id));
        const detail = await api<CourseDetail>("POST", `/admin/courses/${course.id}/lessons`, { ...(isSpeaker ? {} : { title, sharer, sharerRank, sharerTitle }), ...(ownDate ? { eventDate: ownDate } : {}), autoCover, isSpeaker });
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
      await commitStagedAttachments(lessonId, staged.items, (done) => staged.setItems((x) => x.filter((i) => i.id !== done)));
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
      {lesson ? (
        <View style={styles.row}>
          <AppText variant="callout" tone="muted" style={{ flex: 1 }}>
            目前內容
          </AppText>
          <Pill label={mediaKindLabel(currentKind)} />
        </View>
      ) : null}
      <SpeakerCheck value={isSpeaker} onChange={setIsSpeaker} other={otherSpeaker} />
      {isSpeaker ? (
        <SpeakerApplied course={{ title: course.title, teacher: course.teacher ?? "", teacherRank: course.teacherRank ?? "", teacherTitle: course.teacherTitle ?? "" }} />
      ) : (
        <>
          <View style={styles.twoCol}>
            <View style={{ flex: 3, gap: space.xs }}>
              <AppText variant="callout" tone="muted">
                章節名稱
              </AppText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={isNew ? "例如：第 2 段 Q&A" : undefined}
                placeholderTextColor={c.textMuted}
                accessibilityLabel={`${who}名稱`}
                style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
              />
            </View>
            <SharerField value={sharer} onChange={setSharer} label={`${who}分享者`} />
          </View>
          <RankTitleRow rank={sharerRank} title={sharerTitle} onRank={setSharerRank} onTitle={setSharerTitle} rankOptions={rankOptions} who={`${who}分享者`} />
        </>
      )}
      {kind === "youtube" ? <Check label="自動抓取 YouTube 影片畫面當封面" value={autoCover} onChange={setAutoCover} /> : null}
      {lesson && course.chapterCovers ? <LessonArt lesson={lesson} onChanged={invalidate} /> : null}
      <View style={styles.dateHead}>
        <AppText variant="callout" style={{ flex: 1 }}>
          活動日期
        </AppText>
        {courseDate ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sameAsCourse }} accessibilityLabel="日期同課程日期" onPress={() => (sameAsCourse ? setFollow(false) : (setFollow(true), setEventDate(courseDate)))} style={styles.sameCheck}>
            <Icon name={sameAsCourse ? "checkbox" : "square-outline"} size={28} color={sameAsCourse ? c.accent : c.textMuted} />
            <AppText variant="body">同課程日期</AppText>
          </Pressable>
        ) : null}
        {prevDate ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sameAsPrev }} accessibilityLabel="日期同上一堂" onPress={() => (setFollow(false), setEventDate(sameAsPrev ? "" : prevDate))} style={styles.sameCheck}>
            <Icon name={sameAsPrev ? "checkbox" : "square-outline"} size={28} color={sameAsPrev ? c.accent : c.textMuted} />
            <AppText variant="body">同上</AppText>
          </Pressable>
        ) : null}
      </View>
      {sameAsPrev || sameAsCourse ? (
        <AppText variant="body" tone="muted">
          {(sameAsCourse ? courseDate ?? "" : eventDate).replace(/-/g, "/")}（{sameAsCourse ? "同課程日期" : "與上一堂相同"}）
        </AppText>
      ) : (
        <DateSelect value={eventDate} onChange={setEventDate} />
      )}
      <MediaUploadModule draft={media} onChange={setMedia} allowMux={allowMux} lesson={lesson} lessonId={id} onUploaded={invalidate} onBusyChange={(b) => setBusy(b ? "upload" : null)} lengthLabel="本堂長度" />
      <FileUploadModule lessonId={lesson?.id} staged={lesson ? undefined : staged} />
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

/** 勾了主講人：名稱、分享者、獎銜、職稱欄位隱藏，直接套用課程基本資料（伺服器也會強制同步），這裡只顯示套用結果。 */
function SpeakerApplied({ course }: { course: { title: string; teacher: string; teacherRank: string; teacherTitle: string } }) {
  return (
    <NoticeBox text={`章節名稱、分享者、獎銜、職稱直接套用課程基本資料：${[course.title, course.teacher, course.teacherTitle].filter(Boolean).join("・")}`} />
  );
}

/** 「主講人」勾選：同一門課只能有一堂（用於「全部課程 > 單元」的「只顯示主講人」）；已有別堂是主講人時，勾這一堂會轉移過來。 */
function SpeakerCheck({ value, onChange, other }: { value: boolean; onChange: (v: boolean) => void; other?: Lesson }) {
  return (
    <View style={{ gap: space.xs }}>
      <Check label="主講人（每門課只能有一堂）" value={value} onChange={onChange} />
      {value && other ? <NoticeBox text={`目前「${other.title}」是主講人，儲存後會改成這一堂。`} /> : null}
    </View>
  );
}

/** 分享者欄位（輸入姓名；選填）。 */
function SharerField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 2, gap: space.xs }}>
      <AppText variant="callout" tone="muted">
        分享者
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="選填"
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
      />
    </View>
  );
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
              {[lesson.ready ? (lesson.kind === "audio" ? "音檔" : lesson.media?.type === "youtube" ? "YouTube" : lesson.media?.type === "mux" ? "Mux" : "影片") : "尚未設定內容", sharerLine(lesson), lesson.minutes ? `${lesson.minutes} 分鐘` : "", lesson.eventDate ? eventDays(lesson.eventDate, null) : ""].filter(Boolean).join(" · ")}
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
  dateHead: { flexDirection: "row", alignItems: "center" },
  sameCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingLeft: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  iconBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  lessonMain: { flex: 1, minWidth: 0, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm },
});
