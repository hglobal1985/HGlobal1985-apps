import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { HwAssignment, HwCourseView } from "@/api/client";
import { AssignmentSheet } from "@/features/homework/assignment-sheet";
import { GRADING_HINT, hwWhen, resultShort, STATUS_TEXT } from "@/features/homework/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, GuestGate, LoadingView, NoticeBox, Pill, Screen } from "@/ui";

/** 一門課的作業（杜杜龍 2026-11-25）：學員看每份作業的狀態；老師另外可以出作業、看交了幾份、進分組。 */
export default function CourseHomework() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<HwCourseView>(member && courseId ? `/homework/course/${courseId}` : null);
  const [sheet, setSheet] = useState(false);
  if (!member)
    return (
      <Screen header={false}>
        <GuestGate icon="document-text-outline" body="登入後才看得到作業。" />
      </Screen>
    );
  const r = data?.role;
  return (
    <Screen header={false}>
      <Stack.Screen options={{ title: data ? `作業・${data.course.title}` : "作業" }} />
      {loading && !data ? <LoadingView /> : null}
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <NoticeBox text="作業不公開：只有本人、同組組員（看不到分數）、組長和老師看得到。" />
          {r?.teacher ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="出新作業" icon="add" onPress={() => setSheet(true)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" label="學員分組" icon="people-outline" onPress={() => router.push(`/homework/groups/${courseId}`)} fullWidth />
              </View>
            </View>
          ) : r?.groupId || r?.leaderOf ? (
            <Button variant="secondary" label={r.leaderOf ? "我這組（組長可以編組）" : "我的組別"} icon="people-outline" onPress={() => router.push(`/homework/groups/${courseId}`)} fullWidth />
          ) : null}
          {!data.assignments.length ? <EmptyState icon="document-text-outline" title="還沒有作業" body={r?.teacher ? "按上面的「出新作業」，學員會收到通知。" : "老師出作業時會通知你。"} /> : null}
          {data.assignments.map((a) => (
            <AssignmentCard key={a.id} a={a} teacher={!!r?.teacher || !!r?.leaderOf} />
          ))}
        </>
      ) : null}
      {sheet && courseId ? (
        <AssignmentSheet
          courseId={courseId}
          onClose={() => setSheet(false)}
          onSaved={(id) => {
            setSheet(false);
            reload();
            router.push(`/homework/a/${id}`);
          }}
        />
      ) : null}
    </Screen>
  );
}

function AssignmentCard({ a, teacher }: { a: HwAssignment; teacher: boolean }) {
  const { c } = useTheme();
  const st = STATUS_TEXT[a.myStatus];
  const res = resultShort(a.grading, a.myResult, a.myStatus);
  const k = a.counts;
  return (
    <Card onPress={() => router.push(`/homework/a/${a.id}`)} accessibilityLabel={`打開作業 ${a.title}`} style={{ gap: space.sm, opacity: a.open ? 1 : 0.75 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <AppText variant="headline" style={{ flex: 1 }}>
          {a.title}
        </AppText>
        {!a.open ? <Pill label={`${hwWhen(a.opensAt, false)} 開放`} /> : teacher && k ? (k.toGrade ? <Pill label={`待批改 ${k.toGrade}`} tone="warning" /> : <Pill label={`已交 ${k.submitted}／${k.members}`} tone="accent" />) : <Pill label={res ?? st.label} tone={a.myStatus === "graded" ? "success" : st.tone} />}
      </View>
      <AppText variant="caption" tone="muted">
        {a.dueAt ? `截止 ${hwWhen(a.dueAt)}${a.overdue ? "（已過）" : ""}・` : ""}評分：{GRADING_HINT[a.grading]}
      </AppText>
      {teacher && k && k.members ? (
        <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
          <View style={{ height: 8, width: `${Math.round((k.submitted / k.members) * 100)}%`, backgroundColor: c.accent }} />
        </View>
      ) : null}
    </Card>
  );
}
