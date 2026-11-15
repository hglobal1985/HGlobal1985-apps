import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type CourseDetail, type Lesson, type Order } from "@/api/client";
import { CommentBoard } from "@/features/comments/comment-board";
import { confirmAsk, confirmSheet } from "@/features/confirm";
import { EdmStage } from "@/features/courses/edm-viewer";
import { ChapterList, FullVersionList } from "@/features/courses/lesson-list";
import { EdmManager } from "@/features/admin/edm-manager";
import { AutoCoverCheck, SectionList, SectionSheet, type SectionKey } from "@/features/course-edit/course-sections";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { EditLessonRows, LessonSheet, NewLessonSheet, useYoutubeLengthFix } from "@/features/course-edit/lessons";
import { PageHeader } from "@/features/page-header";
import { teacherLine } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, ErrorView, ListRow, LoadingView, NoticeBox, Screen, Section, TopBarButton } from "@/ui";

type Mode = "view" | "edit" | "preview";

const isWeb = Platform.OS === "web";

/**
 * 課程介紹頁：上方只有 EDM（與上課頁影片區同高、可上下拖曳、點一下放大），下面不再放任何課程說明文字，
 * 只有報名按鈕（依狀態）與課程章節。標題在上方導覽列。
 */
export default function CourseDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const { member, ready, invalidate } = useSession();
  const { c } = useTheme();
  const { data, error, loading, reload } = useApi<CourseDetail>(`/courses/${id}`);
  // 剛儲存回來的最新資料（重新載入完成前先用它，避免下一次儲存誤判「別人剛改過」）。
  const [saved, setSaved] = useState<CourseDetail | null>(null);
  const course = saved && saved.id === data?.id && (saved.admin?.updatedAt ?? "") > (data?.admin?.updatedAt ?? "") ? saved : data;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  // 原地編輯：有權限的人在工具列按「編輯」進入；可「預覽」切回學員看到的樣子。
  const manages = !!(course?.can?.edit || course?.can?.remove || course?.can?.restore);
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    if (edit === "1" && manages) setMode("edit");
  }, [edit, manages]);
  const editing = manages && mode === "edit";
  const [sheet, setSheet] = useState<SectionKey | "art" | "newLesson" | "newMaterial" | null>(null);
  const [lessonSheet, setLessonSheet] = useState<Lesson | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  const detecting = useYoutubeLengthFix(course, editing && Platform.OS === "web");

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
    if (free) return <Button label="免費報名" icon="gift-outline" loading={busy === key} disabled={!!busy} onPress={() => register()} fullWidth />;
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
      <Button variant="danger" label="取消" loading={busy === "cancel-course"} disabled={!!busy} onPress={() => cancel()} />
    </View>
    );
  };

  // 還不能看（尚未報名、不符資格…）：整個章節區蓋一層灰色遮罩加大鎖頭，章節完全不能點。
  const noAccess = course.lessons.length === 0 ? course.enrollment !== "opened" && !course.isPublic && !course.admin : course.lessons.every((l) => l.locked);
  const allLocked = noAccess;
  const lockedText = course.priceTba ? "費用尚未公布，暫不開放" : member && !course.eligible ? "獎銜不符，目前無法報名" : "報名後才能觀看";
  // 報名／審核中的操作固定在頁面下方（底部選單上方），往下看章節、留言時仍然按得到；只是說明文字的（費用未公布、獎銜不符…）留在內容區。
  const canRegister = course.enrollment === null && !course.isPublic && !course.watchFree;
  const registerNode = canRegister ? registerButton(course.free, "course") : null;
  const registerIsAction = !!registerNode && (registerNode as { type?: unknown }).type === Button;
  const stickyAction = course.enrollment === "pending" ? pendingRow() : registerIsAction ? registerNode : null;
  const stickyNotice = registerNode && !registerIsAction ? registerNode : null;
  const needRank = member && !course.eligible ? `限${course.minRank.name}獎銜以上報名${course.allowPresident ? "（會長也可報名）" : ""}` : null;

  const lessons = course.lessons.filter((l) => !l.full && !l.material);
  const materials = course.lessons.filter((l) => l.material);
  const moveLesson = async (group: Lesson[], from: number, to: number) => {
    const ids = group.map((l) => l.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x!);
    setLessonBusy(true);
    try {
      await api("POST", `/admin/courses/${course.id}/lessons/order`, { ids });
      invalidate();
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setLessonBusy(false);
    }
  };
  const duplicateLesson = async (l: Lesson) => {
    setLessonBusy(true);
    try {
      await api("POST", `/admin/lessons/${l.id}/duplicate`);
      invalidate();
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setLessonBusy(false);
    }
  };
  const deleteLesson = async (l: Lesson) => {
    const what = l.material ? "教材" : "章節";
    if (!(await confirmAsk(`刪除${what}`, `確定刪除「${l.title}」？這一${l.material ? "份" : "堂"}的音檔與附件會一併刪除。`, "刪除"))) return;
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
        path={`/course/${course.id}`}
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
      <View>
        <EdmStage course={course} />
        {editing && canEditContent ? (
          <Pressable accessibilityRole="button" accessibilityLabel="編輯 EDM 與封面" onPress={() => setSheet("art")} style={styles.edmEdit}>
            <Ionicons name="create-outline" size={20} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>EDM 與封面</Text>
          </Pressable>
        ) : null}
      </View>
      <Screen header={false} footer={editing ? undefined : stickyAction}>
        {message ? <NoticeBox tone={message.tone} text={message.text} /> : null}
        {!editing ? stickyNotice : null}
        {manages && mode === "view" && course.status !== "published" ? <NoticeBox tone="warning" text={course.status === "archived" ? "這門課已下架封存：學員在全部課程看不到，已報名的人照常上課。" : "這門課尚未上架：只有管理者看得到。按右上「編輯」可以上架。"} /> : null}
        {editing ? (
          <Section title="課程設定">
            {detecting ? <NoticeBox text="正在偵測 YouTube 影片長度（讓課程顯示預估分鐘數）…" /> : null}
            {canEditContent ? <SectionList course={course} onOpen={setSheet} /> : (
              <Card style={{ paddingVertical: 0 }}>
                <ListRow icon="eye-outline" title="上架與刪除" subtitle={statusText} onPress={() => setSheet("status")} />
              </Card>
            )}
          </Section>
        ) : null}

        {teacherLine(course) ? (
          <AppText variant="callout" tone="muted">
            {teacherLine(course)}
          </AppText>
        ) : null}

        {editing && canEditContent ? (
          <>
            <Section title="課程章節">
              <EditLessonRows group={lessons} word="章節" onEdit={setLessonSheet} onMove={(i, j) => moveLesson(lessons, i, j)} onCopy={duplicateLesson} onDelete={deleteLesson} busy={lessonBusy} />
              <Button variant="secondary" label="新增章節" icon="add" onPress={() => setSheet("newLesson")} fullWidth />
              <NoticeBox text="同一支影片可以切成多堂：每堂選同一支影片，再填各自的「開始／結束」時間，學員點選章節就會跳到該段。" />
            </Section>
            <Section title="其他教材">
              {materials.length ? <EditLessonRows group={materials} word="教材" onEdit={setLessonSheet} onMove={(i, j) => moveLesson(materials, i, j)} onCopy={duplicateLesson} onDelete={deleteLesson} busy={lessonBusy} /> : null}
              <Button variant="secondary" label="新增教材" icon="add" onPress={() => setSheet("newMaterial")} fullWidth />
              <NoticeBox text="講義、錄音、補充影片等教材放這裡：操作與章節相同，但不計入章節堂數與學習進度。系統自動產生的「完整版」也會出現在這一區的最前面。" />
            </Section>
          </>
        ) : null}
        {editing && canEditContent ? null : (
        <Section title="課程章節">
          <View>
          <ChapterList course={course} style={allLocked ? { minHeight: 230 } : undefined} />
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
        </Section>
        )}
        {!(editing && canEditContent) && course.lessons.some((l) => l.full || l.material) ? (
          <Section title="其他教材">
            <FullVersionList course={course} />
          </Section>
        ) : null}
        {member && course.status !== "draft" ? <CommentBoard courseId={course.id} /> : null}
      </Screen>
      {sheet === "art" ? (
        <EditSheet title="EDM 與封面" onClose={() => setSheet(null)} hideSave>
          <AutoCoverCheck course={course} onChanged={invalidate} />
          <EdmManager course={course} onChanged={invalidate} />
        </EditSheet>
      ) : sheet === "newLesson" || sheet === "newMaterial" ? (
        <NewLessonSheet course={course} kind={sheet === "newMaterial" ? "material" : "chapter"} onClose={() => setSheet(null)} />
      ) : sheet ? (
        <SectionSheet section={sheet} course={course} onClose={() => setSheet(null)} onSaved={onSaved} />
      ) : null}
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
