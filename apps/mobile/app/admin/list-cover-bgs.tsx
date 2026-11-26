import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { api, resolveUrl } from "@/api/client";
import { PickImageButton } from "@/features/admin/pick-image";
import { confirmAsk } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { ListCover } from "@/features/my-lists/list-cover";
import { useApi, useSession } from "@/state/session";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Field, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Bg = { id: string; name: string; url: string; used: number };
const SAMPLE = "清單名稱預覽範例";

/**
 * 設定 › 清單封面底圖（杜杜龍 2026-11-22，超級管理員）：上傳「清單專用」的封面底圖。
 * 會員把清單封面設成「文字封面」時，可以從這裡的底圖挑一張，清單名稱會自動放到最大、加描邊與光暈疊在上面。
 * 每張底圖下面都有文字封面的實際預覽，方便確認複雜的圖上字看不看得清楚。
 */
export default function ListCoverBgsScreen() {
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<Bg[]>(isSuper ? "/admin/list-cover-bgs" : null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [edit, setEdit] = useState<Bg | null>(null);
  const [name, setName] = useState("");
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;
  /** 一次上傳多張：依序上傳，名稱取自檔名；回報成功與失敗張數。 */
  const upload = async (files: File[]) => {
    setBusy(true);
    let ok = 0;
    let lastError = "";
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? `上傳中 ${i + 1} / ${files.length}` : "上傳中");
        try {
          const base = files[i]!.name.replace(/\.[^.]+$/, "").slice(0, 30) || "未命名底圖";
          await api("POST", `/admin/list-cover-bgs?name=${encodeURIComponent(base)}`, files[i]!);
          ok++;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "上傳失敗";
        }
      }
      if (ok) list.reload();
      flashText(ok === files.length ? `已上傳 ${ok} 張底圖` : ok ? `已上傳 ${ok} 張，${files.length - ok} 張失敗：${lastError}` : lastError || "上傳失敗");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const rename = async () => {
    if (!edit || !name.trim()) return;
    try {
      await api("PATCH", `/admin/list-cover-bgs/${edit.id}`, { name: name.trim() });
      flashText("已儲存名稱");
      setEdit(null);
      list.reload();
    } catch (e) {
      flashText(e instanceof Error ? e.message : "儲存失敗");
    }
  };
  const remove = async (b: Bg) => {
    const warn = b.used ? `目前有 ${b.used} 份清單的文字封面正在用它，刪除後那些清單會改回純色底。` : "刪除後無法復原。";
    if (!(await confirmAsk("刪除底圖", `確定刪除「${b.name}」？${warn}`, "刪除"))) return;
    try {
      await api("DELETE", `/admin/list-cover-bgs/${b.id}`);
      flashText("已刪除底圖");
      setEdit(null);
      list.reload();
    } catch (e) {
      flashText(e instanceof Error ? e.message : "刪除失敗");
    }
  };
  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        上傳「清單專用」的封面底圖。會員把清單封面設成「文字封面」時，可以從這裡挑底圖，清單名稱會自動放到最大並加上描邊與光暈。建議上傳橫式圖片（約 16:9），JPG、PNG、WebP，8MB 內，會自動壓縮。
      </AppText>
      <PickImageButton label={busy && progress ? progress : "上傳底圖（可一次選多張）"} onPickMany={(fs) => void upload(fs)} busy={busy} variant="primary" />
      {list.data.length === 0 ? <EmptyState icon="images-outline" title="還沒有底圖" body="按上方「上傳底圖」新增第一張。" /> : null}
      {list.data.map((b) => (
        <Card key={b.id} style={{ gap: space.sm }}>
          <ListCover mode="text" imageUrl={null} bgUrl={b.url} title={SAMPLE} height={150} />
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="headline" numberOfLines={1}>
                {b.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {b.used ? `${b.used} 份清單使用中` : "還沒有清單使用"}
              </AppText>
            </View>
            <Button variant="secondary" label="修改" onPress={() => { setEdit(b); setName(b.name); }} />
          </View>
        </Card>
      ))}
      {edit ? (
        <EditSheet title="底圖設定" onClose={() => setEdit(null)} onSave={rename} dirty={name.trim() !== edit.name}>
          <View style={styles.thumb}>
            <Image source={{ uri: resolveUrl(edit.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
          </View>
          <Field label="底圖名稱（會員選底圖時看不到，只給你辨識）" value={name} onChange={setName} />
          <Button variant="cancel" label="刪除這張底圖" icon="trash-outline" onPress={() => void remove(edit)} fullWidth />
        </EditSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, overflow: "hidden" },
});
