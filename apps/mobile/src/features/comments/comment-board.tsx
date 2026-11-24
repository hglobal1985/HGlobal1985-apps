import { useFeature } from "@/lib/app-mode";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { api, type CourseComment } from "@/api/client";
import { dateTime } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { confirmAsk } from "@/features/confirm";
import { AppText, Button, Card, Field, NoticeBox, Pill, Section, SheetAction } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";

/**
 * 課程留言板：登入會員可留言；可檢舉、封鎖對方（商店規範要求）；管理員可隱藏。
 * 課程頁（預設）：每則留言只顯示前幾行，點一則先從下方彈出完整內容與操作；按住面板往上拉（或按右上角「完整留言板」）進入完整留言頁。
 * 完整留言頁（full）：全文直接顯示、操作鈕直接放在每則留言下方；focusId 是從彈出面板帶進來的那一則（加上強調框）。
 */
/** 依使用模式設定檔（lib/app-mode.tsx）決定顯不顯示；至尊模式（業主 2026-11-24）不顯示留言板。 */
export function CommentBoard(props: { courseId: string; full?: boolean; focusId?: string }) {
  return !useFeature("comments") ? null : <CommentBoardInner {...props} />;
}

function CommentBoardInner({ courseId, full = false, focusId }: { courseId: string; full?: boolean; focusId?: string }) {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const { data, error } = useApi<CourseComment[]>(`/courses/${courseId}/comments`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [open, setOpen] = useState<CourseComment | null>(null);
  const admin = member?.role === "admin";

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ tone: "success", text: done });
      invalidate();
      return true;
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 一則留言的操作鈕（刪除／檢舉／封鎖／隱藏）：完整留言頁放在留言下方，課程頁放在彈出面板裡。 */
  const actions = (cm: CourseComment, after?: () => void) => (
    <View style={styles.row}>
      {cm.mine ? (
        <Button variant="ghost" label="刪除" disabled={busy} onPress={async () => (await confirmAsk("請確認", "確定刪除這則留言？")) && (await run(() => api("DELETE", `/comments/${cm.id}`))) && after?.()} />
      ) : (
        <>
          <Button variant="ghost" label="檢舉" disabled={busy} onPress={async () => (await confirmAsk("請確認", "檢舉這則留言？管理員會收到通知並處理。")) && (await run(() => api("POST", `/comments/${cm.id}/report`, {}), "已送出檢舉，謝謝你。")) && after?.()} />
          <Button variant="ghost" label="封鎖此人" disabled={busy} onPress={async () => (await confirmAsk("請確認", `封鎖後你將不再看到「${cm.authorName}」的留言。`)) && (await run(() => api("POST", `/comments/${cm.id}/block`), "已封鎖。")) && after?.()} />
        </>
      )}
      {admin ? <Button variant="ghost" label={cm.hidden ? "取消隱藏" : "隱藏"} disabled={busy} onPress={async () => (await run(() => api("PATCH", `/admin/comments/${cm.id}`, { hidden: !cm.hidden }))) && after?.()} /> : null}
    </View>
  );

  const head = (cm: CourseComment) => (
    <View style={styles.row}>
      <AppText variant="headline" style={{ flex: 1 }}>
        {cm.authorName}
        {cm.mine ? "（我）" : ""}
      </AppText>
      {cm.hidden ? <Pill label="已隱藏" tone="danger" /> : null}
      <AppText variant="caption" tone="muted">
        {dateTime(cm.createdAt)}
      </AppText>
    </View>
  );

  const goFull = (focus?: string) => {
    setOpen(null);
    router.push({ pathname: "/comments/[courseId]", params: { courseId, ...(focus ? { focus } : {}) } });
  };

  return (
    <Section title={`留言板${data ? `（${data.length}）` : ""}`}>
      <Card>
        <Field label="留言" value={body} onChange={setBody} placeholder="分享你的心得或提問（請保持友善）" multiline />
        <View style={styles.row}>
          <Button
            label="送出留言"
            icon="chatbubble-outline"
            loading={busy}
            disabled={!body.trim()}
            onPress={async () => {
              if (await run(() => api("POST", `/courses/${courseId}/comments`, { body }))) setBody("");
            }}
          />
        </View>
      </Card>
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      {error && !data ? <NoticeBox tone="danger" text={error} /> : null}
      {data && !data.length ? <NoticeBox text="還沒有留言，成為第一個留言的人吧。" /> : null}
      {data?.map((cm) =>
        full ? (
          <Card key={cm.id} style={focusId === cm.id ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
            {head(cm)}
            <AppText>{cm.body}</AppText>
            {actions(cm)}
          </Card>
        ) : (
          <Pressable key={cm.id} accessibilityRole="button" accessibilityLabel={`${cm.authorName} 的留言，點一下看完整內容`} onPress={() => setOpen(cm)} style={({ pressed }) => pressed && { opacity: 0.8 }}>
            <Card>
              {head(cm)}
              <AppText numberOfLines={3}>{cm.body}</AppText>
            </Card>
          </Pressable>
        ),
      )}
      {open ? (
        <BottomSheet onClose={() => setOpen(null)} onExpand={() => goFull(open.id)} expandLabel="繼續上拉進入完整留言板">
          <View style={styles.row}>
            <View style={{ flex: 1 }}>{head(open)}</View>
            <SheetAction label="完整留言板" accessibilityLabel="進入完整留言板" onPress={() => goFull(open.id)} />
          </View>
          <ScrollView style={{ maxHeight: 320 }}>
            <AppText selectable>{open.body}</AppText>
          </ScrollView>
          {actions(open, () => setOpen(null))}
        </BottomSheet>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm } });
