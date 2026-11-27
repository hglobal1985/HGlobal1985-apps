import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { thisYm, useCenterSchedules, ymLabel } from "@/features/courses/center-schedule";
import { useUiConfig } from "@/state/ui-config";
import { space } from "@/theme/tokens";
import { AppText, Button, NoticeBox, Select } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { PickImageButton } from "./pick-image";

/**
 * 中心頁「編輯」裡的課表管理（杜杜龍 2026-11-21）：選年月、選圖片就上傳（同一個月重傳＝更換），可刪除。每個動作按下就儲存；
 * 新月份上架時，訂閱這個中心的人會收到通知。圖片在瀏覽器先壓縮（用「EDM 海報」那組畫質設定，課表小字才清楚）。
 */
export function CenterScheduleEditor({ center, onChanged }: { center: string; onChanged: () => void }) {
  const list = useCenterSchedules(center);
  const { config } = useUiConfig();
  const now = thisYm();
  const next = (() => {
    const d = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5)), 1)); // 預設下個月
    return d.toISOString().slice(0, 7);
  })();
  const [year, setYear] = useState(next.slice(0, 4));
  const [month, setMonth] = useState(next.slice(5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  const ym = `${year}-${month}`;
  const exists = items.some((x) => x.ym === ym);
  const y0 = Number(now.slice(0, 4));
  const years = [y0 - 2, y0 - 1, y0, y0 + 1].map((y) => ({ key: String(y), label: `${y} 年` }));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return { key: m, label: `${i + 1} 月`, hint: items.some((x) => x.ym === `${year}-${m}`) ? "已上傳" : undefined };
  });
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      list.reload();
      onChanged();
      flashText(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = (file: File) =>
    run(async () => {
      const img = await loadImage(file);
      const blob = await cropCompress(img, null, config.app.edmMaxSide, config.app.edmQuality / 100);
      await api("PUT", `/admin/center-schedules?center=${encodeURIComponent(center)}&ym=${ym}`, blob);
    }, exists ? `已更換${ymLabel(ym)}課表` : `已上傳${ymLabel(ym)}課表`);
  const remove = async (target: string) => {
    if (!(await confirmAsk("刪除課表", `確定刪除${ymLabel(target)}的課表？`, "刪除"))) return;
    await run(() => api("DELETE", `/admin/center-schedules?center=${encodeURIComponent(center)}&ym=${target}`), "已刪除課表");
  };
  return (
    <View style={styles.wrap} accessibilityLabel="課表管理">
      <AppText variant="title">課表管理</AppText>
      <AppText variant="caption" tone="muted">
        每個月一張圖片，顯示在中心頁的「本月課表」。新月份上傳時，訂閱這個中心的人會收到通知。
      </AppText>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Select label="年" value={year} options={years} onChange={setYear} />
        </View>
        <View style={{ flex: 1 }}>
          <Select label="月" value={month} options={months} onChange={setMonth} />
        </View>
      </View>
      <PickImageButton label={exists ? `更換${ymLabel(ym)}課表圖片` : `選擇${ymLabel(ym)}課表圖片`} onPick={upload} busy={busy} variant="primary" />
      {items.length ? (
        <View style={{ gap: 2 }}>
          <AppText variant="callout" tone="muted" style={{ fontWeight: "700" }}>
            已上傳的課表
          </AppText>
          {items.map((x) => (
            <View key={x.ym} style={styles.item}>
              <AppText variant="body" style={{ flex: 1, fontWeight: "700" }}>
                {ymLabel(x.ym)}
              </AppText>
              <Button label="刪除" variant="danger" onPress={() => remove(x.ym)} disabled={busy} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  item: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4 },
});
