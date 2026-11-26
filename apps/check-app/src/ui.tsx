/**
 * 共用畫面元件（全 App 只用這一套）：頁面、上方工具列、卡片、按鈕、標籤、開關、加減鈕、分頁切換、
 * 上拉面板（往下滑收起）、底部確認面板、全螢幕提醒。
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, size, useColors, type Palette } from "./theme";

export function T({ children, style, muted, bold, small, tiny, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; bold?: boolean; small?: boolean; tiny?: boolean; numberOfLines?: number }) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[small ? font.small : tiny ? font.tiny : font.body, { color: muted ? c.muted : c.fg }, bold && { fontWeight: "700" }, style]}>
      {children}
    </Text>
  );
}

export function TopBar({ title, back = true, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: ins.top, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 4, maxWidth: size.pageMax, width: "100%", alignSelf: "center" }}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            style={{ width: size.touch, height: size.touch, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={26} color={c.green} />
          </Pressable>
        )}
        <Text numberOfLines={1} style={[font.title, { color: c.fg, flex: 1, paddingLeft: back ? 0 : 10 }]}>
          {title}
        </Text>
        {right}
      </View>
    </View>
  );
}

export function Screen({ children, title, back, right, footer, scroll = true }: { children: ReactNode; title?: string; back?: boolean; right?: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  const c = useColors();
  const body = <View style={{ padding: size.gap, gap: 12, width: "100%", maxWidth: size.pageMax, alignSelf: "center" }}>{children}</View>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      {title !== undefined && <TopBar title={title} back={back} right={right} />}
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.card }}>
          <View style={{ flexDirection: "row", gap: 10, padding: 12, maxWidth: size.pageMax, width: "100%", alignSelf: "center" }}>{footer}</View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style, onPress, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accent?: boolean }) {
  const c = useColors();
  const s: StyleProp<ViewStyle> = [
    { backgroundColor: accent ? c.green : c.card, borderRadius: size.card, borderWidth: accent ? 0 : 1, borderColor: c.line, padding: 14, gap: 8 },
    style,
  ];
  if (!onPress) return <View style={s}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

type BtnKind = "main" | "cancel" | "danger" | "grey" | "save" | "soft";
export function Btn({ label, onPress, kind = "main", disabled, busy, icon, flex = true, small }: { label: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; icon?: keyof typeof Ionicons.glyphMap; flex?: boolean; small?: boolean }) {
  const c = useColors();
  const look: Record<BtnKind, { bg: string; fg: string; border: string }> = {
    main: { bg: c.green, fg: c.on, border: c.green },
    cancel: { bg: "transparent", fg: c.danger, border: c.danger },
    danger: { bg: c.danger, fg: c.on, border: c.danger },
    grey: { bg: c.card, fg: c.fg, border: c.line },
    save: { bg: c.yellow, fg: "#1d2a22", border: c.bWarn },
    soft: { bg: c.greenSoft, fg: c.greenDark, border: c.greenSoft },
  };
  const l = look[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: small ? 40 : 48, paddingHorizontal: small ? 12 : 14, borderRadius: size.radius, borderWidth: 1.5, backgroundColor: l.bg, borderColor: l.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
        flex && { flex: 1 },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? <ActivityIndicator color={l.fg} /> : icon ? <Ionicons name={icon} size={18} color={l.fg} /> : null}
      <Text style={{ color: l.fg, fontWeight: "700", fontSize: small ? 14 : 16 }}>{label}</Text>
    </Pressable>
  );
}

export type ChipTone = "plain" | "ok" | "wait" | "bad" | "gold";
export function Chip({ label, tone = "plain", onPress }: { label: string; tone?: ChipTone; onPress?: () => void }) {
  const c = useColors();
  const m: Record<ChipTone, [string, string]> = { plain: [c.bg, c.muted], ok: [c.greenSoft, c.greenDark], wait: [c.orangeSoft, c.warn], bad: [c.dangerSoft, c.danger], gold: [c.yellow, "#3a2e00"] };
  const [bg, fg] = m[tone];
  const inner = <Text style={{ color: fg, fontSize: 13, fontWeight: "700" }}>{label}</Text>;
  const style: ViewStyle = { backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: tone === "plain" ? c.line : bg };
  if (!onPress) return <View style={style}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[style, { minHeight: 36, justifyContent: "center", paddingHorizontal: 14 }]}>
      {inner}
    </Pressable>
  );
}

export function Toggle({ label, value, onChange, note }: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ minHeight: size.touch, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <T>{label}</T>
        {note ? <T tiny muted>{note}</T> : null}
      </View>
      <View style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: value ? c.green : c.line, padding: 3, alignItems: value ? "flex-end" : "flex-start" }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.card }} />
      </View>
    </Pressable>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ minHeight: size.touch, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: value ? c.green : c.chk, backgroundColor: value ? c.green : "transparent", alignItems: "center", justifyContent: "center" }}>
        {value && <Ionicons name="checkmark" size={16} color={c.on} />}
      </View>
      <T small style={{ flex: 1 }}>
        {label}
      </T>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const c = useColors();
  const b = (d: number, icon: "remove" | "add", label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onChange(Math.min(max, Math.max(min, value + d)))} style={{ width: size.touch, height: size.touch, borderRadius: 22, backgroundColor: c.greenSoft, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={22} color={c.greenDark} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {b(-1, "remove", "減少")}
      <Text style={{ fontSize: 22, fontWeight: "700", minWidth: 36, textAlign: "center", color: c.fg, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {b(1, "add", "增加")}
    </View>
  );
}

export function Seg<K extends string>({ items, value, onChange }: { items: [K, string][]; value: K; onChange: (k: K) => void }) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {items.map(([k, l]) => (
        <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: value === k }} onPress={() => onChange(k)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: value === k ? c.green : c.card, borderWidth: 1, borderColor: value === k ? c.green : c.line }}>
          <Text style={{ color: value === k ? c.on : c.muted, fontWeight: "700", fontSize: 14 }}>{l}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      {label ? <T small bold>{label}</T> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...rest}
        style={[{ minHeight: size.touch, borderWidth: 1.5, borderColor: c.line, borderRadius: size.radius, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16, color: c.fg, backgroundColor: c.card }, rest.multiline && { minHeight: 88, textAlignVertical: "top" }, style]}
      />
    </View>
  );
}

export function Section({ title, right }: { title: string; right?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 6 }}>
      <Text style={{ flex: 1, color: c.muted, fontWeight: "700", fontSize: 13, letterSpacing: 0.5 }}>{title}</Text>
      {right}
    </View>
  );
}

export function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "ok" | "bad" | "wait" }) {
  const c = useColors();
  const m = { plain: [c.card, c.muted, c.line], ok: [c.greenSoft, c.greenDark, c.greenSoft], bad: [c.dangerSoft, c.danger, c.bBad], wait: [c.orangeSoft, c.warn, c.bWarn] }[tone];
  return (
    <View style={{ backgroundColor: m[0], borderRadius: 12, padding: 12, borderWidth: 1, borderColor: m[2] }}>
      {typeof children === "string" ? <Text style={[font.small, { color: m[1] }]}>{children}</Text> : children}
    </View>
  );
}

export function Progress({ value, light }: { value: number; light?: boolean }) {
  const c = useColors();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: light ? "rgba(255,255,255,0.25)" : c.line, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: "100%", backgroundColor: light ? c.yellow : c.green, borderRadius: 4 }} />
    </View>
  );
}

export function Loading({ label = "讀取中…" }: { label?: string }) {
  const c = useColors();
  return (
    <View style={{ padding: 40, alignItems: "center", gap: 10 }}>
      <ActivityIndicator color={c.green} />
      <T small muted>
        {label}
      </T>
    </View>
  );
}

export function Empty({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <View style={{ paddingVertical: 36, alignItems: "center", gap: 8 }}>
      <T bold>{title}</T>
      {note ? (
        <T small muted style={{ textAlign: "center" }}>
          {note}
        </T>
      ) : null}
      {action}
    </View>
  );
}

export function Avatar({ name, url, sizePx = 36 }: { name: string; url?: string | null; sizePx?: number }) {
  const c = useColors();
  if (url) {
    const { Image } = require("react-native") as typeof import("react-native");
    return <Image source={{ uri: url }} style={{ width: sizePx, height: sizePx, borderRadius: sizePx / 2, backgroundColor: c.greenSoft }} />;
  }
  return (
    <View style={{ width: sizePx, height: sizePx, borderRadius: sizePx / 2, backgroundColor: c.greenSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.greenDark, fontWeight: "700", fontSize: sizePx * 0.4 }}>{(name || "?").slice(0, 1)}</Text>
    </View>
  );
}

// ───── 上拉面板（往下滑收起） ─────
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const y = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 90 || g.vy > 1.2) Animated.timing(y, { toValue: 800, duration: 160, useNativeDriver: Platform.OS !== "web" }).start(() => onClose());
        else Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== "web" }).start();
      },
    }),
  ).current;
  useEffect(() => {
    if (open) y.setValue(0);
  }, [open, y]);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="關閉" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.dim }} />
        <Animated.View style={{ transform: [{ translateY: y }], backgroundColor: c.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "88%", width: "100%", maxWidth: size.pageMax, alignSelf: "center" }}>
          <View {...pan.panHandlers} style={{ paddingTop: 8, paddingBottom: 4, alignItems: "center" }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: c.line }} />
            {title ? <Text style={[font.title, { color: c.fg, alignSelf: "flex-start", paddingHorizontal: 16, paddingTop: 8 }]}>{title}</Text> : null}
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer && <View style={{ flexDirection: "row", gap: 10, padding: 12, paddingBottom: 12 + ins.bottom, borderTopWidth: 1, borderTopColor: c.line }}>{footer}</View>}
          {!footer && <View style={{ height: ins.bottom }} />}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ───── 底部確認面板＋全螢幕提醒（全域） ─────
type ConfirmReq = { title: string; message?: string; ok: string; danger?: boolean; resolve: (v: boolean) => void };
type FlashReq = { title: string; note?: string; bad?: boolean };
const HostCtx = createContext<{ confirm: (r: Omit<ConfirmReq, "resolve">) => Promise<boolean>; flash: (r: FlashReq) => void } | null>(null);
let globalHost: { confirm: (r: Omit<ConfirmReq, "resolve">) => Promise<boolean>; flash: (r: FlashReq) => void } | null = null;

/** 需要使用者確認的動作：從下方彈出（左「取消」、右主要動作）。 */
export const confirmSheet = (title: string, message: string, ok: string, danger = false) => globalHost?.confirm({ title, message, ok, danger }) ?? Promise.resolve(false);
/** 一句話的操作回饋（畫面上方的大卡片，自動消失）。 */
export const flash = (title: string, note?: string, bad?: boolean) => globalHost?.flash({ title, note, bad });
export const flashError = (e: unknown) => flash((e as Error)?.message || "發生錯誤，請再試一次", undefined, true);

export function Hosts({ children }: { children: ReactNode }) {
  const c = useColors();
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [fl, setFl] = useState<FlashReq | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = useRef({
    confirm: (r: Omit<ConfirmReq, "resolve">) => new Promise<boolean>((resolve) => setCf({ ...r, resolve })),
    flash: (r: FlashReq) => {
      setFl(r);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFl(null), 1800);
    },
  }).current;
  globalHost = value;
  const done = (v: boolean) => {
    cf?.resolve(v);
    setCf(null);
  };
  return (
    <HostCtx.Provider value={value}>
      {children}
      <Sheet
        open={!!cf}
        onClose={() => done(false)}
        title={cf?.title}
        footer={
          <>
            <Btn label="取消" kind={cf?.danger ? "grey" : "cancel"} onPress={() => done(false)} />
            <Btn label={cf?.ok ?? "確定"} kind={cf?.danger ? "danger" : "main"} onPress={() => done(true)} />
          </>
        }
      >
        {cf?.message ? <T>{cf.message}</T> : null}
      </Sheet>
      {fl && <FlashCard f={fl} c={c} onClose={() => setFl(null)} />}
    </HostCtx.Provider>
  );
}
function FlashCard({ f, c, onClose }: { f: FlashReq; c: Palette; onClose: () => void }) {
  const ins = useSafeAreaInsets();
  return (
    <Pressable onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.dim, alignItems: "center" }} accessibilityRole="alert">
      <View style={{ marginTop: ins.top + 90, width: 220, minHeight: 160, borderRadius: 22, backgroundColor: c.card, alignItems: "center", justifyContent: "center", padding: 18, gap: 8, borderWidth: 4, borderColor: c.bWarn }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: f.bad ? c.danger : c.green, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={f.bad ? "alert" : "checkmark"} size={28} color={c.on} />
        </View>
        <Text style={{ color: c.fg, fontWeight: "700", fontSize: 16, textAlign: "center" }}>{f.title}</Text>
        {f.note ? <Text style={[font.tiny, { color: c.muted, textAlign: "center" }]}>{f.note}</Text> : null}
      </View>
    </Pressable>
  );
}
export const useHosts = () => useContext(HostCtx);
