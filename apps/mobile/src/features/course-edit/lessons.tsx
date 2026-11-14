import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type CourseDetail, type Lesson, type MediaType } from "@/api/client";
import { pickAndUploadAudio } from "@/features/admin/audio-upload";
import { LessonArt } from "@/features/admin/lesson-art";
import { LessonTranscript } from "@/features/admin/lesson-transcript";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { AttachmentManager } from "@/features/attachments";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, DateSelect, Icon, NoticeBox, Pill, todayStr, type SelectOption } from "@/ui";
import { EditSheet } from "./edit-sheet";

const kinds: { key: MediaType; label: string }[] = [
  { key: "demo", label: "示範短片" },
  { key: "youtube", label: "YouTube" },
  { key: "mux", label: "Mux" },
  { key: "audio", label: "音檔" },
];

type Hms = { h: string; m: string; s: string };
const toHms = (sec: number | null): Hms =>
  sec == null ? { h: "", m: "", s: "" } : { h: String(Math.floor(sec / 3600)), m: String(Math.floor((sec % 3600) / 60)), s: String(sec % 60) };
const fromHms = ({ h, m, s }: Hms): number | null | "invalid" => {
  if (!h.trim() && !m.trim() && !s.trim()) return null;
  const [a, b, c] = [h, m, s].map((x) => (x.trim() ? Number(x) : 0));
  if (![a, b, c].every((n) => Number.isInteger(n) && n >= 0) || b > 59 || c > 59) return "invalid";
  return a * 3600 + b * 60 + c;
};
const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h} 小時 ${m} 分 ${s} 秒` : `${m} 分 ${s} 秒`;
};

/** YouTube 影片沒有長度時（章節顯示 0 分鐘），自動偵測並寫回（只有網頁版的管理者畫面做）。 */
export function useYoutubeLengthFix(course: CourseDetail | null | undefined, enabled: boolean) {
  const { invalidate } = useSession();
  const [detecting, setDetecting] = useState(false);
  const detected = useRef(new Set<string>());
  useEffect(() => {
    const lessons = (course?.lessons ?? []).filter((l) => !l.full);
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
  const { member, invalidate } = useSession();
  const rankOptions = useRankOptions();
  const lessons = course.lessons.filter((l) => !l.full);
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
        onSaved={invalidate}
        onDirty={setDirty}
      />
    </EditSheet>
  );
}

/** 新增章節（名稱、分享者），從下方彈出。 */
export function NewLessonSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  const rankOptions = useRankOptions();
  const [title, setTitle] = useState("");
  const [sharer, setSharer] = useState("");
  const [rank, setRank] = useState("");
  const [job, setJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tName = course.teacher ?? "";
  const tRank = course.teacherRank ?? "";
  const tJob = course.teacherTitle ?? "";
  const sameT = !!tName && sharer === tName && rank === tRank && job === tJob;
  const submit = async () => {
    if (!title.trim()) return setError("請輸入章節名稱");
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/admin/courses/${course.id}/lessons`, { title, sharer, sharerRank: rank, sharerTitle: job, eventDate: course.eventStart ?? todayStr() });
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="新增章節" onClose={onClose} onSave={submit} saveLabel="新增" dirty={!!title || !!sharer} busy={busy} error={error}>
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" tone="muted">
          章節名稱
        </AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder="例如：第 2 段 Q&A" placeholderTextColor={c.textMuted} accessibilityLabel="新章節名稱" style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
      </View>
      <SharerField value={sharer} onChange={setSharer} teacher={tName} same={sameT} onToggleSame={() => (setSharer(sameT ? "" : tName), setRank(sameT ? "" : tRank), setJob(sameT ? "" : tJob))} label="新章節分享者" />
      <RankTitleRow rank={rank} title={job} onRank={setRank} onTitle={setJob} rankOptions={rankOptions} readOnly={sameT} who="新章節分享者" />
      <AppText variant="caption" tone="muted">
        新增後再點章節旁的鉛筆，設定影片、音檔與附件。
      </AppText>
    </EditSheet>
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

function TimeInput({ label, value, onChange }: { label: string; value: Hms; onChange: (v: Hms) => void }) {
  const { c } = useTheme();
  const box = (k: keyof Hms, unit: string) => (
    <View style={styles.timeCell}>
      <TextInput
        value={value[k]}
        onChangeText={(t) => onChange({ ...value, [k]: t.replace(/\D/g, "").slice(0, 2) })}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={c.textMuted}
        accessibilityLabel={`${label}${unit}`}
        style={[styles.timeInput, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
      />
      <AppText variant="callout" tone="muted">
        {unit}
      </AppText>
    </View>
  );
  return (
    <View style={styles.timeRow}>
      <AppText variant="callout" style={{ width: 36 }}>
        {label}
      </AppText>
      {box("h", "時")}
      {box("m", "分")}
      {box("s", "秒")}
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
  const [kind, setKind] = useState<MediaType>(lesson.media?.type ?? "demo");
  const [ref, setRef] = useState(lesson.media?.type === "youtube" ? lesson.media.ref ?? "" : "");
  const [start, setStart] = useState(toHms(lesson.start));
  const [end, setEnd] = useState(toHms(lesson.end));
  const [eventDate, setEventDate] = useState(lesson.eventDate ?? "");
  const sameAsPrev = !!prevDate && eventDate === prevDate;
  const sameAsCourse = !!courseDate && eventDate === courseDate;
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  const s = fromHms(start);
  const e = fromHms(end);
  const rangeError = s === "invalid" || e === "invalid" ? "時間格式不正確（分、秒需在 0～59）" : e != null && (s ?? 0) >= e ? "結束時間必須晚於開始時間" : null;
  const length = !rangeError && e != null ? (e as number) - ((s as number | null) ?? 0) : null;
  const currentKind = lesson.media?.type ?? "demo";
  const dirty =
    title !== lesson.title ||
    sharer !== (lesson.sharer ?? "") ||
    sharerRank !== (lesson.sharerRank ?? "") ||
    sharerTitle !== (lesson.sharerTitle ?? "") ||
    eventDate !== (lesson.eventDate ?? "") ||
    (kind !== currentKind && (kind === "demo" || kind === "youtube")) ||
    (kind === "youtube" && ref !== (lesson.media?.type === "youtube" ? lesson.media.ref ?? "" : "")) ||
    JSON.stringify(start) !== JSON.stringify(toHms(lesson.start)) ||
    JSON.stringify(end) !== JSON.stringify(toHms(lesson.end));
  useEffect(() => onDirty?.(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, unknown> = { title, sharer, sharerRank, sharerTitle, startSeconds: s, endSeconds: e, eventDate: eventDate || null };
      if (kind === "demo" || kind === "youtube") body.mediaType = kind;
      if (kind === "youtube") body.mediaRef = ref;
      await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      setMsg({ tone: "success", text: "已儲存" });
      onSaved();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const upload = async () => {
    setBusy("upload");
    setMsg(null);
    try {
      const r = await pickAndUploadAudio(lesson.id, setProgress);
      if (r === "done") {
        setMsg({ tone: "success", text: "音檔已上傳" });
        onSaved();
      }
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
      setProgress(null);
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
        <Pill label={kinds.find((k) => k.key === currentKind)!.label} />
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
      {chapterCovers ? <LessonArt lesson={lesson} onChanged={onSaved} /> : null}
      <View style={styles.dateHead}>
        <AppText variant="callout" style={{ flex: 1 }}>
          活動日期
        </AppText>
        {courseDate ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sameAsCourse }} accessibilityLabel="日期同課程日期" onPress={() => setEventDate(sameAsCourse ? "" : courseDate)} style={styles.sameCheck}>
            <Icon name={sameAsCourse ? "checkbox" : "square-outline"} size={28} color={sameAsCourse ? c.accent : c.textMuted} />
            <AppText variant="body">同課程日期</AppText>
          </Pressable>
        ) : null}
        {prevDate ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sameAsPrev }} accessibilityLabel="日期同上一堂" onPress={() => setEventDate(sameAsPrev ? "" : prevDate)} style={styles.sameCheck}>
            <Icon name={sameAsPrev ? "checkbox" : "square-outline"} size={28} color={sameAsPrev ? c.accent : c.textMuted} />
            <AppText variant="body">同上</AppText>
          </Pressable>
        ) : null}
      </View>
      {sameAsPrev || sameAsCourse ? (
        <AppText variant="body" tone="muted">
          {eventDate.replace(/-/g, "/")}（{sameAsCourse ? "同課程日期" : "與上一堂相同"}）
        </AppText>
      ) : (
        <DateSelect value={eventDate} onChange={setEventDate} />
      )}
      <View style={styles.row}>
        {kinds.filter((k) => allowMux || k.key !== "mux" || kind === "mux").map((k) => {
          const active = k.key === kind;
          return (
            <Pressable
              key={k.key}
              onPress={() => setKind(k.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.chip, { backgroundColor: active ? c.accent : c.surface, borderColor: active ? c.accent : c.border }]}
            >
              <AppText variant="callout" style={{ color: active ? c.textOnAccent : c.text, fontWeight: "600" }}>
                {k.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {kind === "youtube" ? (
        <TextInput
          value={ref}
          onChangeText={setRef}
          placeholder="貼上 YouTube 影片網址（建議設為「不公開」）"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={`${lesson.title} YouTube 網址`}
          style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
        />
      ) : null}
      {kind === "mux" ? (
        <View style={{ gap: space.sm }}>
          {currentKind === "mux" && lesson.media?.ref ? (
            <AppText variant="callout" tone="muted">
              目前影片：{lesson.media.ref.slice(0, 8)}…
            </AppText>
          ) : null}
          <Button
            variant="secondary"
            label={currentKind === "mux" ? "更換 Mux 影片" : "從 Mux 選擇影片"}
            icon="cloud-download-outline"
            onPress={() => router.push({ pathname: "/admin/mux-picker", params: { lessonId: lesson.id, lessonTitle: lesson.title } })}
          />
        </View>
      ) : null}
      {kind === "audio" ? (
        <View style={{ gap: space.sm }}>
          {currentKind === "audio" ? (
            <AppText variant="callout" tone="muted">
              目前已有音檔（{lesson.minutes} 分鐘）
            </AppText>
          ) : null}
          <Button
            variant="secondary"
            label={progress != null ? `上傳中 ${Math.round(progress * 100)}%` : currentKind === "audio" ? "更換音檔" : "上傳音檔"}
            icon="musical-notes-outline"
            loading={busy === "upload" && progress == null}
            disabled={!!busy}
            onPress={upload}
          />
          {currentKind === "audio" ? <LessonTranscript lessonId={lesson.id} /> : null}
        </View>
      ) : null}

      <AppText variant="callout" tone="muted">
        時間軸區間（選填；空白＝從頭播到結束）
      </AppText>
      <TimeInput label="開始" value={start} onChange={setStart} />
      <TimeInput label="結束" value={end} onChange={setEnd} />
      {rangeError ? (
        <AppText variant="callout" tone="danger">
          {rangeError}
        </AppText>
      ) : length != null ? (
        <AppText variant="callout" tone="accent">
          本堂長度：{formatDuration(length)}
        </AppText>
      ) : null}
      <AttachmentManager lessonId={lesson.id} />
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

export function IconButton({ icon, label, onPress, disabled, danger }: { icon: "arrow-up" | "arrow-down" | "trash-outline" | "create-outline"; label: string; onPress?: () => void; disabled?: boolean; danger?: boolean }) {
  const { c } = useTheme();
  const off = disabled || !onPress;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} style={[styles.iconBtn, { borderColor: c.border, opacity: off ? 0.35 : 1 }]}>
      <Icon name={icon} size={18} color={danger ? c.danger : c.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  twoCol: { flexDirection: "row", gap: space.sm },
  sharerCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch },
  dateHead: { flexDirection: "row", alignItems: "center" },
  sameCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingLeft: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  chip: { minHeight: minTouch - 8, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  timeRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  timeCell: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeInput: { width: 56, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, textAlign: "center" },
  iconBtn: { width: minTouch - 4, height: minTouch - 4, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
