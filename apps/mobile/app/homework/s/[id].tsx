import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, type HwAssignment, type HwSubmission } from "@/api/client";
import { HwComments } from "@/features/homework/comments";
import { HwFiles } from "@/features/homework/files-list";
import { hwWhen, STATUS_TEXT, TEACHER_STATUS } from "@/features/homework/format";
import { ResultCard } from "@/features/homework/result-card";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, ErrorView, Field, GuestGate, LoadingView, NoticeBox, Pill, Screen, Section } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type View_ = { submission: HwSubmission; assignment: HwAssignment; course: { id: string; title: string } };

/**
 * 看一份繳交（業主 2026-11-25）：老師在這裡批改——分數（快速鈕＋微調）、5 顆星、或「通過」，寫評語；
 * 下方固定「退回重交」（左）與「儲存並下一份」（右），批完自動跳到下一份待批改，手機單手一路批完。
 * 組長、同組組員看得到內容（組員看不到分數），組長可以留言。
 */
export default function SubmissionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member } = useSession();
  const { c } = useTheme();
  const { data, error, loading, reload } = useApi<View_>(member && id ? `/homework/s/${id}` : null);
  const [sub, setSub] = useState<HwSubmission | null>(null);
  const [score, setScore] = useState("");
  const [starN, setStarN] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setSub(data.submission);
    const r = data.submission.result;
    setScore(r?.score != null ? String(r.score) : "");
    setStarN(r?.stars ?? 0);
    setComment(r?.comment ?? "");
    setErr(null);
  }, [data]);
  useEffect(() => setBusy(false), [id]);
  if (!member)
    return (
      <Screen header={false}>
        <GuestGate icon="document-text-outline" body="登入後才看得到作業。" />
      </Screen>
    );
  const a = data?.assignment;
  const grade = async (action: "grade" | "return") => {
    if (!a || !sub) return;
    setBusy(true);
    setErr(null);
    try {
      const x = await api<{ next: string | null }>("POST", `/homework/s/${sub.id}/grade`, { action, score: Number(score), stars: starN, comment });
      if (x.next) {
        flashText(action === "return" ? "已退回，學員會收到通知" : "已儲存，學員會收到通知");
        router.replace(`/homework/s/${x.next}`);
      } else {
        flashText("這份作業全部批改完了！");
        router.replace(`/homework/a/${a.id}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const quick = a ? [0.6, 0.7, 0.8, 0.9, 1].map((p) => Math.round(a.maxScore * p)) : [];
  const ready = !a ? false : a.grading === "score" ? score.trim() !== "" : a.grading === "stars" ? starN > 0 : true;
  const footer =
    a && sub?.canGrade ? (
      <View style={{ gap: space.xs }}>
        {err ? <NoticeBox tone="danger" text={err} /> : null}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant="cancel" label="退回重交" disabled={busy} onPress={() => grade("return")} fullWidth />
          </View>
          <View style={{ flex: 1.4 }}>
            <Button label={sub.nextToGrade ? "儲存並下一份" : a.grading === "pass" ? "通過" : "儲存"} disabled={busy || !ready} loading={busy} onPress={() => grade("grade")} fullWidth />
          </View>
        </View>
      </View>
    ) : undefined;
  return (
    <Screen header={false} footer={footer}>
      <Stack.Screen options={{ title: sub ? `${sub.memberName}的作業` : "作業" }} />
      {loading && !data ? <LoadingView /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {a && sub && data ? (
        <>
          <Card style={{ gap: space.xs }}>
            <AppText variant="caption" tone="muted">
              {data.course.title}・{a.title}
            </AppText>
            <AppText variant="title">{sub.memberName}</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              {sub.groupName ? <Pill label={sub.groupName} /> : null}
              <Pill label={(sub.canGrade ? TEACHER_STATUS : STATUS_TEXT)[sub.status].label} tone={sub.status === "graded" ? "success" : (sub.canGrade ? TEACHER_STATUS : STATUS_TEXT)[sub.status].tone} />
              {sub.submittedAt ? <Pill label={`${hwWhen(sub.submittedAt)} 交${sub.late ? "・逾期" : ""}`} tone={sub.late ? "danger" : "neutral"} /> : null}
            </View>
            <Button variant="ghost" label="回到作業與繳交狀況" icon="arrow-back" onPress={() => router.replace(`/homework/a/${a.id}`)} fullWidth />
          </Card>
          {sub.files.length ? <HwFiles files={sub.files} title={`${sub.memberName}・${a.title}`} /> : null}
          {sub.note ? (
            <Card style={{ gap: space.xs }}>
              <AppText variant="caption" tone="muted">
                文字／留給老師的話
              </AppText>
              <AppText variant="callout">{sub.note}</AppText>
            </Card>
          ) : null}
          {sub.result && !sub.canGrade ? <ResultCard grading={a.grading} max={a.maxScore} sub={sub} /> : null}
          {sub.canGrade ? (
            <Section title="批改">
              <View style={{ gap: space.md }}>
                {sub.status === "graded" ? <NoticeBox text="已經批改過；再儲存會更新分數與評語並再通知學員。" /> : null}
                {a.grading === "score" ? (
                  <View style={{ gap: space.sm }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      分數（滿分 {a.maxScore}）
                    </AppText>
                    <View style={styles.chips}>
                      {quick.map((v) => {
                        const on = score === String(v);
                        return (
                          <Pressable key={v} accessibilityRole="button" accessibilityLabel={`${v} 分`} onPress={() => setScore(String(v))} style={[styles.chip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface }]}>
                            <AppText style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>{v}</AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                      <Pressable accessibilityRole="button" accessibilityLabel="減 1 分" onPress={() => setScore(String(Math.max(0, (Number(score) || 0) - 1)))} style={[styles.step, { backgroundColor: c.surfaceMuted }]}>
                        <AppText style={{ fontSize: 24, fontWeight: "800" }}>−</AppText>
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Field label="" value={score} onChange={(v) => setScore(v.replace(/\D/g, "").slice(0, 4))} numeric placeholder="分數" />
                      </View>
                      <Pressable accessibilityRole="button" accessibilityLabel="加 1 分" onPress={() => setScore(String(Math.min(a.maxScore, (Number(score) || 0) + 1)))} style={[styles.step, { backgroundColor: c.surfaceMuted }]}>
                        <AppText style={{ fontSize: 24, fontWeight: "800" }}>＋</AppText>
                      </Pressable>
                    </View>
                  </View>
                ) : a.grading === "stars" ? (
                  <View style={{ gap: space.sm }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      點星星評分
                    </AppText>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} 顆星`} onPress={() => setStarN(n)} style={styles.star}>
                          <AppText style={{ fontSize: 40, lineHeight: 48, color: n <= starN ? "#E0A400" : c.border }}>★</AppText>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <NoticeBox text="通過／重交制：按下方「通過」，或「退回重交」並寫評語。" />
                )}
                <Field label="評語（學員看得到；退回重交時必填）" value={comment} onChange={setComment} placeholder="寫給學員的話" multiline />
              </View>
            </Section>
          ) : null}
          <HwComments sub={sub} onChanged={setSub} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minWidth: 60, minHeight: minTouch, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  step: { width: minTouch, height: minTouch, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  star: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
});
