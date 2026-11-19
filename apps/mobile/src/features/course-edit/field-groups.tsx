import { Chips, Field, FormBlock, NoticeBox } from "@/ui";
import { useSession } from "@/state/session";
import type { CourseSummary } from "@/api/client";
import { HQ_UNIT } from "@/api/client";
import { useApi } from "@/state/session";
import { MultiChips } from "./course-sections"; // 函式只在畫面繪製時呼叫，互相引用沒問題
import { AppText } from "@/ui";

/**
 * 編輯面板共用的欄位組（業主 2026-11-18：同類的編輯功能一律用共用模板，不各自重畫）。
 * 課程基本資料、新增課程／清單、區塊編輯，凡是要選「品牌」「分類」都用這裡的元件；要改版面只改這個檔案。
 */

/** 品牌（單選）：標題列＋直接列出所有品牌，沒有展開／收起。 */
export function BrandField({ value, onChange, collapsible }: { value: string; onChange: (id: string) => void; collapsible?: boolean }) {
  const brands = useApi<{ id: string; name: string }[]>("/brands");
  if (!brands.data?.length) return null;
  return (
    <FormBlock collapsible={collapsible} title="品牌" hint="單選；沒上傳封面時，用品牌 logo 當封面">
      <Chips label="品牌" options={[{ key: "", label: "無" }, ...brands.data.map((b) => ({ key: b.id, label: b.name }))]} value={value} onChange={onChange} />
    </FormBlock>
  );
}

/** 分類（可複選，值是用「、」分隔的字串）：標題列＋已有分類的點選清單；withInput＝多一個可自己輸入新分類的欄位。 */
export function CategoryField({ value, onChange, withInput = false, collapsible }: { value: string; onChange: (v: string) => void; withInput?: boolean; collapsible?: boolean }) {
  const categories = useApi<string[]>("/admin/categories");
  return (
    <FormBlock collapsible={collapsible} title="分類" hint={withInput ? "可複選；點選加入或取消，也可以自己輸入（多個用「、」分開）" : "可複選"}>
      {withInput ? <Field label="" value={value} onChange={onChange} placeholder="例如：達標班、會議" /> : null}
      {categories.data?.length ? <MultiChips options={categories.data} value={value} onChange={onChange} /> : <AppText tone="muted">目前沒有分類</AppText>}
    </FormBlock>
  );
}

/** 每個主辦單位（含總部）已有幾門課（用「、」分隔的主辦單位欄位）。 */
export function hostCountsOf(list: { hostUnit: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) for (const h of x.hostUnit.split(/[、,，]+/).map((v) => v.trim()).filter(Boolean)) out[h] = (out[h] ?? 0) + 1;
  return out;
}

/**
 * 主辦單位／建立單位（可複選，值是用「、」分隔的字串）：新增課程／清單與「進階設定」共用，不再有展開／收起（業主 2026-11-18）。
 * 只有總部管理員能選；中心的會長、音控、小編固定是自己的中心。含某個中心＝中心課程（出現在該中心頁）；只有寰宇總部＝一般課程。
 */
export function HostField({ title, value, fixed, onChange }: { title: string; value: string; fixed: string; onChange: (v: string) => void }) {
  const { member } = useSession();
  const isHq = member?.role === "admin";
  const centers = useApi<string[]>(isHq ? "/centers" : null);
  const all = useApi<CourseSummary[]>(isHq ? "/admin/courses" : null);
  if (!isHq) return <NoticeBox text={`${title}固定為「${fixed}」，由系統帶入。`} />;
  const counts = hostCountsOf(all.data ?? []);
  return (
    <FormBlock title={title} hint="可複選；含某個中心＝中心課程，只出現在該中心頁；只有寰宇總部＝一般課程。管理權限與「中心」篩選以第一個中心為準。">
      <MultiChips options={[HQ_UNIT, ...(centers.data ?? [])]} value={value} counts={counts} onChange={onChange} />
    </FormBlock>
  );
}
