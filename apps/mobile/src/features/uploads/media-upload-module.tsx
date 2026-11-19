import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Lesson, MediaType } from "@/api/client";
import { LessonTranscript } from "@/features/admin/lesson-transcript";
import { audioDuration, pickAudio, uploadPickedAudio, type PickedAudio } from "@/features/admin/audio-upload";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Icon, NoticeBox } from "@/ui";
import { formatDuration, fromHms, toHms, type Hms } from "./hms";
import { TimeRangePicker } from "./time-range-picker";

/**
 * 【影音上傳模組】全站「設定影音來源＋時間軸區間」的唯一畫面與邏輯（章節編輯、其他教材新增／編輯都用它）。
 * 要新增匯入管道（例如 Vimeo、雲端硬碟…）：在下方 MEDIA_CHANNELS 加一項，所有用到的地方會同步出現，不要在別處另做。
 *
 * 兩種用法：
 * - 已有教材／章節（傳 lessonId）：音檔選完立刻上傳；其他欄位由呼叫端按「儲存」時用 mediaDraftBody 送出。
 * - 新增中（沒有 lessonId）：音檔先暫存在 draft.audio，建立後呼叫 commitMediaDraft 才上傳；Mux 需要已建立的教材，所以新增時不提供。
 */
/** toEnd＝「到影片結尾」勾選（只是畫面用的旗標，不會存檔；勾選後結束欄位自動填入影片最後一秒）。 */
export type MediaDraft = { kind: MediaType; ref: string; start: Hms; end: Hms; audio: PickedAudio | null; toEnd?: boolean };

export const emptyMediaDraft = (): MediaDraft => ({ kind: "demo", ref: "", start: toHms(null), end: toHms(null), audio: null });

export const mediaDraftOf = (lesson: Lesson): MediaDraft => ({
  kind: lesson.media?.type ?? "demo",
  ref: lesson.media?.type === "youtube" ? lesson.media.ref ?? "" : "",
  start: toHms(lesson.start),
  end: toHms(lesson.end),
  audio: null,
});

/** 時間軸格式或先後不對時的錯誤文字（沒有錯誤回 null）。 */
export function mediaDraftError(d: MediaDraft): string | null {
  const s = fromHms(d.start);
  const e = fromHms(d.end);
  if (s === "invalid" || e === "invalid") return "時間格式不正確（分、秒需在 0～59）";
  if (e != null && (s ?? 0) >= e) return "結束時間必須晚於開始時間";
  return null;
}

/** 跟原本的內容比，有沒有改動（lesson 沒給＝新增中，有填任何東西就算改動）。 */
export function mediaDraftDirty(d: MediaDraft, lesson?: Lesson): boolean {
  const base = lesson ? mediaDraftOf(lesson) : emptyMediaDraft();
  return (
    d.kind !== base.kind ||
    (d.kind === "youtube" && d.ref !== base.ref) ||
    !!d.audio ||
    JSON.stringify(d.start) !== JSON.stringify(base.start) ||
    JSON.stringify(d.end) !== JSON.stringify(base.end)
  );
}

/** 要送給 PATCH /admin/lessons/:id 的影音欄位（示範／YouTube 才送來源；Mux 與音檔各有自己的流程）。 */
export function mediaDraftBody(d: MediaDraft): Record<string, unknown> {
  const body: Record<string, unknown> = { startSeconds: fromHms(d.start) === "invalid" ? null : fromHms(d.start), endSeconds: fromHms(d.end) === "invalid" ? null : fromHms(d.end) };
  if (d.kind === "demo" || d.kind === "youtube") body.mediaType = d.kind;
  if (d.kind === "youtube") body.mediaRef = d.ref;
  return body;
}

/** 新增流程：教材建立後，把暫存的音檔上傳（沒有暫存就什麼都不做）。 */
export async function commitMediaDraft(lessonId: string, d: MediaDraft, onProgress?: (p: number) => void): Promise<void> {
  if (d.kind === "audio" && d.audio) await uploadPickedAudio(lessonId, d.audio, onProgress ?? (() => undefined));
}

type ChannelCtx = {
  draft: MediaDraft;
  set: (patch: Partial<MediaDraft>) => void;
  lesson?: Lesson;
  lessonId?: string;
  busy: boolean;
  progress: number | null;
  upload: () => void;
};

/** 匯入管道清單：新增管道＝加一項（label 是按鈕文字；staged＝新增中（還沒有教材）也能用；superAdminOnly＝只有超級管理員看得到）。 */
const MEDIA_CHANNELS: { key: MediaType; label: string; staged: boolean; superAdminOnly?: boolean; render: (ctx: ChannelCtx) => ReactNode }[] = [
  { key: "youtube", label: "YouTube", staged: true, render: (ctx) => <YoutubeInput {...ctx} /> },
  { key: "mux", label: "Mux", staged: false, superAdminOnly: true, render: (ctx) => <MuxInput {...ctx} /> },
  { key: "audio", label: "音檔", staged: true, render: (ctx) => <AudioInput {...ctx} /> },
];

/** 從使用者貼的 YouTube 網址或 11 碼編號取出影片編號（取不到回 null）。 */
function youtubeIdOf(ref: string): string | null {
  const s = ref.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(s)?.[1] ?? null;
}

/** 偵測這個來源的影音長度（秒）：YouTube（網頁版）、剛選好的音檔、已上傳的音檔／Mux（用章節長度估算，approx＝true）。 */
async function detectLength(draft: MediaDraft, lesson?: Lesson): Promise<{ sec: number | null; approx: boolean }> {
  let sec: number | null = null;
  if (draft.kind === "youtube" && youtubeIdOf(draft.ref)) sec = await detectYoutubeSeconds(youtubeIdOf(draft.ref)!);
  else if (draft.kind === "audio" && draft.audio) sec = await audioDuration(draft.audio.file);
  if (sec == null && lesson && lesson.media?.type === draft.kind && lesson.minutes > 0 && draft.kind !== "youtube") return { sec: lesson.minutes * 60, approx: true };
  return { sec, approx: false };
}

export const mediaKindLabel = (k: MediaType) => MEDIA_CHANNELS.find((ch) => ch.key === k)?.label ?? "";

export function MediaUploadModule({
  draft,
  onChange,
  allowMux,
  lesson,
  lessonId,
  onUploaded,
  onBusyChange,
  lengthLabel = "本段長度",
  showHint = true,
}: {
  draft: MediaDraft;
  onChange: (d: MediaDraft) => void;
  allowMux: boolean;
  /** 已存在的章節／教材（有的話才能顯示目前內容、選 Mux、顯示逐字稿）。 */
  lesson?: Lesson;
  lessonId?: string;
  /** 音檔上傳完成（已有教材時）。 */
  onUploaded?: () => void;
  onBusyChange?: (busy: boolean) => void;
  lengthLabel?: string;
  /** 顯示欄位的說明文字（例如「選填；空白＝從頭播到結束」）；教材頁不要說明就傳 false。 */
  showHint?: boolean;
}) {
  const { c } = useTheme();
  const id = lessonId ?? lesson?.id;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const set = (patch: Partial<MediaDraft>) => onChange({ ...draft, ...patch });

  const upload = async () => {
    setMsg(null);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const picked = await pickAudio();
      if (!picked) return;
      if (!id) return set({ kind: "audio", audio: picked });
      await uploadPickedAudio(id, picked, setProgress);
      setMsg({ tone: "success", text: "音檔已上傳" });
      onUploaded?.();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      onBusyChange?.(false);
    }
  };

  const ctx: ChannelCtx = { draft, set, lesson, lessonId: id, busy, progress, upload };
  const channels = MEDIA_CHANNELS.filter((ch) => (id ? true : ch.staged) && (!ch.superAdminOnly || allowMux || draft.kind === ch.key));
  const active = MEDIA_CHANNELS.find((ch) => ch.key === draft.kind);
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.row}>
        {channels.map((ch) => {
          const on = ch.key === draft.kind;
          return (
            <Pressable key={ch.key} onPress={() => set({ kind: ch.key })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }]}>
              <AppText variant="callout" style={{ color: on ? c.textOnAccent : c.text, fontWeight: "600" }}>
                {ch.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {active?.render(ctx)}
      <TimeRangeFields draft={draft} set={set} lesson={lesson} lengthLabel={lengthLabel} showHint={showHint} />
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
    </View>
  );
}

/**
 * 時間軸區間欄位（業主 2026-11-18 模組化）：拖曳時間軸（TimeRangePicker）＋手動輸入開始／結束時間＋「到影片結尾」勾選＋長度提示。
 * 章節、完整版課程影片（透過 MediaUploadModule）與「清單卡」的 YouTube 教材都用這一個元件，不可在別處另做。
 */
export function TimeRangeFields({ draft, set, lesson, lengthLabel = "本段長度", showHint = true }: { draft: MediaDraft; set: (patch: Partial<MediaDraft>) => void; lesson?: Lesson; lengthLabel?: string; showHint?: boolean }) {
  const { c } = useTheme();
  const s = fromHms(draft.start);
  const e = fromHms(draft.end);
  const error = mediaDraftError(draft);
  const length = !error && e != null ? (e as number) - ((s as number | null) ?? 0) : null;
  // 「到影片結尾」：勾選後自動偵測影片長度並填入結束欄位；來源或選好的檔案換了就重新偵測。
  const [endNote, setEndNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  useEffect(() => {
    if (!draft.toEnd) return setEndNote(null);
    let alive = true;
    setEndNote({ tone: "info", text: "正在偵測影片長度…" });
    (async () => {
      const { sec, approx } = await detectLength(draft, lesson);
      if (!alive) return;
      if (sec == null || sec <= 0) {
        set({ toEnd: false });
        return setEndNote({ tone: "danger", text: draft.kind === "youtube" ? "抓不到影片長度（手機 App 不支援偵測，請在網頁版操作，或自行輸入結束時間）" : "抓不到影片長度，請自行輸入結束時間" });
      }
      set({ end: toHms(Math.floor(sec)) });
      setEndNote({ tone: "info", text: approx ? `已填入影片結尾（依章節長度 ${lesson!.minutes} 分鐘估算，不一定精確到秒）` : "已填入影片最後一秒" });
    })();
    return () => {
      alive = false;
    };
  }, [draft.toEnd, draft.kind, draft.ref, draft.audio]); // eslint-disable-line react-hooks/exhaustive-deps
  // 拖曳設定時間軸（開啟時才偵測長度）。
  const pickOpen = true; // 拖曳設定直接全部展開（業主 2026-11-17：取消「用拖曳設定開始與結束」按鈕）
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (!pickOpen) return;
    let alive = true;
    setDuration(null);
    detectLength(draft, lesson).then((r) => alive && setDuration(r.sec));
    return () => {
      alive = false;
    };
  }, [pickOpen, draft.kind, draft.ref, draft.audio]); // eslint-disable-line react-hooks/exhaustive-deps
  const canPick = (draft.kind === "youtube" && !!youtubeIdOf(draft.ref)) || draft.kind === "audio" || draft.kind === "mux";
  return (
    <View style={{ gap: space.md }}>
      <AppText variant="callout" tone="muted">
        {showHint ? "時間軸區間（選填；空白＝從頭播到結束）" : "時間軸區間"}
      </AppText>
      {canPick && pickOpen ? (
        <TimeRangePicker
          kind={draft.kind}
          ytId={draft.kind === "youtube" ? youtubeIdOf(draft.ref) : null}
          audioFile={draft.kind === "audio" ? (draft.audio?.file ?? null) : null}
          duration={duration}
          start={draft.start}
          end={draft.end}
          onChange={(patch) => set(patch)}
        />
      ) : null}
      <TimeInput label="開始" value={draft.start} onChange={(v) => set({ start: v })} />
      <TimeInput label="結束" value={draft.end} onChange={(v) => set({ end: v })} disabled={!!draft.toEnd} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!draft.toEnd }} accessibilityLabel="到影片結尾" onPress={() => set({ toEnd: !draft.toEnd })} style={styles.endCheck}>
        <Icon name={draft.toEnd ? "checkbox" : "square-outline"} size={28} color={draft.toEnd ? c.accent : c.textMuted} />
        <AppText variant="body">到影片結尾（自動填入影片最後一秒）</AppText>
      </Pressable>
      {endNote ? (
        <AppText variant="callout" tone={endNote.tone === "danger" ? "danger" : "muted"}>
          {endNote.text}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="callout" tone="danger">
          {error}
        </AppText>
      ) : length != null ? (
        <AppText variant="callout" tone="accent">
          {lengthLabel}：{formatDuration(length)}
        </AppText>
      ) : null}
    </View>
  );
}

function YoutubeInput({ draft, set, lesson }: ChannelCtx) {
  const { c } = useTheme();
  return (
    <TextInput
      value={draft.ref}
      onChangeText={(t) => set({ ref: t })}
      placeholder="貼上 YouTube 影片網址（建議設為「不公開」）"
      placeholderTextColor={c.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={`${lesson?.title ?? "教材"} YouTube 網址`}
      style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
    />
  );
}

function MuxInput({ lesson, lessonId }: ChannelCtx) {
  const current = lesson?.media?.type === "mux" ? lesson.media.ref : null;
  return (
    <View style={{ gap: space.sm }}>
      {current ? (
        <AppText variant="callout" tone="muted">
          目前影片：{current.slice(0, 8)}…
        </AppText>
      ) : null}
      <Button
        variant="secondary"
        label={current ? "更換 Mux 影片" : "從 Mux 選擇影片"}
        icon="cloud-download-outline"
        onPress={() => router.push({ pathname: "/admin/mux-picker", params: { lessonId: lessonId ?? "", lessonTitle: lesson?.title ?? "" } })}
      />
    </View>
  );
}

function AudioInput({ draft, lesson, lessonId, busy, progress, upload }: ChannelCtx) {
  const has = lesson?.media?.type === "audio";
  return (
    <View style={{ gap: space.sm }}>
      {has ? (
        <AppText variant="callout" tone="muted">
          目前已有音檔（{lesson?.minutes} 分鐘）
        </AppText>
      ) : null}
      {draft.audio ? (
        <AppText variant="callout" tone="muted">
          已選擇：{draft.audio.name}（按「新增」後上傳）
        </AppText>
      ) : null}
      <Button
        variant="secondary"
        label={progress != null ? `上傳中 ${Math.round(progress * 100)}%` : has || draft.audio ? "更換音檔" : "上傳音檔"}
        icon="musical-notes-outline"
        loading={busy && progress == null}
        disabled={busy}
        onPress={upload}
      />
      {has && lessonId ? <LessonTranscript lessonId={lessonId} /> : null}
    </View>
  );
}

function TimeInput({ label, value, onChange, disabled }: { label: string; value: Hms; onChange: (v: Hms) => void; disabled?: boolean }) {
  const { c } = useTheme();
  const box = (k: keyof Hms, unit: string) => (
    <View style={styles.timeCell}>
      <TextInput
        value={value[k]}
        onChangeText={(t) => onChange({ ...value, [k]: t.replace(/\D/g, "").slice(0, 2) })}
        keyboardType="number-pad"
        editable={!disabled}
        placeholder="0"
        placeholderTextColor={c.textMuted}
        accessibilityLabel={`${label}${unit}`}
        style={[styles.timeInput, type.body, { color: disabled ? c.textMuted : c.text, borderColor: c.border, backgroundColor: disabled ? c.surfaceMuted : c.surface }]}
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

const styles = StyleSheet.create({
  pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: minTouch, borderWidth: 1.5, borderRadius: radius.md },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  chip: { minHeight: minTouch - 8, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  endCheck: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  timeRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  timeCell: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeInput: { width: 56, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, textAlign: "center" },
});
