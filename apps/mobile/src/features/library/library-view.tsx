import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type LibraryItem, type LibraryUnlock, type LibraryView } from "@/api/client";
import { TYPE_INFO } from "@/features/link-types";
import { eventDays } from "@/features/format";
import { LIB, useLibraryChrome } from "@/lib/library-mode";
import { useLayout } from "@/theme/layout";
import { LoadingView } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { BottomSheet } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";

/**
 * 「我的書櫃」公開檢視（杜杜龍 2026-11-17，版面＝方案 1 木質書架）：網址 /會員編號，不出現在行動大學任何清單與搜尋。
 * 深色木質底、黃銅名牌、每個書架（分類標題，點一下收合）上一排書脊；整座書櫃或單獨一本書都可以有密碼（可設幾天後失效）。
 * 這一頁自成一套配色，故意跟行動大學標準頁面不同；不計學習進度。
 */
export { LIB };
const SPINES = ["#7A1F26", "#1F5A44", "#1F3A6B", "#7A5330", "#5A2A6B", "#8A6D1F", "#2F6F6A", "#9A3B2B", "#3C4F8C", "#5F6F2A"];
const spineColor = (id: string) => SPINES[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % SPINES.length]!;
const KEY = (n: string) => `hglobal:learn:lib-tokens:${n}`;
export type Tokens = { lib?: string; items?: Record<string, string> };

export function openBook(b: LibraryItem) {
  if (!b.url) return;
  let u = b.url;
  if (b.type === "youtube" && b.start) u += `${u.includes("?") ? "&" : "?"}t=${b.start}s`;
  if (Platform.OS === "web" && typeof window !== "undefined") window.open(u, "_blank", "noopener");
  else void Linking.openURL(u).catch(() => flashText("無法開啟連結"));
}

export function LibraryScreen({ number }: { number: string }) {
  useLibraryChrome();
  useEffect(() => {
    // 自己的書櫃從設定進來時（網址是 /library），網址列換成專屬網址 /會員編號。
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname !== `/${number}`) window.history.replaceState(window.history.state, "", `/${number}`);
  }, [number]);
  const [view, setView] = useState<LibraryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Tokens>({});
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(
    async (t: Tokens) => {
      try {
        setView(await api<LibraryView>("POST", `/library/view/${number}`, { tokens: t }));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [number],
  );
  useEffect(() => {
    AsyncStorage.getItem(KEY(number))
      .then((v) => (v ? (JSON.parse(v) as Tokens) : {}))
      .catch(() => ({}) as Tokens)
      .then((t) => {
        setTokens(t);
        setLoaded(true);
        void load(t);
      });
  }, [number, load]);
  const saveTokens = (t: Tokens) => {
    setTokens(t);
    AsyncStorage.setItem(KEY(number), JSON.stringify(t)).catch(() => undefined);
    void load(t);
  };
  if (!loaded || (!view && !error)) return <LoadingView />;
  if (error && !view)
    return (
      <Page>
        <Text style={styles.empty}>🔒 找不到這個書櫃</Text>
      </Page>
    );
  if (!view) return null;
  if (view.locked) return <LockedLibrary view={view} number={number} onUnlocked={(tk) => saveTokens({ ...tokens, lib: tk })} />;
  return <Shelves view={view} number={number} tokens={tokens} onTokens={saveTokens} />;
}

function Page({ children, gear }: { children: React.ReactNode; gear?: () => void }) {
  // 書櫃自成一套深色木質版面，不用行動大學的標準上方工具列；自己放一個返回鍵（沒有上一頁就回首頁）。
  // 大螢幕（杜杜龍 2026-11-18）：書架放寬，一排看得到更多書。
  const lay = useLayout();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: LIB.bg }} contentContainerStyle={[styles.page, lay.large ? { maxWidth: lay.wideMax, paddingHorizontal: lay.gutter } : null]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: Platform.OS === "web" ? 0 : 20 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={10} style={{ width: 44, height: 44, justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={28} color={LIB.brass} />
        </Pressable>
        {gear ? (
          <Pressable accessibilityRole="button" accessibilityLabel="書櫃設定" onPress={gear} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="settings-outline" size={26} color={LIB.brass} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}

function Plaque({ title, owner }: { title: string; owner?: string }) {
  return (
    <View style={styles.plaque}>
      <View style={styles.screw} />
      <Text style={styles.plaqueTitle}>{title}</Text>
      <Text style={styles.plaqueSub}>EX LIBRIS</Text>
      <View style={[styles.screw, { right: 12, left: undefined }]} />
      {owner ? <Text style={[styles.plaqueSub, { letterSpacing: 0, fontSize: 12 }]}>{owner}</Text> : null}
    </View>
  );
}

function PasswordBox({ onSubmit, busy, error }: { onSubmit: (pw: string) => void; busy: boolean; error: string | null }) {
  const [pw, setPw] = useState("");
  return (
    <View style={{ gap: 10 }}>
      <TextInput value={pw} onChangeText={setPw} placeholder="輸入密碼" placeholderTextColor={LIB.muted} secureTextEntry autoCapitalize="none" accessibilityLabel="密碼" style={styles.input} onSubmitEditing={() => onSubmit(pw)} />
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy || !pw} onPress={() => onSubmit(pw)} style={({ pressed }) => [styles.brassBtn, (busy || !pw) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
        <Text style={styles.brassBtnText}>{busy ? "確認中…" : "開啟"}</Text>
      </Pressable>
    </View>
  );
}

function LockedLibrary({ view, number, onUnlocked }: { view: LibraryView; number: string; onUnlocked: (token: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      onUnlocked((await api<LibraryUnlock>("POST", `/library/view/${number}/unlock`, { password })).token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Plaque title={view.title} />
      <View style={styles.lockCard}>
        <Ionicons name="lock-closed" size={36} color={LIB.brass} />
        <Text style={styles.lockText}>{view.lockExpired ? "這座書櫃的密碼已經失效，請向書櫃主人索取新的密碼。" : "這座書櫃需要密碼才能進入"}</Text>
        {view.lockExpired ? null : <PasswordBox onSubmit={go} busy={busy} error={error} />}
      </View>
    </Page>
  );
}

export function Shelves({ view, number, tokens, onTokens, onGear, emptyText = "書架還是空的" }: { view: LibraryView; number: string; tokens: Tokens; onTokens: (t: Tokens) => void; onGear?: () => void; emptyText?: string }) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<LibraryItem | null>(null);
  // 書架（分類標題）與底下的書：第一個書架之前的書放在「散放的書」。
  const groups: { shelf: LibraryItem | null; books: LibraryItem[] }[] = [];
  for (const it of view.items) {
    if (it.kind === "shelf") groups.push({ shelf: it, books: [] });
    else {
      if (!groups.length) groups.push({ shelf: null, books: [] });
      groups[groups.length - 1]!.books.push(it);
    }
  }
  const total = view.items.filter((i) => i.kind === "book").length;
  return (
    <Page gear={view.owner ? () => router.push("/library-settings") : onGear}>
      <Plaque title={view.title} owner={view.ownerName} />
      <View style={styles.stats}>
        <Text style={styles.statN}>{total}</Text>
        <Text style={styles.statL}>館藏</Text>
        <Text style={styles.statN}>{groups.filter((g) => g.shelf).length}</Text>
        <Text style={styles.statL}>書架</Text>
      </View>
      {!groups.length ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {groups.map((g, gi) => {
        const id = g.shelf?.id ?? `loose-${gi}`;
        const open = !folded.has(id);
        return (
          <View key={id} style={{ gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setFolded((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; })} style={styles.shelfHead}>
              <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={18} color={LIB.brass} />
              <Text style={styles.shelfTitle}>{g.shelf?.title ?? "散放的書"}</Text>
              <Text style={styles.shelfCount}>{g.books.length} 冊</Text>
            </Pressable>
            {open ? (
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {g.books.length ? g.books.map((b) => <Spine key={b.id} b={b} onPress={() => setSheet(b)} />) : <Text style={[styles.empty, { paddingHorizontal: 8 }]}>（這個書架還沒有書）</Text>}
                </ScrollView>
                <View style={styles.plank} />
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={styles.note}>
        <Text style={styles.noteText}>🔒 這是私人書櫃：不會出現在行動大學的任何清單，只有拿到專屬網址的人才看得到。</Text>
      </View>
      {sheet ? <BookSheet number={number} b={view.items.find((x) => x.id === sheet.id) ?? sheet} tokens={tokens} onTokens={onTokens} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function Spine({ b, onPress }: { b: LibraryItem; onPress: () => void }) {
  const chars = [...b.title].slice(0, 9);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${b.title}${b.locked ? "（有密碼）" : ""}`} onPress={onPress} style={({ pressed }) => [styles.spine, { backgroundColor: spineColor(b.id) }, pressed && { transform: [{ translateY: -4 }] }]}>
      <View style={styles.band} />
      <View style={{ height: 26, alignItems: "center", justifyContent: "center" }}>
        {b.locked ? <Ionicons name="lock-closed" size={16} color={LIB.brass} /> : b.type ? <BrandIcon type={b.type} fallback={TYPE_INFO[b.type].icon as never} size={18} /> : null}
      </View>
      <Text style={styles.spineText}>{chars.join("\n")}{[...b.title].length > 9 ? "\n…" : ""}</Text>
      <View style={[styles.band, { marginTop: "auto" }]} />
    </Pressable>
  );
}

function BookSheet({ number, b, tokens, onTokens, onClose }: { number: string; b: LibraryItem; tokens: Tokens; onTokens: (t: Tokens) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<LibraryUnlock>("POST", `/library/view/${number}/unlock`, { password, itemId: b.id });
      onTokens({ ...tokens, items: { ...(tokens.items ?? {}), [b.id]: r.token } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {b.type ? <BrandIcon type={b.type} fallback={TYPE_INFO[b.type].icon as never} size={36} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>{b.title}</Text>
            <Text style={styles.sheetSub}>{[b.type ? TYPE_INFO[b.type].label : "", b.eventDate ? eventDays(b.eventDate, null) : ""].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>
        {b.locked ? (
          <>
            <Text style={styles.sheetSub}>這本書有密碼，輸入後才能開啟。</Text>
            <PasswordBox onSubmit={unlock} busy={busy} error={error} />
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => openBook(b)} style={({ pressed }) => [styles.brassBtn, pressed && { opacity: 0.8 }]}>
            <Text style={styles.brassBtnText}>開啟這本書</Text>
          </Pressable>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 90, maxWidth: 720, width: "100%", alignSelf: "center" },
  plaque: { backgroundColor: LIB.brass, borderRadius: 10, paddingVertical: 22, paddingHorizontal: 28, alignItems: "center", gap: 4, borderBottomWidth: 4, borderBottomColor: LIB.brassDark },
  screw: { position: "absolute", left: 12, top: "45%", width: 9, height: 9, borderRadius: 5, backgroundColor: LIB.brassDark },
  plaqueTitle: { color: "#3A2410", fontSize: 24, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  plaqueSub: { color: "#5A3E1A", fontSize: 11, letterSpacing: 4, fontWeight: "700" },
  stats: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 6 },
  statN: { color: LIB.text, fontSize: 22, fontWeight: "800", marginLeft: 10 },
  statL: { color: LIB.muted, fontSize: 13 },
  shelfHead: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  shelfTitle: { flex: 1, color: LIB.text, fontSize: 18, fontWeight: "800" },
  shelfCount: { color: LIB.muted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 4, minHeight: 190 },
  spine: { width: 62, height: 180, borderRadius: 4, paddingVertical: 6, alignItems: "center", overflow: "hidden", borderLeftWidth: 3, borderLeftColor: "rgba(255,255,255,0.18)" },
  band: { width: "76%", height: 3, backgroundColor: LIB.brass, opacity: 0.85 },
  spineText: { color: LIB.brass, fontSize: 15, fontWeight: "800", lineHeight: 19, textAlign: "center", marginTop: 4 },
  plank: { height: 14, borderRadius: 3, backgroundColor: LIB.wood, borderBottomWidth: 4, borderBottomColor: LIB.woodDark, marginTop: -2 },
  note: { borderWidth: 1, borderStyle: "dashed", borderColor: LIB.wood, borderRadius: 12, padding: 14 },
  noteText: { color: LIB.muted, fontSize: 13, lineHeight: 20 },
  empty: { color: LIB.muted, textAlign: "center", fontSize: 15, paddingVertical: 24 },
  lockCard: { backgroundColor: LIB.card, borderRadius: 14, padding: 22, alignItems: "center", gap: 14, marginTop: 10 },
  lockText: { color: LIB.text, fontSize: 16, textAlign: "center", lineHeight: 24 },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: LIB.wood, backgroundColor: LIB.bg, color: LIB.text, paddingHorizontal: 14, fontSize: 16, minWidth: 240 },
  err: { color: "#FF9A8A", fontSize: 14 },
  brassBtn: { minHeight: 48, borderRadius: 12, backgroundColor: LIB.brass, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  brassBtnText: { color: "#3A2410", fontSize: 16, fontWeight: "900" },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#1D2A22" },
  sheetSub: { fontSize: 13, color: "#5E6B63" },
});
