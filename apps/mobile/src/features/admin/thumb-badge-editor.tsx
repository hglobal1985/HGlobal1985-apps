import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, THUMB_BADGE_COLORS, type ThumbBadgeKind } from "@/api/client";
import { reloadThumbBadges, useThumbBadge } from "@/lib/thumb-badges";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Field, FormBlock, ThumbBadgeView } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT = { symbol: "", fg: "#FFFFFF", bg: "#0C603C" };

/** 色票一排：點一下選色；選中的加粗外框。 */
function Swatches({ value, onPick, label }: { value: string; onPick: (hex: string) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="callout" tone="muted">
        {label}
      </AppText>
      <View style={styles.swatches}>
        {THUMB_BADGE_COLORS.map((hex) => {
          const on = value.toUpperCase() === hex;
          return <Pressable key={hex} accessibilityRole="button" accessibilityLabel={`${label} ${hex}`} accessibilityState={{ selected: on }} onPress={() => onPick(hex)} style={[styles.swatch, { backgroundColor: hex, borderColor: on ? c.accent : c.border, borderWidth: on ? 3 : 1 }]} />;
        })}
      </View>
    </View>
  );
}

/**
 * 縮圖符號編輯（杜杜龍 2026-11-23）：每張系列卡、課程卡、中心卡可以指定小縮圖的符號（emoji 或最多 4 個字）、文字色與底色，
 * 上方有即時預覽（清單列大小與方形各一個）。放在三個編輯封面的地方，以及「設定 › 縮圖符號」總覽；全站小縮圖都用它，不再用標題文字。
 * kind／id：課程＝課程編號、系列＝系列名稱、中心＝中心名稱。
 */
export function ThumbBadgeEditor({ kind, id, label, onChanged, bare }: { kind: ThumbBadgeKind; id: string; label: string; onChanged?: () => void; /** 不包 FormBlock（設定頁總覽的面板裡用）。 */ bare?: boolean }) {
  const { c } = useTheme();
  const current = useThumbBadge(kind, id);
  const [symbol, setSymbol] = useState(current?.symbol ?? DEFAULT.symbol);
  const [fg, setFg] = useState(current?.fg ?? DEFAULT.fg);
  const [bg, setBg] = useState(current?.bg ?? DEFAULT.bg);
  const [busy, setBusy] = useState(false);
  // 資料晚到（第一次打開時還在讀取）：沒動過就跟著更新。
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !current) return;
    setSymbol(current.symbol);
    setFg(current.fg);
    setBg(current.bg);
  }, [current, touched]);
  const edit = <T,>(set: (v: T) => void) => (v: T) => (setTouched(true), set(v));
  const chars = [...symbol.trim()];
  const valid = chars.length >= 1 && chars.length <= 4 && HEX.test(fg) && HEX.test(bg);
  const dirty = !current ? chars.length > 0 : current.symbol !== symbol.trim() || current.fg.toUpperCase() !== fg.toUpperCase() || current.bg.toUpperCase() !== bg.toUpperCase();
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api("PUT", "/admin/thumb-badges", { kind, key: id, symbol: symbol.trim(), fg, bg });
      await reloadThumbBadges();
      setTouched(false);
      flashText("已儲存縮圖符號");
      onChanged?.();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("DELETE", `/admin/thumb-badges?kind=${kind}&key=${encodeURIComponent(id)}`);
      await reloadThumbBadges();
      setSymbol(DEFAULT.symbol);
      setFg(DEFAULT.fg);
      setBg(DEFAULT.bg);
      setTouched(false);
      flashText("已恢復預設縮圖");
      onChanged?.();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shownSymbol = symbol.trim();
  const body = (
    <View style={{ gap: space.md }}>
      <View style={styles.previewRow} accessibilityLabel="縮圖即時預覽">
        <View style={[styles.rect, { borderColor: c.border }]}>{shownSymbol ? <ThumbBadgeView symbol={shownSymbol} fg={HEX.test(fg) ? fg : DEFAULT.fg} bg={HEX.test(bg) ? bg : DEFAULT.bg} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft }]} />}</View>
        <View style={[styles.square, { borderColor: c.border }]}>{shownSymbol ? <ThumbBadgeView symbol={shownSymbol} fg={HEX.test(fg) ? fg : DEFAULT.fg} bg={HEX.test(bg) ? bg : DEFAULT.bg} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.accentSoft }]} />}</View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={2}>
            {label}
          </AppText>
          <AppText variant="caption" tone="muted">
            {shownSymbol ? "即時預覽（清單列與方形）" : "還沒指定符號：目前顯示預設縮圖"}
          </AppText>
        </View>
      </View>
      <Field label="符號（emoji 或最多 4 個字）" value={symbol} onChange={edit(setSymbol)} placeholder="例如 🌱 或 人才" hint={chars.length > 4 ? "最多 4 個字，請刪減" : undefined} />
      <Swatches label="文字顏色" value={fg} onPick={edit(setFg)} />
      <Field label="文字色碼（#RRGGBB）" value={fg} onChange={edit(setFg)} placeholder="#FFFFFF" hint={HEX.test(fg) ? undefined : "色碼格式要像 #FFFFFF"} />
      <Swatches label="底色" value={bg} onPick={edit(setBg)} />
      <Field label="底色色碼（#RRGGBB）" value={bg} onChange={edit(setBg)} placeholder="#0C603C" hint={HEX.test(bg) ? undefined : "色碼格式要像 #0C603C"} />
      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <Button variant="cancel" label="恢復預設" fullWidth disabled={busy || !current} onPress={clear} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={dirty ? "儲存" : "已儲存"} fullWidth disabled={busy || !valid || !dirty} onPress={save} />
        </View>
      </View>
    </View>
  );
  return bare ? body : <FormBlock title="縮圖符號" hint="清單列、選單裡的小縮圖。可以輸入 emoji 或短文字，並選文字色與底色；沒指定時顯示預設圖示。">{body}</FormBlock>;
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  rect: { width: 96, height: 54, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1 },
  square: { width: 54, height: 54, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: minTouch - 4, height: minTouch - 4, borderRadius: 999 },
  buttons: { flexDirection: "row", gap: space.sm },
});
