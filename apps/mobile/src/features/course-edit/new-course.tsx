import { router } from "expo-router";
import { useState } from "react";
import { api, HQ_UNIT, type CourseDetail, type CourseSummary } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { AppText, Chips, Field, NoticeBox } from "@/ui";
import { Check, countByHost } from "./course-sections";
import { EditSheet } from "./edit-sheet";

/**
 * 「＋新增課程」：只填名稱、主辦中心、系列（可不選），建立成未上架的草稿後，
 * 直接進入該課程介紹頁的編輯模式，其餘欄位在頁面上一區一區補（手機不用一口氣填完一大張表）。
 * 總部可以選主辦中心；中心的會長、音控、小編固定是自己的中心。
 */
export function NewCourseSheet({ onClose, defaultCenter }: { onClose: () => void; defaultCenter?: string }) {
  const { member, invalidate } = useSession();
  const isHq = member?.role === "admin";
  const centers = useApi<string[]>(isHq ? "/centers" : null);
  const series = useApi<string[]>("/admin/series");
  const allCourses = useApi<CourseSummary[]>(isHq ? "/admin/courses" : null);
  const hostCounts = countByHost(allCourses.data ?? []);
  const [title, setTitle] = useState("");
  const [host, setHost] = useState(isHq ? (defaultCenter ?? HQ_UNIT) : (member?.courseRights?.center ?? member?.center ?? ""));
  const [seriesName, setSeriesName] = useState("");
  const [autoCover, setAutoCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return setError("請輸入課程名稱");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: title.trim(), series: seriesName.trim(), autoCover };
      if (isHq) Object.assign(body, { hostUnit: host, guidanceUnit: HQ_UNIT });
      const d = await api<CourseDetail>("POST", "/admin/courses", body);
      invalidate();
      onClose();
      router.push({ pathname: "/course/[id]", params: { id: d.id, edit: "1" } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="新增課程" onClose={onClose} onSave={submit} saveLabel="建立" dirty={!!title.trim()} busy={busy} error={error}>
      <Field label="課程名稱（必填）" value={title} onChange={setTitle} placeholder="例如：翡翠達標班" />
      <AppText variant="callout" tone="muted">
        主辦中心
      </AppText>
      {isHq ? (
        <Chips options={[HQ_UNIT, ...(centers.data ?? [])].map((x) => ({ key: x, label: `${x}（${hostCounts[x] ?? 0}）` }))} value={host} onChange={setHost} />
      ) : (
        <NoticeBox text={`主辦中心固定為「${host}」。`} />
      )}
      <Field label="系列（選填；同系列的課合併成一張卡）" value={seriesName} onChange={setSeriesName} placeholder="不填＝不合併" />
      {series.data?.length ? <Chips label="已有的系列" options={[{ key: "", label: "不合併" }, ...series.data.map((x) => ({ key: x, label: x }))]} value={seriesName} onChange={setSeriesName} /> : null}
      <Check label="自動抓取 YouTube 影片畫面當封面" value={autoCover} onChange={setAutoCover} />
      <AppText variant="caption" tone="muted">
        建立後是「未上架」，學員看不到；在課程頁補好資料再上架。
      </AppText>
    </EditSheet>
  );
}
