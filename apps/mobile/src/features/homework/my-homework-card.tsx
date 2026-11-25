import { router } from "expo-router";
import { View } from "react-native";
import type { MyHomework } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Card, ListRow, Pill } from "@/ui";
import { hwLeft, hwWhen, resultShort, STATUS_TEXT } from "./format";

/**
 * 「學習中」最上面的「我的作業」卡（業主 2026-11-25）：有作業的學員才看得到；
 * 被退回、還沒交的排最前面，最近截止與剩幾天一眼看得到；老師另外看到「待批改」。點一列直接進那份作業。
 */
export function MyHomeworkCard() {
  const { data } = useApi<MyHomework>("/homework/mine");
  if (!data || (!data.items.length && !data.toGrade.length)) return null;
  const next = data.items.find((i) => (i.status === "none" || i.status === "draft" || i.status === "returned") && i.dueAt && !i.overdue);
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <AppText variant="headline" style={{ flex: 1 }} accessibilityRole="header">
          我的作業
        </AppText>
        {data.todo ? <Pill label={`待繳 ${data.todo} 份`} tone="warning" /> : null}
      </View>
      {next ? (
        <AppText variant="callout" tone="muted">
          最近截止：{hwWhen(next.dueAt)}・{hwLeft(next.dueAt)}
        </AppText>
      ) : null}
      <View>
        {data.toGrade.map((t) => (
          <ListRow key={`g${t.assignmentId}`} icon="create-outline" title={t.title} subtitle={`${t.courseTitle}・老師批改`} right={<Pill label={`待批改 ${t.count}`} tone="warning" />} onPress={() => router.push(`/homework/a/${t.assignmentId}`)} />
        ))}
        {data.items.slice(0, 6).map((i) => {
          const r = resultShort(i.grading, i.result, i.status);
          const st = STATUS_TEXT[i.status];
          return <ListRow key={i.assignmentId} icon="document-text-outline" title={i.title} subtitle={`${i.courseTitle}${i.dueAt ? `・截止 ${hwWhen(i.dueAt, false)}` : ""}${i.overdue && (i.status === "none" || i.status === "draft") ? "・已逾期" : ""}`} right={<Pill label={r ?? st.label} tone={i.status === "graded" ? "success" : st.tone} />} onPress={() => router.push(`/homework/a/${i.assignmentId}`)} />;
        })}
      </View>
    </Card>
  );
}
