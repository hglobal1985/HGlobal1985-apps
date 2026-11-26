import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { ActivityView, QueueEntry } from "@check/contract";
import { api } from "@/api/client";
import { Comments, FileGrid } from "@/features/files";
import { gradeBody, GradePanel, gradeReady, initialGrade, type GradeInput } from "@/features/grade";
import { itemRule } from "@/features/items";
import { useData } from "@/state/session";
import { Avatar, Btn, Card, Chip, Empty, Field, flash, flashError, Loading, Note, Progress, Screen, Sheet, T } from "@/kit";

/** 批改台：一份一份往下批（老師評分；組長確認或退回）。 */
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const act = useData<ActivityView>(`/activities/${id}`);
  const { data, error, reload } = useData<QueueEntry[]>(`/activities/${id}/queue`);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [g, setG] = useState<GradeInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState(false);
  const [retText, setRetText] = useState("");
  const list = (data ?? []).filter((e) => !done.has(e.submission.id));
  const e = list[0];
  const teacher = act.data ? act.data.role !== "student" : null;
  useEffect(() => {
    if (e) setG(initialGrade(e.submission));
  }, [e?.submission.id]);
  if (!data || teacher === null) return <Screen title="批改">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  const total = data.length;
  const next = (sid: string) => setDone((s) => new Set(s).add(sid));
  if (!e)
    return (
      <Screen title="批改">
        <Empty title={total ? "全部處理完成" : "目前沒有要批改的作業"} note={total ? "學員都會收到通知。" : teacher ? "學員送出作業後會出現在這裡。" : "組員送出作業後會出現在這裡。"} action={<Btn flex={false} kind="grey" label="重新整理" onPress={async () => { setDone(new Set()); await reload(); }} />} />
        <Btn flex={false} kind="grey" label="回到作業" onPress={() => router.replace(`/activity/${id}`)} />
      </Screen>
    );
  const s = e.submission;
  const fixed = e.item.mode === "fixed" || e.item.mode === "pass";
  const run = async (fn: () => Promise<unknown>, msg: string, note: string) => {
    setBusy(true);
    try {
      await fn();
      flash(msg, note);
      next(s.id);
    } catch (err) {
      flashError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title={`${teacher ? "批改" : "確認組員作業"}・${total - list.length + 1} / ${total}`}
      footer={
        <>
          <Btn label="退回重交" kind="cancel" onPress={() => { setRetText(g?.comment ?? ""); setRet(true); }} />
          {teacher ? (
            <Btn label={fixed ? "通過・下一份" : "儲存並下一份"} busy={busy} disabled={!g || !gradeReady(e.item, g)} onPress={() => run(() => api(`/submissions/${s.id}/grade`, "POST", gradeBody(e.item, g!)), "已儲存", `${s.name}，下一份`)} />
          ) : (
            <Btn label="確認沒問題" busy={busy} onPress={() => run(() => api(`/submissions/${s.id}/leader-ok`, "POST", { note: "" }), "已確認", "交給老師評分")} />
          )}
        </>
      }
    >
      <Progress value={(total - list.length) / total} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Avatar name={s.name} />
        <View style={{ flex: 1 }}>
          <T bold>{s.name}</T>
          <T tiny muted>{e.lessonTitle}・{e.item.name}</T>
        </View>
        {e.groupName ? <Chip label={e.groupName} /> : null}
        {s.late ? <Chip tone="bad" label="逾期" /> : null}
      </View>
      <T small muted>{itemRule(e.item)}</T>
      <FileGrid files={s.files} />
      {s.note ? <Note>{`學員說明：${s.note}`}</Note> : null}
      {s.status === "leader_ok" ? <Note tone="ok">{`組長已確認${s.leaderNote ? `：${s.leaderNote}` : ""}`}</Note> : null}
      {teacher && g ? <GradePanel item={e.item} sub={s} value={g} onChange={setG} /> : <Note>組長只能確認或退回，分數由老師評。</Note>}
      <Card>
        <Comments submissionId={s.id} comments={s.comments} onChange={reload} canModerate={act.data?.role === "manager"} />
      </Card>
      <Sheet
        open={ret}
        onClose={() => setRet(false)}
        title={`退回 ${s.name} 的作業`}
        footer={
          <>
            <Btn label="取消" kind="cancel" onPress={() => setRet(false)} />
            <Btn
              label="退回"
              busy={busy}
              disabled={!retText.trim()}
              onPress={async () => {
                setRet(false);
                await run(() => api(`/submissions/${s.id}/return`, "POST", { comment: retText }), "已退回重交", `${s.name} 會收到通知`);
              }}
            />
          </>
        }
      >
        <Field value={retText} onChangeText={setRetText} placeholder="告訴學員要怎麼改（必填）" multiline />
      </Sheet>
    </Screen>
  );
}
