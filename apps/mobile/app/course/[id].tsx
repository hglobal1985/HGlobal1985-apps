import { Redirect, router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type CourseDetail, type Lesson, type Order } from "@/api/client";
import { CommentBoard } from "@/features/comments/comment-board";
import { confirmAsk, confirmSheet } from "@/features/confirm";
import { EdmStage } from "@/features/courses/edm-viewer";
import { useCoverStats } from "@/features/courses/cover-stats";
import { hasBlocks } from "@/features/courses/block-module";
import { ChapterList, FullVersionList } from "@/features/courses/lesson-list";
import { InlineAudio } from "@/features/player/audio-bar";
import { engine } from "@/features/player/engine";
import { LessonPlayer } from "@/features/player/lesson-player";
import { PlayerControls } from "@/features/player/player-controls";
import { PlayerSlot } from "@/features/player/player-slot";
import { useLessonSession } from "@/features/player/use-lesson-session";
import { lessonHref } from "@/lib/lesson-href";
import { EdmManager } from "@/features/admin/edm-manager";
import { SectionList, SectionSheet, type SectionKey } from "@/features/course-edit/course-sections";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { NewMaterialSheet } from "@/features/course-edit/material-sheet";
import { Check } from "@/features/course-edit/course-sections";
import { CollapseToggle } from "@/ui/collapse-toggle";
import { BlockEditList, EditLessonRows, LessonSheet, MoveToBlockSheet, PickMaterialsSheet, NewLessonSheet, SectionTitleSheet, useYoutubeLengthFix } from "@/features/course-edit/lessons";
import { PageHeader } from "@/features/page-header";
import { useApi, useSession } from "@/state/session";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { StageWidth } from "@/ui/stage-frame";
import { AppText, Button, Card, LoadingLadybug, LoginPrompt, ErrorView, ListRow, LoadingView, NoticeBox, Pill, Screen, Section, TopBarButton } from "@/ui";

type Mode = "view" | "edit" | "preview";

const isWeb = Platform.OS === "web";

/**
 * 課程介紹頁：上方只有 EDM（可上下拖曳、點一下放大），下面不再放任何課程說明文字，
 * 只有報名按鈕（依狀態）與課程章節。標題在上方導覽列。
 * 點章節＝原地播放（業主 2026-11-16）：上方的 EDM 換成播放器（同一個位置），章節清單不動；網址的 ?lesson=章節編號 記住播放哪一堂，舊的 /learn/… 網址會轉到這裡。
 */
export default function CourseRoute() {
  const params = useLocalSearchParams<{ id: string; edit?: string; lesson?: string; block?: string }>();
  return <CourseDetailScreen id={params.id} edit={params.edit} lesson={params.lesson} block={params.block} chapter={chapterFromParams(params)} />;
}

/** 課程介紹頁本體（/course/編號 與課程專屬網址 /中心縮寫/英譯姓名-編號 共用）。 */
/** 網址 ?2（只有數字、沒有值的參數）＝第 2 章；回傳章節編號。 */
export function chapterFromParams(params: Record<string, unknown>): number | undefined {
  const k = Object.keys(params).find((x) => /^\d{1,3}$/.test(x));
  return k ? Number(k) : undefined;
}

export function CourseDetailScreen({ id, edit, lesson, chapter, block }: { id: string; edit?: string; lesson?: string; chapter?: number; block?: string }) {
  const { member, ready, invalidate } = useSession();
  const { c } = useTheme();
  const lay = useLayout();
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${id}`);
  // 剛儲存回來的最新資料（重新載入完成前先用它，避免下一次儲存誤判「別人剛改過」）。
  const [saved, setSaved] = useState<CourseDetail | null>(null);
  const base = saved && saved.id === data?.id && (saved.admin?.updatedAt ?? "") > (data?.admin?.updatedAt ?? "") ? saved : data;
  // 章節排序、複製要「瞬間」有反應（業主 2026-11-17）：先在畫面上直接改，伺服器在背景處理，處理完再用正式資料換回來。
  // 點閱（業主 2026-11-17）：每進入／重新整理一次課程頁就 +1，算進主辦中心與所屬系列的封面點閱（訪客也算）。
  // 封面的訂閱鈕與點閱次數只放在中心卡、清單卡、系列卡（業主 2026-11-19：課程卡不顯示）；課程頁載入仍照舊把點閱算進主辦中心與所屬系列。
  // 封面的訂閱鈕與點閱次數：統一用封面統計模組（進入頁面時點閱 +1，算進主辦中心、所屬系列與這門課自己的封面）。
  const stats = useCoverStats("course", data?.id ?? null, `/course/${id}`, data?.isList ? "清單" : "課程");
  // 清單卡頁右上角「縮圖／詳細列表」切換（業主 2026-11-19，模仿系列頁）：記住上次的選擇。
  const [listLayout, setListLayout] = useState<"thumb" | "detail">("thumb");
  useEffect(() => {
    AsyncStorage.getItem("hglobal:learn:list-layout")
      .then((v) => (v === "thumb" || v === "detail") && setListLayout(v))
      .catch(() => undefined);
  }, []);
  const pickLayout = (v: "thumb" | "detail") => {
    setListLayout(v);
    AsyncStorage.setItem("hglobal:learn:list-layout", v).catch(() => undefined);
  };
  const [opt, setOpt] = useState<Lesson[] | null>(null);
  const pendingOps = useRef(0);
  const opQueue = useRef<Promise<unknown>>(Promise.resolve());
  const course = base && opt ? { ...base, lessons: opt } : base;
  useEffect(() => {
    if (!pendingOps.current) setOpt(null);
  }, [data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  // 原地編輯：有權限的人在工具列按「編輯」進入；可「預覽」切回學員看到的樣子。
  const manages = !!(course?.can?.edit || course?.can?.remove || course?.can?.restore);
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    if (edit === "1" && manages) setMode("edit");
  }, [edit, manages]);
  const editing = manages && mode === "edit";
  // 網址列＝分享選單給的規則網址（業主 2026-11-17）：有專屬網址的課程，網頁版把瀏覽器網址換成「/中心縮寫/英譯主講人-1」（重新整理仍回到這一頁）。
  const shortPath = course?.shortPath;
  useEffect(() => {
    if (Platform.OS !== "web" || !shortPath || typeof window === "undefined") return;
    const t = setTimeout(() => {
      if (window.location.pathname !== `/${shortPath}`) window.history.replaceState(window.history.state, "", `/${shortPath}${window.location.search}`);
    }, 60);
    return () => clearTimeout(t);
  }, [shortPath, lesson, id]);
  const [sheet, setSheet] = useState<SectionKey | "art" | "newLesson" | "newMaterial" | "newSection" | null>(null);
  const [moveTarget, setMoveTarget] = useState<Lesson | null>(null); // 要移到其他區塊的教材
  const [settingsOpen, setSettingsOpen] = useState(false); // 編輯模式的「設定」預設收起
  useEffect(() => {
    if (!editing) setSettingsOpen(false);
  }, [editing]);
  const [pickBlock, setPickBlock] = useState<string | null>(null); // 「移動教材」要移進哪個區塊
  const [materialBlock, setMaterialBlock] = useState<string | undefined>(undefined); // 新增教材要加到哪個區塊
  const [lessonSheet, setLessonSheet] = useState<Lesson | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  useYoutubeLengthFix(course, editing && Platform.OS === "web");
  // 原地播放：正在播放哪一堂（編輯模式不播放）。播放邏輯（授權、進度回報、自動完成…）都在 useLessonSession。
  const [playingId, setPlayingId] = useState<string | null>(lesson ?? null);
  useEffect(() => {
    if (lesson) setPlayingId(lesson);
  }, [lesson]);
  // 網址 ?N：播放第 N 章（章節清單前面顯示的編號）；章節資料載入後才找得到。
  // 網址 ?N：一般課程＝第 N 章；清單卡＝第 N 段影片（清單只有教材）。
  const chapterLesson = chapter && course ? course.lessons.find((l) => (course.isList ? l.material && !l.full && !l.section : !l.material) && l.position === chapter)?.id : undefined;
  useEffect(() => {
    if (chapterLesson) setPlayingId(chapterLesson);
  }, [chapterLesson]);
  const session = useLessonSession(course, editing ? null : playingId, reload, (cid, lid) => (cid === course?.id ? setPlayingId(lid) : router.replace(lessonHref(cid, lid) as never)));
  // 換章節的空檔（新的播放授權還沒回來）繼續顯示上一個播放器，避免畫面閃回 EDM。
  const lastStage = useRef<{ key: string; audio: boolean } | null>(null);
  if (session.pinned && session.track) lastStage.current = { key: session.track.key, audio: session.track.mode === "audio" };
  if (!playingId || editing) lastStage.current = null;
  const playLesson = playingId && !editing ? course?.lessons.find((l) => l.id === playingId) : undefined;
  const stage = playLesson ? (session.pinned && session.track ? { key: session.track.key, audio: session.track.mode === "audio" } : lastStage.current) : null;
  const playLegacy = !!playLesson && session.legacyYoutube && !!session.playback;
  const playChapters = course ? course.lessons.filter((l) => !l.material && !l.section) : [];
  const playNext = playLesson && !playLesson.material ? playChapters[playChapters.findIndex((l) => l.id === playLesson.id) + 1] : undefined;
  // 進入課程頁就是「播放器版面」（業主 2026-11-17）：還沒按播放時，舞台是 EDM 加大播放鈕、下方是待機的控制列；按下去才開始載入並播放第一堂。
  const firstPlayable = course && !editing ? course.lessons.find((l) => !l.locked && !l.full && !l.section && (course.isList ? l.material : !l.material)) : undefined;
  const playLesson_ = (lid: string) => {
    engine.expectSwitch();
    setPlayingId(lid);
  };

  // 課程介紹頁需登入：未登入導向登入，完成後回到這一頁。「完全公開」的課程例外，訪客直接看得到。
  if (ready && !member && !course && !loading) return <Redirect href={{ pathname: "/me", params: { next: `/course/${id}` } }} />;
  if (!course)
    return (
      <Screen header={false}>
        {loading || !ready ? <LoadingView /> : <ErrorView message={error ?? "找不到這門課程"} onRetry={reload} />}
      </Screen>
    );

  /** 報名：免費立即開通；付費建立待審核的報名並前往報名明細。 */
  const register = async () => {
    setBusy("course");
    setMessage(null);
    try {
      const [order] = await api<Order[]>("POST", "/orders", { items: [{ courseId: course.id }] });
      invalidate();
      reload();
      // 留在這一頁：按鈕會變成「審核中」（付費）或課程直接開通（免費），不跳到別的頁面。
      setMessage(order.status === "opened" ? { tone: "success", text: "報名成功！課程已開通，請從下方章節開始上課。" } : { tone: "success", text: "報名已送出，等待審核。繳費與審核進度可以點下方「付款審核中」查看。" });
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  /** 反悔取消報名（只有「審核中」可以；已開通的不提供）。要先從下方彈出確認面板確認。 */
  const cancel = async () => {
    if (!(await confirmSheet({ title: "取消報名", message: "確定要取消這筆報名嗎？取消後可以重新報名。", confirmLabel: "確定取消", cancelLabel: "先不要", danger: true }))) return;
    setBusy("cancel-course");
    setMessage(null);
    try {
      await api("POST", `/courses/${course.id}/cancel-registration`, {});
      invalidate();
      setMessage({ tone: "success", text: "已取消報名。" });
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const registerButton = (free: boolean, key: string) => {
    if (course.priceTba) return <NoticeBox tone="warning" text="這門課程的費用尚未公布，公布後才開放報名。" />;
    if (!member) return <Button label="登入後報名" icon="log-in-outline" onPress={() => router.push({ pathname: "/me", params: { next: `/course/${course.id}` } })} fullWidth />;
    if (!course.eligible) return <NoticeBox tone="warning" text={`這門課程限 ${course.minRank.name} 以上獎銜${course.allowPresident ? "或會長" : ""}報名。`} />;
    if (free) return <Button label="免費報名・有更新會通知你" icon="gift-outline" loading={busy === key} disabled={!!busy} onPress={() => register()} fullWidth />;
    // iOS/Android：依商店規範不顯示付費報名方式，只說明尚未開通。
    if (!isWeb) return <NoticeBox text="這門課程尚未為你開通。開通後即可在這裡觀看。" />;
    return <Button label="按此報名＋審核繳費" icon="create-outline" loading={busy === key} disabled={!!busy} onPress={() => register()} fullWidth />;
  };

  /** 審核中：同一列兩顆按鈕——「付款審核中（點擊查看）」與「取消」。 */
  const pendingRow = () => {
    const orderId = course.pendingOrderId;
    return (
    <View style={styles.pending}>
      <View style={{ flex: 1 }}>
        <Button variant="secondary" label="付款審核中（點擊查看）" icon="time-outline" onPress={() => router.push(orderId ? `/orders/${orderId}` : "/orders")} fullWidth />
      </View>
      <Button variant="cancel" label="取消" loading={busy === "cancel-course"} disabled={!!busy} onPress={() => cancel()} />
    </View>
    );
  };

  // 還不能看（尚未報名、不符資格…）：整個章節區蓋一層灰色遮罩加大鎖頭，章節完全不能點。
  const noAccess = course.lessons.length === 0 ? course.enrollment !== "opened" && !course.isPublic && !course.admin : course.lessons.every((l) => l.locked);
  const allLocked = noAccess;
  // 清單／素材類沒有報名：符合獎銜就能直接使用，不符合＝鎖頭（業主 2026-11-18）。
  const lockedText = course.isList ? (member ? "獎銜不符，目前無法使用" : "登入並符合獎銜才能使用") : course.priceTba ? "費用尚未公布，暫不開放" : member && !course.eligible ? "獎銜不符，目前無法報名" : "報名後才能觀看";
  // 報名／審核中的操作固定在頁面下方（底部選單上方），往下看章節、留言時仍然按得到；只是說明文字的（費用未公布、獎銜不符…）留在內容區。
  // 課程類一律手動報名（即使免費或完全公開，登入後都有報名鈕；報名＝訂閱，有更新會通知）；清單／素材類永遠沒有報名鈕（業主 2026-11-18）。
  const canRegister = course.enrollment === null && !course.isList && (!course.isPublic || !!member);
  const registerNode = canRegister ? registerButton(course.free, "course") : null;
  const registerIsAction = !!registerNode && (registerNode as { type?: unknown }).type === Button;
  const stickyAction = course.enrollment === "pending" ? pendingRow() : registerIsAction ? registerNode : null;
  const stickyNotice = registerNode && !registerIsAction ? registerNode : null;
  const needRank = member && !course.eligible ? `限${course.minRank.name}獎銜以上報名${course.allowPresident ? "（會長也可報名）" : ""}` : null;

  const lessons = course.lessons.filter((l) => !l.material);
  const materials = course.lessons.filter((l) => l.material);
  /** 重新編號：章節、教材各自從 1 開始（完整版課程影片不編號）。 */
  const renumber = (list: Lesson[]): Lesson[] => {
    const n = { chapter: 0, material: 0 };
    return list.map((l) => (l.full || l.section ? l : { ...l, position: ++n[l.material ? "material" : "chapter"] }));
  };
  /** 畫面先改、請求排隊在背景送：連續按很多下也照順序處理；全部完成才重新載入，失敗就還原並提示。 */
  const optimistic = (next: Lesson[], send: () => Promise<unknown>) => {
    setOpt(next);
    pendingOps.current += 1;
    opQueue.current = opQueue.current.then(async () => {
      try {
        await send();
      } catch (e) {
        setMessage({ tone: "danger", text: (e as Error).message });
        pendingOps.current = 0;
        setOpt(null);
        invalidate();
        return;
      }
      pendingOps.current -= 1;
      if (pendingOps.current === 0) invalidate();
    });
  };
  /** 把一組項目依新順序放回它們原本佔的位置（畫面先改、背景存檔）。 */
  const applyOrder = (group: Lesson[], next: Lesson[]) => {
    const ids = next.map((l) => l.id);
    const groupIds = new Set(group.map((l) => l.id));
    // 這一組在整份清單裡原本佔的位置，依新順序放回去。
    const all = course!.lessons;
    const slots = all.map((l, i) => (groupIds.has(l.id) && !l.full ? i : -1)).filter((i) => i >= 0);
    const merged = [...all];
    slots.forEach((slot, k) => (merged[slot] = next[k]!));
    optimistic(renumber(merged), () => api("POST", `/admin/courses/${course!.id}/lessons/order?lite=1`, { ids }));
  };
  const moveLesson = async (group: Lesson[], from: number, to: number) => {
    const movable = group.filter((l) => !l.full); // 「完整版課程影片」固定在最後，不參與排序
    const next = [...movable];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    applyOrder(group, next);
  };
  /** 把教材移到另一個區塊的最後面。 */
  const moveToBlock = (lesson: Lesson, blockId: string) => {
    const group = materials.filter((l) => !l.full);
    const rest = group.filter((l) => l.id !== lesson.id);
    const at = rest.findIndex((l) => l.id === blockId);
    if (at < 0) return;
    let end = at + 1;
    while (end < rest.length && !rest[end]!.section) end++;
    applyOrder(group, [...rest.slice(0, end), lesson, ...rest.slice(end)]);
  };
  /** 勾選的多個教材一起移到某區塊的最後面（保持它們原本的先後順序）。 */
  const moveManyToBlock = (ids: string[], blockId: string) => {
    const group = materials.filter((l) => !l.full);
    const pick = new Set(ids);
    const moved = group.filter((l) => pick.has(l.id));
    const rest = group.filter((l) => !pick.has(l.id));
    const at = rest.findIndex((l) => l.id === blockId);
    if (at < 0 || !moved.length) return;
    let end = at + 1;
    while (end < rest.length && !rest[end]!.section) end++;
    applyOrder(group, [...rest.slice(0, end), ...moved, ...rest.slice(end)]);
  };
  /** 清單的區塊整塊移動（區塊標題連同底下的教材一起）。 */
  const moveBlock = (groups: Lesson[][], from: number, to: number) => {
    const next = [...groups];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    applyOrder(materials.filter((l) => !l.full), next.flat());
  };
  const duplicateLesson = async (l: Lesson) => {
    const all = course!.lessons;
    const at = all.findIndex((x) => x.id === l.id);
    const copy: Lesson = { ...l, id: `tmp-${Date.now()}`, title: `${l.title}（複製）`.slice(0, 120), completed: false };
    optimistic(renumber([...all.slice(0, at + 1), copy, ...all.slice(at + 1)]), () => api("POST", `/admin/lessons/${l.id}/duplicate?lite=1`));
  };
  const deleteLesson = async (l: Lesson) => {
    const what = l.material ? "教材" : "章節";
    if (!(await confirmAsk(`刪除${what}`, `確定刪除「${l.title}」？這一${l.material ? "份" : "堂"}的音檔與附件會一併刪除。`, "刪除"))) return;
    optimistic(renumber(course!.lessons.filter((x) => x.id !== l.id)), () => api("DELETE", `/admin/lessons/${l.id}`));
  };
  const fullRow = materials.find((l) => l.full);
  const toggleFull = async (on: boolean) => {
    if (!on && fullRow) return deleteFull(fullRow);
    setLessonBusy(true);
    try {
      await api("POST", `/admin/courses/${course.id}/full-version`);
      invalidate();
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setLessonBusy(false);
    }
  };
  const deleteFull = async (l: Lesson) => {
    if (!(await confirmAsk("取消完整版課程影片", "確定移除「完整版課程影片」這一列？已設定的影片來源與秒數會一併清除。", "移除"))) return;
    setLessonBusy(true);
    try {
      await api("DELETE", `/admin/lessons/${l.id}`);
      invalidate();
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setLessonBusy(false);
    }
  };
  const statusText = course.status === "published" ? "上架中" : course.status === "archived" ? "已下架封存" : "未上架";
  const canEditContent = !!course.can?.edit;
  const onSaved = (d: CourseDetail) => setSaved(d);

  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title={course.title}
        path={course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`}
        course={course.isList ? undefined : { teacher: course.teacher ?? "", teacherTitle: course.teacherTitle ?? "", title: course.title }}
        list={course.isList ? { title: course.title } : undefined}
        // 直接從分享網址進來時，返回鍵回到「上一層」：中心主辦的課程＝該中心專屬頁；總部課程＝全部課程（業主 2026-11-17）。
        backTo={course.isList ? `/courses?focus=${encodeURIComponent(course.series ? `s:${course.series}` : `c:${course.id}`)}` : course.hostCenter ? `/courses?center=${encodeURIComponent(course.hostCenter)}` : "/courses"}
        // 清單卡：返回一律回到寰宇大學的卡片清單並定位到這張卡（業主 2026-11-18），不會跑到主辦中心頁。
        backAlways={course.isList}
        extra={
          manages && mode === "view" ? (
            <TopBarButton label="編輯" accessibilityLabel="編輯這門課程" iconName="create-outline" onPress={() => setMode("edit")} />
          ) : null
        }
      />
      {manages && mode !== "view" ? (
        <View style={[styles.banner, { backgroundColor: mode === "edit" ? c.accent : c.warning }]} accessibilityRole="summary">
          <Text style={styles.bannerText} numberOfLines={1}>
            {mode === "edit" ? `編輯模式中・${statusText}` : "預覽中：學員看到的樣子"}
          </Text>
          {mode === "edit" ? (
            <>
              <BannerButton label="預覽" onPress={() => setMode("preview")} />
              <BannerButton label="完成" strong onPress={() => setMode("view")} />
            </>
          ) : (
            <BannerButton label="回到編輯" strong onPress={() => setMode("edit")} />
          )}
        </View>
      ) : null}
      {/* 大螢幕橫向（平板橫放、電腦）：左欄＝舞台＋控制列，右欄＝章節與其他內容（業主 2026-11-18）；手機、平板直式維持上下排列。 */}
      <View style={lay.split ? styles.split : styles.stack}>
      <StageWidth.Provider value={lay.split ? null : undefined}>
      <View style={lay.split ? [styles.splitLeft, { width: Math.round(lay.width * 0.56) }] : undefined}>
        {stage ? (
          <View>
            {stage.audio ? (
              <InlineAudio trackKey={stage.key} />
            ) : (
              <>
                <PlayerSlot trackKey={stage.key} />
                <PlayerControls />
              </>
            )}
          </View>
        ) : playLegacy && session.playback ? (
          <LessonPlayer playback={session.playback} onSegmentEnd={session.onLegacyEnd} />
        ) : (
          <>
            <View>
              <EdmStage course={course} stats={course.isList ? stats : undefined} />
              {/* 影片中間不放任何按鈕（業主 2026-11-17）：播放一律從下面的控制列。 */}
            </View>
            {firstPlayable || playLesson ? (
              <View style={[styles.idleBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="播放" onPress={() => firstPlayable && !playLesson && playLesson_(firstPlayable.id)} hitSlop={8} style={styles.idlePlay}>
                  {playLesson ? <LoadingLadybug size={32} /> : <Ionicons name="play" size={26} color={c.text} />}
                </Pressable>
                <View style={[styles.idleTrack, { backgroundColor: c.border }]} />
                <AppText variant="callout" tone="muted">{`-${Math.floor((playLesson ?? firstPlayable)!.minutes)}:00`}</AppText>
              </View>
            ) : null}
          </>
        )}
        {editing && canEditContent ? (
          <Pressable accessibilityRole="button" accessibilityLabel="編輯 EDM 與封面" onPress={() => setSheet("art")} style={styles.edmEdit}>
            <Ionicons name="create-outline" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>EDM 與封面</Text>
          </Pressable>
        ) : null}
      </View>
      </StageWidth.Provider>
      <View style={lay.split ? [styles.splitRight, { borderLeftColor: c.border }] : styles.stack}>
      <Screen header={false} gutter={lay.split ? space.lg : undefined} footer={editing ? undefined : stickyAction}>
        {message ? <NoticeBox tone={message.tone} text={message.text} /> : null}
        {session.playError ? <NoticeBox tone="danger" text={session.playError} /> : null}
        {playLesson && session.engineError ? <NoticeBox tone="danger" text={session.engineError} /> : null}
        {session.playback?.kind === "demo" && playLesson ? <Pill label={session.playback.label} tone="warning" /> : null}
        {!editing && !member ? <LoginPrompt /> : null}
        {playLesson?.completed && !playNext && !playLesson.material ? (
          <NoticeBox tone="success" text="恭喜！你已完成這門課程的最後一堂。" />
        ) : null}
        {!editing ? stickyNotice : null}
        {manages && mode === "view" && course.status !== "published" ? <NoticeBox tone="warning" text={course.status === "archived" ? "這門課已下架封存：學員在全部課程看不到，已報名的人照常上課。" : "這門課尚未上架：只有管理者看得到。按右上「編輯」可以上架。"} /> : null}
        {editing ? (
          // 編輯模式的「設定」預設收起，按右側「展開」才看到（業主 2026-11-18，全站一致）。
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
                設定
              </AppText>
              <CollapseToggle open={settingsOpen} onPress={() => setSettingsOpen((v) => !v)} label="設定" />
            </View>
            {settingsOpen ? (
              <>
                {canEditContent ? <SectionList course={course} onOpen={setSheet} /> : (
                  <Card style={{ paddingVertical: 0 }}>
                    <ListRow icon="eye-outline" title="上架與刪除" subtitle={statusText} onPress={() => setSheet("status")} />
                  </Card>
                )}
              </>
            ) : null}
          </View>
        ) : null}

        {editing && canEditContent ? (
          <>
            {course.isList ? null : (
              <Section title="課程章節">
                <EditLessonRows group={lessons} word="章節" onEdit={setLessonSheet} onMove={(i, j) => moveLesson(lessons, i, j)} onCopy={duplicateLesson} onDelete={deleteLesson} busy={lessonBusy} />
                <Button variant="secondary" label="新增章節" icon="add" onPress={() => setSheet("newLesson")} fullWidth />
                <NoticeBox text="同一支影片可以切成多堂：每堂選同一支影片，再填各自的「開始／結束」時間，學員點選章節就會跳到該段。" />
              </Section>
            )}
            {/* 清單卡（業主 2026-11-16）：只有其他教材，而且不顯示「其他教材」標題、沒有完整版課程影片。 */}
            <Section title={course.isList ? "" : "其他教材"}>
              {hasBlocks(course) ? (
                <>
                {course.isList ? null : <Check label="顯示完整版課程影片" value={!!fullRow} onChange={toggleFull} disabled={lessonBusy} />}
                <BlockEditList items={materials} onEdit={setLessonSheet} onMoveItem={moveLesson} onMoveBlock={moveBlock} onCopy={duplicateLesson} onDelete={deleteLesson} onAddMaterial={(blockId) => (setMaterialBlock(blockId), setSheet("newMaterial"))} onAddBlock={() => setSheet("newSection")} onMoveTo={setMoveTarget} onPickMove={setPickBlock} busy={lessonBusy} />
                </>
              ) : (
                <>
                  {materials.length ? <EditLessonRows group={materials} word="教材" onEdit={setLessonSheet} onMove={(i, j) => moveLesson(materials, i, j)} onCopy={duplicateLesson} onDelete={deleteLesson} busy={lessonBusy} /> : null}
                  <Check label="顯示完整版課程影片" value={!!fullRow} onChange={toggleFull} disabled={lessonBusy} />
                  <Button variant="secondary" label="新增教材" icon="add" onPress={() => (setMaterialBlock(undefined), setSheet("newMaterial"))} fullWidth />
                </>
              )}
            </Section>
          </>
        ) : null}
        {(editing && canEditContent) || course.isList ? null : (
          <View>
          <ChapterList course={course} style={allLocked ? { minHeight: 230 } : undefined} playingId={editing ? null : playingId} onPlay={playLesson_} />
          {allLocked ? (
            <View style={styles.mask} accessibilityRole="alert" accessibilityLabel={lockedText}>
              <Ionicons name="lock-closed" size={48} color="#fff" />
              <AppText variant="title" style={{ color: "#fff", textAlign: "center" }}>
                {lockedText}
              </AppText>
              {needRank ? (
                <AppText variant="headline" style={{ color: "#fff", textAlign: "center" }}>
                  {needRank}
                </AppText>
              ) : null}
            </View>
          ) : null}
          </View>
        )}
        {!(editing && canEditContent) && course.lessons.some((l) => l.material) ? (
          <Section title={course.isList ? "" : "其他教材"}>
            {hasBlocks(course) && course.lessons.some((l) => l.section) ? (
              <View style={[styles.layoutToggle, { borderColor: c.border, backgroundColor: c.surface }]} accessibilityRole="radiogroup">
                {(["detail", "thumb"] as const).map((v) => (
                  <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: listLayout === v }} accessibilityLabel={v === "detail" ? "詳細列表" : "縮圖"} onPress={() => pickLayout(v)} style={[styles.layoutBtn, listLayout === v && { backgroundColor: c.accent }]}>
                    <Ionicons name={v === "detail" ? "list-outline" : "grid-outline"} size={22} color={listLayout === v ? c.textOnAccent : c.text} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <FullVersionList course={course} openBlock={block} layout={listLayout} playingId={editing ? null : playingId} onPlay={playLesson_} />
          </Section>
        ) : null}
        {member && course.status !== "draft" ? <CommentBoard courseId={course.id} /> : null}
      </Screen>
      </View>
      </View>
      {sheet === "art" ? (
        <EditSheet title="EDM 與封面" onClose={() => setSheet(null)} hideSave>
          <EdmManager course={course} onChanged={invalidate} />
        </EditSheet>
      ) : sheet === "newLesson" || sheet === "newMaterial" || sheet === "newSection" ? (
        sheet === "newMaterial" ? <NewMaterialSheet course={course} afterBlock={materialBlock} onClose={() => setSheet(null)} /> : sheet === "newSection" ? <SectionTitleSheet course={course} onClose={() => setSheet(null)} /> : <NewLessonSheet course={course} onClose={() => setSheet(null)} />
      ) : sheet ? (
        <SectionSheet section={sheet} course={course} onClose={() => setSheet(null)} onSaved={onSaved} />
      ) : null}
      {pickBlock ? <PickMaterialsSheet items={materials.filter((l) => !l.full)} blockId={pickBlock} onMove={(ids) => (moveManyToBlock(ids, pickBlock), setPickBlock(null))} onClose={() => setPickBlock(null)} /> : null}
      {moveTarget ? <MoveToBlockSheet items={materials.filter((l) => !l.full)} lesson={moveTarget} onPick={(id) => (moveToBlock(moveTarget, id), setMoveTarget(null))} onClose={() => setMoveTarget(null)} /> : null}
      {lessonSheet ? <LessonSheet course={course} lesson={course.lessons.find((l) => l.id === lessonSheet.id) ?? lessonSheet} onClose={() => setLessonSheet(null)} /> : null}
    </View>
  );
}

function BannerButton({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.bannerBtn, strong && { backgroundColor: "#fff" }]}>
      <Text style={{ color: strong ? "#123" : "#fff", fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layoutToggle: { alignSelf: "flex-end", flexDirection: "row", borderWidth: 1, borderRadius: radius.md, overflow: "hidden", height: minTouch, marginBottom: space.sm },
  layoutBtn: { width: 48, height: "100%", alignItems: "center", justifyContent: "center" },
  stack: { flex: 1 },
  split: { flex: 1, flexDirection: "row" },
  splitLeft: { alignSelf: "flex-start" },
  splitRight: { flex: 1, minWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  idleBar: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  idlePlay: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  idleTrack: { flex: 1, height: 6, borderRadius: 3 },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: minTouch },
  bannerText: { flex: 1, color: "#fff", fontWeight: "700", fontSize: 15 },
  bannerBtn: { minHeight: 36, minWidth: 64, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  edmEdit: { position: "absolute", right: space.sm, bottom: space.sm, flexDirection: "row", alignItems: "center", gap: 6, minHeight: minTouch, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.6)" },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  lessonMain: { flex: 1, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm },
  mask: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, backgroundColor: "rgba(70,76,72,0.72)", alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.md },
  pending: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
});
