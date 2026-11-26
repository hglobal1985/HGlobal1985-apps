import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { ItemCard, SubmissionView } from "@check/contract";
import { api } from "@/api/client";
import { Comments, FileGrid } from "@/features/files";
import { gradeBody, GradePanel, gradeReady, initialGrade, type GradeInput } from "@/features/grade";
import { itemRule, StatusChip } from "@/features/items";
import { useData } from "@/state/session";
import { Avatar, Btn, Card, Field, flash, flashError, Loading, Note, Screen, Sheet, T } from "@/kit";

type V = { submission: SubmissionView; item: ItemCard; canGrade: boolean; canLeaderReview: boolean };

/** 看一份繳交（老師可評分；組長可確認或退回；同組組員只能看）。 */
export default function SubmissionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: v, error, reload } = useData<V>(`/submissions/${id}`);
  const [g, setG] = useState<GradeInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState(false);
  const [retText, setRetText] = useState("");
  useEffect(() => {
    if (v) setG(initialGrade(v.submission));
  }, [v?.submission.id, v?.submission.status]);
  if (!v) return <Screen title="作業">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  const s = v.submission;
  const canReturn = v.canGrade || (v.canLeaderReview && s.status === "submitted");
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      flash(msg);
      await reload();
    } catch (e) {
      flashError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title={`${s.name}・${v.item.name}`}
      footer={
        canReturn ? (
          <>
            <Btn label="退回重交" kind="cancel" onPress={() => { setRetText(""); setRet(true); }} />
            {v.canGrade && g ? (
              <Btn label={s.status === "graded" ? "修改評分" : "儲存評分"} busy={busy} disabled={!gradeReady(v.item, g)} onPress={() => act(() => api(`/submissions/${s.id}/grade`, "POST", gradeBody(v.item, g)), "已儲存")} />
            ) : (
              <Btn label="確認沒問題" busy={busy} onPress={() => act(() => api(`/submissions/${s.id}/leader-ok`, "POST", { note: "" }), "已確認")} />
            )}
          </>
        ) : undefined
      }
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar name={s.name} />
          <T bold style={{ flex: 1 }}>{s.name}</T>
          <StatusChip status={s.status} points={s.points} late={s.late} />
        </View>
        <T small muted>{itemRule(v.item)}{s.declared != null ? `・申報 ${s.declared} ${v.item.unit}` : ""}</T>
      </Card>
      <FileGrid files={s.files} />
      {s.note ? <Note>{`說明：${s.note}`}</Note> : null}
      {s.comment && s.status !== "draft" ? <Note tone={s.status === "returned" ? "bad" : "ok"}>{`老師評語：${s.comment}`}</Note> : null}
      {v.canGrade && g ? <GradePanel item={v.item} sub={s} value={g} onChange={setG} /> : null}
      <Card>
        <Comments submissionId={s.id} comments={s.comments} onChange={reload} canModerate={v.canGrade} />
      </Card>
      <Sheet
        open={ret}
        onClose={() => setRet(false)}
        title={`退回 ${s.name} 的作業`}
        footer={
          <>
            <Btn label="取消" kind="cancel" onPress={() => setRet(false)} />
            <Btn label="退回" disabled={!retText.trim()} onPress={async () => { setRet(false); await act(() => api(`/submissions/${s.id}/return`, "POST", { comment: retText }), "已退回重交"); }} />
          </>
        }
      >
        <Field value={retText} onChangeText={setRetText} placeholder="告訴學員要怎麼改（必填）" multiline />
      </Sheet>
    </Screen>
  );
}
