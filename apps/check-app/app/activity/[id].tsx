import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { KINDS, type ActivityView } from "@check/contract";
import { api } from "@/api/client";
import { itemRule, StatusChip } from "@/features/items";
import { dueText, leftText } from "@/format";
import { useData } from "@/state/session";
import { useColors } from "@/kit";
import { Btn, Card, Chip, Empty, flash, flashError, Loading, Note, Progress, Screen, Seg, T } from "@/kit";

export default function ActivityPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { data: v, error } = useData<ActivityView>(`/activities/${id}`);
  const [lesson, setLesson] = useState<string | null>(null);
  useEffect(() => {
    if (!v || lesson) return;
    const next = v.lessons.find((l) => l.dueAt && Date.parse(l.dueAt) > Date.now()) ?? v.lessons[v.lessons.length - 1];
    setLesson(next?.id ?? null);
  }, [v, lesson]);
  if (!v) return <Screen title="作業">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  const teacher = v.role !== "student";
  const l = v.lessons.find((x) => x.id === lesson) ?? v.lessons[0];
  const lessonPts = l?.items.reduce((s, i) => s + (i.my?.status === "graded" && i.inTotal ? (i.my.points ?? 0) : 0), 0) ?? 0;
  return (
    <Screen
      title={v.activity.title}
      right={v.role === "manager" ? <Btn small flex={false} kind="grey" label="設定" onPress={() => router.push(`/manage/${id}`)} /> : undefined}
    >
      {teacher ? (
        <Card>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Chip label={`學員 ${v.counts.students} 人`} />
            <Chip label={`${v.counts.groups} 組`} />
            <Chip tone={v.counts.toReview ? "wait" : "plain"} label={`待批改 ${v.counts.toReview}`} />
            {v.counts.pendingJoin ? <Chip tone="bad" label={`待核准加入 ${v.counts.pendingJoin}`} /> : null}
            {v.activity.status === "draft" ? <Chip tone="gold" label="草稿：學員還看不到" /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Btn small label="批改" onPress={() => router.push(`/review/${id}`)} />
            <Btn small kind="grey" label="分組與名單" onPress={() => router.push(`/groups/${id}`)} />
          </View>
        </Card>
      ) : (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <T small muted>我的總分</T>
              <Text style={{ fontSize: 30, fontWeight: "800", color: c.green }}>{v.total}</Text>
            </View>
            <T small muted>{v.groupName ? `${v.groupName}${v.isLeader ? "・組長" : ""}` : "尚未分組"}</T>
          </View>
          <Progress value={v.total / 100} />
          {v.groupId ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Btn small kind="grey" label={v.isLeader ? "本組名單與分組" : "本組名單"} onPress={() => router.push(`/groups/${id}`)} />
              {v.isLeader ? <Btn small label="確認組員作業" onPress={() => router.push(`/review/${id}`)} /> : null}
            </View>
          ) : null}
        </Card>
      )}
      {!v.lessons.length ? (
        <Empty title="還沒有作業項目" note={v.role === "manager" ? "到右上角「設定」新增每一堂與作業項目。" : "老師還沒出作業。"} />
      ) : (
        <>
          <Seg items={v.lessons.map((x) => [x.id, x.title] as [string, string])} value={l.id} onChange={setLesson} />
          <Card style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <T small muted>截止 {dueText(l.dueAt)}</T>
              <T bold>
                {leftText(l.dueAt) || "沒有截止時間"}
                {l.dueAt && Date.parse(l.dueAt) < Date.now() && v.activity.lateAllowed ? "・可補交（標示逾期）" : ""}
              </T>
            </View>
            {teacher ? (
              <Btn
                small
                flex={false}
                kind="grey"
                label="提醒沒交的人"
                onPress={async () => {
                  try {
                    const r = await api<{ reminded: number }>(`/lessons/${l.id}/remind`, "POST");
                    flash("已提醒", `${r.reminded} 位學員會收到通知`);
                  } catch (e) {
                    flashError(e);
                  }
                }}
              />
            ) : (
              <View style={{ alignItems: "flex-end" }}>
                <T tiny muted>本堂得分</T>
                <Text style={{ fontSize: 22, fontWeight: "800", color: c.green }}>{lessonPts}</Text>
              </View>
            )}
          </Card>
          {l.items.map((i) => (
            <Card key={i.id} onPress={() => router.push(`/item/${i.id}`)}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T bold>{i.name}</T>
                  <T small muted>{itemRule(i)}</T>
                </View>
                {teacher && i.stats ? (
                  <Chip tone={i.stats.toReview ? "wait" : i.stats.submitted >= i.stats.students && i.stats.students ? "ok" : "plain"} label={i.mode === "onsite" ? `已登錄 ${i.stats.graded}/${i.stats.students}` : `已交 ${i.stats.submitted}/${i.stats.students}`} />
                ) : (
                  <StatusChip status={i.my?.status ?? "none"} points={i.my?.points} late={i.my?.late} />
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {i.kinds.length ? i.kinds.map((k) => <Chip key={k} label={KINDS[k]} />) : <Chip label="不用上傳" />}
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
