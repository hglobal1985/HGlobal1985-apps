import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type CourseDetail, type Lesson } from "@/api/client";
import { LessonArt } from "@/features/admin/lesson-art";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { FileUploadModule, MediaUploadModule, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, mediaKindLabel, type MediaDraft } from "@/features/uploads";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { eventDays, sharerLine } from "@/features/format";
import { AppText, Button, Card, DateSelect, Icon, NoticeBox, Pill, todayStr, type SelectOption } from "@/ui";
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

/** 一個章節的完整設定（名稱、分享者、日期、影片／音檔、時間軸、封面、附件、逐字稿），從下方彈出。 */
export function LessonSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  if (lesson.material) return <EditMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
  return <ChapterSheet course={course} lesson={lesson} onClose={onClose} />;
}

function ChapterSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  const { member, invalidate } = useSession();
  const rankOptions = useRankOptions();
  const lessons = course.lessons.filter((l) => !l.material);
  const i = lessons.findIndex((l) => l.id === lesson.id);
  const [dirty, setDirty] = useState(false);
  return (
    <EditSheet title={`第 ${lesson.position} 堂：${lesson.title}`} onClose={onClose} dirty={dirty} hideSave>
      <LessonEditor
        key={`${lesson.id}:${lesson.media?.type}:${lesson.media?.ref}:${lesson.coverUrl}:${lesson.posterUrl}:${lesson.minutes}`}
        lesson={lesson}
        prevDate={i > 0 ? lessons[i - 1]?.eventDate ?? undefined : undefined}
        allowMux={member?.role === "admin"}
        teacher={course.teacher ?? ""}
        teacherRank={course.teacherRank ?? ""}
        teacherTitle={course.teacherTitle ?? ""}
        rankOptions={rankOptions}
        chapterCovers={course.chapterCovers}
        courseDate={course.eventStart ?? undefined}
        otherSpeaker={course.lessons.find((l) => !l.material && l.isSpeaker && l.id !== lesson.id)}
        onSaved={invalidate}
        onDirty={setDirty}
      />
    </EditSheet>
  );
}

/** 新增章節（名稱、分享者），從下方彈出。「其他教材」另有獨立的新增頁面（material-sheet.tsx）。 */
export function NewLessonSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const word = "章節";
  const { c } = useTheme();
  const { invalidate } = useSession();
  const rankOptions = useRankOptions();
  const [title, setTitle] = useState("");
  const [sharer, setSharer] = useState("");
  const [rank, setRank] = useState("");
  const [job, setJob] = useState("");
  const [autoCover, setAutoCover] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tName = course.teacher ?? "";
  const tRank = course.teacherRank ?? "";
  const tJob = course.teacherTitle ?? "";
  const sameT = !!tName && sharer === tName && rank === tRank && job === tJob;
  const submit = async () => {
    if (!title.trim()) return setError(`請輸入${word}名稱`);
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/admin/courses/${course.id}/lessons`, { title, sharer, sharerRank: rank, sharerTitle: job, ...(course.eventStart ? {} : { eventDate: todayStr() }), autoCover, isSpeaker });
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title={`新增${word}`} onClose={onClose} onSave={submit} saveLabel="新增" dirty={!!title || !!sharer} busy={busy} error={error}>
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" tone="muted">
          {word}名稱
        </AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder="例如：第 2 段 Q&A" placeholderTextColor={c.textMuted} accessibilityLabel={`新${word}名稱`} style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
      </View>
      <SharerField value={sharer} onChange={setSharer} teacher={tName} same={sameT} onToggleSame={() => (setSharer(sameT ? "" : tName), setRank(sameT ? "" : tRank), setJob(sameT ? "" : tJob))} label="新章節分享者" />
      <RankTitleRow rank={rank} title={job} onRank={setRank} onTitle={setJob} rankOptions={rankOptions} readOnly={sameT} who="新章節分享者" />
      <SpeakerCheck value={isSpeaker} onChange={setIsSpeaker} other={course.lessons.find((l) => !l.material && l.isSpeaker)} />
      <Check label="自動抓取 YouTube 影片畫面當封面" value={autoCover} onChange={setAutoCover} />
      <AppText variant="caption" tone="muted">
        新增後再點{word}旁的鉛筆，設定影片、音檔與附件。設成 YouTube 影片後，封面就會自動用影片畫面。
      </AppText>
    </EditSheet>
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

/** 分享者欄位：右側「同主講人」勾選（課程有填主講人才出現）；勾選＝分享者就是主講人，輸入框收起來。 */
function SharerField({ value, onChange, teacher, same, onToggleSame, label }: { value: string; onChange: (v: string) => void; teacher: string; same: boolean; onToggleSame: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 2, gap: space.xs }}>
      <AppText variant="callout" tone="muted">
        分享者
      </AppText>
      {same ? (
        <View style={[styles.input, { justifyContent: "center", borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
          <AppText variant="body" tone="muted" numberOfLines={1}>
            {teacher}
          </AppText>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="選填"
          placeholderTextColor={c.textMuted}
          accessibilityLabel={label}
          style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
        />
      )}
      {teacher ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: same }} accessibilityLabel="分享者同主講人" onPress={onToggleSame} style={styles.sharerCheck}>
          <Icon name={same ? "checkbox" : "square-outline"} size={28} color={same ? c.accent : c.textMuted} />
          <AppText variant="callout">同主講人</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function LessonEditor({
  onDirty,
  lesson,
  onSaved,
  allowMux,
  prevDate,
  teacher,
  teacherRank,
  teacherTitle,
  courseDate,
  otherSpeaker,
  rankOptions,
  chapterCovers,
}: {
  /** 有沒有改了還沒儲存（關閉面板時提醒）。 */
  onDirty?: (dirty: boolean) => void;
  allowMux: boolean;
  /** 上一堂的活動日期（有才會顯示「同上」勾選）。 */
  prevDate?: string;
  /** 課程的活動日期（開始日；「同課程日期」勾選用，沒設定就不顯示勾選）。 */
  courseDate?: string;
  /** 目前已被設為主講人的「另一堂」（有的話，勾選這一堂時提示會轉移）。 */
  otherSpeaker?: Lesson;
  /** 課程主講人（姓名、獎銜、職稱；「同主講人」勾選用）。 */
  teacher: string;
  teacherRank: string;
  teacherTitle: string;
  rankOptions: SelectOption[];
  /** 課程勾選「章節各自設定封面」時才顯示封面設定。 */
  chapterCovers: boolean;
  lesson: Lesson;
  onSaved: () => void;
}) {
  const { c } = useTheme();
  const [title, setTitle] = useState(lesson.title);
  const [sharer, setSharer] = useState(lesson.sharer ?? "");
  const [sharerRank, setSharerRank] = useState(lesson.sharerRank ?? "");
  const [sharerTitle, setSharerTitle] = useState(lesson.sharerTitle ?? "");
  const sameT = !!teacher && sharer === teacher && sharerRank === teacherRank && sharerTitle === teacherTitle;
  const [media, setMedia] = useState<MediaDraft>(() => mediaDraftOf(lesson));
  const kind = media.kind;
  // 章節日期預設「跟著課程日期」（follow）：課程日期改了這堂跟著變；自己選了日期就不再跟著。
  const [follow, setFollow] = useState(!!courseDate && !!lesson.dateFollows);
  const [eventDate, setEventDate] = useState(lesson.eventDate ?? "");
  const ownDate = follow ? "" : eventDate;
  const [autoCover, setAutoCover] = useState(!!lesson.autoCover);
  const [isSpeaker, setIsSpeaker] = useState(!!lesson.isSpeaker);
  const sameAsPrev = !follow && !!prevDate && eventDate === prevDate;
  const sameAsCourse = follow;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  const rangeError = mediaDraftError(media);
  const currentKind = lesson.media?.type ?? "demo";
  const dirty =
    title !== lesson.title ||
    sharer !== (lesson.sharer ?? "") ||
    sharerRank !== (lesson.sharerRank ?? "") ||
    sharerTitle !== (lesson.sharerTitle ?? "") ||
    ownDate !== (lesson.dateFollows ? "" : lesson.eventDate ?? "") ||
    isSpeaker !== !!lesson.isSpeaker ||
    autoCover !== !!lesson.autoCover ||
    mediaDraftDirty(media, lesson);
  useEffect(() => onDirty?.(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, unknown> = { title, sharer, sharerRank, sharerTitle, eventDate: ownDate || null, autoCover, isSpeaker, ...mediaDraftBody(media) };
      await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      setMsg({ tone: "success", text: "已儲存" });
      onSaved();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
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

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.row}>
        <AppText variant="callout" tone="muted" style={{ flex: 1 }}>
          目前內容
        </AppText>
        <Pill label={mediaKindLabel(currentKind)} />
      </View>
      <View style={styles.twoCol}>
        <View style={{ flex: 3, gap: space.xs }}>
          <AppText variant="callout" tone="muted">
            章節名稱
          </AppText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            accessibilityLabel={`第 ${lesson.position} 堂名稱`}
            style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
          />
        </View>
        <SharerField value={sharer} onChange={setSharer} teacher={teacher} same={sameT} onToggleSame={() => (setSharer(sameT ? "" : teacher), setSharerRank(sameT ? "" : teacherRank), setSharerTitle(sameT ? "" : teacherTitle))} label={`第 ${lesson.position} 堂分享者`} />
      </View>
      <RankTitleRow rank={sharerRank} title={sharerTitle} onRank={setSharerRank} onTitle={setSharerTitle} rankOptions={rankOptions} readOnly={sameT} who={`第 ${lesson.position} 堂分享者`} />
      <SpeakerCheck value={isSpeaker} onChange={setIsSpeaker} other={otherSpeaker} />
      {kind === "youtube" ? <Check label="自動抓取 YouTube 影片畫面當封面" value={autoCover} onChange={setAutoCover} /> : null}
      {chapterCovers ? <LessonArt lesson={lesson} onChanged={onSaved} /> : null}
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
      <MediaUploadModule draft={media} onChange={setMedia} allowMux={allowMux} lesson={lesson} onUploaded={onSaved} onBusyChange={(b) => setBusy(b ? "upload" : null)} lengthLabel="本堂長度" />
      <FileUploadModule lessonId={lesson.id} />
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      <View style={styles.row}>
        <Button label="儲存" icon="save-outline" loading={busy === "save"} disabled={!!busy} onPress={save} />
        {currentKind === "mux" || currentKind === "audio" ? (
          <Button variant="secondary" label="播放檢查" icon="pulse-outline" loading={busy === "check"} disabled={!!busy} onPress={check} />
        ) : null}
      </View>
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
  sharerCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch },
  dateHead: { flexDirection: "row", alignItems: "center" },
  sameCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingLeft: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  iconBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  lessonMain: { flex: 1, minWidth: 0, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm },
});
