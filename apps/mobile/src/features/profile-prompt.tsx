import { Button } from "@/ui/button";
import { trackFeature } from "@/lib/feature-track";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { type HostInstance, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { api } from "@/api/client";
import { openAccountCenter } from "@/features/account-link";
import { PushSwitchRow } from "@/features/push-switch";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { SuggestField, useSuggestions } from "@/features/admin/suggest-input";

type FieldView = { value: string; pending: string | null; status: string };
type View_ = {
  legalName: string;
  nickname: string;
  email: string;
  googleEmail?: string;
  enabled: boolean;
  hglobal: boolean;
  hglobalSystems: string[];
  fields: Record<"education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond", FieldView>;
  rankOptions: { value: string; label: string }[];
};
type Key = "legal_name" | "display_name" | "contact_email" | "education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond";

const FIELD_H = 40;
const OTHER = "__other";
const NONE_TERM = "無";
/** 欄位要顯示的內容：有等待審核的新值就顯示新值（使用者剛填的），沒有才顯示目前生效的值。 */
const shown = (f: { value: string; pending: string | null }) => f.pending ?? f.value;
const formVals = (d: View_): Record<Key, string> => ({ legal_name: d.legalName, display_name: d.nickname, contact_email: d.email || d.googleEmail || "", education_system: shown(d.fields.education_system), education_center: shown(d.fields.education_center), rank: shown(d.fields.rank), upline_platinum: shown(d.fields.upline_platinum), upline_diamond: shown(d.fields.upline_diamond) });
const norm = (s: string) => s.trim().toLowerCase();

/** 欄位標籤：必填欄位旁有橘色「必填」小標籤（中央視覺規範）；「變更需再重新審核」一律固定顯示在第二行（業主 2026-11-22）；reserveNote＝同一排其他欄位有第二行時，這欄也留一行空間，下拉框才會對齊。 */
function Label({ text, tag, note, reserveNote }: { text: string; tag?: string; note?: string; reserveNote?: boolean }) {
  const { c } = useTheme();
  return (
    <View>
      <View style={styles.labelRow}>
        <AppText variant="caption" tone="muted" style={{ flexShrink: 1 }}>
          {text}
        </AppText>
        {tag ? (
          <View style={[styles.req, { backgroundColor: c.warningSoft, borderColor: c.warning }]}>
            <Text style={{ color: c.warning, fontSize: 12, fontWeight: "800" }}>{tag}</Text>
          </View>
        ) : null}
      </View>
      {note ? (
        <Text numberOfLines={1} style={{ color: c.warning, fontSize: 12, fontWeight: "800", lineHeight: 16 }}>
          {note}
        </Text>
      ) : reserveNote ? (
        <View style={{ height: 16 }} />
      ) : null}
    </View>
  );
}

/** 必填沒填時，整列用 2px 橘框＋淡橘底標示（中央視覺規範）。 */
function Row({ bad, z, fixed, children }: { bad?: boolean; z?: number; /** 固定外框（透明框＋同樣的內距）：有沒有橘框，欄位位置都不會位移（三欄對齊用，業主 2026-11-23）。 */ fixed?: boolean; children: ReactNode }) {
  const { c } = useTheme();
  const box = { borderWidth: 2, borderRadius: radius.md, padding: 4 };
  return <View style={[{ gap: 2, zIndex: z ?? 1 }, fixed && { ...box, borderColor: "transparent" }, bad && { ...box, borderColor: c.warning, backgroundColor: c.warningSoft }]}>{children}</View>;
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { c } = useTheme();
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.textMuted} autoCapitalize="none" style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />;
}

/** 與中央會員相同的「無」勾選框：只寫一個字「無」，排在輸入框／下拉選單右邊。 */
function NoneBox({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onToggle} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} accessibilityLabel="無" style={[styles.none, { opacity: disabled ? 0.45 : 1 }]}>
      <Icon name={on ? "checkbox" : "square-outline"} size={18} color={on ? c.accentText : c.textMuted} />
      <AppText variant="caption" style={{ fontWeight: "700", fontSize: 13 }}>無</AppText>
    </Pressable>
  );
}

/**
 * 自訂下拉選單（不用系統原生選單）：依螢幕剩餘空間自動往下或往上展開；選項超過 12 個時上方有搜尋框。
 */
function Dropdown({ options, value, label, disabled, onPick, open, onOpenChange, pop, keepWidth }: { pop?: "left" | "center" | "right"; /** 勾了「無」等狀態：欄位寬度鎖在勾選前的寬度（業主 2026-11-23），不隨文字縮短。 */ keepWidth?: boolean; options: { value: string; label: string }[]; value: string; label: string; disabled?: boolean; onPick: (v: string) => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { c } = useTheme();
  const { height: winH, width: winW } = useWindowDimensions();
  const box = useRef<HostInstance>(null);
  const lastW = useRef(0); // 最近一次「正常顯示」時的欄位寬度
    const [pos, setPos] = useState({ up: false, max: 240, left: 0, w: 220 });
  const toggle = () => {
    if (open) return onOpenChange(false);
    box.current?.measureInWindow((x, y, w, h) => {
      const below = winH - (y + h) - 24;
      const above = y - 24;
      const up = below < 240 && above > below;
      // 窄欄（三欄表單）的選項面板：寬度放寬，並以欄位為中心、夾在螢幕左右各 16 之內（不再超出畫面）。
      // 選項面板寬度＝剛好放得下最長的選項（不小於欄位本身），並夾在螢幕左右各 16 之內。
      const est = Math.max(0, ...options.map((o) => [...o.label].reduce((n, ch) => n + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 16 : 9), 0))) + 36;
      const popW = Math.min(winW - 32, Math.max(w, est));
      const left = Math.min(Math.max(x, 16), winW - 16 - popW) - x;
      setPos({ up, max: Math.max(140, Math.min(300, up ? above : below)), left, w: popW });
      onOpenChange(true);
    });
  };
  return (
    <View ref={box} collapsable={false} style={pop ? { alignSelf: "stretch", minWidth: 0, zIndex: open ? 50 : 1 } : { flex: 1, zIndex: open ? 50 : 1 }}>
      <Pressable onLayout={(e) => { if (!keepWidth) lastW.current = Math.round(e.nativeEvent.layout.width); }} onPress={() => !disabled && toggle()} accessibilityRole="button" accessibilityState={{ disabled: !!disabled, expanded: open }} style={[styles.input, { borderColor: c.border, backgroundColor: disabled ? c.surfaceMuted : c.surface, flexDirection: "row", alignItems: "center", gap: pop ? 2 : space.sm, opacity: disabled ? 0.7 : 1 }, pop ? { paddingHorizontal: 8 } : null]}>
        <AppText style={pop ? { flex: 1, minWidth: 0 } : { flex: 1 }} numberOfLines={1} tone={disabled || !value ? "muted" : undefined}>
          {label}
        </AppText>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={pop ? 14 : 20} color={c.textMuted} />
      </Pressable>
      {open ? (
        <View style={[styles.dropdown, pop ? { width: pos.w, left: pos.left, right: "auto" as never } : null, pos.up ? { bottom: FIELD_H + 4 } : { top: FIELD_H + 4 }, { maxHeight: pos.max, borderWidth: 2, borderColor: c.accentText, backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }]}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((o) => (
              <Pressable key={o.value} onPress={() => (onPick(o.value), onOpenChange(false))} accessibilityRole="button" style={[styles.opt, o.value === value && { backgroundColor: c.accentSoft }]}>
                <AppText numberOfLines={1}>{o.label}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** 視窗頂端的按鈕：文字一律單行。儲存＝金黃色（中央視覺規範），儲存中顯示轉圈圈與「儲存中」。 */
/**
 * 「資料需完整 才可瀏覽課程」視窗：蓋在首頁上層，內容壓縮在一個畫面內。
 * 欄位規則依中央會員最新版（串接指令 2026-11-13.9）：
 * 暱稱必填；勾選「我是 Amway 會員」後系統、中心、獎銜必填（可勾「無」）；獎銜永遠可選，不再等系統與中心（中央 2026-11-23.1）；
 * 系統是清單選單＋「其他」自訂；中心在所選系統是寰宇時是清單選單＋「其他」，否則是一般輸入框；
 * 必填沒填時標示橘框，不送出。直接用會員本人的身分寫回會員中心（行動大學不保存）。
 */
/**
 * 完善個人資料表單（兩種模式共用同一份，業主 2026-11-24：欄位改了兩邊自動一起變）。
 * inline＝直接放在頁面裡（至尊模式的模式頁，沒有「關閉」鈕、儲存後不關閉）；預設＝上拉選單。
 */
export function ProfilePrompt({ onClose, initial: first, inline = false }: { onClose: () => void; initial?: View_ | null; inline?: boolean }) {
  const { c } = useTheme();
  const { height: winH, width: winW } = useWindowDimensions();
  const { invalidate, refreshMember } = useSession();
  const [data, setData] = useState<View_ | null>(first ?? null);
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<Key, string>>({ legal_name: "", display_name: "", contact_email: "", education_system: "", education_center: "", rank: "", upline_platinum: "", upline_diamond: "" });
  const [terms, setTerms] = useState<{ education_system: string[]; education_center: string[] }>({ education_system: [], education_center: [] });
  const [otherPick, setOtherPick] = useState<{ education_system?: boolean; education_center?: boolean }>({});
  const [openKey, setOpenKey] = useState<string | null>(null); // 目前展開的下拉選單：展開中的那一列要蓋在所有列的上面
  const [wantAmway, setWantAmway] = useState(false); // 剛勾選「我是 Amway 會員」、還沒儲存
  const [busy, setBusy] = useState(false);
  const [showBad, setShowBad] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: Key) => (v: string) => setVals((s) => ({ ...s, [k]: v }));

  const apply = useCallback((d: View_) => {
    setData(d);
    setVals(formVals(d));
    setOtherPick({});
    setWantAmway(false);
    setError(null);
  }, []);
  const load = useCallback(() => {
    api<View_>("GET", "/me/central-profile")
      .then(apply)
      .catch((e: Error) => setError(e.message));
  }, [apply]);
  useEffect(() => {
    // 開啟時如果首頁已經把資料帶來了，就直接用（不用再等一次網路）；否則才向伺服器要。
    if (first) setVals(formVals(first));
    else load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  // 系統、中心的清單（中央的關聯詞庫，空字串＝整份清單）。
  useEffect(() => {
    if (!data?.enabled && !wantAmway) return;
    for (const pool of ["education_system", "education_center"] as const)
      api<string[]>("GET", `/me/vocab?pool=${pool}&q=`)
        .then((s) => setTerms((t) => ({ ...t, [pool]: s })))
        .catch(() => undefined);
  }, [data?.enabled, wantAmway]);

  const amway = !!data?.enabled || wantAmway;
  // 上手白金／上手鑽石（業主 2026-11-23）：自由輸入＋中央關聯詞（輸入時列出建議、點選填入）；兩欄的建議清單放在兩欄下方整列。
  const [uplineFocus, setUplineFocus] = useState<"upline_platinum" | "upline_diamond" | null>(null);
  // 上手白金的關聯詞同時來自上手鑽石的詞庫（業主 2026-11-23）：兩個詞庫合併、去重。
  const platOwn = useSuggestions(vals.upline_platinum, "upline_platinum", amway && uplineFocus === "upline_platinum");
  const platFromDiamond = useSuggestions(vals.upline_platinum, "upline_diamond", amway && uplineFocus === "upline_platinum");
  const diamSug = useSuggestions(vals.upline_diamond, "upline_diamond", amway && uplineFocus === "upline_diamond");
  const platSug = [...new Set([...platOwn, ...platFromDiamond])].slice(0, 50);
  // 關聯詞選單：各自顯示在自己欄位的正上方、同寬；網頁版用 portal 掛到最上層，不被上拉視窗的邊緣遮住（業主 2026-11-23）。
  const platBox = useRef<HostInstance>(null);
  const diamBox = useRef<HostInstance>(null);
  const [popRect, setPopRect] = useState<{ x: number; y: number; w: number } | null>(null);
  const upList = uplineFocus === "upline_platinum" ? platSug : uplineFocus === "upline_diamond" ? diamSug : [];
  useEffect(() => {
    if (!uplineFocus) return setPopRect(null);
    const measure = () => (uplineFocus === "upline_platinum" ? platBox : diamBox).current?.measureInWindow((x, y, w) => setPopRect({ x, y, w }));
    measure();
    const t = setTimeout(measure, 350); // 鍵盤升起、面板捲動之後再量一次
    return () => clearTimeout(t);
  }, [uplineFocus, upList.length]);
  // Email 還空著時自動帶入 Google 登入信箱（業主 2026-11-23）：「原本的值」仍是空的，所以按儲存會一併寫回會員中心。
  const initial = data ? { ...formVals(data), contact_email: data.email } : null;
  const changed = initial ? (Object.keys(vals) as Key[]).filter((k) => (amway || k === "legal_name" || k === "display_name") && vals[k].trim() !== initial[k].trim()) : [];
  const rankNone = vals.rank === "none";
  const rankLabel = (v: string) => data?.rankOptions.find((o) => o.value === v)?.label ?? v;
  /** 選的系統是不是寰宇：只有寰宇才能選「中心」（業主 2026-11-22）；其他系統、「無」、還沒選，中心都不能選。 */
  const sysVal = vals.education_system.trim();
  const systemHg = !!data && !!sysVal && sysVal !== NONE_TERM && data.hglobalSystems.some((t) => norm(t) === norm(sysVal));
  /** 換系統時中心跟著連動：非寰宇的系統（含「無」）中心自動填「無」（中央規定三欄必填）；回到寰宇就清空讓會員自己選。 */
  const setSystem = (v: string) =>
    setVals((st) => {
      const t = v.trim();
      const hg = !!data && !!t && t !== NONE_TERM && data.hglobalSystems.some((h) => norm(h) === norm(t));
      const center = hg ? (st.education_center.trim() === NONE_TERM ? "" : st.education_center) : t ? NONE_TERM : "";
      return { ...st, education_system: v, education_center: center };
    });
  const missing: Key[] = data ? ([!vals.legal_name.trim() && "legal_name", amway && !vals.upline_platinum.trim() && "upline_platinum", amway && !vals.upline_diamond.trim() && "upline_diamond", amway && !vals.education_system.trim() && "education_system", amway && systemHg && !vals.education_center.trim() && "education_center", amway && !vals.rank.trim() && "rank"].filter(Boolean) as Key[]) : [];

  /** 三欄窄版用的短標籤：審核通過→通過、審核中...→審核中。 */
  const shortTag = (t: string | undefined) => (t === "審核通過" ? "通過" : t === "審核中..." ? "審核中" : t);

  /** 標籤：沒填 → 「必填」；填了就隱藏；中心、獎銜（沒被改動時）等待審核 → 「審核中...」、已通過審核 → 「審核通過」（外觀都同必填）。 */
  const tagFor = (key: "education_system" | "education_center" | "rank" | "display_name" | "legal_name", reviewed = false): string | undefined => {
    const v = vals[key];
    // 「必填」標籤依目前的選擇動態顯示（業主 2026-11-23）：中心只有系統是寰宇才需要填（非寰宇自動「無」、還沒選系統時還不能選），其他情況不顯示。
    if (key === "education_center" && !systemHg) return undefined;
    if (!v.trim()) return undefined; // 不再顯示「必填」膠囊（業主 2026-11-23）：全部欄位都必填，未填按儲存會擋下並標橘框
    if (reviewed && data && key !== "display_name" && key !== "legal_name") {
      const f = data.fields[key];
      if (initial && v === initial[key]) {
        if (f.pending !== null || f.status === "pending") return "審核中..."; // 一切以中央回傳的 status 為準（2026-11-24.2：獎銜一律審核、寰宇時中心也審核）
        if (f.status === "approved") return "審核通過";
      }
    }
    return undefined;
  };

  /** 已通過審核的中心、獎銜被改動時，提醒「變更需再重新審核」（單純文字，不加外框，顏色同標籤文字）。 */
  const noteFor = (key: "education_center" | "rank"): string | undefined => {
    const v = vals[key];
    if (!data || !initial || !v.trim() || v === initial[key]) return undefined;
    const f = data.fields[key];
    return f.status === "approved" && f.pending === null ? "變更需再重新審核" : undefined;
  };

  const save = async () => {
    if (missing.length) {
      setShowBad(true);
      setMsg({ ok: false, text: "還有標示「必填」的欄位沒填" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // 所有改過的欄位一次送出（伺服器同時寫給會員中心），並把最新狀態一起帶回來。
      const r = await api<{ ok: boolean; errors: string[]; pending: boolean; form: View_ | null }>("PUT", "/me/central-profile", { changes: changed.map((key) => ({ key, value: vals[key] })), ...(wantAmway && !data?.enabled ? { enableAmway: true } : {}) });
      if (r.form) apply(r.form);
      else load();
      if (!r.errors.length) trackFeature("profile_edit");
      setShowBad(false);
      setMsg(r.errors.length ? { ok: false, text: r.errors[0] } : { ok: true, text: r.pending ? "已儲存，部分欄位等待審核" : "已儲存到會員中心" });
      invalidate();
      // 儲存成功後立刻重新取一次會員資料（業主 2026-11-23 回報本名按儲存後再進來又變空白）：
      // 首頁／設定頁保存的是開啟 App 時帶來的舊資料（含 profileForm、profileMissing），不更新的話再開面板會看到舊值，還會再次誤判「資料不全」而彈出。
      if (!r.errors.length) await refreshMember(0).catch(() => undefined);
      if (!r.errors.length && !inline) onClose(); // 儲存成功就自動關閉視窗（業主 2026-11-19）；放在頁面裡的不關閉
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // 系統選「其他」時中心欄被隱藏，它的「變更需再重新審核」也不算（不然其他欄會多留一行空白）。
  const sysNone = vals.education_system.trim() === NONE_TERM;
  const sysIsOther = !sysNone && (otherPick.education_system ?? (!!sysVal && !terms.education_system.includes(vals.education_system)));
  const anyNote = !!((!sysIsOther && noteFor("education_center")) || noteFor("rank"));
  /** 三欄的外框：寬度剛好符合內容（業主 2026-11-22）；展開中的那一欄要蓋在其他欄與所有列上面。 */
  const colBox = (key: string, children: ReactNode) => (
    <View key={key} style={{ flex: 1, flexBasis: 0, minWidth: 0, zIndex: openKey === key ? 100 : 1 }}>
      {children}
    </View>
  );
  /** 系統／中心：清單選單＋「其他」自訂輸入＋下方的「無」勾選框（三欄緊湊表單的一欄）。 */
  const listedCol = (key: "education_system" | "education_center", label: string, pop: "left" | "center" | "right") => {
    const v = vals[key];
    const none = v.trim() === NONE_TERM;
    const isCenter = key === "education_center";
    const blocked = isCenter && !systemHg; // 中心只有系統是寰宇才能選
    const list = terms[key];
    const other = !blocked && !none && (otherPick[key] ?? (!!v.trim() && !list.includes(v)));
    const sel = none ? "" : other ? OTHER : v;
    const options = [{ value: "", label: "（未選擇）" }, ...list.map((t) => ({ value: t, label: t })), { value: OTHER, label: "其他" }];
    const onPick = (p: string) => {
      const val = p === OTHER ? "" : p;
      setOtherPick((st) => ({ ...st, [key]: p === OTHER }));
      if (isCenter) set(key)(val);
      else setSystem(val);
    };
    const toggleNone = () => {
      setOtherPick((st) => ({ ...st, [key]: false }));
      if (isCenter) set(key)(none ? "" : NONE_TERM);
      else setSystem(none ? "" : NONE_TERM);
    };
    return {
      other,
      node: colBox(
        key,
        <Row fixed z={openKey === key ? 100 : 1} bad={showBad && missing.includes(key)}>
          <Label text={label} tag={shortTag(tagFor(key, isCenter))} note={isCenter ? noteFor("education_center") : undefined} reserveNote={anyNote} />
          <Dropdown
            pop={pop}
            keepWidth={blocked || none}
            options={options}
            value={sel}
            label={blocked ? (sysVal && sysVal !== "" ? "無" : "先選系統") : none ? "無" : other ? "其他" : v || "（未選擇）"}
            disabled={blocked || none}
            open={openKey === key}
            onOpenChange={(o) => setOpenKey(o ? key : null)}
            onPick={onPick}
          />
          <NoneBox on={blocked ? !!sysVal : none} disabled={blocked} onToggle={toggleNone} />
        </Row>,
      ),
    };
  };
  const sysCol = listedCol("education_system", "系統", "center");
  const cenCol = listedCol("education_center", "中心", "right");

  const popup =
    uplineFocus && upList.length && popRect ? (
      <View
        pointerEvents="auto"
        style={[styles.dropdown, { position: Platform.OS === "web" ? ("fixed" as never) : "absolute", left: popRect.x, width: popRect.w, right: "auto" as never, bottom: Platform.OS === "web" ? Math.round(window.innerHeight - popRect.y + 4) : Math.round(winH - popRect.y + 4), maxHeight: Math.min(220, Math.max(88, popRect.y - 12)), zIndex: 30000, borderWidth: 2, borderColor: c.accentText, backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 20 }]}
      >
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {upList.map((x) => (
            <Pressable key={x} onPress={() => (set(uplineFocus)(x), setUplineFocus(null))} accessibilityRole="button" accessibilityLabel={`選用 ${x}`} style={styles.opt}>
              <AppText numberOfLines={1}>{x}</AppText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    ) : null;

  return (
    // 上拉選單（業主 2026-11-18：取消置中彈窗）：統一用 BottomSheet，可下滑收起；欄位可捲動，儲存／關閉固定在最下面一列。
    <Wrap inline={inline} onClose={onClose}>
      <Body inline={inline} maxH={Math.round(winH * (winH >= winW ? 0.86 : 0.5))}>
          <Pressable onPress={openAccountCenter} accessibilityRole="link" style={styles.more}>
            <Icon name="open-outline" size={20} color={c.accentText} />
            <Text numberOfLines={1} style={{ color: c.accentText, fontSize: 17, fontWeight: "700", flexShrink: 1 }}>
              前往完整版會員中心
            </Text>
          </Pressable>
          {msg ? (
            <AppText variant="caption" tone={msg.ok ? "success" : "danger"} numberOfLines={2}>
              {msg.text}
            </AppText>
          ) : null}
          {error ? (
            <AppText variant="caption" tone="danger" numberOfLines={2}>
              {error}
            </AppText>
          ) : null}
          {!data && !error ? <AppText tone="muted">讀取中…</AppText> : null}
          {data ? (
            <>
              {/* 本名（四個中文字寬）＋縮小的手機推播（業主 2026-11-23：暱稱欄位刪除，推播改放這裡）。 */}
              <View style={[styles.line, { alignItems: "flex-end" }]}>
                <View style={{ width: 128 }}>
                  <Row bad={showBad && missing.includes("legal_name")}>
                    <Label text="本名" />
                    <Input value={vals.legal_name} onChange={set("legal_name")} />
                  </Row>
                </View>
                <View style={{ flex: 1, minWidth: 0, }}>
                  <PushSwitchRow banner compact />
                </View>
              </View>
              {/* 「我是 Amway 會員」（業主 2026-11-19）：直接在這裡勾選，勾了馬上出現系統、中心、獎銜三欄（業主 2026-11-22 方案 B：三欄緊湊表單）；已勾選後要取消請到會員中心（取消會換掉會員編號）。 */}
              <View style={[styles.amwayCard, { backgroundColor: c.surfaceMuted }]}>
                {/* 勾選之後這一列自動隱藏（業主 2026-11-23）：只剩三欄。 */}
                {!amway ? (
                  <Pressable onPress={() => !data.enabled && setWantAmway((v) => !v)} disabled={data.enabled} accessibilityRole="checkbox" accessibilityState={{ checked: amway, disabled: data.enabled }} style={[styles.none, { minHeight: 32 }]}>
                    <Icon name={amway ? "checkbox" : "square-outline"} size={26} color={amway ? c.accentText : c.textMuted} />
                    <AppText style={{ fontWeight: "800" }}>我是 Amway 會員</AppText>
                  </Pressable>
                ) : null}
                {amway ? (
                  <>
                    {/* 上手白金｜上手鑽石（必填）：兩欄並排，輸入時下方列出中央會員的關聯詞可點選。 */}
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", zIndex: uplineFocus ? 100 : 1 }}>
                      {(["upline_platinum", "upline_diamond"] as const).map((k) => (
                        <View key={k} ref={k === "upline_platinum" ? platBox : diamBox} collapsable={false} style={{ flex: 1, minWidth: 0 }}>
                         <Row fixed bad={showBad && missing.includes(k)}>
                          <Label text={k === "upline_platinum" ? "上手白金" : "上手鑽石"} />
                          <SuggestField value={vals[k]} onChange={set(k)} onFocusChange={(f) => setUplineFocus((cur) => (f ? k : cur === k ? null : cur))} accessibilityLabel={k === "upline_platinum" ? "上手白金" : "上手鑽石"} />
                         </Row>
                        </View>
                      ))}
                    </View>
                    {/* 順序：獎銜 > 系統 > 中心（業主 2026-11-22）。獎銜一律可選；中心只有系統是寰宇才能選。 */}
                    <View style={{ flexDirection: "row", gap: 8, zIndex: 30, alignItems: "flex-start" }}>
                      {colBox(
                        "rank",
                        <Row fixed z={openKey === "rank" ? 100 : 1} bad={showBad && missing.includes("rank")}>
                          <Label text="獎銜" tag={shortTag(tagFor("rank", true))} note={noteFor("rank")} reserveNote={anyNote} />
                          <Dropdown
                            pop="left"
                            keepWidth={rankNone}
                            options={data.rankOptions.filter((o) => o.value !== "none").map((o) => ({ value: o.value, label: o.label }))}
                            value={rankNone ? "" : vals.rank}
                            label={rankNone ? "無" : vals.rank ? rankLabel(vals.rank) : "請選擇"}
                            disabled={rankNone}
                            open={openKey === "rank"}
                            onOpenChange={(o) => setOpenKey(o ? "rank" : null)}
                            onPick={set("rank")}
                          />
                          <NoneBox on={rankNone} onToggle={() => set("rank")(rankNone ? "" : "none")} />
                        </Row>,
                      )}
                      {sysCol.node}
                      {sysCol.other ? (
                        // 系統選「其他」：隱藏中心欄，原位置改成自訂系統的輸入欄（業主 2026-11-23）。
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Row fixed bad={showBad && missing.includes("education_system")}>
                            <Label text="自訂系統" tag={shortTag(tagFor("education_system"))} reserveNote={anyNote} />
                            <Input value={vals.education_system} onChange={setSystem} placeholder="請輸入系統名稱" />
                          </Row>
                        </View>
                      ) : (
                        cenCol.node
                      )}
                    </View>
                    {!sysCol.other && cenCol.other ? <Input value={vals.education_center} onChange={set("education_center")} placeholder="中心：請輸入自訂內容" /> : null}
                  </>
                ) : null}
              </View>
            </>
          ) : null}
      </Body>
      <View style={styles.actions}>
        {inline ? null : (
          <View style={{ flex: 1 }}>
            <Button variant="cancel" label="關閉" icon="close" onPress={onClose} fullWidth />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button label="儲存" icon="save-outline" onPress={save} disabled={busy || (!changed.length && !(wantAmway && !data?.enabled))} loading={busy} fullWidth />
        </View>
      </View>
    {popup && Platform.OS === "web" ? createPortal(popup, document.body) : popup}
    </Wrap>
  );
}

/** 外框：上拉選單，或放在頁面裡的卡片。 */
function Wrap({ inline, onClose, children }: { inline: boolean; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  return inline ? <View style={[styles.inlineCard, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View> : <BottomSheet onClose={onClose}>{children}</BottomSheet>;
}

/** 欄位區：上拉選單裡可捲動；放在頁面裡就跟著頁面捲。 */
function Body({ inline, maxH, children }: { inline: boolean; maxH: number; children: ReactNode }) {
  return inline ? (
    <View style={styles.sheetBody}>{children}</View>
  ) : (
    <ScrollView style={{ maxHeight: maxH }} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheetBody: { gap: space.xs, paddingBottom: space.xs },
  inlineCard: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.md },
  actions: { flexDirection: "row", gap: space.sm, width: "100%" },
  btn: { minHeight: 44, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space.sm },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 24 },
  req: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  input: { minHeight: FIELD_H, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  none: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 28, minWidth: 48 },
  dropdown: { position: "absolute", left: 0, right: 0, borderWidth: 1, borderRadius: radius.md, zIndex: 60, overflow: "hidden" },
  search: { minHeight: 40, borderBottomWidth: 1, paddingHorizontal: space.md, fontSize: 15 },
  opt: { minHeight: 44, paddingHorizontal: space.md, justifyContent: "center" },
  amwayCard: { borderRadius: radius.md, padding: space.sm, gap: space.xs, zIndex: 5 },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
});
