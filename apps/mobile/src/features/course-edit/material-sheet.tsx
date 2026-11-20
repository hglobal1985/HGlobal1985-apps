import { isDownloadUrl } from "@/lib/download-material";
import { Check } from "@/features/course-edit/course-sections";
import { isSuperAdmin } from "@/lib/roles";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { api, classifyLink, parseHttpsUrl, type CourseDetail, type Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { fromHms, toHms, type Hms } from "@/features/uploads/hms";
import { commitMediaDraft, MediaUploadModule, TimeRangeFields, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, type MediaDraft } from "@/features/uploads";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, DateSelect, FormBlock, Icon, LoadingView } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { FileUploadModule } from "@/features/uploads/file-upload-module";
import { BrandIcon } from "@/ui/brand-icon";
import { EditSheet } from "./edit-sheet";

/**
 * 「其他教材」的新增與編輯面板（業主 2026-11-16 改版）：只有三個東西——
 * ① 外部連結（旁邊有「貼上」鈕）② 教材名稱（貼上連結後自動抓取網頁標題填入，可自行修改）③ 檔案類型（依連結自動判斷，顯示官方 Logo）。
 * 不再有影音上傳、音檔、附件等舊功能。「完整版課程影片」那一列另有影音設定（FullVersionSheet），不受影響。
 */
export function NewMaterialSheet({ course, onClose, afterBlock }: { course: CourseDetail; onClose: () => void; /** 新增到某個區塊的最後面（區塊的編號）；沒傳＝加在整份清單最後。 */ afterBlock?: string }) {
  // 連結區塊（品牌資訊卡的「新品特惠培訓直播」，業主 2026-11-18）：內容存在來源清單，新增教材直接加到來源清單的那個區塊，兩邊同步。
  const sec = afterBlock ? course.lessons.find((l) => l.id === afterBlock) : undefined;
  const src = useApi<CourseDetail>(sec?.linkedCourseId ? `/courses/${sec.linkedCourseId}` : null);
  if (sec?.linkedCourseId) return src.data ? <LinkMaterialSheet course={src.data} onClose={onClose} afterBlock={sec.linkedBlockId} /> : <BottomSheet onClose={onClose}><LoadingView /></BottomSheet>;
  return <LinkMaterialSheet course={course} onClose={onClose} afterBlock={afterBlock} />;
}

export function EditMaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  if (lesson.full) return <FullVersionSheet lesson={lesson} onClose={onClose} />;
  if (isDownloadUrl(lesson.linkUrl)) return <FileMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
  return <LinkMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
}

/** 上傳的檔案教材：只能改名稱與日期（要換檔案就刪掉重新上傳）。 */
function FileMaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  const [title, setTitle] = useState(lesson.title);
  const [evDate, setEvDate] = useState(lesson.eventDate ?? "");
  const [theme, setTheme] = useState(!!lesson.isSpeaker);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return setError("請輸入教材名稱");
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/admin/lessons/${lesson.id}`, { title: title.trim(), eventDate: evDate || null, ...(theme !== !!lesson.isSpeaker ? { isSpeaker: theme } : {}) });
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const info = lesson.linkType ? TYPE_INFO[lesson.linkType] : null;
  return (
    <EditSheet title={`教材 ${lesson.position}：${lesson.title}`} onClose={onClose} onSave={submit} dirty={title !== lesson.title || evDate !== (lesson.eventDate ?? "") || theme !== !!lesson.isSpeaker} busy={busy} error={error}>
      <FormBlock title="檔案" hint="要換檔案，請刪除這個教材後重新上傳">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {lesson.linkType ? <BrandIcon type={lesson.linkType} fallback={info!.icon as never} size={32} /> : null}
          <AppText variant="body">{info?.label ?? "檔案"}</AppText>
        </View>
      </FormBlock>
      <AppText variant="callout" tone="muted">
        教材名稱
      </AppText>
      <TextInput value={title} onChangeText={setTitle} accessibilityLabel="教材名稱" maxLength={80} style={[{ minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
      <DateSelect label="日期（選填）" value={evDate} onChange={setEvDate} />
      <ThemeCheck value={theme} onChange={setTheme} />
    </EditSheet>
  );
}

/** 「主題」勾選（業主 2026-11-19）：每個區塊（沒有區塊就整份）只能有一個，勾新的會取代原本那個。 */
function ThemeCheck({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <>
      <Check label="主題" value={value} onChange={onChange} />
      <AppText variant="caption" tone="muted">
        每個區塊只能有一個主題，勾選後會取代原本的主題。
      </AppText>
    </>
  );
}

type Fetch = "idle" | "loading" | "done" | "none";

/** 從 YouTube 網址取出影片編號（watch?v=、youtu.be/、shorts/、embed/）。 */
function ytIdOfUrl(u: URL | null): string | null {
  if (!u) return null;
  if (u.hostname.replace(/^www\./, "") === "youtu.be") return u.pathname.split("/")[1] || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = /\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1]! : null;
}

function LinkMaterialSheet({ course, lesson, onClose, afterBlock }: { course: CourseDetail; lesson?: Lesson; onClose: () => void; afterBlock?: string }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  // 清單卡的影片教材存的是影片來源（不是外部連結）：編輯時把它還原成 YouTube 網址顯示。
  const baseLink = lesson?.linkUrl ?? (lesson?.media?.type === "youtube" && lesson.media.ref ? `https://www.youtube.com/watch?v=${lesson.media.ref}` : "");
  const [url, setUrl] = useState(baseLink);
  const [title, setTitle] = useState(lesson?.title ?? "");
  const lastAuto = useRef<string>(lesson?.title ?? ""); // 最近一次自動填入的名稱：名稱還是這個（或空白）時，換連結才會自動換名稱；自己改過的不會被蓋掉
  const lastAutoDate = useRef<string>(lesson?.eventDate ?? "");
  const [fetching, setFetching] = useState<Fetch>("idle");
  // 素材項目自己的日期（選填）與影片時間軸區間（只有清單裡的 YouTube 影片；業主 2026-11-17）。
  const [evDate, setEvDate] = useState(lesson?.eventDate ?? "");
  const [theme, setTheme] = useState(!!lesson?.isSpeaker);
  const [trim, setTrim] = useState<{ start: Hms; end: Hms }>({ start: toHms(lesson?.start ?? null), end: toHms(lesson?.end ?? null) });
  const [toEnd, setToEnd] = useState(false);
  const secOf = (h: Hms) => (fromHms(h) === "invalid" ? null : (fromHms(h) as number | null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseHttpsUrl(url);
  const fileType = parsed ? classifyLink(parsed) : null;
  const ytId = fileType === "youtube" ? ytIdOfUrl(parsed) : null;
  const dirty = lesson ? theme !== !!lesson.isSpeaker || url !== baseLink || title !== lesson.title || evDate !== (lesson.eventDate ?? "") || secOf(trim.start) !== (lesson.start ?? null) || secOf(trim.end) !== (lesson.end ?? null) : !!url.trim() || !!title.trim();

  // 連結一變（貼上或手動輸入，停下來 0.6 秒後），請伺服器代為讀取網頁標題。
  useEffect(() => {
    if (!parsed || parsed.toString() === baseLink) return setFetching("idle");
    let alive = true;
    setFetching("loading");
    const t = setTimeout(() => {
      api<{ title: string | null; date?: string | null; defaultTitle: string }>("GET", `/admin/link-title?url=${encodeURIComponent(parsed.toString())}`)
        .then((r) => {
          if (!alive) return;
          const name = r.title ?? r.defaultTitle;
          setTitle((cur) => {
            if (cur.trim() && cur !== lastAuto.current) return cur; // 已經自己改過名稱：不蓋掉
            lastAuto.current = name;
            return name;
          });
          // 教材日期直接讀連結的發布日期並顯示在日期欄位（業主 2026-11-18）；日期欄是空的或還是上次自動填的才會換，自己改過的不蓋掉。
          if (r.date) {
            setEvDate((cur) => {
              if (cur && cur !== lastAutoDate.current) return cur;
              lastAutoDate.current = r.date!;
              return r.date!;
            });
          }
          setFetching(r.title ? "done" : "none");
        })
        .catch(() => alive && setFetching("none"));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const paste = async () => {
    setError(null);
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) return setError("剪貼簿裡沒有內容，請先複製連結");
      setUrl(text);
    } catch {
      setError("無法讀取剪貼簿，請長按輸入框手動貼上");
    }
  };

  const before = useRef(new Set(course.lessons.map((l) => l.id)));
  // 上傳檔案完成：新建的教材（可能多個）搬到指定區塊的最後面，然後關閉。
  const onFiles = async (d: CourseDetail, hadErrors: boolean) => {
    const fresh = d.lessons.filter((l) => l.material && !l.full && !before.current.has(l.id));
    if (afterBlock && fresh.length) {
      const all = d.lessons.filter((l) => l.material && !l.full);
      const rest = all.filter((l) => !fresh.some((f) => f.id === l.id));
      const at = rest.findIndex((l) => l.id === afterBlock);
      if (at >= 0) {
        let end = at + 1;
        while (end < rest.length && !rest[end]!.section) end++;
        await api("POST", `/admin/courses/${course.id}/lessons/order?lite=1`, { ids: [...rest.slice(0, end), ...fresh, ...rest.slice(end)].map((l) => l.id) }).catch(() => undefined);
      }
    }
    invalidate();
    if (!hadErrors) onClose(); // 有檔案被擋時留在面板，讓使用者看到原因
  };
  const submit = async () => {
    if (!parsed) return setError("請貼上 https 開頭的外部連結");
    setBusy(true);
    setError(null);
    try {
      const dateBody = { eventDate: evDate || null };
      let lessonId = lesson?.id;
      if (lesson) await api("PUT", `/admin/lessons/${lesson.id}/material`, { url: parsed.toString(), title, ...dateBody });
      else {
        const before = new Set(course.lessons.map((l) => l.id));
        const d = await api<CourseDetail>("POST", `/admin/courses/${course.id}/materials`, { url: parsed.toString(), title, ...dateBody });
        lessonId = d.lessons.find((l) => !before.has(l.id))?.id;
        // 指定區塊：把新教材移到該區塊的最後面（區塊底下＝到下一個區塊標題之前）。
        if (afterBlock && lessonId) {
          const all = d.lessons.filter((l) => l.material && !l.full);
          const rest = all.filter((l) => l.id !== lessonId);
          const at = rest.findIndex((l) => l.id === afterBlock);
          if (at >= 0) {
            let end = at + 1;
            while (end < rest.length && !rest[end]!.section) end++;
            const next = [...rest.slice(0, end), all.find((l) => l.id === lessonId)!, ...rest.slice(end)];
            await api("POST", `/admin/courses/${course.id}/lessons/order?lite=1`, { ids: next.map((l) => l.id) });
          }
        }
      }
      // 主題（業主 2026-11-19）：每個區塊（沒有區塊就整份）只能有一個，勾新的伺服器會取消原本那個。
      if (lesson && theme !== !!lesson.isSpeaker) await api("PATCH", `/admin/lessons/${lesson.id}`, { isSpeaker: theme });
      // 影片時間軸區間：連結換成別支影片時伺服器會清空區間，所以一律在儲存連結之後再寫入。
      if (ytId && lessonId && (secOf(trim.start) !== null || secOf(trim.end) !== null || lesson?.start != null || lesson?.end != null)) await api("PATCH", `/admin/lessons/${lessonId}`, { startSeconds: secOf(trim.start), endSeconds: secOf(trim.end) });
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = [{ minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }, bodyFont, { color: c.text, borderColor: c.border, backgroundColor: c.surface }];
  const info = fileType ? TYPE_INFO[fileType] : null;
  return (
    <EditSheet title={lesson ? `教材 ${lesson.position}：${lesson.title}` : "新增教材"} onClose={onClose} onSave={submit} saveLabel={lesson ? "儲存" : "新增"} dirty={dirty} busy={busy} error={error}>
      {!lesson ? (
        <FormBlock title="上傳檔案" hint="圖片、照片、文件（PDF、Word、PowerPoint、Excel、文字檔）；不可上傳影片。可以從這支手機或電腦選檔案，也可以從你自己的 Google 雲端硬碟選擇（系統會幫你轉存到行動大學的儲存空間）。單檔大小有上限，選好就會直接上傳並建立教材；之後誰能下載，跟著這份課程或清單的規則。">
          <FileUploadModule courseId={course.id} onUploaded={onFiles} onBusyChange={setBusy} />
        </FormBlock>
      ) : null}
      {!lesson ? (
        <AppText variant="callout" tone="muted" style={{ fontWeight: "700" }}>
          或貼上外部連結
        </AppText>
      ) : null}
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" tone="muted">
          外部連結
        </AppText>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://…"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="外部連結"
            style={[...input, { flex: 1 }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="貼上剪貼簿的連結" onPress={paste} style={({ pressed }) => [{ minHeight: minTouch, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.accent, flexDirection: "row", alignItems: "center", gap: 6 }, pressed && { opacity: 0.8 }]}>
            <Icon name="clipboard-outline" size={20} color={c.textOnAccent} />
            <AppText variant="callout" style={{ color: c.textOnAccent, fontWeight: "700" }}>
              貼上
            </AppText>
          </Pressable>
        </View>
        {url.trim() && !parsed ? (
          <AppText variant="caption" tone="danger">
            連結要以 https:// 開頭
          </AppText>
        ) : null}
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" tone="muted">
          教材名稱
        </AppText>
        <TextInput value={title} onChangeText={setTitle} placeholder={fetching === "loading" ? "正在抓取名稱…" : "貼上連結後自動填入"} placeholderTextColor={c.textMuted} accessibilityLabel="教材名稱" maxLength={80} style={input} />
        <AppText variant="caption" tone="muted">
          {fetching === "loading" ? "正在讀取連結的標題…" : fetching === "done" ? "已自動填入連結的標題，可以直接修改。" : fetching === "none" ? "抓不到這個連結的標題，已先填入類型名稱，請自行修改。" : "名稱空白時，儲存會自動用連結的標題。"}
        </AppText>
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" tone="muted">
          檔案類型
        </AppText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: minTouch }}>
          {fileType ? <BrandIcon type={fileType} fallback={info!.icon as never} size={36} /> : <Icon name="link-outline" size={36} color={c.textMuted} />}
          <AppText variant="body">{info ? `${info.label}${fileType === "youtube" ? "（在 App 內播放）" : ""}` : "貼上連結後自動判斷"}</AppText>
        </View>
        <AppText variant="caption" tone="muted">
          YouTube 影片會在 App 內播放；其他連結（簡報、PDF、雲端檔案…）點了開啟外部網頁。
        </AppText>
      </View>
      <DateSelect label="日期（選填；貼上連結會自動帶入連結的日期，可自行修改）" value={evDate} onChange={setEvDate} />
      {lesson ? <ThemeCheck value={theme} onChange={setTheme} /> : null}
      {ytId ? (
        <TimeRangeFields
          draft={{ kind: "youtube", ref: ytId, start: trim.start, end: trim.end, audio: null, toEnd: toEnd }}
          set={(patch) => {
            if (patch.start || patch.end) setTrim((x) => ({ start: patch.start ?? x.start, end: patch.end ?? x.end }));
            if ("toEnd" in patch) setToEnd(!!patch.toEnd);
          }}
          lesson={lesson}
          showHint
        />
      ) : null}
    </EditSheet>
  );
}

/** 「完整版課程影片」那一列：只設定影音來源與開頭／結束秒數（維持原樣）。 */
function FullVersionSheet({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const { member, invalidate } = useSession();
  const [media, setMedia] = useState<MediaDraft>(() => mediaDraftOf(lesson));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const bad = mediaDraftError(media);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/admin/lessons/${lesson.id}`, mediaDraftBody(media));
      await commitMediaDraft(lesson.id, media);
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
    <EditSheet title={lesson.title} onClose={onClose} onSave={submit} saveLabel="儲存" dirty={mediaDraftDirty(media, lesson)} busy={busy} error={error}>
      <MediaUploadModule draft={media} onChange={setMedia} allowMux={isSuperAdmin(member)} lesson={lesson} lessonId={lesson.id} onUploaded={invalidate} showHint={false} />
    </EditSheet>
  );
}

const bodyFont = type.body;
