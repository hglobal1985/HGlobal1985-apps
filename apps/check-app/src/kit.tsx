/**
 * 繳作業系統的畫面元件入口：全部轉用「共用元件」（packages/ui，與寰宇行動大學同一套；杜杜龍 2026-11-26）。
 * 這個檔案只是把繳作業系統原本的元件名稱接到共用元件上，外觀、行為一律以共用元件為準；
 * 要改設計請改 packages/ui 裡的元件（兩個 App 一起變），不要在這裡另畫樣式。
 * 新畫面可以直接 import 共用元件（例如 "@/ui/button"），不一定要經過這裡。
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { ConfirmSheetHost, confirmSheet as sharedConfirm } from "@/features/confirm";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type as typeScale } from "@/theme/tokens";
import { BottomSheet } from "@/ui/bottom-sheet";
import { Button, type ButtonVariant } from "@/ui/button";
import { Card as SharedCard } from "@/ui/card";
import { Check as SharedCheck } from "@/ui/check";
import { Chips } from "@/ui/chips";
import { DIM_COLOR } from "@/ui/dim-backdrop";
import { EmptyState } from "@/ui/empty-state";
import { FLASH_ICON, FlashHost, showFlash } from "@/ui/flash-notice";
import { InAppBrowserBanner } from "@/ui/in-app-banner";
import { NoticeBox } from "@/ui/notice-box";
import { Pill, type PillTone } from "@/ui/pill";
import { Screen as SharedScreen } from "@/ui/screen";
import { Section as SharedSection } from "@/ui/section";
import { LoadingView } from "@/ui/state-views";
import { Stepper as SharedStepper } from "@/ui/stepper";
import { AppText } from "@/ui/text";
import { TopBar as SharedTopBar } from "@/ui/top-bar";

/** 顏色：一律來自共用設計規範 2.0（theme/tokens.ts）。 */
export function useColors() {
  const { c } = useTheme();
  return {
    bg: c.background,
    card: c.surface,
    fg: c.text,
    muted: c.textMuted,
    line: c.border,
    green: c.accent,
    greenDark: c.accentText,
    greenSoft: c.accentSoft,
    orange: c.warning,
    orangeSoft: c.warningSoft,
    yellow: "#FFD43B",
    danger: c.danger,
    dangerSoft: c.dangerSoft,
    ok: c.success,
    warn: c.warning,
    on: c.textOnAccent,
    dim: DIM_COLOR,
  };
}
export type Palette = ReturnType<typeof useColors>;
export const size = { touch: minTouch, radius: radius.md, card: radius.lg, gap: space.lg, pageMax: 720 };
export const font = {
  page: typeScale.display,
  title: typeScale.title,
  body: typeScale.body,
  small: typeScale.callout,
  tiny: typeScale.caption,
};

export function T({ children, style, muted, bold, small, tiny, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; bold?: boolean; small?: boolean; tiny?: boolean; numberOfLines?: number }) {
  return (
    <AppText variant={small ? "callout" : tiny ? "caption" : "body"} tone={muted ? "muted" : "default"} numberOfLines={numberOfLines} style={[bold && { fontWeight: "700" }, style]}>
      {children}
    </AppText>
  );
}

/** 返回工具列：共用 TopBar。 */
export function TopBar({ title, right }: { title: string; back?: boolean; right?: ReactNode }) {
  return <SharedTopBar title={title} right={right} safeTop />;
}

/**
 * 頁面：共用 Screen。主分頁（back=false）用大標題；其他頁面上方是共用 TopBar。
 * footer 是一列按鈕（左取消、右主要動作）。
 */
export function Screen({ children, title, back = true, right, footer }: { children: ReactNode; title?: string; back?: boolean; right?: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  const bar = footer ? <View style={styles.row}>{footer}</View> : undefined;
  if (!back) return <SharedScreen title={title} right={right} footer={bar}>{children}</SharedScreen>;
  return (
    <SharedScreen header={false} topBar={title !== undefined ? <SharedTopBar title={title} right={right} safeTop /> : undefined} footer={bar} gap={space.md}>
      {children}
    </SharedScreen>
  );
}

export function Card({ children, style, onPress, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: boolean }) {
  const { c } = useTheme();
  return (
    <SharedCard onPress={onPress} style={[accent && { backgroundColor: c.accent, borderColor: c.accent }, style]}>
      {children}
    </SharedCard>
  );
}

type BtnKind = "main" | "cancel" | "danger" | "grey" | "save" | "soft";
const VARIANT: Record<BtnKind, ButtonVariant> = { main: "primary", save: "primary", cancel: "cancel", danger: "dangerSolid", grey: "secondary", soft: "secondary" };
export function Btn({ label, onPress, kind = "main", disabled, busy, icon, flex = true }: { label: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; icon?: string; flex?: boolean; small?: boolean }) {
  const b = <Button label={label} onPress={onPress} variant={VARIANT[kind]} disabled={disabled} loading={busy} icon={icon as never} fullWidth={flex} />;
  return flex ? <View style={{ flex: 1 }}>{b}</View> : b;
}

export type ChipTone = "plain" | "ok" | "wait" | "bad" | "gold";
const PILL: Record<ChipTone, PillTone> = { plain: "neutral", ok: "success", wait: "warning", bad: "danger", gold: "bright" };
export function Chip({ label, tone = "plain", onPress }: { label: string; tone?: ChipTone; onPress?: () => void }) {
  const { c } = useTheme();
  if (!onPress) return <Pill label={label} tone={PILL[tone]} />;
  // 可以點的選項：外觀與共用 Chips（單選圓角選項列）相同；選中＝深綠底白字。
  const active = tone !== "plain";
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, { backgroundColor: active ? c.accent : c.surface, borderColor: active ? c.accent : c.border }]}>
      <AppText variant="callout" style={{ color: active ? c.textOnAccent : c.text, fontWeight: "600" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** 開關：共用勾選框（整列可點）。 */
export function Toggle({ label, value, onChange, note }: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (
    <View>
      <SharedCheck label={label} value={value} onChange={onChange} />
      {note ? <AppText variant="caption" tone="muted" style={{ marginLeft: 36, marginTop: -6 }}>{note}</AppText> : null}
    </View>
  );
}
export const Check = SharedCheck;

/** 加減數量：共用 Stepper。 */
export function Stepper({ value, onChange, label = "", hint = "", unit = "", min = 0, max = 999 }: { value: number; onChange: (v: number) => void; label?: string; hint?: string; unit?: string; min?: number; max?: number }) {
  return <SharedStepper label={label} hint={hint} value={value} min={min} max={max} step={1} unit={unit} onChange={onChange} />;
}

/** 單選切換：共用 Chips（圓角選項列）。 */
export function Seg<K extends string>({ items, value, onChange }: { items: [K, string][]; value: K; onChange: (k: K) => void }) {
  return <Chips options={items.map(([key, label]) => ({ key, label }))} value={value} onChange={onChange} />;
}

/** 文字輸入：外觀與共用 Field 一致（有標籤時直接用共用 Field）。 */
export function Field(props: TextInputProps & { label?: string }) {
  const { c } = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space.xs }}>
      {label ? <AppText variant="callout" tone="muted">{label}</AppText> : null}
      <TextInput
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label ?? rest.placeholder}
        {...rest}
        style={[styles.input, typeScale.body, rest.multiline && styles.multiline, { color: c.text, borderColor: c.border, backgroundColor: c.surface }, style]}
      />
    </View>
  );
}

export function Section({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <SharedSection title={title} action={right}>
      {null}
    </SharedSection>
  );
}

const NOTE_TONE = { plain: "info", ok: "success", bad: "danger", wait: "warning" } as const;
export function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "ok" | "bad" | "wait" }) {
  return <NoticeBox tone={NOTE_TONE[tone]} text={typeof children === "string" ? children : String(children ?? "")} />;
}

export function Progress({ value, light }: { value: number; light?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: light ? "rgba(255,255,255,0.25)" : c.border, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: "100%", backgroundColor: light ? "#FFD43B" : c.accent, borderRadius: 4 }} />
    </View>
  );
}

/** 讀取中：共用「灌溉小樹苗」。 */
export const Loading = (_: { label?: string }) => <LoadingView />;

export function Empty({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return <EmptyState icon={"document-text-outline" as never} title={title} body={note} action={action} />;
}

export function Avatar({ name, url, sizePx = 36 }: { name: string; url?: string | null; sizePx?: number }) {
  const { c } = useTheme();
  if (url) return <Image source={{ uri: url }} style={{ width: sizePx, height: sizePx, borderRadius: sizePx / 2, backgroundColor: c.accentSoft }} />;
  return (
    <View style={{ width: sizePx, height: sizePx, borderRadius: sizePx / 2, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.accentText, fontWeight: "700", fontSize: sizePx * 0.4 }}>{(name || "?").slice(0, 1)}</Text>
    </View>
  );
}

/** 上拉面板：共用 BottomSheet（往下滑收起、上一頁＝關閉）。footer＝一列按鈕（左取消、右儲存）。 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <BottomSheet onClose={onClose}>
      {title ? <AppText variant="title">{title}</AppText> : null}
      <View style={{ gap: space.md }}>{children}</View>
      {footer ? <View style={styles.row}>{footer}</View> : null}
    </BottomSheet>
  );
}

/** 需要確認的動作：共用底部確認面板。 */
/** typeOk＝高度危險動作：要輸入 ok 才能按確定（杜杜龍 2026-11-28 全生態系統規定）。 */
export const confirmSheet = (title: string, message: string, ok: string, danger = false, typeOk = false) => sharedConfirm({ title, message, confirmLabel: ok, danger: danger || typeOk, typeOk });

/** 一句話回饋：共用全螢幕提醒。 */
export function flash(title: string, note?: string, bad?: boolean) {
  const icon = <Ionicons name={bad ? "alert-circle" : "checkmark-circle"} size={FLASH_ICON - 3} color={bad ? "#B3261E" : "#0C603C"} />;
  showFlash({ title, body: note, icon, holdMs: (title + (note ?? "")).length > 14 ? 1600 : 1000 });
}
export const flashError = (e: unknown) => flash((e as Error)?.message || "發生錯誤，請再試一次", undefined, true);

/** 全站提醒與確認面板的掛載點（放在根版面）。 */
export function Hosts({ children }: { children: ReactNode }) {
  return (
    <>
      <InAppBrowserBanner />
      {children}
      <ConfirmSheetHost />
      <FlashHost />
    </>
  );
}

export const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  chip: { minHeight: minTouch - 8, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center" },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  multiline: { minHeight: 96, paddingTop: space.md, textAlignVertical: "top" },
});
