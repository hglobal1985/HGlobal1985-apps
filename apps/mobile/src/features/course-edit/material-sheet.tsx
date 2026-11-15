import { useState } from "react";
import { TextInput, View } from "react-native";
import { api, type CourseDetail, type Lesson } from "@/api/client";
import { commitMediaDraft, commitStagedAttachments, emptyMediaDraft, FileUploadModule, MediaUploadModule, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, useStagedAttachments, type MediaDraft } from "@/features/uploads";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Select, todayStr, type SelectOption } from "@/ui";
import { EditSheet } from "./edit-sheet";

/**
 * 「其他教材」的新增與編輯面板（獨立於章節面板，兩者互不影響）：
 * 教材名稱、分享者（下拉：同課程章節的分享者）、影音上傳模組、檔案上傳模組——一個頁面就能全部完成。
 * 「完整版課程影片」那一列只顯示影音上傳模組（設定來源與開頭／結束秒數）。
 */
const NONE = "__none";

type Person = { name: string; rank: string; title: string };

/** 同課程的人選：課程主講人＋各章節分享者（去重）。選到時連同獎銜、職稱一起存（畫面不顯示）。 */
function peopleOf(course: CourseDetail): Person[] {
  const list: Person[] = [];
  const add = (name: string | null | undefined, rank: string | null | undefined, title: string | null | undefined) => {
    const n = (name ?? "").trim();
    if (n && !list.some((p) => p.name === n)) list.push({ name: n, rank: rank ?? "", title: title ?? "" });
  };
  add(course.teacher, course.teacherRank, course.teacherTitle);
  for (const l of course.lessons) if (!l.material) add(l.sharer, l.sharerRank, l.sharerTitle);
  return list;
}

export function NewMaterialSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  return <MaterialSheet course={course} onClose={onClose} />;
}

export function EditMaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  return <MaterialSheet course={course} lesson={lesson} onClose={onClose} />;
}

function MaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson?: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const people = peopleOf(course);
  const isFull = !!lesson?.full;
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [sharer, setSharer] = useState(lesson?.sharer ?? "");
  const [media, setMedia] = useState<MediaDraft>(() => (lesson ? mediaDraftOf(lesson) : emptyMediaDraft()));
  const staged = useStagedAttachments();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: SelectOption[] = [{ key: NONE, label: "不指定" }, ...people.map((p) => ({ key: p.name, label: p.name })), ...(sharer && !people.some((p) => p.name === sharer) ? [{ key: sharer, label: sharer }] : [])];
  const person = people.find((p) => p.name === sharer);
  const dirty = !!createdId || (lesson ? title !== lesson.title || sharer !== (lesson.sharer ?? "") || mediaDraftDirty(media, lesson) : !!title || !!sharer || mediaDraftDirty(media) || staged.items.length > 0);
  const id = lesson?.id ?? createdId ?? undefined;

  const submit = async () => {
    if (!isFull && !title.trim()) return setError("請輸入教材名稱");
    const bad = mediaDraftError(media);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      let lessonId = id;
      if (!lessonId) {
        // 新增：先建立教材，再依序送出影音設定、音檔與附件（任何一步失敗，教材已建立，可按「新增」重試未完成的部分）。
        const before = new Set(course.lessons.map((l) => l.id));
        const detail = await api<CourseDetail>("POST", `/admin/courses/${course.id}/lessons`, { title, sharer, sharerRank: person?.rank ?? "", sharerTitle: person?.title ?? "", ...(course.eventStart ? {} : { eventDate: todayStr() }), kind: "material" });
        lessonId = detail.lessons.find((l) => !before.has(l.id))?.id;
        if (!lessonId) throw Error("新增失敗，請重新整理後再試");
        setCreatedId(lessonId);
      } else if (lesson) {
        await api("PATCH", `/admin/lessons/${lessonId}`, { ...(isFull ? {} : { title, sharer, sharerRank: person?.rank ?? lesson.sharerRank ?? "", sharerTitle: person?.title ?? lesson.sharerTitle ?? "" }), ...mediaDraftBody(media) });
      }
      if (!lesson) {
        if (mediaDraftDirty(media)) await api("PATCH", `/admin/lessons/${lessonId}`, mediaDraftBody(media));
        await commitMediaDraft(lessonId, media);
        await commitStagedAttachments(lessonId, staged.items, (done) => staged.setItems((x) => x.filter((i) => i.id !== done)));
      }
      invalidate();
      onClose();
    } catch (e) {
      invalidate();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditSheet title={lesson ? (isFull ? lesson.title : `教材 ${lesson.position}：${lesson.title}`) : "新增教材"} onClose={onClose} onSave={submit} saveLabel={lesson ? "儲存" : "新增"} dirty={dirty} busy={busy} error={error}>
      {isFull ? null : (
        <>
          <View style={{ gap: space.xs }}>
            <AppText variant="callout" tone="muted">
              教材名稱
            </AppText>
            <TextInput value={title} onChangeText={setTitle} accessibilityLabel="教材名稱" style={[{ minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
          </View>
          <Select label="分享者" value={sharer || NONE} options={options} onChange={(k) => setSharer(k === NONE ? "" : k)} />
        </>
      )}
      <MediaUploadModule draft={media} onChange={setMedia} allowMux={member?.role === "admin"} lesson={lesson} lessonId={id} onUploaded={invalidate} showHint={false} />
      {isFull ? null : <FileUploadModule lessonId={id} staged={staged} showHint={false} />}
    </EditSheet>
  );
}
