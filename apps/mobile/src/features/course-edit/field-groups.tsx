import { Chips, Field, FormBlock } from "@/ui";
import { useApi } from "@/state/session";
import { MultiChips } from "./course-sections"; // 函式只在畫面繪製時呼叫，互相引用沒問題
import { AppText } from "@/ui";

/**
 * 編輯面板共用的欄位組（業主 2026-11-18：同類的編輯功能一律用共用模板，不各自重畫）。
 * 課程基本資料、新增課程／清單、區塊編輯，凡是要選「品牌」「分類」都用這裡的元件；要改版面只改這個檔案。
 */

/** 品牌（單選）：標題列＋直接列出所有品牌，沒有展開／收起。 */
export function BrandField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const brands = useApi<{ id: string; name: string }[]>("/brands");
  if (!brands.data?.length) return null;
  return (
    <FormBlock title="品牌" hint="單選；沒上傳封面時，用品牌 logo 當封面">
      <Chips label="品牌" options={[{ key: "", label: "無" }, ...brands.data.map((b) => ({ key: b.id, label: b.name }))]} value={value} onChange={onChange} />
    </FormBlock>
  );
}

/** 分類（可複選，值是用「、」分隔的字串）：標題列＋已有分類的點選清單；withInput＝多一個可自己輸入新分類的欄位。 */
export function CategoryField({ value, onChange, withInput = false }: { value: string; onChange: (v: string) => void; withInput?: boolean }) {
  const categories = useApi<string[]>("/admin/categories");
  return (
    <FormBlock title="分類" hint={withInput ? "可複選；點選加入或取消，也可以自己輸入（多個用「、」分開）" : "可複選"}>
      {withInput ? <Field label="" value={value} onChange={onChange} placeholder="例如：達標班、會議" /> : null}
      {categories.data?.length ? <MultiChips options={categories.data} value={value} onChange={onChange} /> : <AppText tone="muted">目前沒有分類</AppText>}
    </FormBlock>
  );
}
