import { useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { api, resolveUrl } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { radius, space } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { showToast } from "@/ui/toast";
import { EDM_MAX_SIDE, cropCompress, loadImage } from "./image-tools";

const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

/**
 * 中心 EDM（網頁版）：整張海報上傳（瀏覽器內壓縮，不保留原檔），在「全部課程」選了這個中心時顯示，
 * 與課程頁的 EDM 一樣可以上下拖曳、點一下放大。
 */
export function CenterEdm({ center, edmUrl, onChanged }: { center: string; edmUrl?: string | null; onChanged: () => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const q = `?center=${encodeURIComponent(center)}`;
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg("上傳中…");
    try {
      const img = await loadImage(file);
      await api("PUT", `/admin/center-art${q}`, await cropCompress(img, null, EDM_MAX_SIDE, 0.9));
      setMsg(null);
      showToast("已更新中心 EDM");
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: "移除中心 EDM", message: `移除後，全部課程選「${center}」時就不顯示 EDM。`, confirmLabel: "移除", cancelLabel: "先不要", danger: true }))) return;
    setBusy(true);
    try {
      await api("DELETE", `/admin/center-art${q}`);
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.wrap}>
      {edmUrl ? <Image source={{ uri: resolveUrl(edmUrl) }} style={styles.thumb} resizeMode="cover" accessibilityLabel={`${center} EDM`} /> : null}
      <AppText variant="caption" tone="muted">
        可選 JPG、PNG、WebP、HEIC，上傳時自動壓縮。
      </AppText>
      <View style={styles.buttons}>
        <Button label={edmUrl ? "更換 EDM" : "上傳 EDM"} icon="image-outline" loading={busy} disabled={busy} onPress={() => input.current?.click()} />
        {edmUrl ? <Button variant="ghost" label="移除 EDM" disabled={busy} onPress={remove} /> : null}
      </View>
      {msg ? <AppText variant="caption">{msg}</AppText> : null}
      <input ref={input} type="file" accept={FILE_ACCEPT} onChange={pick} style={{ display: "none" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, alignItems: "flex-start" },
  thumb: { width: 120, height: 170, borderRadius: radius.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
