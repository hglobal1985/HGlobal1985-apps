import { isSuperAdmin } from "@/lib/roles";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { api, classifyLink, parseHttpsUrl, type CourseDetail, type Lesson } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { commitMediaDraft, MediaUploadModule, mediaDraftBody, mediaDraftDirty, mediaDraftError, mediaDraftOf, type MediaDraft } from "@/features/uploads";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { EditSheet } from "./edit-sheet";

/**
 * 「其他教材」的新增與編輯面板（業主 2026-11-16 改版）：只有三個東西——
 * ① 外部連結（旁邊有「貼上」鈕）② 教材名稱（貼上連結後自動抓取網頁標題填入，可自行修改）③ 檔案類型（依連結自動判斷，顯示官方 Logo）。
 * 不再有影音上傳、音檔、附件等舊功能。「完整版課程影片」那一列另有影音設定（FullVersionSheet），不受影響。
 */
export function NewMaterialSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  return <LinkMaterialSheet course={course} onClose={onClose} />;
}

export function EditMaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson: Lesson; onClose: () => void }) {
  if (lesson.full) return <FullVersionSheet lesson={lesson} onClose={onClose} />;
  return <LinkMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
}

type Fetch = "idle" | "loading" | "done" | "none";

function LinkMaterialSheet({ course, lesson, onClose }: { course: CourseDetail; lesson?: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  // 素材清單的影片教材存的是影片來源（不是外部連結）：編輯時把它還原成 YouTube 網址顯示。
  const baseLink = lesson?.linkUrl ?? (course.isList && lesson?.media?.type === "youtube" && lesson.media.ref ? `https://www.youtube.com/watch?v=${lesson.media.ref}` : "");
  const [url, setUrl] = useState(baseLink);
  const [title, setTitle] = useState(lesson?.title ?? "");
  const lastAuto = useRef<string>(lesson?.title ?? ""); // 最近一次自動填入的名稱：名稱還是這個（或空白）時，換連結才會自動換名稱；自己改過的不會被蓋掉
  const [fetching, setFetching] = useState<Fetch>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseHttpsUrl(url);
  const fileType = parsed ? classifyLink(parsed) : null;
  const dirty = lesson ? url !== baseLink || title !== lesson.title : !!url.trim() || !!title.trim();

  // 連結一變（貼上或手動輸入，停下來 0.6 秒後），請伺服器代為讀取網頁標題。
  useEffect(() => {
    if (!parsed || parsed.toString() === baseLink) return setFetching("idle");
    let alive = true;
    setFetching("loading");
    const t = setTimeout(() => {
      api<{ title: string | null; defaultTitle: string }>("GET", `/admin/link-title?url=${encodeURIComponent(parsed.toString())}`)
        .then((r) => {
          if (!alive) return;
          const name = r.title ?? r.defaultTitle;
          setTitle((cur) => {
            if (cur.trim() && cur !== lastAuto.current) return cur; // 已經自己改過名稱：不蓋掉
            lastAuto.current = name;
            return name;
          });
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

  const submit = async () => {
    if (!parsed) return setError("請貼上 https 開頭的外部連結");
    setBusy(true);
    setError(null);
    try {
      if (lesson) await api("PUT", `/admin/lessons/${lesson.id}/material`, { url: parsed.toString(), title });
      else await api("POST", `/admin/courses/${course.id}/materials`, { url: parsed.toString(), title });
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
          <AppText variant="body">{info ? `${info.label}${course.isList && fileType === "youtube" ? "（在 App 內播放）" : ""}` : "貼上連結後自動判斷"}</AppText>
        </View>
        {course.isList ? (
          <AppText variant="caption" tone="muted">
            YouTube 影片會在 App 內播放並記錄學習進度；其他連結（簡報、PDF、雲端檔案…）點了開啟外部網頁。
          </AppText>
        ) : null}
      </View>
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
