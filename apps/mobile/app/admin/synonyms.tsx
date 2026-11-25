import { Screen } from "@/ui";
import { SynonymsEditor } from "@/features/search/synonyms-editor";

/** 設定 › 搜尋關聯詞（業主 2026-11-25）：編輯器已搬到共用元件，同時放在「搜尋與 AI 設定」頁；這個網址保留給舊連結。 */
export default function SynonymsScreen() {
  return (
    <Screen header={false}>
      <SynonymsEditor />
    </Screen>
  );
}
