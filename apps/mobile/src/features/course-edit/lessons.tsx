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
import { AppText, Button, Card, DateSelect, Icon, NoticeBox, SheetRow, todayStr } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { CollapseToggle } from "@/ui/collapse-toggle";
import { Check } from "@/ui/check";
import { IconButton } from "@/ui/icon-button";
import { BrandField, CategoryField } from "./field-groups";
import { EditSheet } from "./edit-sheet";
import { EditMaterialSheet } from "./material-sheet";

/** YouTube 影片沒有長度時（章節顯示 0 分鐘），自動偵測並寫回（只有網頁版的管理者畫面做）。 */
/** 元件版（給「用到才下載」用，見 features/admin-parts.tsx）：放在畫面上就會執行 useYoutubeLengthFix，本身不顯示任何東西。 */
export function YoutubeLengthFix({ course, enabled }: { course: CourseDetail | null | undefined; enabled: boolean }) {
  useYoutubeLengthFix(course, enabled);
  return null;
}

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
  if (lesson.section) return <SectionTitleSheet course={course} lesson={lesson} onClose={onClose} />;
  if (lesson.material) return <EditMaterialSheet course={course} lesson={lesson} onClose={onClose} />;
  return <ChapterSheet course={course} lesson={lesson} onClose={onClose} />;
}

/**
 * 清單的「區塊」新增與編輯（業主 2026-11-18，由原本的「分類標題」升級）：區塊名稱、「顯示在上拉選單」勾選（預設勾選）；
 * 勾選後出現封面（上傳；沒上傳就用品牌 logo）、品牌（單選）、分類（可複選）。區塊底下（到下一個區塊之前）的教材屬於這個區塊，學員點區塊標題可收合。
 * 沒傳 lesson＝新增（加在最後面，之後可用上下移動調整位置）；封面要區塊建立後才能上傳。
 */
export function SectionTitleSheet({ course, lesson, onClose }: { course: CourseDetail; lesson?: Lesson; onClose: () => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [inSheet, setInSheet] = useState(lesson ? lesson.inSheet !== false : true);
  const [brandId, setBrandId] = useState(lesson?.brandId ?? "");
  const [cats, setCats] = useState(lesson?.categories ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !lesson || title.trim() !== lesson.title || inSheet !== (lesson.inSheet !== false) || brandId !== (lesson.brandId ?? "") || cats !== (lesson.categories ?? "");
  const submit = async () => {
    if (!title.trim()) return setError("請輸入區塊名稱");
    setBusy(true);
    setError(null);
    try {
      const body = { title: title.trim(), inSheet, brandId: inSheet ? brandId : "", categories: inSheet ? cats : "" };
      if (lesson) await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      else await api("POST", `/admin/courses/${course.id}/lessons`, { kind: "section", ...body });
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title={lesson ? "編輯區塊" : "新增區塊"} onClose={onClose} onSave={submit} saveLabel={lesson ? "儲存" : "新增"} dirty={dirty} busy={busy} error={error}>
      <AppText variant="callout" tone="muted">
        區塊名稱
      </AppText>
      <TextInput value={title} onChangeText={setTitle} placeholder="例如：紐崔萊、雅姿" placeholderTextColor={c.textMuted} accessibilityLabel="區塊名稱" maxLength={60} style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }, type.body]} />
      <Check label="顯示在上拉選單（學員從寰宇大學點進來時，選單會列出這個區塊）" value={inSheet} onChange={setInSheet} />
      {inSheet ? (
        <>
          {lesson ? (
            <View style={{ gap: space.xs }}>
              <AppText variant="callout" tone="muted">
                區塊封面（沒上傳時，用下面選的品牌 logo）
              </AppText>
              <LessonArt lesson={lesson} onChanged={invalidate} />
            </View>
          ) : (
            <AppText variant="caption" tone="muted">
              區塊封面要等區塊建立後，再按區塊旁的鉛筆上傳；沒上傳時，有選品牌就用品牌 logo。
            </AppText>
          )}
          <BrandField value={brandId} onChange={setBrandId} />
          <CategoryField value={cats} onChange={setCats} />
        </>
      ) : null}
      <AppText variant="caption" tone="muted">
        區塊底下（到下一個區塊之前）的教材屬於這個區塊；學員點區塊標題可以收合，預設都是收起。用上下移動可以調整區塊的順序。
      </AppText>
    </EditSheet>
  );
}

/**
 * 清單編輯模式（業主 2026-11-18）：每個區塊一張卡（區塊標題列＋底下的教材＋「新增教材到這個區塊」），「新增區塊」獨立放在最下面。
 * 區塊的上下移動＝整個區塊（連同底下的教材）一起移；教材的上下移動只在區塊內。
 */
export function BlockEditList({ extraMovable, items, onEdit, onMoveItem, onMoveBlock, onCopy, onDelete, onAddMaterial, onAddBlock, onMoveTo, onPickMove, busy }: { /** 區塊外還有可以拉進區塊的項目（套裝課程的課程章節）。 */ extraMovable?: boolean; onMoveTo: (l: Lesson) => void; onPickMove: (blockId: string) => void; items: Lesson[]; onEdit: (l: Lesson) => void; onMoveItem: (group: Lesson[], from: number, to: number) => void; onMoveBlock: (groups: Lesson[][], from: number, to: number) => void; onCopy: (l: Lesson) => void; onDelete: (l: Lesson) => void; onAddMaterial: (blockId?: string) => void; onAddBlock: () => void; busy: boolean }) {
  const { c } = useTheme();
  // 編輯模式的區塊預設全部收起，同一時間只展開一個（業主 2026-11-18）。
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = items.filter((l) => !l.full);
  // 切成區塊：每組 = [區塊標題, 底下的教材…]；最前面還沒歸區塊的教材自成一組（沒有標題）。
  const groups: Lesson[][] = [];
  for (const l of rows) {
    if (l.section || !groups.length) groups.push([l]);
    else groups[groups.length - 1]!.push(l);
  }
  const full = items.filter((l) => l.full);
  return (
    <View style={{ gap: space.md }}>
      {groups.map((g, gi) => {
        const head = g[0]!.section ? g[0]! : null;
        const body = head ? g.slice(1) : g;
        const realIdx = groups.filter((x) => x[0]!.section).indexOf(g); // 只算有標題的區塊，沒標題的那組不能移動
        const blockCount = groups.filter((x) => x[0]!.section).length;
        return (
          <Card key={g[0]!.id} style={{ paddingVertical: 0, paddingHorizontal: 0, overflow: "hidden" }}>
            {head ? (
              <View style={[styles.lessonRow, { backgroundColor: c.accentSoft, borderBottomColor: c.border }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`編輯區塊 ${head.title}`} onPress={() => onEdit(head)} style={styles.lessonMain}>
                  <AppText variant="body" numberOfLines={2} style={{ fontWeight: "800" }}>
                    {`📂 ${head.title}`}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {[head.inSheet === false ? "不顯示在上拉選單" : "顯示在上拉選單", head.brandName ?? "", head.categories ?? ""].filter(Boolean).join(" · ")}
                  </AppText>
                </Pressable>
                <IconButton icon="arrow-up" label="區塊上移" onPress={gi > 0 && realIdx > 0 ? () => onMoveBlock(groups, gi, gi - 1) : undefined} disabled={busy} />
                <IconButton icon="arrow-down" label="區塊下移" onPress={realIdx < blockCount - 1 ? () => onMoveBlock(groups, gi, gi + 1) : undefined} disabled={busy} />
                <IconButton icon="create-outline" label={`編輯區塊 ${head.title}`} onPress={() => onEdit(head)} disabled={busy} />
                <IconButton icon="trash-outline" label={`刪除區塊 ${head.title}`} onPress={() => onDelete(head)} disabled={busy} danger />
                <CollapseToggle open={openId === head.id} onPress={() => setOpenId(openId === head.id ? null : head.id)} label={`區塊 ${head.title}`} />
              </View>
            ) : (
              <View style={[styles.lessonRow, { backgroundColor: c.accentSoft, borderBottomColor: c.border, paddingLeft: space.sm }]}>
                <AppText variant="body" style={{ flex: 1, fontWeight: "800" }}>
                  未歸區塊的教材（{body.length}）
                </AppText>
                <CollapseToggle open={openId === g[0]!.id} onPress={() => setOpenId(openId === g[0]!.id ? null : g[0]!.id)} label="未歸區塊的教材" />
              </View>
            )}
            {(head ? openId !== head.id : openId !== g[0]!.id) ? null : body.length ? (
              <EditLessonRows group={body} word="教材" onEdit={onEdit} onMove={(i, j) => onMoveItem(body, i, j)} onCopy={onCopy} onDelete={onDelete} busy={busy} bare onMoveTo={blockCount > 1 || (!head && blockCount >= 1) ? onMoveTo : undefined} />
            ) : (
              <AppText variant="callout" tone="muted" style={{ padding: space.md }}>
                這個區塊還沒有教材
              </AppText>
            )}
            {(head ? openId !== head.id : openId !== g[0]!.id) ? null : <View style={{ padding: space.sm }}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button variant="secondary" label={head ? `新增教材` : "新增教材"} icon="add" onPress={() => onAddMaterial(head?.id)} fullWidth />
                </View>
                {head && (extraMovable || rows.some((l) => !l.section)) ? (
                  <View style={{ flex: 1 }}>
                    <Button variant="secondary" label="移動教材" icon="swap-vertical" onPress={() => onPickMove(head.id)} fullWidth />
                  </View>
                ) : null}
              </View>
            </View>}
          </Card>
        );
      })}
      {!groups.length ? <Button variant="secondary" label="新增教材" icon="add" onPress={() => onAddMaterial()} fullWidth /> : null}
      {full.length ? <EditLessonRows group={full} word="教材" onEdit={onEdit} onMove={() => undefined} onCopy={onCopy} onDelete={onDelete} busy={busy} /> : null}
      {/* 區塊是獨立的區域：新增區塊不跟教材清單混在一起（業主 2026-11-18）。 */}
      <Button variant="secondary" label="新增區塊" icon="folder-open-outline" onPress={onAddBlock} fullWidth />
    </View>
  );
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
    ? ((title !== lesson.title || sharer !== (lesson.sharer ?? "") || sharerRank !== (lesson.sharerRank ?? "") || sharerTitle !== (lesson.sharerTitle ?? ""))) ||
      ownDate !== (lesson.dateFollows ? "" : lesson.eventDate ?? "") ||
      isSpeaker !== !!lesson.isSpeaker ||
      isSummary !== !!lesson.isSummary ||
      mediaDraftDirty(media, lesson)
    : !!createdId || !!title || !!sharer || !!sharerRank || !!sharerTitle || isSpeaker || isSummary || mediaDraftDirty(media);

  const save = async (): Promise<boolean> => {
    if (!lesson) return false;
    if (rangeError) return setMsg({ tone: "danger", text: rangeError }), false;
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, unknown> = { title: isSummary ? SUMMARY_TITLE : title, sharer, sharerRank, sharerTitle, eventDate: ownDate || null, isSpeaker, isSummary, ...mediaDraftBody(media) };
      await api("PATCH", `/admin/lessons/${lesson.id}`, body);
      invalidate();
      return true;
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // 新增：先建立章節，再依序送出影音設定與音檔。中途失敗時章節已建立，再按「新增」只補沒完成的部分（不會重複建立）。
  const create = async () => {
    if (!isSummary && !title.trim()) return setMsg({ tone: "danger", text: "請輸入章節名稱" });
    if (rangeError) return setMsg({ tone: "danger", text: rangeError });
    setBusy("create");
    setMsg(null);
    let made = !!createdId;
    try {
      let lessonId = createdId ?? undefined;
      if (!lessonId) {
        const before = new Set(course.lessons.map((l) => l.id));
        const detail = await api<CourseDetail>("POST", `/admin/courses/${course.id}/lessons`, { title: isSummary ? SUMMARY_TITLE : title, sharer, sharerRank, sharerTitle, ...(ownDate ? { eventDate: ownDate } : {}), isSpeaker, isSummary });
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
      onSave={isNew ? create : async () => void ((await save()) && onClose())}
      saveLabel={isNew ? "新增" : "儲存"}
      dirty={dirty}
      busy={busy === "create" || busy === "save"}
      error={msg?.tone === "danger" ? msg.text : null}
    >
      {/* 「主題」（原「主講」）「總結」兩個勾選同一列（業主 2026-11-16）；每門課各只能一堂、兩者互斥。 */}
      <View style={styles.checkRow}>
        <View style={{ flex: 1 }}>
          <Check label="主題" value={isSpeaker} onChange={pickSpeaker} />
        </View>
        <View style={{ flex: 1 }}>
          <Check label="總結" value={isSummary} onChange={pickSummary} />
        </View>
      </View>
      {isSpeaker && otherSpeaker ? <NoticeBox text={`目前「${otherSpeaker.title}」是主題，儲存後會改成這一堂。`} /> : null}
      {isSummary && otherSummary ? <NoticeBox text={`目前「${otherSummary.title}」是總結，儲存後會改成這一堂。`} /> : null}
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
      {!isNew && msg?.tone === "success" ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      {!isNew && (currentKind === "mux" || currentKind === "audio") ? (
        <View style={styles.row}>
          {currentKind === "mux" || currentKind === "audio" ? <Button variant="secondary" label="播放檢查" icon="pulse-outline" loading={busy === "check"} disabled={!!busy} onPress={check} /> : null}
        </View>
      ) : null}
    </EditSheet>
  );
}

/** 勾了「總結」的章節，名稱固定為這兩個字（伺服器也會強制）。 */
const SUMMARY_TITLE = "總結";


/** 課程頁編輯模式的章節／教材清單（同一個元件，兩組共用）：每列＝名稱（點了編輯）＋小按鈕 ↑ ↓ 複製 編輯 刪除（32px，讓名稱有空間）。 */
export function EditLessonRows({ group, word, onEdit, onMove, onCopy, onDelete, busy, bare, onMoveTo }: { /** 放在區塊卡片裡時不再自己畫外框。 */ bare?: boolean; /** 有傳＝每列多一個「移到其他區塊」鈕。 */ onMoveTo?: (l: Lesson) => void; group: Lesson[]; word: string; onEdit: (l: Lesson) => void; onMove: (from: number, to: number) => void; onCopy: (l: Lesson) => void; onDelete: (l: Lesson) => void; busy: boolean }) {
  const { c } = useTheme();
  // 「完整版課程影片」永遠在最後一列：不能上下移、不能複製；其他列的上下移只在它們之間進行。
  const movable = group.filter((l) => !l.full).length;
  const Wrap = bare ? View : Card;
  return (
    <Wrap style={bare ? undefined : { paddingVertical: 0 }}>
      {group.map((lesson, i) => (
        <View key={lesson.id} style={[styles.lessonRow, { borderBottomColor: c.border }]}>
<View style={{ flex: 1, minWidth: 0 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`編輯${word} ${lesson.position}`} onPress={() => onEdit(lesson)} style={styles.lessonMain}>
              <AppText variant="body" numberOfLines={2} style={lesson.section ? { fontWeight: "800" } : undefined}>
                {lesson.section ? `📂 ${lesson.title}` : lesson.full ? lesson.title : `${lesson.position}. ${lesson.title}`}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {lesson.section ? "分類標題" : [lesson.linkType ? TYPE_INFO[lesson.linkType].label : lesson.ready ? (lesson.kind === "audio" ? "音檔" : lesson.media?.type === "youtube" ? "YouTube" : lesson.media?.type === "mux" ? "Mux" : "影片") : "尚未設定內容", sharerLine(lesson), minutesText(lesson.minutes), lesson.eventDate ? eventDays(lesson.eventDate, null) : ""].filter(Boolean).join(" · ")}
              </AppText>
            </Pressable>
            {onMoveTo && !lesson.section && !lesson.full ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`移到其他區塊：${lesson.title}`} onPress={() => onMoveTo(lesson)} disabled={busy} style={[styles.moveBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
                <Icon name="folder-open-outline" size={13} color={c.accentText} />
                <AppText variant="caption" style={{ color: c.accentText, fontWeight: "800" }}>
                  移到…
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {lesson.full ? null : (
            <>
              <IconButton icon="arrow-up" label="上移" onPress={i > 0 ? () => onMove(i, i - 1) : undefined} disabled={busy} />
              <IconButton icon="arrow-down" label="下移" onPress={i < movable - 1 ? () => onMove(i, i + 1) : undefined} disabled={busy} />
              {lesson.section ? null : <IconButton icon="copy-outline" label={`複製${word} ${lesson.position}`} onPress={() => onCopy(lesson)} disabled={busy} />}
            </>
          )}
          <IconButton icon="create-outline" label={`編輯${word} ${lesson.position}`} onPress={() => onEdit(lesson)} disabled={busy} />
          <IconButton icon="trash-outline" label={`刪除${word} ${lesson.position}`} onPress={() => onDelete(lesson)} disabled={busy} danger />
        </View>
      ))}
    </Wrap>
  );
}


const styles = StyleSheet.create({
  twoCol: { flexDirection: "row", gap: space.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dateHead: { flexDirection: "row", alignItems: "center" },
  sameCheck: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: minTouch, paddingLeft: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  moveBtn: { alignSelf: "flex-start", marginLeft: space.sm, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 28, borderRadius: 999, borderWidth: 1 },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  lessonMain: { flex: 1, minWidth: 0, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm },
});

/** 把教材移到另一個區塊（業主 2026-11-18）：列出所有區塊，點一個就搬到那個區塊的最後面。 */
export function MoveToBlockSheet({ items, lesson, onPick, onClose }: { items: Lesson[]; lesson: Lesson; onPick: (blockId: string) => void; onClose: () => void }) {
  const heads = items.filter((l) => l.section);
  const current = (() => {
    let cur: string | null = null;
    for (const l of items) {
      if (l.section) cur = l.id;
      if (l.id === lesson.id) return cur;
    }
    return null;
  })();
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline" numberOfLines={2}>
        移動「{lesson.title}」到哪個區塊？
      </AppText>
      <SheetScroll>
        {heads.map((h) => (
          <SheetRow key={h.id} title={`📂 ${h.title}`} disabled={h.id === current} onPress={() => onPick(h.id)} chevron={h.id !== current} right={h.id === current ? <AppText tone="muted">目前所在</AppText> : undefined} />
        ))}
      </SheetScroll>
      <Button variant="cancel" label="取消" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

/** 勾選本清單的教材，一次移到指定區塊的最後面（業主 2026-11-18）：列出清單內所有教材（依區塊分組），已在該區塊的灰掉不能勾。 */
export function PickMaterialsSheet({ items, blockId, onMove, onClose }: { items: Lesson[]; blockId: string; onMove: (ids: string[]) => void; onClose: () => void }) {
  const { c } = useTheme();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const target = items.find((l) => l.id === blockId);
  // 每個教材目前所在的區塊
  let cur: string | null = null;
  const rows = items.map((l) => {
    if (l.section) cur = l.id;
    return { l, block: l.section ? l.id : cur };
  });
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline" numberOfLines={2}>
        勾選要移到「{target?.title}」的教材
      </AppText>
      <SheetScroll>
        {rows.map(({ l, block }) =>
          l.section ? (
            <AppText key={l.id} variant="callout" style={{ fontWeight: "800", color: c.accentText, paddingTop: space.sm }}>
              📂 {l.title}
            </AppText>
          ) : (
            <Pressable key={l.id} accessibilityRole="checkbox" accessibilityState={{ checked: sel.has(l.id), disabled: block === blockId }} disabled={block === blockId} onPress={() => toggle(l.id)} style={{ minHeight: minTouch, flexDirection: "row", alignItems: "center", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, opacity: block === blockId ? 0.4 : 1 }}>
              <Icon name={sel.has(l.id) || block === blockId ? "checkbox" : "square-outline"} size={26} color={sel.has(l.id) || block === blockId ? c.accent : c.textMuted} />
              <AppText variant="body" numberOfLines={2} style={{ flex: 1 }}>
                {l.title}
              </AppText>
              {block === blockId ? <AppText variant="caption" tone="muted">已在此區塊</AppText> : null}
            </Pressable>
          ),
        )}
      </SheetScroll>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="cancel" label="取消" onPress={onClose} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={sel.size ? `移動（${sel.size}）` : "移動"} disabled={!sel.size} onPress={() => onMove([...sel])} fullWidth />
        </View>
      </View>
    </BottomSheet>
  );
}
