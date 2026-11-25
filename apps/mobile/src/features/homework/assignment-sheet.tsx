import { useState } from "react";
import { View } from "react-native";
import { api, HW_GRADINGS, HW_KINDS, type HwAssignment, type HwGrading, type HwKind } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { space } from "@/theme/tokens";
import { AppText, Button, Check, Field, SegmentTabs } from "@/ui";
import { DateSelect } from "@/ui/date-select";
import { flashText } from "@/ui/flash-notice";
import { dueIso, isoDay, openIso } from "./format";

/** 出新作業／修改作業（老師）：名稱、說明、學員可以交什麼、評分方式、開放與截止日期。 */
export function AssignmentSheet({ courseId, editing, onClose, onSaved, onDeleted }: { courseId: string; editing?: HwAssignment; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [kinds, setKinds] = useState<HwKind[]>(editing?.kinds ?? ["image", "video", "file", "link", "text"]);
  const [grading, setGrading] = useState<HwGrading>(editing?.grading ?? "score");
  const [maxScore, setMaxScore] = useState(String(editing?.maxScore ?? 100));
  const [opens, setOpens] = useState(isoDay(editing?.opensAt ?? null));
  const [due, setDue] = useState(isoDay(editing?.dueAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !editing || title !== editing.title || body !== editing.body || grading !== editing.grading || kinds.join() !== editing.kinds.join() || opens !== isoDay(editing.opensAt) || due !== isoDay(editing.dueAt) || maxScore !== String(editing.maxScore);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { title, body, kinds, grading, maxScore: Number(maxScore) || 100, opensAt: openIso(opens), dueAt: dueIso(due) };
      if (editing) {
        await api("PATCH", `/homework/a/${editing.id}`, payload);
        flashText("已儲存");
        onSaved(editing.id);
      } else {
        const r = await api<{ id: string }>("POST", `/homework/course/${courseId}/assignments`, payload);
        flashText("已發布，已通知學員");
        onSaved(r.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!editing || !(await confirmSheet({ title: "刪除這份作業", message: "學員交的檔案、分數和評語會一起刪除，無法復原。", confirmLabel: "刪除", danger: true }))) return;
    setBusy(true);
    try {
      await api("DELETE", `/homework/a/${editing.id}`);
      flashText("已刪除作業");
      onDeleted?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const toggle = (k: HwKind, on: boolean) => setKinds((ks) => (on ? HW_KINDS.map((x) => x.key).filter((x) => x === k || ks.includes(x)) : ks.filter((x) => x !== k)));
  return (
    <EditSheet title={editing ? "修改作業" : "出新作業"} onClose={onClose} onSave={save} saveLabel={editing ? "儲存" : "發布"} dirty={dirty} busy={busy} error={error}>
      <Field label="作業名稱" value={title} onChange={setTitle} placeholder="例如：作業一：個人形象照" />
      <Field label="說明（學員看得到）" value={body} onChange={setBody} placeholder="要交什麼、注意事項" multiline />
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" style={{ fontWeight: "700" }}>
          學員可以交什麼
        </AppText>
        {HW_KINDS.map((k) => (
          <Check key={k.key} label={k.key === "video" ? "短影片（3 分鐘內，自動壓縮）" : k.key === "file" ? "檔案（PDF、Word、簡報、Excel…）" : k.key === "link" ? "連結（例如 YouTube 不公開影片）" : k.key === "text" ? "文字心得" : k.label} value={kinds.includes(k.key)} onChange={(v) => toggle(k.key, v)} />
        ))}
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="callout" style={{ fontWeight: "700" }}>
          評分方式
        </AppText>
        <SegmentTabs options={HW_GRADINGS} value={grading} onChange={setGrading} />
        {grading === "score" ? <Field label="滿分" value={maxScore} onChange={setMaxScore} numeric /> : null}
        <AppText variant="caption" tone="muted">
          {grading === "pass" ? "批改時選「通過」或「退回重交」。" : grading === "stars" ? "批改時點 1～5 顆星。" : "批改時填分數。"}每種方式都可以「退回重交」並寫評語；只有老師能評分。
        </AppText>
      </View>
      <DateSelect label="開放繳交日（不設＝立刻開放）" value={opens} onChange={setOpens} />
      <DateSelect label="截止日（當天 23:59；過了仍可補交，會標「逾期」）" value={due} onChange={setDue} />
      {editing ? <Button variant="danger" label="刪除這份作業" icon="trash-outline" onPress={remove} disabled={busy} fullWidth /> : null}
    </EditSheet>
  );
}
