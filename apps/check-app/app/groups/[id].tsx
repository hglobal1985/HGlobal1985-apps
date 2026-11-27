import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { PeopleView, Person } from "@check/contract";
import { api } from "@/api/client";
import { shareLink } from "@/features/share";
import { useData } from "@/state/session";
import { Avatar, Btn, Card, Chip, confirmSheet, Empty, Field, flash, flashError, Loading, Note, Screen, Section, Sheet, T } from "@/kit";

type Act = { label: string; run: () => Promise<unknown>; done: string; confirm?: [string, string]; danger?: boolean };

/** 分組與名單：老師全部可編；組長只能編自己這組；學員只看自己這組。 */
export default function Groups() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: v, error, reload } = useData<PeopleView>(`/activities/${id}/people`);
  const [who, setWho] = useState<Person | null>(null);
  const [moving, setMoving] = useState<Person | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  if (!v) return <Screen title="分組">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  const teacher = v.staff.length > 0 || v.canManage;
  const leaderGroup = v.canEditGroupId;
  const person = (p: Person, extra?: string) => (
    <Pressable key={p.memberId} accessibilityRole="button" onPress={() => (teacher || leaderGroup ? setWho(p) : undefined)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56 }}>
      <Avatar name={p.name} url={p.avatarUrl} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <T bold>{p.name}</T>
          {p.isLeader ? <Chip tone="gold" label="組長" /> : null}
        </View>
        {extra ? <T tiny muted>{extra}</T> : null}
      </View>
      {p.total != null ? <T bold>{p.total} 分</T> : null}
    </Pressable>
  );
  const call = async (a: Act) => {
    setWho(null);
    setMoving(null);
    if (a.confirm && !(await confirmSheet(a.confirm[0], a.confirm[1], a.label, a.danger))) return;
    try {
      await a.run();
      flash(a.done);
      await reload();
    } catch (e) {
      flashError(e);
    }
  };
  const post = (m: string, body: object) => () => api("POST", `/activities/${id}/people/${encodeURIComponent(m)}`, body);
  const actions = (p: Person): Act[] => {
    const out: Act[] = [];
    if (p.status === "pending")
      return [
        { label: "核准加入", run: post(p.memberId, { action: "approve" }), done: "已核准" },
        { label: "拒絕", run: post(p.memberId, { action: "reject" }), done: "已拒絕", confirm: ["拒絕加入？", `${p.name} 不會加入這份作業。`], danger: true },
      ];
    if (p.role !== "student") {
      if (v.canManage) out.push({ label: p.role === "manager" ? "改成老師" : "改成管理員", run: post(p.memberId, { action: "role", role: p.role === "manager" ? "teacher" : "manager" }), done: "已更改" });
      if (v.canManage) out.push({ label: "改回學員", run: post(p.memberId, { action: "role", role: "student" }), done: "已更改" });
      return out;
    }
    if (teacher) {
      if (p.groupId && !p.isLeader) out.push({ label: "設為組長", run: post(p.memberId, { action: "leader" }), done: "已設為組長" });
      if (v.canManage) out.push({ label: "設為老師", run: post(p.memberId, { action: "role", role: "teacher" }), done: "已設為老師" });
    }
    if (!p.groupId && leaderGroup) out.push({ label: "拉進本組", run: post(p.memberId, { action: "group", groupId: leaderGroup }), done: "已加入本組" });
    if (p.groupId && (teacher || p.groupId === leaderGroup) && !p.isLeader) out.push({ label: "移出這一組", run: post(p.memberId, { action: "group", groupId: null }), done: "已移出", confirm: [`把 ${p.name} 移出這一組？`, "作業和分數都會保留，只是變成「還沒分組」。"], danger: true });
    if (v.canManage) out.push({ label: "移出這份作業", run: post(p.memberId, { action: "remove" }), done: "已移出", confirm: [`把 ${p.name} 移出這份作業？`, "他將看不到這份作業；已交的作業和分數保留。"], danger: true });
    return out;
  };
  return (
    <Screen
      title={teacher ? "分組與名單" : "本組"}
      right={teacher ? <Btn small flex={false} label="＋新增組" onPress={async () => { try { await api("POST", `/activities/${id}/groups`, {}); flash("已新增一組"); await reload(); } catch (e) { flashError(e); } }} /> : undefined}
    >
      {v.pending.length ? (
        <>
          <Section title={`等待核准（${v.pending.length}）`} />
          <Card style={{ gap: 0 }}>{v.pending.map((p) => person(p, "點一下核准或拒絕"))}</Card>
        </>
      ) : null}
      {v.groups.map((g) => (
        <View key={g.id} style={{ gap: 8 }}>
          <Section
            title={`${g.name}・${g.members.length} 人`}
            right={teacher || g.id === leaderGroup ? <Btn small flex={false} kind="grey" label="改組名" onPress={() => setRename({ id: g.id, name: g.name })} /> : undefined}
          />
          {g.joinCode ? (
            <Card style={{ flexDirection: "row", alignItems: "center" }}>
              <T small muted style={{ flex: 1 }}>學員點這一組的連結登入，就會自動加入「{g.name}」</T>
              <Btn small flex={false} label="分享連結" onPress={() => shareLink(`/join/${g.joinCode}`, `請點連結加入「${g.name}」`)} />
            </Card>
          ) : null}
          <Card style={{ gap: 0 }}>{g.members.length ? g.members.map((p) => person(p)) : <T small muted>還沒有組員</T>}</Card>
        </View>
      ))}
      {!v.groups.length ? <Empty title="還沒有分組" note={teacher ? "按右上角「＋新增組」。" : "老師還沒幫你分組。"} /> : null}
      {teacher || leaderGroup ? (
        <>
          <Section title={`還沒分組（${v.unassigned.length}）`} />
          <Card style={{ gap: 0 }}>{v.unassigned.length ? v.unassigned.map((p) => person(p, teacher ? "點一下分組" : "點一下拉進本組")) : <T small muted>全部都分好了</T>}</Card>
        </>
      ) : null}
      {v.staff.length ? (
        <>
          <Section title="老師與管理員" />
          <Card style={{ gap: 0 }}>{v.staff.map((p) => person(p, p.role === "manager" ? "管理員" : "老師"))}</Card>
        </>
      ) : null}
      {v.canManage ? (
        <Card>
          <T small muted>邀請老師：產生 24 小時有效、只能一人使用的連結</T>
          <Btn
            flex={false}
            kind="grey"
            label="產生老師邀請連結"
            onPress={async () => {
              try {
                const r = await api<{ code: string }>("POST", `/activities/${id}/invites`, { role: "teacher" });
                await shareLink(`/invite/${r.code}`, "邀請你擔任作業老師（24 小時內有效）");
              } catch (e) {
                flashError(e);
              }
            }}
          />
        </Card>
      ) : null}

      <Sheet open={!!who} onClose={() => setWho(null)} title={who?.name} footer={<Btn label="關閉" kind="cancel" onPress={() => setWho(null)} />}>
        {who && teacher && who.role === "student" && who.status === "active" ? <Btn kind="grey" flex={false} label={who.groupId ? "換到其他組" : "分到某一組"} onPress={() => { setMoving(who); setWho(null); }} /> : null}
        {who ? actions(who).map((a) => <Btn key={a.label} kind={a.danger ? "cancel" : "grey"} flex={false} label={a.label} onPress={() => call(a)} />) : null}
        {!teacher ? <T small muted>指定組長、換組只有老師能做。</T> : null}
      </Sheet>
      <Sheet open={!!moving} onClose={() => setMoving(null)} title={`把 ${moving?.name ?? ""} 分到…`} footer={<Btn label="取消" kind="cancel" onPress={() => setMoving(null)} />}>
        {v.groups.map((g) => (
          <Btn key={g.id} kind="grey" flex={false} label={`${g.name}（${g.members.length} 人）`} onPress={() => call({ label: g.name, run: post(moving!.memberId, { action: "group", groupId: g.id }), done: `已分到${g.name}` })} />
        ))}
      </Sheet>
      <RenameSheet value={rename} onClose={() => setRename(null)} onDone={reload} />
    </Screen>
  );
}

function RenameSheet({ value, onClose, onDone }: { value: { id: string; name: string } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(value?.name ?? ""), [value]);
  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title="改組名"
      footer={
        <>
          <Btn label="取消" kind="cancel" onPress={onClose} />
          <Btn
            label="儲存"
            busy={busy}
            disabled={!name.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                await api("PATCH", `/groups/${value!.id}`, { name });
                flash("已儲存");
                onClose();
                await onDone();
              } catch (e) {
                flashError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      }
    >
      <Field value={name} onChangeText={setName} placeholder={value?.name} autoFocus />
    </Sheet>
  );
}
