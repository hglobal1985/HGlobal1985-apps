import { useState } from "react";
import { flashText } from "@/ui/flash-notice";
import { useUnsavedPrompt } from "@/lib/settings-page";
import { Screen, Section, SettingsFooter } from "@/ui";
import { SynonymsEditor, useSynonymsDraft } from "@/features/search/synonyms-editor";

/** 設定 › 搜尋關聯詞（杜杜龍 2026-11-25）：編輯器已搬到共用元件，同時放在「搜尋與 AI 設定」頁；這個網址保留給舊連結。整頁一個「儲存」（杜杜龍 2026-11-26）。 */
export default function SynonymsScreen() {
  const draft = useSynonymsDraft();
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await draft.save();
      flashText("已儲存");
      return true;
    } catch (e) {
      flashText((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  useUnsavedPrompt({ dirty: draft.dirty, save, discard: draft.discard });
  return (
    <Screen header={false} footer={<SettingsFooter dirty={draft.dirty} saving={saving} onSave={() => void save()} onDiscard={draft.discard} />}>
      <Section fold title="搜尋關聯詞">
        <SynonymsEditor draft={draft} />
      </Section>
    </Screen>
  );
}
