import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, resolveUrl, type BrandLogo } from "@/api/client";
import { logoColors } from "@/lib/logo-colors";
import { confirmAsk } from "@/features/confirm";
import { PickImageButton } from "@/features/admin/pick-image";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, BrandCover, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Screen, Slider } from "@/ui";
import { hexToHsl, hslToHex, type Hsl } from "@/lib/color-utils";
import { flashText } from "@/ui/flash-notice";

const SWATCHES = ["#FFFFFF", "#F6F5F0", "#111111", "#1F4D3A", "#B3261E", "#F0B323", "#1F3A6B", "#7A4B2A"];
/** 深色模式底色的常用選項（比 App 深色背景稍亮或同色，logo 才看得清楚）。 */
const DARK_SWATCHES = ["#000000", "#111111", "#1B1F1E", "#23302B", "#2A2A2E", "#1A2540", "#3A2A24", "#FFFFFF"];

/**
 * 設定 › 品牌 Logo（杜杜龍 2026-11-18，超級管理員）：上傳／更換 logo，每個 logo 可選底色或底圖（透明背景、長寬不合時用），
 * 並指定對應的分類標籤。課程與素材勾選「使用品牌 logo 作為封面」且分類對得到時，封面就用這個 logo（置中、四周留安全距離）。
 */
export default function BrandLogosScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<BrandLogo[]>(isSuper ? "/admin/brand-logos" : null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>("POST", "/admin/brand-logos", { name: "新品牌" });
      list.reload();
      setEditId(r.id);
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cur = list.data.find((x) => x.id === editId) ?? null;
  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        新增品牌並上傳 logo。教材卡、區塊在編輯時選「品牌」（和分類是分開的欄位）；沒有手動上傳封面時，封面就用這個品牌的 logo。
      </AppText>
      <Button label="新增品牌" icon="add-circle-outline" loading={busy} onPress={create} fullWidth />
      {list.data.map((b) => (
        <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`編輯 ${b.name}`} onPress={() => setEditId(b.id)}>
          <Card>
            {b.logoUrl ? <BrandCover brand={{ logoUrl: b.logoUrl, bgColor: b.bgColor, bgColorDark: b.bgColorDark, bgUrl: b.bgUrl }} style={{ borderRadius: radius.md }} /> : <View style={[styles.empty, { borderColor: c.border }]}><AppText tone="muted">還沒有上傳 logo</AppText></View>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: c.accentSoft }} accessibilityLabel={`品牌標籤 ${b.name}`}>
                <AppText variant="callout" style={{ color: c.accentText, fontWeight: "800" }}>
                  {b.name}
                </AppText>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
      {!list.data.length ? <EmptyState icon="images-outline" title="還沒有品牌 Logo" body="按上方「新增品牌」建立第一個。" /> : null}
      {cur ? <LogoSheet key={cur.id} logo={cur} onClose={() => setEditId(null)} onChanged={list.reload} /> : null}
    </Screen>
  );
}

type Tab = "light" | "dark" | "image";

/**
 * 顏色選擇（杜杜龍 2026-11-18）：先點常用色塊（或 logo 常用色）當基底，再用兩條滑桿微調——「變淡」（往右越淡）與「色彩飽和度」（往右越鮮豔）。
 * 沒有手動輸入色碼。淺色、深色底色共用同一個。
 */
function ColorPicker({ value, onChange, swatches, picks }: { value: string; onChange: (hex: string) => void; swatches: string[]; picks: string[] }) {
  const { c } = useTheme();
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(value));
  const set = (next: Hsl) => {
    setHsl(next);
    onChange(hslToHex(next));
  };
  const choose = (hex: string) => {
    const n = hexToHsl(hex);
    setHsl(n);
    onChange(hex.toUpperCase());
  };
  const row = (list: string[], label: string) => (
    <View style={styles.swatches}>
      {list.map((x) => (
        <Pressable key={x} accessibilityRole="button" accessibilityLabel={`${label} ${x}`} onPress={() => choose(x)} style={[styles.swatch, { backgroundColor: x, borderColor: value.toUpperCase() === x.toUpperCase() ? c.accent : c.border, borderWidth: value.toUpperCase() === x.toUpperCase() ? 3 : 1 }]} />
      ))}
    </View>
  );
  return (
    <View style={{ gap: space.xs }}>
      {row(swatches, "底色")}
      {picks.length ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="muted">
            logo 常用的顏色（點一下套用）
          </AppText>
          {row(picks, "logo 常用色")}
        </View>
      ) : null}
      <AppText variant="callout" style={{ fontWeight: "700" }}>
        變淡（往右越淡）
      </AppText>
      <Slider label="變淡，往右拉顏色變淡、往左變深" value={hsl.l / 100} onChange={(v) => set({ ...hsl, l: v * 100 })} />
      <AppText variant="callout" style={{ fontWeight: "700" }}>
        色彩飽和度（往右越鮮豔）
      </AppText>
      <Slider label="色彩飽和度，往右拉顏色更鮮豔、往左變灰" value={hsl.s / 100} onChange={(v) => set({ ...hsl, s: v * 100 })} />
    </View>
  );
}

function LogoSheet({ logo, onClose, onChanged }: { logo: BrandLogo; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(logo.name);
  const [tab, setTab] = useState<Tab>("light"); // 預覽圖共用：切到哪一顆按鈕，預覽就顯示那個模式的樣子
  const [lightColor, setLightColor] = useState(logo.bgColor ?? "#FFFFFF");
  const [darkColor, setDarkColor] = useState<string | null>(logo.bgColorDark); // 深色模式底色：null＝沒設定，深色模式照淺色模式的底色或底圖；一選顏色就設定了
  const [logoPicks, setLogoPicks] = useState<string[]>([]);
  useEffect(() => {
    if (logo.logoUrl) void logoColors(resolveUrl(logo.logoUrl)).then(setLogoPicks);
  }, [logo.logoUrl]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (done) flashText(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const hasImage = !!logo.bgUrl;
  const upload = (part: "logo" | "bg") => (file: File) => run(() => api("PUT", `/admin/brand-logos/${logo.id}/${part}`, file), part === "logo" ? "已更新 logo" : "已更新背景圖");
  const save = async () => {
    // 有自訂背景圖時，淺色模式用背景圖（底色只是墊在下面）；沒有就用淺色底色。深色底色另外存。
    const body: Record<string, unknown> = { name: name.trim(), bgColor: hasImage ? null : lightColor, bgColorDark: darkColor };
    if (await run(() => api("PATCH", `/admin/brand-logos/${logo.id}`, body), "已儲存")) onClose();
  };
  const remove = async () => {
    if (await confirmAsk("刪除品牌 Logo", `確定刪除「${logo.name}」？選了這個品牌的教材卡會改回原本的封面。`, "刪除")) {
      if (await run(() => api("DELETE", `/admin/brand-logos/${logo.id}`), "已刪除")) onClose();
    }
  };
  const preview = { logoUrl: logo.logoUrl ?? "", bgColor: hasImage ? null : lightColor, bgColorDark: darkColor, bgUrl: logo.bgUrl };
  return (
    <EditSheet title="品牌 Logo" onClose={onClose} onSave={save} dirty busy={busy} error={error}>
      {/* 品牌名稱欄位的右邊就是 logo 上傳／更換鈕（杜杜龍 2026-11-18）。 */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Field label="品牌標籤名稱" value={name} onChange={setName} />
        </View>
        <PickImageButton label={logo.logoUrl ? "更換 logo" : "上傳 logo"} onPick={upload("logo")} busy={busy} variant="primary" />
      </View>
      <AppText variant="caption" tone="muted">
        品牌標籤名稱＝課程、清單選品牌時顯示的名稱。
      </AppText>
      {/* 預覽圖只有一張：下面三顆按鈕切換要調整的模式，預覽就顯示那個模式的樣子，淺色、深色可以來回調整。 */}
      {logo.logoUrl ? <BrandCover brand={preview} scheme={tab === "dark" ? "dark" : "light"} style={{ borderRadius: radius.md }} /> : <AppText tone="muted">先上傳 logo 才看得到預覽</AppText>}
      <Chips title="調整" label="調整" options={[{ key: "light", label: "淺色模式" }, { key: "dark", label: "深色模式" }, { key: "image", label: "自訂背景" }]} value={tab} onChange={(v) => setTab(v as Tab)} />
      {tab === "light" ? (
        hasImage ? (
          <NoticeBox text="目前淺色模式用的是自訂背景圖。要改成純色，請到「自訂背景」移除背景圖。" />
        ) : (
          <ColorPicker value={lightColor} onChange={setLightColor} swatches={SWATCHES} picks={logoPicks} />
        )
      ) : null}
      {tab === "dark" ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" tone="muted">
            只有使用者切換成「深色模式」時才套用，全站所有品牌 logo 出現的地方都一起變。還沒選顏色之前，深色模式照淺色模式的底色或背景圖。
          </AppText>
          <ColorPicker value={darkColor ?? "#1B1F1E"} onChange={setDarkColor} swatches={DARK_SWATCHES} picks={logoPicks} />
          {darkColor ? <Button variant="cancel" label="清除深色底色（深色模式照淺色）" icon="close-circle-outline" disabled={busy} onPress={() => setDarkColor(null)} /> : null}
        </View>
      ) : null}
      {tab === "image" ? (
        <View style={{ gap: space.xs }}>
          <PickImageButton label={hasImage ? "更換背景圖" : "上傳背景圖"} onPick={upload("bg")} busy={busy} />
          {hasImage ? <Button variant="cancel" label="移除背景圖（改回純色）" icon="trash-outline" disabled={busy} onPress={() => void run(() => api("DELETE", `/admin/brand-logos/${logo.id}/bg`), "已移除背景圖")} /> : null}
          <AppText variant="caption" tone="muted">
            背景圖會填滿整個封面，logo 放在中間（建議用 16:9 的圖）。
          </AppText>
        </View>
      ) : null}
      <Button variant="danger" label="刪除這個品牌 Logo" icon="trash-outline" disabled={busy} onPress={remove} />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  empty: { aspectRatio: 16 / 9, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  swatch: { width: 44, height: 44, borderRadius: radius.md },
});
