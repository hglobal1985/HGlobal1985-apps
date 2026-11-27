import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { forgetUploadSettings, type UploadSettingsView } from "@/features/upload-settings";
import { UploadSettingsFields } from "@/features/uploads/upload-settings-fields";
import { useUnsavedPrompt } from "@/lib/settings-page";
import { flashText } from "@/ui/flash-notice";
import { NoticeBox } from "@/ui/notice-box";
import { SettingsFooter } from "@/ui/settings-footer";
import { LoadingView } from "@/ui/state-views";
import { useData } from "@/state/session";
import { Screen } from "@/kit";
import type { SharedUploadSettings } from "../../../../packages/server-shared/src/upload-settings";

/** 上傳設定（超級管理員）：照片、影片的壓縮畫質，與行動大學「儲存空間管理 › 上傳設定」是同一份，任一邊改另一邊自動跟上。 */
export default function UploadSettingsPage() {
  const { data } = useData<UploadSettingsView>("/upload-settings");
  const [v, setV] = useState<SharedUploadSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data && !v) setV(data.settings);
  }, [data, v]);
  const dirty = !!data && !!v && JSON.stringify(v) !== JSON.stringify(data.settings);
  const save = async () => {
    if (!v) return false;
    setSaving(true);
    try {
      const r = await api<{ settings: SharedUploadSettings }>("PUT", "/upload-settings", v);
      if (data) data.settings = r.settings;
      setV(r.settings);
      forgetUploadSettings();
      flashText("已儲存，行動大學也會一起套用");
      return true;
    } catch (e) {
      flashText((e as Error).message || "儲存失敗，請再試一次");
      return false;
    } finally {
      setSaving(false);
    }
  };
  useUnsavedPrompt({ dirty, save, discard: () => data && setV(data.settings) });
  return (
    <Screen title="上傳設定" footer={data?.canEdit ? <SettingsFooter dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={() => data && setV(data.settings)} /> : undefined}>
      {!data || !v ? (
        <LoadingView />
      ) : (
        <>
          <NoticeBox tone="info" text="這裡的設定和寰宇行動大學是同一份：在任何一邊修改，另一邊約 1 分鐘內自動跟上。作業短影片的長度（3 分鐘）與大小（80MB）上限不在這裡。" />
          {!data.canEdit ? <NoticeBox tone="warning" text="只有超級管理員可以修改。" /> : null}
          <UploadSettingsFields value={v} onChange={setV} />
        </>
      )}
    </Screen>
  );
}
