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
import { AppText, BrandCover, Button, Card, Chips, EmptyState, ErrorView, Field, FormBlock, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const SWATCHES = ["#FFFFFF", "#F6F5F0", "#111111", "#1F4D3A", "#B3261E", "#F0B323", "#1F3A6B", "#7A4B2A"];
/** 深色模式底色的常用選項（比 App 深色背景稍亮或同色，logo 才看得清楚）。 */
const DARK_SWATCHES = ["#000000", "#111111", "#1B1F1E", "#23302B", "#2A2A2E", "#1A2540", "#3A2A24", "#FFFFFF"];
type BgMode = "white" | "color" | "image";

/**
 * 設定 › 品牌 Logo（業主 2026-11-18，超級管理員）：上傳／更換 logo，每個 logo 可選底色或底圖（透明背景、長寬不合時用），
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
        新增品牌並上傳 logo。課程、素材、清單區塊在編輯時選「品牌」（和分類是分開的欄位）；沒有手動上傳封面時，封面就用這個品牌的 logo。
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

function LogoSheet({ logo, onClose, onChanged }: { logo: BrandLogo; onClose: () => void; onChanged: () => void }) {
  const { c } = useTheme();
  const [name, setName] = useState(logo.name);
  const [mode, setMode] = useState<BgMode>(logo.bgUrl ? "image" : logo.bgColor && logo.bgColor !== "#FFFFFF" ? "color" : "white");
  const [color, setColor] = useState(logo.bgColor ?? "#FFFFFF");
  const [darkOn, setDarkOn] = useState(!!logo.bgColorDark); // 深色模式底色：不設定＝深色模式照原本的底色或底圖
  const [darkColor, setDarkColor] = useState(logo.bgColorDark ?? "#1B1F1E");
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
  const upload = (part: "logo" | "bg") => (file: File) => run(() => api("PUT", `/admin/brand-logos/${logo.id}/${part}`, file), part === "logo" ? "已更新 logo" : "已更新底圖");
  const save = async () => {
    const body: Record<string, unknown> = { name: name.trim(), bgColor: mode === "color" ? color : mode === "white" ? "#FFFFFF" : null, bgColorDark: darkOn ? darkColor : null };
    if (mode !== "image" && logo.bgUrl) await api("DELETE", `/admin/brand-logos/${logo.id}/bg`).catch(() => undefined);
    if (await run(() => api("PATCH", `/admin/brand-logos/${logo.id}`, body), "已儲存")) onClose();
  };
  const remove = async () => {
    if (await confirmAsk("刪除品牌 Logo", `確定刪除「${logo.name}」？選了這個品牌的課程與素材會改回原本的封面。`, "刪除")) {
      if (await run(() => api("DELETE", `/admin/brand-logos/${logo.id}`), "已刪除")) onClose();
    }
  };
  const preview = { logoUrl: logo.logoUrl ?? "", bgColor: mode === "color" ? color : mode === "white" ? "#FFFFFF" : null, bgColorDark: darkOn ? darkColor : null, bgUrl: mode === "image" ? logo.bgUrl : null };
  return (
    <EditSheet title="品牌 Logo" onClose={onClose} onSave={save} dirty busy={busy} error={error}>
      <Field label="品牌標籤名稱（課程、清單選品牌時顯示的名稱）" value={name} onChange={setName} />
      <AppText variant="callout" style={{ fontWeight: "700" }}>
        封面預覽
      </AppText>
      {logo.logoUrl ? <BrandCover brand={preview} scheme="light" style={{ borderRadius: radius.md }} /> : <AppText tone="muted">先上傳 logo 才看得到預覽</AppText>}
      <PickImageButton label={logo.logoUrl ? "更換 logo 圖檔" : "上傳 logo 圖檔"} onPick={upload("logo")} busy={busy} variant="primary" />
      <Chips title="封面底" label="底" options={[{ key: "white", label: "白色（預設）" }, { key: "color", label: "指定底色" }, { key: "image", label: "底圖" }]} value={mode} onChange={(v) => setMode(v as BgMode)} />
      {mode === "color" ? (
        <View style={{ gap: space.xs }}>
          <View style={styles.swatches}>
            {SWATCHES.map((x) => (
              <Pressable key={x} accessibilityRole="button" accessibilityLabel={`底色 ${x}`} onPress={() => setColor(x)} style={[styles.swatch, { backgroundColor: x, borderColor: color === x ? c.accent : c.border, borderWidth: color === x ? 3 : 1 }]} />
            ))}
          </View>
          {logoPicks.length ? (
            <View style={{ gap: space.xs }}>
              <AppText variant="caption" tone="muted">
                logo 常用的顏色（點一下套用）
              </AppText>
              <View style={styles.swatches}>
                {logoPicks.map((x) => (
                  <Pressable key={x} accessibilityRole="button" accessibilityLabel={`logo 常用色 ${x}`} onPress={() => setColor(x)} style={[styles.swatch, { backgroundColor: x, borderColor: color === x ? c.accent : c.border, borderWidth: color === x ? 3 : 1 }]} />
                ))}
              </View>
            </View>
          ) : null}
          <Field label="自訂底色（#RRGGBB）" value={color} onChange={setColor} placeholder="#FFFFFF" />
        </View>
      ) : null}
      {mode === "image" ? (
        <View style={{ gap: space.xs }}>
          <PickImageButton label={logo.bgUrl ? "更換底圖" : "上傳底圖"} onPick={upload("bg")} busy={busy} />
          <AppText variant="caption" tone="muted">
            底圖會填滿整個封面，logo 放在中間（建議用 16:9 的圖）。
          </AppText>
        </View>
      ) : null}
      <FormBlock title="深色模式底色" hint="只有使用者切換成「深色模式」時才套用，全站所有品牌 logo 出現的地方都一起變；淺色模式不受影響。不設定＝深色模式照上面的底色或底圖。">
        <Chips title="深色模式" label="深色模式" options={[{ key: "off", label: "不設定" }, { key: "on", label: "指定深色底色" }]} value={darkOn ? "on" : "off"} onChange={(v) => setDarkOn(v === "on")} />
        {darkOn ? (
          <View style={{ gap: space.xs }}>
            <View style={styles.swatches}>
              {DARK_SWATCHES.map((x) => (
                <Pressable key={x} accessibilityRole="button" accessibilityLabel={`深色模式底色 ${x}`} onPress={() => setDarkColor(x)} style={[styles.swatch, { backgroundColor: x, borderColor: darkColor === x ? c.accent : c.border, borderWidth: darkColor === x ? 3 : 1 }]} />
              ))}
            </View>
            <Field label="自訂深色底色（#RRGGBB）" value={darkColor} onChange={setDarkColor} placeholder="#1B1F1E" />
            {logo.logoUrl ? (
              <>
                <AppText variant="caption" tone="muted">
                  深色模式預覽
                </AppText>
                <BrandCover brand={preview} scheme="dark" style={{ borderRadius: radius.md }} />
              </>
            ) : null}
          </View>
        ) : null}
      </FormBlock>
      <Button variant="danger" label="刪除這個品牌 Logo" icon="trash-outline" disabled={busy} onPress={remove} />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  empty: { aspectRatio: 16 / 9, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  swatch: { width: 44, height: 44, borderRadius: radius.md },
});
