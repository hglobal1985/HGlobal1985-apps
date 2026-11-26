import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { KINDS, LIMITS, MODES, pointsFor, type ItemView, type Kind } from "@check/contract";
import { api, upload } from "@/api/client";
import { Comments, FileGrid } from "@/features/files";
import { itemRule, StatusChip } from "@/features/items";
import { pickFiles, pickPhotos, pickVideo, takePhoto, type Picked } from "@/features/upload";
import { dueText, leftText } from "@/format";
import { useData } from "@/state/session";
import { Avatar, Btn, Card, Check, Chip, Field, flash, flashError, Loading, Note, Progress, Screen, Section, Seg, Sheet, Stepper, T } from "@/kit";

export default function ItemPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: v, error, reload, set } = useData<ItemView>(`/items/${id}`);
  if (!v) return <Screen title="作業">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  return v.role === "student" ? <StudentItem v={v} set={set} reload={reload} /> : <TeacherItem v={v} reload={reload} />;
}

function Header({ v }: { v: ItemView }) {
  return (
    <Card>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <T small muted style={{ flex: 1 }}>
          {v.lesson.title}・截止 {dueText(v.lesson.dueAt)}
          {v.lesson.dueAt ? `（${leftText(v.lesson.dueAt)}）` : ""}
        </T>
        {v.role === "student" ? <StatusChip status={v.my?.status ?? "none"} points={v.my?.points} late={v.my?.late} /> : <Chip label={MODES[v.item.mode]} />}
      </View>
      <T bold>{itemRule(v.item)}</T>
      {v.deadlinePassed && v.role === "student" ? <T small muted>{v.lateAllowed ? "已截止，仍可補交（會標示逾期）" : "已截止，不開放補交"}</T> : null}
    </Card>
  );
}

function StudentItem({ v, set, reload }: { v: ItemView; set: (d: ItemView) => void; reload: () => Promise<void> }) {
  const my = v.my;
  const files = my?.files ?? [];
  const [declared, setDeclared] = useState(my?.declared ?? 0);
  const [note, setNote] = useState(my?.note ?? "");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [entry, setEntry] = useState<"link" | "text" | null>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  useEffect(() => {
    if (my?.declared != null) setDeclared(my.declared);
  }, [my?.declared]);
  const needsConsent = files.some((f) => f.kind === "photo" || f.kind === "video");
  const room = LIMITS.entries - files.length;

  const sendPicked = async (list: Picked[]) => {
    if (!list.length) return;
    setProgress(0);
    try {
      let last: ItemView | null = null;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const q = `kind=${p.kind}&name=${encodeURIComponent(p.name)}${p.durationSec ? `&dur=${p.durationSec}` : ""}`;
        last = await upload<ItemView>(`/items/${v.item.id}/files?${q}`, p.blob, (x) => setProgress((i + x) / list.length));
      }
      if (last) set(last);
      if (v.item.mode === "count" && list[0].kind === "photo" && declared < files.length + list.length) setDeclared(files.length + list.length);
      flash("已上傳", `${list.length} 個檔案`);
    } catch (e) {
      flashError(e);
      await reload();
    } finally {
      setProgress(null);
    }
  };
  const pick = async (kind: Kind) => {
    if (room <= 0) return flash(`最多 ${LIMITS.entries} 個`, "請先刪掉一些再加", true);
    try {
      if (kind === "photo") return setPhotoMenu(true);
      if (kind === "video") return await sendPicked(await pickVideo());
      if (kind === "file") return await sendPicked(await pickFiles(room));
      setEntry(kind);
    } catch (e) {
      flashError(e);
    }
  };
  const footer = v.canEdit ? (
    <>
      <Btn label="返回" kind="cancel" onPress={() => router.back()} />
      <Btn
        label={my?.status === "returned" ? "修改後重新送出" : "送出作業"}
        busy={busy}
        disabled={!files.length || (needsConsent && !agree) || (v.item.mode === "count" && declared < 1)}
        onPress={async () => {
          setBusy(true);
          try {
            set(await api<ItemView>(`/items/${v.item.id}/submit`, "POST", { declared, note }));
            flash("已送出", "老師批改後會通知你");
          } catch (e) {
            flashError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  ) : my && (my.status === "submitted" || my.status === "leader_ok") && (!v.deadlinePassed || v.lateAllowed) ? (
    <Btn
      label="收回修改"
      kind="grey"
      onPress={async () => {
        try {
          set(await api<ItemView>(`/items/${v.item.id}/unsubmit`, "POST"));
          flash("已收回", "改好後再送出一次");
        } catch (e) {
          flashError(e);
        }
      }}
    />
  ) : undefined;
  return (
    <Screen title={v.item.name} footer={footer}>
      <Header v={v} />
      {my?.status === "graded" ? (
        <Note tone="ok">{`得分：${my.points} 分${v.item.inTotal ? "" : "（另計，不加入總分）"}${my.stars ? `・${"★".repeat(my.stars)}` : ""}\n${my.comment || "老師沒有留評語"}`}</Note>
      ) : null}
      {my?.status === "returned" ? <Note tone="bad">{`退回重交：${my.comment || my.leaderNote}`}</Note> : null}
      {my?.status === "leader_ok" ? <Note>{`組長已確認，等老師評分。${my.leaderNote ? `組長：${my.leaderNote}` : ""}`}</Note> : null}
      {my?.status === "submitted" ? <Note>已送出，等待批改。截止前可以按「收回修改」。</Note> : null}
      {v.item.mode === "onsite" ? <Note>這一項由老師在課堂現場登錄成績，不需要上傳。</Note> : null}

      {v.item.mode !== "onsite" && (
        <>
          <Section title={`我的繳交${files.length ? `（${files.length}/${LIMITS.entries}）` : ""}`} />
          <FileGrid
            files={files}
            onRemove={
              v.canEdit
                ? async (f) => {
                    try {
                      set(await api<ItemView>(`/files/${f.id}`, "DELETE"));
                    } catch (e) {
                      flashError(e);
                    }
                  }
                : undefined
            }
          />
          {progress !== null ? (
            <View style={{ gap: 4 }}>
              <Progress value={progress} />
              <T tiny muted>上傳中 {Math.round(progress * 100)}%，請不要關閉畫面</T>
            </View>
          ) : null}
          {v.canEdit ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(Object.keys(KINDS) as Kind[])
                  .filter((k) => v.item.kinds.includes(k))
                  .map((k) => (
                    <Btn key={k} small flex={false} kind="soft" icon="add" label={KINDS[k]} disabled={progress !== null} onPress={() => pick(k)} />
                  ))}
              </View>
              <T tiny muted>
                這一項收：{v.item.kinds.map((k) => KINDS[k]).join("、")}。照片 {LIMITS.photoMB}MB、檔案 {LIMITS.fileMB}MB 內；短影片 3 分鐘內。
              </T>
              {v.item.mode === "count" ? (
                <Card>
                  <Stepper label={`我完成的${v.item.unit}數`} hint={`預估 ${pointsFor(v.item, { approved: declared })} 分，老師核定後才算`} unit={v.item.unit} value={declared} onChange={setDeclared} />
                </Card>
              ) : null}
              <Field value={note} onChangeText={setNote} placeholder="給老師的說明（選填）" multiline />
              {needsConsent ? <Check value={agree} onChange={setAgree} label="照片或影片裡如果有其他人，我已取得對方同意或已遮住臉與個資。" /> : null}
            </>
          ) : null}
        </>
      )}

      {v.peers.length ? (
        <>
          <Section title={`同組已送出（${v.peers.length}）`} />
          <Card>
            {v.peers.map((p) => (
              <Btn key={p.submissionId} kind="grey" flex={false} label={`${p.name}・${p.files} 個`} onPress={() => router.push(`/sub/${p.submissionId}`)} />
            ))}
          </Card>
        </>
      ) : null}
      {v.isLeader && v.roster ? <Roster v={v} /> : null}
      {my && my.status !== "draft" ? <Comments submissionId={my.id} comments={my.comments} onChange={reload} /> : null}

      <EntrySheet kind={entry} onClose={() => setEntry(null)} itemId={v.item.id} onDone={(d) => { set(d); setEntry(null); }} />
      <Sheet open={photoMenu} onClose={() => setPhotoMenu(false)} title="加照片" footer={<Btn label="取消" kind="cancel" onPress={() => setPhotoMenu(false)} />}>
        <Btn kind="grey" flex={false} icon="images-outline" label="從相簿選（可多選）" onPress={async () => { setPhotoMenu(false); try { await sendPicked(await pickPhotos(room)); } catch (e) { flashError(e); } }} />
        <Btn kind="grey" flex={false} icon="camera-outline" label="拍照" onPress={async () => { setPhotoMenu(false); try { await sendPicked(await takePhoto()); } catch (e) { flashError(e); } }} />
      </Sheet>
    </Screen>
  );
}

function EntrySheet({ kind, onClose, itemId, onDone }: { kind: "link" | "text" | null; onClose: () => void; itemId: string; onDone: (v: ItemView) => void }) {
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setA(""), [kind]);
  return (
    <Sheet
      open={!!kind}
      onClose={onClose}
      title={kind === "link" ? "貼上連結" : "寫文字心得"}
      footer={
        <>
          <Btn label="取消" kind="cancel" onPress={onClose} />
          <Btn
            label="加入"
            busy={busy}
            disabled={!a.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                onDone(await api<ItemView>(`/items/${itemId}/entries`, "POST", kind === "link" ? { kind, url: a } : { kind, body: a }));
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
      {kind === "link" ? (
        <Field value={a} onChangeText={setA} placeholder="例如 YouTube 不公開影片的網址" autoCapitalize="none" keyboardType="url" />
      ) : (
        <Field value={a} onChangeText={setA} placeholder="寫下你的心得" multiline style={{ minHeight: 160 }} maxLength={LIMITS.textChars} />
      )}
    </Sheet>
  );
}

function Roster({ v, onsite }: { v: ItemView; onsite?: (m: { memberId: string; name: string }) => void }) {
  const [f, setF] = useState<"all" | "wait" | "done" | "none">("all");
  const list = (v.roster ?? []).filter((r) => f === "all" || (f === "wait" && (r.status === "submitted" || r.status === "leader_ok")) || (f === "done" && r.status === "graded") || (f === "none" && (r.status === "none" || r.status === "draft")));
  return (
    <>
      <Section title={v.role === "student" ? "本組繳交狀況" : "繳交狀況"} />
      <Seg items={[["all", "全部"], ["wait", "待批改"], ["done", "已批改"], ["none", "未繳"]]} value={f} onChange={setF} />
      <Card style={{ gap: 0 }}>
        {list.length ? (
          list.map((r) => (
            <View key={r.memberId} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56 }}>
              <Avatar name={r.name} />
              <View style={{ flex: 1 }}>
                <T bold>{r.name}</T>
                <T tiny muted>{r.groupName ?? "尚未分組"}</T>
              </View>
              {onsite ? (
                <Btn small flex={false} kind={r.status === "graded" ? "grey" : "main"} label={r.status === "graded" ? `${r.points} 分` : "登錄"} onPress={() => onsite(r)} />
              ) : r.submissionId && r.status !== "draft" ? (
                <Btn small flex={false} kind="grey" label={r.status === "graded" ? `${r.points} 分` : "查看"} onPress={() => router.push(`/sub/${r.submissionId}`)} />
              ) : (
                <StatusChip status={r.status} late={r.late} />
              )}
            </View>
          ))
        ) : (
          <T small muted>沒有符合的學員</T>
        )}
      </Card>
    </>
  );
}

function TeacherItem({ v, reload }: { v: ItemView; reload: () => Promise<void> }) {
  const [who, setWho] = useState<{ memberId: string; name: string } | null>(null);
  const [score, setScore] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Screen
      title={v.item.name}
      footer={
        <>
          <Btn
            label="提醒沒交的人"
            kind="grey"
            onPress={async () => {
              try {
                const r = await api<{ reminded: number }>(`/lessons/${v.lesson.id}/remind`, "POST");
                flash("已提醒", `${r.reminded} 位學員會收到通知`);
              } catch (e) {
                flashError(e);
              }
            }}
          />
          {v.item.mode !== "onsite" ? <Btn label="開始批改" onPress={() => router.push(`/review/${v.activityId}`)} /> : null}
        </>
      }
    >
      <Header v={v} />
      {v.item.mode === "onsite" ? <Note>這一項由老師現場登錄：點學員右邊的「登錄」輸入分數。</Note> : null}
      <Roster v={v} onsite={v.item.mode === "onsite" ? (m) => { setWho(m); setScore(""); } : undefined} />
      <Sheet
        open={!!who}
        onClose={() => setWho(null)}
        title={`登錄 ${who?.name ?? ""} 的成績`}
        footer={
          <>
            <Btn label="取消" kind="cancel" onPress={() => setWho(null)} />
            <Btn
              label="儲存"
              busy={busy}
              disabled={score === ""}
              onPress={async () => {
                setBusy(true);
                try {
                  await api(`/items/${v.item.id}/onsite`, "POST", { memberId: who!.memberId, score: Number(score) });
                  flash("已登錄", `${who!.name} ${score} 分`);
                  setWho(null);
                  await reload();
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
        <Field value={score} onChangeText={(t) => setScore(t.replace(/[^\d.]/g, ""))} keyboardType="numeric" placeholder={`0～${v.item.fullScore ?? 100}`} />
      </Sheet>
    </Screen>
  );
}
