import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import type { ActivityCard } from "@check/contract";
import { api } from "@/api/client";
import { dateOnly, leftText, parseTw, shortDue } from "@/format";
import { useData, useSession } from "@/state/session";
import { Btn, Card, Chip, Empty, Field, flash, flashError, font, Loading, Note, Progress, Screen, Sheet, T, useColors } from "@/kit";

export default function Home() {
  const { me } = useSession();
  const { data, loading, error } = useData<ActivityCard[]>("/home");
  const [adding, setAdding] = useState(false);
  return (
    <Screen title="我的作業" back={false} right={me?.superAdmin ? <Btn small flex={false} label="＋新增作業" onPress={() => setAdding(true)} /> : undefined}>
        {loading && !data ? <Loading /> : null}
        {error && !data ? <Note tone="bad">{error}</Note> : null}
        {data && !data.length ? <Empty title="目前沒有作業" note="請點作業管理員給你的加入連結，加入後就會出現在這裡。" /> : null}
        {data?.map((a) => <ActivityHero key={a.id} a={a} />)}
      <NewActivity open={adding} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); router.push(`/manage/${id}`); }} />
    </Screen>
  );
}

function ActivityHero({ a }: { a: ActivityCard }) {
  const c = useColors();
  const teacher = a.role !== "student";
  const white = { color: c.on };
  const sub = { color: c.on, opacity: 0.85, fontSize: 13 };
  if (a.pending)
    return (
      <Card>
        <T bold>{a.title}</T>
        <Note tone="wait">已送出加入申請，等待管理員核准。核准後會通知你。</Note>
      </Card>
    );
  return (
    <Card accent onPress={() => router.push(`/activity/${a.id}`)}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={sub}>{[dateOnly(a.startsOn), dateOnly(a.endsOn)].filter(Boolean).join(" – ")}</Text>
          <Text style={[font.title, white, { fontSize: 20 }]}>{a.title}</Text>
        </View>
        <Chip tone="gold" label={a.status === "draft" ? "草稿" : a.status === "closed" ? "已結束" : "進行中"} />
      </View>
      {teacher ? (
        <>
          <Text style={sub}>{a.role === "manager" ? "管理員" : "老師"}</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Pill label={`待批改 ${a.toReview}`} />
            {a.nextDue ? <Pill label={`${a.nextDue.lessonTitle} ${shortDue(a.nextDue.dueAt)} 截止`} /> : null}
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Text style={sub}>我的總分</Text>
              <Text style={{ color: c.on, fontSize: 32, fontWeight: "800" }}>{a.total}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={sub}>{a.groupName ? `${a.groupName}${a.isLeader ? "・組長" : ""}` : "尚未分組"}</Text>
              {a.nextDue ? <Text style={[white, { fontWeight: "700" }]}>{`${a.nextDue.lessonTitle}・${leftText(a.nextDue.dueAt)}`}</Text> : null}
            </View>
          </View>
          <Progress value={a.total / 100} light />
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Pill label={`待繳 ${a.todo}`} />
            {a.returned ? <Pill label={`退回 ${a.returned}`} /> : null}
            {a.isLeader && a.toReview ? <Pill label={`組員待確認 ${a.toReview}`} /> : null}
            {a.nextDue ? <Pill label={`最近截止 ${shortDue(a.nextDue.dueAt)}`} /> : null}
          </View>
        </>
      )}
      {a.filesPurged ? <Text style={sub}>檔案已刪除，成績保留</Text> : null}
    </Card>
  );
}
function Pill({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: c.on, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function NewActivity({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const toDate = (s: string) => (s.trim() ? (parseTw(s)?.slice(0, 10) ?? "x") : "");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="新增作業"
      footer={
        <>
          <Btn label="取消" kind="cancel" onPress={onClose} />
          <Btn
            label="建立"
            busy={busy}
            disabled={!title.trim()}
            onPress={async () => {
              const s = toDate(start);
              const e = toDate(end);
              if (s === "x" || e === "x") return flash("日期格式不正確", "例如 2026/12/05", true);
              setBusy(true);
              try {
                const { id } = await api<{ id: string }>("POST", "/activities", { title, startsOn: s, endsOn: e });
                flash("已建立", "先是草稿，設定好再開放");
                onDone(id);
              } catch (err) {
                flashError(err);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      }
    >
      <Field label="作業名稱" value={title} onChangeText={setTitle} placeholder="例如：美力之星 第二屆" />
      <Field label="開始日期（選填）" value={start} onChangeText={setStart} placeholder="2026/12/05" />
      <Field label="結束日期（選填）" value={end} onChangeText={setEnd} placeholder="2027/02/20" />
      <T small muted>建立後先是草稿，只有你和老師看得到。設定好每一堂與作業項目再開放。</T>
    </Sheet>
  );
}
