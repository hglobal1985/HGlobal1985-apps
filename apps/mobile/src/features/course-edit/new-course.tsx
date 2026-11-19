import { router } from "expo-router";
import { useState } from "react";
import { api, HQ_UNIT, type CourseDetail } from "@/api/client";
import { useSession } from "@/state/session";
import { AppText } from "@/ui";
import { isSuperAdmin } from "@/lib/roles";
import { BasicsFields, type BasicsForm } from "./course-sections";
import { HostField } from "./field-groups";
import { EditSheet } from "./edit-sheet";
import { KindToggle } from "./kind-toggle";

/**
 * 「＋新增課程」：只填名稱、主講人姓名（必填）、主辦中心、系列（可不選），建立成未上架的草稿後，
 * 直接進入該課程介紹頁的編輯模式，其餘欄位在頁面上一區一區補（手機不用一口氣填完一大張表）。
 * 總部可以選主辦中心；中心的會長、音控、小編固定是自己的中心。
 */
export function NewCourseSheet({ onClose, defaultCenter, defaultSeries, list: listProp = false }: { onClose: () => void; defaultCenter?: string; /** 從系列頁新增：系列預先填好（業主 2026-11-18）。 */ defaultSeries?: string; /** 新增「清單卡」：只有名稱、主辦、系列，沒有主講人。 */ list?: boolean }) {
  const { member, invalidate } = useSession();
  const [list, setList] = useState(listProp); // 右上「素材／課程」切換（業主 2026-11-18）：新增畫面可自由切換，整個面板的欄位跟著變
  const isHq = member?.role === "admin";
  const isSuper = isSuperAdmin(member);
  const [f, setF] = useState<BasicsForm>({ isShorts: false, title: "", noSpeaker: false, teacher: "", teacherRank: "", teacherTitle: "", eventStart: "", eventEnd: "", category: "", series: defaultSeries ?? "", brandId: "", zone: listProp ? "amway_material" : "hglobal" });
  const pickKind = (toList: boolean) => {
    setList(toList);
    // 專區還是預設值就跟著類型換（課程→寰宇、素材→安麗素材）；自己改過的不動。
    setF((x) => (x.zone === (toList ? "hglobal" : "amway_material") ? { ...x, zone: toList ? "amway_material" : "hglobal" } : x));
  };
  const [host, setHost] = useState(isHq ? (defaultCenter ?? HQ_UNIT) : (member?.courseRights?.center ?? member?.center ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!f.title.trim()) return setError(list ? "請輸入清單卡名稱" : "請輸入課程名稱");
    if (!list && !f.noSpeaker && !f.teacher.trim()) return setError("請輸入主講人姓名（課程專屬網址要用），沒有主講人請勾選「無」");
    setBusy(true);
    setError(null);
    try {
      const { zone: _z, ...fRest } = f;
      const body: Record<string, unknown> = list
        ? { isList: true, title: f.title.trim(), category: f.category, brandId: f.brandId, ...(isSuper ? { series: f.series.trim(), zone: f.zone } : {}) }
        : { ...fRest, ...(isSuper ? { zone: f.zone } : {}), title: f.title.trim(), teacher: f.teacher.trim(), teacherTitle: f.teacherTitle.trim(), eventStart: f.eventStart || null, eventEnd: f.eventStart ? f.eventEnd || null : null, ...(isSuper ? { series: f.series.trim() } : { series: undefined }) };
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
    <EditSheet material={list} headRight={<KindToggle isList={list} onPick={pickKind} />} title={list ? "新增清單" : "新增課程"} onClose={onClose} onSave={submit} saveLabel="建立" dirty={!!f.title.trim() || !!f.teacher.trim()} busy={busy} error={error}>
      <BasicsFields isList={list} f={f} setF={setF} />
      <HostField title={list ? "建立單位" : "主辦中心"} value={host} fixed={host} onChange={setHost} />
      <AppText variant="caption" tone="muted">
        {list ? "建立後是「未上架」，學員看不到；在清單頁用「新增教材」加入影片或檔案，再上架。清單一律完全公開、免費。" : "建立後是「未上架」，學員看不到；在課程頁補好資料再上架。"}
      </AppText>
    </EditSheet>
  );
}
