import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { DEFAULT_KINDS, KINDS, MODES, type ActivitySettings, type ActivityView, type ItemCard, type ItemMode, type Kind, type LessonView } from "@check/contract";
import { api, API_BASE } from "@/api/client";
import { accessToken } from "@/central/auth";
import { itemRule } from "@/features/items";
import { shareLink } from "@/features/share";
import { dateOnly, dueText, isoToTwInput, mb, parseTw } from "@/format";
import { useData } from "@/state/session";
import { Btn, Card, Chip, confirmSheet, Field, flash, flashError, Loading, Note, Screen, Section, Seg, Sheet, T, Toggle } from "@/kit";

/** 管理：作業設定、每一堂與作業項目、加入連結、檔案保存。只有管理員。 */
export default function Manage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: v, error, reload } = useData<ActivityView>(`/activities/${id}`);
  const storage = useData<{ files: number; bytes: number }>(`/activities/${id}/storage`);
  const [lessonEdit, setLessonEdit] = useState<LessonView | "new" | null>(null);
  const [itemEdit, setItemEdit] = useState<{ lessonId: string; item: ItemCard | null } | null>(null);
  const [retention, setRetention] = useState("");
  useEffect(() => setRetention(dateOnly(v?.activity.retentionUntil ?? null)), [v?.activity.retentionUntil]);
  if (!v) return <Screen title="設定">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  if (v.role !== "manager") return <Screen title="設定"><Note tone="bad">只有管理員可以設定</Note></Screen>;
  const a = v.activity;
  const patch = async (body: Partial<Record<keyof ActivitySettings, unknown>>, msg = "已儲存") => {
    try {
      await api("PATCH", `/activities/${id}`, body);
      flash(msg);
      await reload();
    } catch (e) {
      flashError(e);
    }
  };
  return (
    <Screen title={`設定・${a.title}`}>
      <Section title="狀態" />
      <Card>
        <Seg items={[["draft", "草稿"], ["open", "開放中"], ["closed", "已結束"]]} value={a.status} onChange={async (s) => {
          if (s === "open" && a.status === "draft" && !(await confirmSheet("開放給學員？", "已加入的學員會收到通知，可以開始交作業。", "開放"))) return;
          await patch({ status: s }, s === "open" ? "已開放" : "已儲存");
        }} />
        <T tiny muted>草稿只有老師、管理員看得到；已結束就不能再交。</T>
      </Card>

      <Section title="學員加入" />
      <Card>
        <T small muted>學員點這個連結登入，就會申請加入這份作業。</T>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn small label="分享加入連結" onPress={() => shareLink(`/join/${a.joinCode}`, `請點連結加入「${a.title}」`)} />
          <Btn small kind="grey" label="重新產生" onPress={async () => {
            if (!(await confirmSheet("重新產生加入連結？", "舊的連結會立刻失效。", "重新產生"))) return;
            try { await api("POST", `/activities/${id}/join-code`); flash("已重新產生"); await reload(); } catch (e) { flashError(e); }
          }} />
        </View>
        <Toggle label="加入要管理員核准" value={a.joinApproval} onChange={(x) => patch({ joinApproval: x })} />
        <Btn small flex={false} kind="grey" label={`分組與名單${v.counts.pendingJoin ? `（${v.counts.pendingJoin} 人待核准）` : ""}`} onPress={() => router.push(`/groups/${id}`)} />
      </Card>

      <Section title="作業項目" right={<Btn small flex={false} label="＋新增一堂" onPress={() => setLessonEdit("new")} />} />
      {v.lessons.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <T bold>{l.title}</T>
              <T tiny muted>截止 {dueText(l.dueAt)}</T>
            </View>
            <Btn small flex={false} kind="grey" label="編輯" onPress={() => setLessonEdit(l)} />
          </View>
          {l.items.map((i, k) => (
            <View key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: "rgba(127,127,127,0.2)", paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <T small bold>{i.name}</T>
                <T tiny muted>{MODES[i.mode]}・{itemRule(i)}</T>
              </View>
              <Btn small flex={false} kind="grey" label="↑" disabled={k === 0} onPress={async () => { await api("POST", `/items/${i.id}/move`, { dir: -1 }); await reload(); }} />
              <Btn small flex={false} kind="grey" label="編輯" onPress={() => setItemEdit({ lessonId: l.id, item: i })} />
            </View>
          ))}
          <Btn small flex={false} kind="soft" icon="add" label="新增作業項目" onPress={() => setItemEdit({ lessonId: l.id, item: null })} />
        </Card>
      ))}

      <Section title="截止與提醒" />
      <Card>
        <Toggle label="截止後開放補交" note="補交的作業會標示「逾期」；每個項目也可以單獨設定" value={a.lateAllowed} onChange={(x) => patch({ lateAllowed: x })} />
        <Toggle label="自動提醒沒交的人" note="截止前 3 天、1 天各推一次" value={a.autoRemind} onChange={(x) => patch({ autoRemind: x })} />
        <Toggle label="同組組員互看時看得到分數" value={a.peersSeeScores} onChange={(x) => patch({ peersSeeScores: x })} />
      </Card>

      <Section title="檔案保存" />
      <Card>
        <T small>目前用量：{storage.data ? `${mb(storage.data.bytes)}・${storage.data.files} 個檔案` : "讀取中…"}</T>
        {a.filesPurgedAt ? <Note>檔案已於 {dueText(a.filesPurgedAt)} 刪除，成績與評語保留。</Note> : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field label="自動刪除日期（只刪檔案，成績保留）" value={retention} onChangeText={setRetention} placeholder="例如 2027/06/30" />
          </View>
          <Btn small flex={false} label="儲存" onPress={() => {
            const d = retention.trim() ? parseTw(retention)?.slice(0, 10) : "";
            if (d === undefined) return flash("日期格式不正確", "例如 2027/06/30", true);
            void patch({ retentionUntil: d });
          }} />
        </View>
        <T tiny muted>刪除前 30 天、7 天、1 天會通知所有人下載備份。</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn small kind="grey" label="備份全部檔案" onPress={() => router.push(`/files/${id}?all=1`)} />
          <Btn small kind="grey" label="下載成績表" onPress={() => downloadScores(id!, a.title)} />
        </View>
        <Btn small flex={false} kind="cancel" label="刪除全部檔案" disabled={!!a.filesPurgedAt} onPress={async () => {
          if (!(await confirmSheet("刪除這份作業的全部檔案？", `${storage.data?.files ?? 0} 個檔案會永久刪除，分數與評語保留。建議先備份。`, "刪除", true))) return;
          try { const r = await api<{ deleted: number }>("POST", `/activities/${id}/purge`); flash("已刪除全部檔案", `${r.deleted} 個`); await reload(); await storage.reload(); } catch (e) { flashError(e); }
        }} />
      </Card>

      <LessonSheet activityId={id!} value={lessonEdit} onClose={() => setLessonEdit(null)} onDone={reload} />
      <ItemSheet value={itemEdit} onClose={() => setItemEdit(null)} onDone={reload} />
    </Screen>
  );
}

async function downloadScores(id: string, title: string) {
  try {
    const token = await accessToken();
    const res = await fetch(`${API_BASE}/api/activities/${id}/scores`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("下載失敗，請再試一次");
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title}-成績.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else flash("請用網頁版下載成績表", "check.hglobal1985.com");
  } catch (e) {
    flashError(e);
  }
}

function LessonSheet({ activityId, value, onClose, onDone }: { activityId: string; value: LessonView | "new" | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const isNew = value === "new";
  useEffect(() => {
    if (value === "new") {
      setTitle("");
      setDue("");
    } else if (value) {
      setTitle(value.title);
      setDue(isoToTwInput(value.dueAt));
    }
  }, [value]);
  const save = async () => {
    const dueAt = due.trim() ? parseTw(due) : "";
    if (dueAt === null) return flash("截止時間格式不正確", "例如 2027/01/09 23:59", true);
    setBusy(true);
    try {
      if (isNew) await api("POST", `/activities/${activityId}/lessons`, { title, dueAt });
      else await api("PATCH", `/lessons/${(value as LessonView).id}`, { title, dueAt });
      flash("已儲存");
      onClose();
      await onDone();
    } catch (e) {
      flashError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!value} onClose={onClose} title={isNew ? "新增一堂" : "編輯這一堂"} footer={<><Btn label="取消" kind="cancel" onPress={onClose} /><Btn label="儲存" busy={busy} onPress={save} /></>}>
      <Field label="名稱" value={title} onChangeText={setTitle} placeholder="例如：第一堂" />
      <Field label="截止時間（台灣時間）" value={due} onChangeText={setDue} placeholder="2027/01/09 23:59" />
      {!isNew && value ? (
        <Btn kind="cancel" flex={false} label="刪除這一堂" onPress={async () => {
          if (!(await confirmSheet("刪除這一堂？", "這一堂的作業項目也會一起刪除。已經有人交作業就不能刪。", "刪除", true))) return;
          try { await api("DELETE", `/lessons/${value.id}`); flash("已刪除"); onClose(); await onDone(); } catch (e) { flashError(e); }
        }} />
      ) : null}
    </Sheet>
  );
}

type Draft = { name: string; note: string; mode: ItemMode; per: string; unit: string; maxPoints: string; minCount: string; points: string; fullScore: string; inTotal: boolean; kinds: Kind[] };
const toDraft = (i: ItemCard | null): Draft => ({
  name: i?.name ?? "",
  note: i?.note ?? "",
  mode: i?.mode ?? "count",
  per: i?.per != null ? String(i.per) : "1",
  unit: i?.unit ?? "張",
  maxPoints: i?.maxPoints != null ? String(i.maxPoints) : "",
  minCount: i?.minCount != null ? String(i.minCount) : "",
  points: i?.points != null ? String(i.points) : "5",
  fullScore: i?.fullScore != null ? String(i.fullScore) : "100",
  inTotal: i?.inTotal ?? true,
  kinds: i?.kinds ?? DEFAULT_KINDS.count,
});

function ItemSheet({ value, onClose, onDone }: { value: { lessonId: string; item: ItemCard | null } | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(toDraft(null));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) setD(toDraft(value.item));
  }, [value]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = async () => {
    setBusy(true);
    const body = { name: d.name, note: d.note, mode: d.mode, per: n(d.per), unit: d.unit, maxPoints: n(d.maxPoints), minCount: n(d.minCount), points: n(d.points), fullScore: n(d.fullScore), inTotal: d.inTotal, kinds: d.kinds };
    try {
      if (value?.item) await api("PATCH", `/items/${value.item.id}`, body);
      else await api("POST", `/lessons/${value!.lessonId}/items`, body);
      flash("已儲存", d.name);
      onClose();
      await onDone();
    } catch (e) {
      flashError(e);
    } finally {
      setBusy(false);
    }
  };
  const num = (label: string, k: keyof Draft, ph = "") => (
    <View style={{ flex: 1 }}>
      <Field label={label} value={String(d[k])} onChangeText={(t) => set({ [k]: t.replace(/[^\d.]/g, "") } as Partial<Draft>)} keyboardType="numeric" placeholder={ph} />
    </View>
  );
  return (
    <Sheet open={!!value} onClose={onClose} title={value?.item ? "編輯作業項目" : "新增作業項目"} footer={<><Btn label="取消" kind="cancel" onPress={onClose} /><Btn label="儲存" busy={busy} disabled={!d.name.trim()} onPress={save} /></>}>
      <Field label="項目名稱" value={d.name} onChangeText={(t) => set({ name: t })} placeholder="例如：卸妝乳示範照" />
      <T small bold>評分方式</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(MODES) as ItemMode[]).map((m) => (
          <Chip key={m} tone={d.mode === m ? "ok" : "plain"} label={MODES[m]} onPress={() => set({ mode: m, kinds: value?.item ? d.kinds : DEFAULT_KINDS[m], inTotal: m === "onsite" ? false : d.inTotal })} />
        ))}
      </View>
      {d.mode === "count" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>{num("每件幾分", "per")}<View style={{ flex: 1 }}><Field label="單位" value={d.unit} onChangeText={(t) => set({ unit: t })} placeholder="張" /></View></View>
          <View style={{ flexDirection: "row", gap: 8 }}>{num("最高幾分（空白＝不限）", "maxPoints")}{num("至少幾件（選填）", "minCount")}</View>
        </>
      ) : null}
      {d.mode === "fixed" || d.mode === "pass" ? num("通過得幾分", "points") : null}
      {d.mode === "score" || d.mode === "onsite" ? num("滿分", "fullScore") : null}
      {d.mode === "stars" ? num("1 顆星幾分", "per") : null}
      <Toggle label="加入總分" value={d.inTotal} onChange={(x) => set({ inTotal: x })} />
      {d.mode !== "onsite" ? (
        <>
          <T small bold>學員可以交</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <Chip key={k} tone={d.kinds.includes(k) ? "ok" : "plain"} label={KINDS[k]} onPress={() => set({ kinds: d.kinds.includes(k) ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] })} />
            ))}
          </View>
        </>
      ) : null}
      <Field label="說明（選填）" value={d.note} onChangeText={(t) => set({ note: t })} placeholder="例如：可加碼辦理" />
      {value?.item ? (
        <Btn kind="cancel" flex={false} label="刪除這個項目" onPress={async () => {
          if (!(await confirmSheet("刪除這個項目？", "已經有人交了就不能刪。", "刪除", true))) return;
          try { await api("DELETE", `/items/${value.item!.id}`); flash("已刪除"); onClose(); await onDone(); } catch (e) { flashError(e); }
        }} />
      ) : null}
    </Sheet>
  );
}
