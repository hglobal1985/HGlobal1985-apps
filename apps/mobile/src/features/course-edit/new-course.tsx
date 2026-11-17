import { router } from "expo-router";
import { useState } from "react";
import { api, HQ_UNIT, type CourseDetail, type CourseSummary } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { AppText, Chips, NoticeBox } from "@/ui";
import { centerTitle } from "@/features/format";
import { isSuperAdmin } from "@/lib/roles";
import { BasicsFields, countByHost, type BasicsForm } from "./course-sections";
import { EditSheet } from "./edit-sheet";

/**
 * 「＋新增課程」：只填名稱、主講人姓名（必填）、主辦中心、系列（可不選），建立成未上架的草稿後，
 * 直接進入該課程介紹頁的編輯模式，其餘欄位在頁面上一區一區補（手機不用一口氣填完一大張表）。
 * 總部可以選主辦中心；中心的會長、音控、小編固定是自己的中心。
 */
export function NewCourseSheet({ onClose, defaultCenter, list = false }: { onClose: () => void; defaultCenter?: string; /** 新增「素材清單」：只有名稱、主辦、系列，沒有主講人。 */ list?: boolean }) {
  const { member, invalidate } = useSession();
  const isHq = member?.role === "admin";
  const isSuper = isSuperAdmin(member);
  const centers = useApi<string[]>(isHq ? "/centers" : null);
  const allCourses = useApi<CourseSummary[]>(isHq ? "/admin/courses" : null);
  const hostCounts = countByHost(allCourses.data ?? []);
  const [f, setF] = useState<BasicsForm>({ isShorts: false, title: "", teacher: "", teacherRank: "", teacherTitle: "", eventStart: "", eventEnd: "", category: "", series: "", theme: "sage" });
  const [host, setHost] = useState(isHq ? (defaultCenter ?? HQ_UNIT) : (member?.courseRights?.center ?? member?.center ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!f.title.trim()) return setError(list ? "請輸入素材清單名稱" : "請輸入課程名稱");
    if (!list && !f.teacher.trim()) return setError("請輸入主講人姓名（課程專屬網址要用）");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = list
        ? { isList: true, title: f.title.trim(), category: f.category, ...(isSuper ? { series: f.series.trim() } : {}) }
        : { ...f, title: f.title.trim(), teacher: f.teacher.trim(), teacherTitle: f.teacherTitle.trim(), eventStart: f.eventStart || null, eventEnd: f.eventStart ? f.eventEnd || null : null, ...(isSuper ? { series: f.series.trim() } : { series: undefined }) };
      if (isHq) Object.assign(body, { hostUnit: host }); // 指導單位預設不勾（不建議勾選），建好後要的話到進階設定勾
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
    <EditSheet title={list ? "新增清單（影片／檔案）" : "新增課程"} onClose={onClose} onSave={submit} saveLabel="建立" dirty={!!f.title.trim() || !!f.teacher.trim()} busy={busy} error={error}>
      <BasicsFields isList={list} f={f} setF={setF} />
      <AppText variant="callout" tone="muted">
        {list ? "建立單位" : "主辦中心"}
      </AppText>
      {isHq ? (
        <Chips options={[HQ_UNIT, ...(centers.data ?? [])].map((x) => ({ key: x, label: `${x === HQ_UNIT ? x : centerTitle(x)}（${hostCounts[x] ?? 0}）` }))} value={host} onChange={setHost} />
      ) : (
        <NoticeBox text={`${list ? "建立單位" : "主辦中心"}固定為「${host}」。`} />
      )}
      <AppText variant="caption" tone="muted">
        {list ? "建立後是「未上架」，學員看不到；在清單頁用「新增教材」加入影片或檔案，再上架。清單一律完全公開、免費。" : "建立後是「未上架」，學員看不到；在課程頁補好資料再上架。"}
      </AppText>
    </EditSheet>
  );
}
