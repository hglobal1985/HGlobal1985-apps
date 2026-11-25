import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api, type HwGroupMember, type HwGroupsView } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Field, GuestGate, ListRow, LoadingView, NoticeBox, Pill, Screen, Section, SheetRow } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";

/**
 * 學員分組（業主 2026-11-25：組長、老師都可以編組）。
 * 老師：新增組、改組名、刪組、把學員換組、指定組長（一組一位）。
 * 組長：把還沒分組的學員拉進自己這組、把組員移出、改自己這組的組名。
 * 一般學員：只看得到自己這組的名單。點一位學員從下方彈出可做的動作。
 */
export default function HomeworkGroups() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<HwGroupsView>(member && courseId ? `/homework/course/${courseId}/groups` : null);
  const [view, setView] = useState<HwGroupsView | null>(null);
  const [name, setName] = useState("");
  const [pick, setPick] = useState<{ m: HwGroupMember; groupId: string | null } | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const v = view ?? data;
  if (!member)
    return (
      <Screen header={false}>
        <GuestGate icon="people-outline" body="登入後才看得到分組。" />
      </Screen>
    );
  const run = async (fn: () => Promise<HwGroupsView>, done?: string) => {
    try {
      setView(await fn());
      if (done) flashText(done);
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const move = (sub: string, groupId: string | null, leader?: boolean, done?: string) => {
    setPick(null);
    void run(() => api<HwGroupsView>("PUT", `/homework/course/${courseId}/member`, { sub, groupId, ...(leader !== undefined ? { leader } : {}) }), done);
  };
  const addGroup = () => {
    void run(() => api<HwGroupsView>("POST", `/homework/course/${courseId}/groups`, { name }), `已新增「${name}」`);
    setName("");
  };
  const delGroup = async (id: string, n: string) => {
    if (!(await confirmSheet({ title: `刪除「${n}」`, message: "組員會變成「還沒分組」，作業不受影響。", confirmLabel: "刪除", danger: true }))) return;
    void run(() => api<HwGroupsView>("DELETE", `/homework/groups/${id}`), "已刪除");
  };
  const groupName = (id: string | null) => v?.groups.find((g) => g.id === id)?.name ?? "";
  return (
    <Screen header={false}>
      <Stack.Screen options={{ title: "學員分組" }} />
      {loading && !v ? <LoadingView /> : null}
      {error && !v ? <ErrorView message={error} onRetry={reload} /> : null}
      {v ? (
        <>
          <NoticeBox text={v.teacher ? "點學員可以換組或設為組長。名單是這門課已開通的學員。組長看得到自己這組的作業並留言；評分只有老師。" : v.leaderOf ? "你是組長：點「還沒分組」的學員可以拉進你這組，點組員可以移出。" : "這是你這組的名單；同組組員看得到彼此已送出的作業（看不到分數）。"} />
          {v.teacher ? (
            <Card style={{ gap: space.sm }}>
              <Field label="新增一組" value={name} onChange={setName} placeholder="例如：第一組" />
              <Button label="新增" icon="add" disabled={!name.trim()} onPress={addGroup} fullWidth />
            </Card>
          ) : null}
          {!v.groups.length && !v.ungrouped.length ? <EmptyState icon="people-outline" title="還沒有分組" /> : null}
          {v.groups.map((g) => (
            <Section
              key={g.id}
              title={`${g.name}（${g.members.length} 人）`}
              action={
                v.teacher || v.leaderOf === g.id ? (
                  <View style={{ flexDirection: "row", gap: space.xs }}>
                    <Button variant="ghost" label="改名" onPress={() => setRename({ id: g.id, name: g.name })} />
                    {v.teacher ? <Button variant="ghost" label="刪除" onPress={() => void delGroup(g.id, g.name)} /> : null}
                  </View>
                ) : undefined
              }
            >
              <Card style={{ paddingVertical: 0 }}>
                {!g.members.length ? (
                  <AppText tone="muted" style={{ paddingVertical: space.md }}>
                    還沒有組員
                  </AppText>
                ) : null}
                {g.members.map((m) => (
                  <ListRow key={m.sub} icon={m.leader ? "star" : "person-outline"} title={m.name} right={m.leader ? <Pill label="組長" tone="bright" /> : undefined} onPress={v.teacher || (v.leaderOf === g.id && !m.leader) ? () => setPick({ m, groupId: g.id }) : undefined} />
                ))}
              </Card>
            </Section>
          ))}
          {v.ungrouped.length ? (
            <Section title={`還沒分組（${v.ungrouped.length} 人）`}>
              <Card style={{ paddingVertical: 0 }}>
                {v.ungrouped.map((m) => (
                  <ListRow key={m.sub} icon="person-add-outline" title={m.name} onPress={() => setPick({ m, groupId: null })} />
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}
      {pick && v ? (
        <BottomSheet onClose={() => setPick(null)}>
          <AppText variant="title" style={{ paddingBottom: space.sm }}>
            {pick.m.name}
            {pick.groupId ? `（${groupName(pick.groupId)}）` : ""}
          </AppText>
          <SheetScroll>
            {v.teacher
              ? v.groups.filter((g) => g.id !== pick.groupId).map((g) => <SheetRow key={g.id} title={`移到 ${g.name}`} onPress={() => move(pick.m.sub, g.id, false, `已移到${g.name}`)} />)
              : !pick.groupId && v.leaderOf
                ? [<SheetRow key="join" title={`加入我這組（${groupName(v.leaderOf)}）`} onPress={() => move(pick.m.sub, v.leaderOf, undefined, "已加入")} />]
                : null}
            {v.teacher && pick.groupId && !pick.m.leader ? <SheetRow title="★ 設為這一組的組長" onPress={() => move(pick.m.sub, pick.groupId, true, `${pick.m.name} 已設為組長`)} /> : null}
            {v.teacher && pick.groupId && pick.m.leader ? <SheetRow title="取消組長" onPress={() => move(pick.m.sub, pick.groupId, false, "已取消組長")} /> : null}
            {pick.groupId ? <SheetRow title="移出分組" onPress={() => move(pick.m.sub, null, undefined, "已移出")} /> : null}
          </SheetScroll>
        </BottomSheet>
      ) : null}
      {rename ? (
        <BottomSheet onClose={() => setRename(null)}>
          <View style={{ gap: space.md }}>
            <Field label="組名" value={rename.name} onChange={(n) => setRename({ ...rename, name: n })} />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button variant="cancel" label="取消" onPress={() => setRename(null)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="儲存"
                  disabled={!rename.name.trim()}
                  onPress={() => {
                    const r = rename;
                    setRename(null);
                    void run(() => api<HwGroupsView>("PATCH", `/homework/groups/${r.id}`, { name: r.name }), "已改名");
                  }}
                  fullWidth
                />
              </View>
            </View>
          </View>
        </BottomSheet>
      ) : null}
    </Screen>
  );
}
