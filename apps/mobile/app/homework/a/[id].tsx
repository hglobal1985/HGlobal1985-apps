import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useUnsavedPrompt } from "@/lib/settings-page";
import { api, type HwAssignmentView, type HwFile, type HwRosterRow, type HwStatus, type HwSubmission } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { AssignmentSheet } from "@/features/homework/assignment-sheet";
import { HwComments } from "@/features/homework/comments";
import { HwFiles } from "@/features/homework/files-list";
import { GRADING_HINT, hwLeft, hwWhen, resultShort, STATUS_TEXT, TEACHER_STATUS } from "@/features/homework/format";
import { ResultCard } from "@/features/homework/result-card";
import { HomeworkUploader } from "@/features/homework/uploader";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, ErrorView, Field, GuestGate, ListRow, LoadingView, NoticeBox, Pill, Screen, Section, SegmentTabs } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Filter = "all" | "submitted" | "graded" | "none";

/**
 * 一份作業（杜杜龍 2026-11-25）：
 * - 學員：看說明 → 放照片／短影片／檔案／連結、寫文字 → 下方「送出作業」；送出後截止前都能修改；批改後看分數與評語。
 * - 老師、組長：下面列出繳交狀況（依組別），點一位進去看作業；老師可以批改、提醒還沒交的人、修改作業。
 * - 同組組員：看得到同組已送出的作業（看不到分數）。
 */
export default function AssignmentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<HwAssignmentView>(member && id ? `/homework/a/${id}` : null);
  const [mine, setMine] = useState<HwSubmission | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    setMine(data?.mine ?? null);
    setNote(data?.mine?.note ?? "");
  }, [data]);
  const a = data?.assignment;
  const r = data?.role;
  const staff = !!r?.teacher || !!r?.leaderOf;
  const status: HwStatus = mine?.status ?? "none";
  const canEdit = !!r?.enrolled && !!a?.open && status !== "graded";
  const dirtyNote = note !== (mine?.note ?? "");
  const submit = async (): Promise<boolean> => {
    if (!a) return false;
    setBusy(true);
    setErr(null);
    try {
      const x = await api<{ mine: HwSubmission }>("POST", `/homework/a/${a.id}/submit`, { note });
      setMine(x.mine);
      flashText(status === "submitted" ? "已更新作業" : "已送出作業，批改好會通知你");
      reload();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // 作業說明打到一半還沒送出：離開（含瀏覽器上一頁、手勢）前主動詢問（杜杜龍 2026-11-26 永久指示）
  useUnsavedPrompt({ dirty: canEdit && dirtyNote && !!note.trim(), save: submit, discard: () => setNote(mine?.note ?? "") });
  const remove = async (f: HwFile) => {
    if (!(await confirmSheet({ title: "移除這個檔案", message: f.name, confirmLabel: "移除", danger: true }))) return;
    try {
      setMine((await api<{ mine: HwSubmission | null }>("DELETE", `/homework/files/${f.id}`)).mine);
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const remind = async () => {
    if (!a || !(await confirmSheet({ title: "提醒還沒交的人", message: "還沒送出、或被退回的學員會收到通知。", confirmLabel: "送出提醒" }))) return;
    try {
      const x = await api<{ count: number }>("POST", `/homework/a/${a.id}/remind`);
      flashText(`已提醒 ${x.count} 位學員`);
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const rows = useMemo(() => {
    const list = data?.roster ?? [];
    return list.filter((x) => filter === "all" || (filter === "submitted" ? x.status === "submitted" : filter === "graded" ? x.status === "graded" || x.status === "returned" : x.status === "none" || x.status === "draft"));
  }, [data, filter]);
  if (!member)
    return (
      <Screen header={false}>
        <GuestGate icon="document-text-outline" body="登入後才看得到作業。" />
      </Screen>
    );
  const firstToGrade = data?.roster.find((x) => x.status === "submitted" && x.submissionId)?.submissionId;
  const hasWork = !!mine?.files.length || !!note.trim();
  const footer =
    a && canEdit ? (
      <View style={{ gap: space.xs }}>
        {err ? <NoticeBox tone="danger" text={err} /> : null}
        <Button
          label={status === "submitted" ? (dirtyNote ? "更新作業" : "已送出・可以繼續修改") : status === "returned" ? "重新送出" : hasWork ? "送出作業" : "先放上檔案或寫文字"}
          icon="paper-plane-outline"
          disabled={busy || !hasWork || (status === "submitted" && !dirtyNote)}
          loading={busy}
          onPress={submit}
          fullWidth
        />
      </View>
    ) : undefined;
  return (
    <Screen header={false} footer={footer}>
      <Stack.Screen options={{ title: a?.title ?? "作業" }} />
      {loading && !data ? <LoadingView /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {a && data && r ? (
        <>
          <Card style={{ gap: space.sm }}>
            <AppText variant="caption" tone="muted">
              {data.course.title}
            </AppText>
            <AppText variant="title">{a.title}</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {a.dueAt ? <Pill label={`截止 ${hwWhen(a.dueAt)}`} tone={a.overdue ? "danger" : "warning"} /> : null}
              {a.dueAt && !a.overdue ? <Pill label={hwLeft(a.dueAt)} /> : null}
              {!a.open ? <Pill label={`${hwWhen(a.opensAt)} 開放繳交`} /> : null}
              <Pill label={`評分：${GRADING_HINT[a.grading]}${a.grading === "score" ? `（滿分 ${a.maxScore}）` : ""}`} />
            </View>
            {a.body ? <AppText variant="callout">{a.body}</AppText> : null}
            {r.teacher ? <Button variant="ghost" label="修改作業" icon="create-outline" onPress={() => setEdit(true)} fullWidth /> : null}
          </Card>

          {r.enrolled ? (
            <Section title="我的作業">
              <View style={{ gap: space.md }}>
                <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
                  <Pill label={STATUS_TEXT[status].label} tone={status === "graded" ? "success" : STATUS_TEXT[status].tone} />
                  {mine?.submittedAt ? (
                    <AppText variant="caption" tone="muted">
                      {hwWhen(mine.submittedAt)} 送出{mine.late ? "・逾期" : ""}
                    </AppText>
                  ) : null}
                </View>
                {mine?.result ? <ResultCard grading={a.grading} max={a.maxScore} sub={mine} /> : null}
                {status === "returned" ? <NoticeBox tone="warning" text="老師退回了這份作業，照評語修改後再按「重新送出」。" /> : null}
                {mine?.files.length ? <HwFiles files={mine.files} title={a.title} onRemove={canEdit ? remove : undefined} /> : null}
                {canEdit ? <HomeworkUploader assignment={a} mine={mine} onChanged={setMine} /> : null}
                {canEdit && (a.kinds.includes("text") || note) ? <Field label={a.kinds.includes("text") ? "文字心得" : "想對老師說的話（選填）"} value={note} onChange={setNote} placeholder={a.kinds.includes("text") ? "寫下你的心得" : "例如：第三張是在中心拍的"} multiline /> : null}
                {!canEdit && mine?.note ? (
                  <Card>
                    <AppText variant="callout">{mine.note}</AppText>
                  </Card>
                ) : null}
                {!a.open ? <NoticeBox text={`${hwWhen(a.opensAt)} 開放繳交，到時會通知你。`} /> : null}
                {mine && mine.status !== "draft" ? <HwComments sub={mine} onChanged={setMine} /> : null}
              </View>
            </Section>
          ) : null}

          {staff ? (
            <Section title={r.teacher ? "繳交狀況" : "我這組的繳交狀況"}>
              <View style={{ gap: space.sm }}>
                {a.counts ? (
                  <AppText variant="callout" tone="muted">
                    已交 {a.counts.submitted}／{a.counts.members}・待批改 {a.counts.toGrade}・已批改 {a.counts.graded}
                    {a.counts.returned ? `・退回 ${a.counts.returned}` : ""}
                  </AppText>
                ) : null}
                {r.teacher && firstToGrade ? <Button label="開始批改" icon="create-outline" onPress={() => router.push(`/homework/s/${firstToGrade}`)} fullWidth /> : null}
                <SegmentTabs<Filter>
                  options={[
                    { key: "all", label: "全部" },
                    { key: "submitted", label: "待批改" },
                    { key: "graded", label: "已批改" },
                    { key: "none", label: "未繳" },
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
                <Roster rows={rows} grading={a.grading} />
                {!rows.length ? <AppText tone="muted">沒有符合的學員</AppText> : null}
                {r.teacher ? <Button variant="secondary" label="提醒還沒交的人" icon="notifications-outline" onPress={remind} fullWidth /> : null}
                {r.teacher && !data.groups.length ? <NoticeBox text="還沒分組。到「學員分組」排好組、指定組長後，組長就能看自己這組的作業。" /> : null}
              </View>
            </Section>
          ) : data.roster.length ? (
            <Section title="同組的作業">
              <Roster rows={data.roster} grading={a.grading} />
            </Section>
          ) : null}
        </>
      ) : null}
      {edit && a ? (
        <AssignmentSheet
          courseId={a.courseId}
          editing={a}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            reload();
          }}
          onDeleted={() => {
            setEdit(false);
            router.replace(`/homework/${a.courseId}`);
          }}
        />
      ) : null}
    </Screen>
  );
}

function Roster({ rows, grading }: { rows: HwRosterRow[]; grading: HwAssignmentView["assignment"]["grading"] }) {
  const groups: { name: string; rows: HwRosterRow[] }[] = [];
  for (const x of rows) {
    const name = x.groupName ?? "未分組";
    const g = groups.find((y) => y.name === name) ?? (groups.push({ name, rows: [] }), groups[groups.length - 1]!);
    g.rows.push(x);
  }
  return (
    <View style={{ gap: space.sm }}>
      {groups.map((g) => (
        <Card key={g.name} style={{ paddingVertical: 0 }}>
          <AppText variant="caption" tone="muted" style={{ paddingTop: space.sm }}>
            {g.name}
          </AppText>
          {g.rows.map((x) => {
            const st = TEACHER_STATUS[x.status];
            const res = resultShort(grading, x.result, x.status);
            return (
              <ListRow
                key={x.sub}
                icon={x.leader ? "star-outline" : "person-outline"}
                title={`${x.name}${x.leader ? "（組長）" : ""}`}
                subtitle={x.submittedAt ? `${hwWhen(x.submittedAt)} 交${x.late ? "・逾期" : ""}` : "還沒交"}
                right={<Pill label={res ?? st.label} tone={x.status === "graded" ? "success" : st.tone} />}
                onPress={x.submissionId ? () => router.push(`/homework/s/${x.submissionId}`) : undefined}
              />
            );
          })}
        </Card>
      ))}
    </View>
  );
}
