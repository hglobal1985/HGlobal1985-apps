import { useEffect, useState } from "react";
import { Image, StyleSheet, TextInput, View } from "react-native";
import { api, resolveUrl, THUMB_WIDTH_CHOICES, type ThumbSettings } from "@/api/client";
import { Stepper } from "@/ui/stepper";
import { Check } from "@/ui/check";
import { useApi } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, ErrorView, LoadingView, NoticeBox, Screen, Section } from "@/ui";

type Status = { binding: boolean; lastError: { at: string; key: string; w: number; message: string } | null; samples: string[]; totalCovers: number };
type Probe = { w: number; kb: number | null; header: string };
type Usage = { month: string; monthly: number; used: number; remaining: number; classes: { cls: string; label: string; priority: number; used: number; cap: number; remaining: number }[]; groups: { cls: string; label: string; used: number }[] };

/** 一條用量進度條：已用／上限，剩餘額度寫在右邊。 */
function UsageBar({ label, used, cap, remaining }: { label: string; used: number; cap: number; remaining: number }) {
  const { c } = useTheme();
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="body" style={{ fontWeight: "700" }}>{label}</AppText>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: pct >= 100 ? c.danger : c.accent }} />
      </View>
      <AppText variant="caption" tone="muted">{`已用 ${used} 張／上限 ${cap} 張・剩餘 ${remaining} 張`}</AppText>
    </View>
  );
}

const KB_TARGET = 30;
const pctVal = (v: number) => Math.round(v * 100);

/**
 * 設定 › Cloudflare即時縮圖（超級管理員，業主 2026-11-20）：Cloudflare 圖片縮放（Images 綁定）所有可調選項集中在這一頁。
 * 免費方案每月 5,000 種「不重複縮圖」，超過只是不縮（回原圖）、不會收費；總開關預設關閉。
 */
export default function ThumbnailsScreen() {
  const { c } = useTheme();
  const { config, reload: reloadConfig } = useUiConfig();
  const saved = config.app.thumb;
  const [t, setT] = useState<ThumbSettings>(saved);
  useEffect(() => setT(saved), [JSON.stringify(saved)]);
  const set = <K extends keyof ThumbSettings>(k: K, v: ThumbSettings[K]) => setT((x) => ({ ...x, [k]: v }));
  const status = useApi<Status>("/admin/thumb/status");
  const usage = useApi<Usage>("/admin/thumb/usage");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [probing, setProbing] = useState(false);
  const dirty = JSON.stringify(t) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/ui-config", { app: { ...config.app, thumb: t } });
      reloadConfig();
      setMsg({ tone: "success", text: "已儲存。手機的卡片縮圖會依新設定縮小。" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const toggleWidth = (w: number) => set("widths", t.widths.includes(w) ? t.widths.filter((x) => x !== w) : [...t.widths, w].sort((a, b) => a - b));

  const sample = status.data?.samples[0];
  const runProbe = async () => {
    if (!sample) return;
    setProbing(true);
    try {
      const out: Probe[] = [];
      for (const w of [...saved.widths].sort((a, b) => a - b)) {
        const res = await fetch(`${resolveUrl(sample)}${sample.includes("?") ? "&" : "?"}w=${w}`, { cache: "reload" });
        const blob = await res.blob();
        out.push({ w, kb: Math.round(blob.size / 1024), header: res.headers.get("x-thumb") ?? "" });
      }
      setProbes(out);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setProbing(false);
    }
  };
  const clearError = async () => {
    await api("DELETE", "/admin/thumb/status");
    status.reload();
  };

  if (status.loading && !status.data) return <LoadingView />;
  if (status.error && !status.data) return <ErrorView message={status.error} onRetry={status.reload} />;
  const st = status.data!;
  const unique = (st.totalCovers || 0) * Math.max(1, saved.widths.length);

  return (
    <Screen>
      <Section fold title="總開關">
        <Card>
          <Check label="啟用即時縮圖（手機小螢幕的卡片縮圖改用縮小版）" value={t.enabled} onChange={(v) => set("enabled", v)} />
          <AppText variant="caption" tone="muted">
            Cloudflare 免費方案每月可做 5,000 種「不重複縮圖」；超過時只是不縮（直接顯示原圖），不會收費。目前約 {st.totalCovers} 張封面 × {saved.widths.length} 種寬度 ≈ {unique} 種，遠低於額度。
          </AppText>
          {!st.binding ? <NoticeBox tone="danger" text="伺服器沒有接上圖片縮放功能（IMAGES），縮圖不會生效。" /> : null}
        </Card>
      </Section>

      <Section fold title="額度與優先順序">
        <Card>
          <AppText variant="body">優先順序：① 封面（課程、系列、中心照片）＞ ② 中心 EDM ＞ ③ 其他相簿（成交百寶箱）。低優先的用到上限就改回傳原圖（不縮），額度預留給更高優先的。</AppText>
          {usage.data ? (
            <>
              <UsageBar label={`本月總額度（${usage.data.month}）`} used={usage.data.used} cap={usage.data.monthly} remaining={usage.data.remaining} />
              {usage.data.classes.map((k) => (
                <UsageBar key={k.cls} label={`${k.priority}. ${k.label}`} used={k.used} cap={k.cap} remaining={k.remaining} />
              ))}
              <AppText variant="body" style={{ fontWeight: "700" }}>各區塊使用的縮圖張數</AppText>
              {usage.data.groups.length ? (
                usage.data.groups.map((g, i) => (
                  <View key={`${g.cls}${i}`} style={styles.row}>
                    <AppText variant="callout" style={{ flex: 1 }} numberOfLines={2}>{g.label}</AppText>
                    <AppText variant="callout" tone="muted">{`${g.used} 張`}</AppText>
                  </View>
                ))
              ) : (
                <AppText tone="muted">本月還沒有縮圖紀錄。</AppText>
              )}
            </>
          ) : (
            <AppText tone="muted">讀取中…</AppText>
          )}
          <Stepper label="每月縮圖額度" hint="Cloudflare 免費方案每月 5,000 種不重複縮圖" value={t.quota.monthly} min={100} max={100000} step={500} unit="張" onChange={(v) => set("quota", { ...t.quota, monthly: v })} />
          <Stepper label="中心 EDM 最多用到" hint="用到這個比例就不再縮 EDM，留給封面" value={t.quota.edmPct} min={0} max={100} step={5} unit="%" onChange={(v) => set("quota", { ...t.quota, edmPct: v })} />
          <Stepper label="其他相簿最多用到" hint="用到這個比例就不再縮相簿照片，留給封面與 EDM" value={t.quota.albumPct} min={0} max={100} step={5} unit="%" onChange={(v) => set("quota", { ...t.quota, albumPct: v })} />
        </Card>
      </Section>

      <Section fold title="尺寸">
        <Card>
          <AppText variant="body">允許的縮圖寬度（每多選一種，每張圖就多算一種縮圖）</AppText>
          <View style={styles.wrap}>
            {THUMB_WIDTH_CHOICES.map((w) => (
              <Check key={w} label={`${w}px`} value={t.widths.includes(w)} onChange={() => toggleWidth(w)} />
            ))}
          </View>
          <Stepper label="高度比例" hint="高度＝寬度的幾％（0＝依原圖比例；56＝16:9）" value={pctVal(t.height)} min={0} max={300} step={5} unit="%" onChange={(v) => set("height", v / 100)} />
          <Chips title="裁切方式 fit" value={t.fit} onChange={(v) => set("fit", v)} options={[{ key: "scale-down", label: "只縮小" }, { key: "contain", label: "完整放入" }, { key: "cover", label: "填滿裁切" }, { key: "crop", label: "裁切" }, { key: "pad", label: "補邊" }, { key: "squeeze", label: "拉伸" }]} />
          <Chips title="裁切重心 gravity" value={t.gravity} onChange={(v) => set("gravity", v)} options={[{ key: "auto", label: "自動" }, { key: "center", label: "中央" }, { key: "face", label: "人臉" }, { key: "left", label: "左" }, { key: "right", label: "右" }, { key: "top", label: "上" }, { key: "bottom", label: "下" }]} />
          <Stepper label="四邊裁掉" hint="每邊裁掉幾像素（0＝不裁）" value={t.trim} min={0} max={500} step={10} unit="px" onChange={(v) => set("trim", v)} />
          <Chips title="旋轉 rotate" value={String(t.rotate)} onChange={(v) => set("rotate", Number(v) as ThumbSettings["rotate"])} options={[{ key: "0", label: "不轉" }, { key: "90", label: "90°" }, { key: "180", label: "180°" }, { key: "270", label: "270°" }]} />
          <Chips title="翻轉 flip" value={t.flip || "none"} onChange={(v) => set("flip", v === "none" ? "" : (v as ThumbSettings["flip"]))} options={[{ key: "none", label: "不翻" }, { key: "h", label: "左右" }, { key: "v", label: "上下" }, { key: "hv", label: "全部" }]} />
        </Card>
      </Section>

      <Section fold title="輸出格式與畫質">
        <Card>
          <Chips title="格式 format" value={t.format} onChange={(v) => set("format", v)} options={[{ key: "auto", label: "自動（建議）" }, { key: "avif", label: "AVIF" }, { key: "webp", label: "WebP" }, { key: "jpeg", label: "JPEG" }, { key: "png", label: "PNG" }]} />
          <Stepper label="畫質" hint="數字越小檔案越小（有選下方文字等級時以等級為準）" value={t.quality} min={10} max={100} step={5} unit="" onChange={(v) => set("quality", v)} />
          <Chips title="畫質等級 quality（文字）" value={t.qualityLevel || "none"} onChange={(v) => set("qualityLevel", v === "none" ? "" : (v as ThumbSettings["qualityLevel"]))} options={[{ key: "none", label: "用數字" }, { key: "high", label: "高" }, { key: "medium-high", label: "中高" }, { key: "medium-low", label: "中低" }, { key: "low", label: "低" }]} />
          <Check label="保留動畫（GIF／動態圖）" value={t.anim} onChange={(v) => set("anim", v)} />
          <Chips title="圖片附帶資訊 metadata" value={t.metadata} onChange={(v) => set("metadata", v)} options={[{ key: "none", label: "全部移除" }, { key: "copyright", label: "只留版權" }, { key: "keep", label: "全部保留" }]} />
        </Card>
      </Section>

      <Section fold title="影像調整">
        <Card>
          <Stepper label="模糊 blur" hint="0＝不模糊" value={t.blur} min={0} max={250} step={5} unit="" onChange={(v) => set("blur", v)} />
          <Stepper label="銳利化 sharpen" hint="0＝不處理（縮小後變糊時可加 1～2）" value={t.sharpen} min={0} max={10} step={1} unit="" onChange={(v) => set("sharpen", v)} />
          <Stepper label="亮度 brightness" hint="100%＝不變" value={pctVal(t.brightness)} min={0} max={400} step={5} unit="%" onChange={(v) => set("brightness", v / 100)} />
          <Stepper label="對比 contrast" hint="100%＝不變" value={pctVal(t.contrast)} min={0} max={400} step={5} unit="%" onChange={(v) => set("contrast", v / 100)} />
          <Stepper label="伽瑪 gamma" hint="100%＝不變" value={pctVal(t.gamma)} min={10} max={400} step={5} unit="%" onChange={(v) => set("gamma", v / 100)} />
          <Stepper label="飽和度 saturation" hint="100%＝不變，0＝黑白" value={pctVal(t.saturation)} min={0} max={400} step={5} unit="%" onChange={(v) => set("saturation", v / 100)} />
          <AppText variant="body">補邊／透明背景底色（#RRGGBB，空白＝不指定）</AppText>
          <TextInput value={t.background} onChangeText={(v) => set("background", v.trim())} placeholder="#FFFFFF" autoCapitalize="characters" style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]} />
          <Stepper label="邊框粗細" hint="0＝沒有邊框" value={t.borderWidth} min={0} max={50} step={1} unit="px" onChange={(v) => set("borderWidth", v)} />
          <AppText variant="body">邊框顏色（#RRGGBB）</AppText>
          <TextInput value={t.borderColor} onChangeText={(v) => set("borderColor", v.trim())} placeholder="#FFFFFF" autoCapitalize="characters" style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]} />
        </Card>
      </Section>

      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      <Button label="儲存設定" icon="save-outline" loading={saving} disabled={!dirty || saving} onPress={save} fullWidth />

      <Section fold title="試算（用已儲存的設定，對一張真實封面縮圖）">
        <Card>
          {!saved.enabled ? <NoticeBox tone="danger" text="總開關目前是關閉的，所以下面的圖與試算都是原圖（沒有縮小）。請在最上方勾選「啟用即時縮圖」並按「儲存設定」，再試算。" /> : null}
          {sample ? <Image source={{ uri: `${resolveUrl(sample)}${sample.includes("?") ? "&" : "?"}w=${[...saved.widths].sort((x, y) => x - y)[0] ?? 320}` }} style={styles.sample} resizeMode="cover" accessibilityIgnoresInvertColors /> : <AppText tone="muted">目前沒有已上架的封面可試算。</AppText>}
          <Button label="開始試算" icon="speedometer-outline" variant="secondary" loading={probing} disabled={!sample || probing} onPress={runProbe} fullWidth />
          {probes?.map((p) => (
            <View key={p.w} style={styles.row}>
              <AppText variant="body" style={{ flex: 1 }}>
                {p.w}px：{p.kb ?? "?"} KB {p.header ? `（${p.header}）` : ""}
              </AppText>
              <AppText variant="callout" style={{ color: p.kb != null && p.kb <= KB_TARGET ? c.success : c.danger, fontWeight: "800" }}>
                {p.kb != null && p.kb <= KB_TARGET ? `≤ ${KB_TARGET}KB ✓` : `超過 ${KB_TARGET}KB`}
              </AppText>
            </View>
          ))}
          {probes?.some((p) => p.header === "fallback") ? <NoticeBox tone="danger" text="有一張沒縮成功（回傳原圖）：總開關沒開、寬度不在允許清單，或縮圖失敗，請看下方狀態。" /> : null}
        </Card>
      </Section>

      <Section fold title="狀態">
        <Card>
          {st.lastError ? (
            <>
              <NoticeBox tone="danger" text={`最近一次縮圖失敗（${st.lastError.at.slice(0, 16).replace("T", " ")}，寬 ${st.lastError.w}）：${st.lastError.message}`} />
              <Button label="清除錯誤紀錄" variant="cancel" onPress={clearError} fullWidth />
            </>
          ) : (
            <AppText tone="muted">沒有縮圖失敗紀錄。</AppText>
          )}
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  sample: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
