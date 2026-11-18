import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, type BrandLogo } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { PickImageButton } from "@/features/admin/pick-image";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, BrandCover, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const SWATCHES = ["#FFFFFF", "#F6F5F0", "#111111", "#1F4D3A", "#B3261E", "#F0B323", "#1F3A6B", "#7A4B2A"];
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
            {b.logoUrl ? <BrandCover brand={{ logoUrl: b.logoUrl, bgColor: b.bgColor, bgUrl: b.bgUrl }} style={{ borderRadius: radius.md }} /> : <View style={[styles.empty, { borderColor: c.border }]}><AppText tone="muted">還沒有上傳 logo</AppText></View>}
            <AppText variant="headline">{b.name}</AppText>
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
    const body: Record<string, unknown> = { name: name.trim(), bgColor: mode === "color" ? color : mode === "white" ? "#FFFFFF" : null };
    if (mode !== "image" && logo.bgUrl) await api("DELETE", `/admin/brand-logos/${logo.id}/bg`).catch(() => undefined);
    if (await run(() => api("PATCH", `/admin/brand-logos/${logo.id}`, body), "已儲存")) onClose();
  };
  const remove = async () => {
    if (await confirmAsk("刪除品牌 Logo", `確定刪除「${logo.name}」？選了這個品牌的課程與素材會改回原本的封面。`, "刪除")) {
      if (await run(() => api("DELETE", `/admin/brand-logos/${logo.id}`), "已刪除")) onClose();
    }
  };
  const preview = { logoUrl: logo.logoUrl ?? "", bgColor: mode === "color" ? color : mode === "white" ? "#FFFFFF" : null, bgUrl: mode === "image" ? logo.bgUrl : null };
  return (
    <EditSheet title="品牌 Logo" onClose={onClose} onSave={save} dirty busy={busy} error={error}>
      <Field label="品牌名稱" value={name} onChange={setName} />
      <AppText variant="callout" style={{ fontWeight: "700" }}>
        封面預覽
      </AppText>
      {logo.logoUrl ? <BrandCover brand={preview} style={{ borderRadius: radius.md }} /> : <AppText tone="muted">先上傳 logo 才看得到預覽</AppText>}
      <PickImageButton label={logo.logoUrl ? "更換 logo 圖檔" : "上傳 logo 圖檔"} onPick={upload("logo")} busy={busy} variant="primary" />
      <Chips label="底" options={[{ key: "white", label: "白色（預設）" }, { key: "color", label: "指定底色" }, { key: "image", label: "底圖" }]} value={mode} onChange={(v) => setMode(v as BgMode)} />
      {mode === "color" ? (
        <View style={{ gap: space.xs }}>
          <View style={styles.swatches}>
            {SWATCHES.map((x) => (
              <Pressable key={x} accessibilityRole="button" accessibilityLabel={`底色 ${x}`} onPress={() => setColor(x)} style={[styles.swatch, { backgroundColor: x, borderColor: color === x ? c.accent : c.border, borderWidth: color === x ? 3 : 1 }]} />
            ))}
          </View>
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
      <Button variant="danger" label="刪除這個品牌 Logo" icon="trash-outline" disabled={busy} onPress={remove} />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  empty: { aspectRatio: 16 / 9, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  swatch: { width: 44, height: 44, borderRadius: radius.md },
});
