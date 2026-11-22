import Ionicons from "@expo/vector-icons/Ionicons";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { trackFeature } from "@/lib/feature-track";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import { ListIcon } from "@/ui/list-icon";
import { bumpMark, useMark, type ListRef } from "./store";

export type OwnList = { id: string; title: string; slug: string; clicks: number; people: number; count: number; url: string; coverItemId: string | null; coverUrl: string | null; coverMode: "item" | "text"; coverBgUrl: string | null; coverText?: string | null; coverColor?: string | null; has?: boolean };
export type Quota = { base: number; total: number; used: number; unlocks: { achievementId: string; name: string; extra: number; earned: boolean; description: string; type: string; threshold: number; feature: string | null }[] };
type Resp = { lists: OwnList[]; quota: Quota; id?: string };

/** 清單額度用完時，提示要完成哪個學習成就才能多解鎖（取第一個還沒完成的）。 */
export function quotaHint(q: Quota): string {
  const next = q.unlocks.find((u) => !u.earned);
  return next ? `完成「${next.name}」成就，可多建立 ${next.extra} 份清單` : "清單數量已用完";
}

/** 沒登入就先帶去登入，登入後回到原頁。 */
function useRequireLogin() {
  const { member } = useSession();
  const path = usePathname();
  return () => {
    if (member) return true;
    const back = Platform.OS === "web" && typeof window !== "undefined" ? window.location.pathname + window.location.search : path;
    router.push({ pathname: "/me", params: { next: back } });
    return false;
  };
}

/**
 * 上方工具列的「加入我的清單」圖示（業主 2026-11-21 方案 2）：放在邀請、分享旁；已加入時變黃色並顯示加入了幾份清單。
 * 內頁（課程卡、教材卡、系列卡、中心卡）的上方工具列都放它（用 PageHeader 的 addToList 會自動有）。
 */
export function HeaderAddToList({ target, title }: { target: ListRef; title: string }) {
  const { c } = useTheme();
  const n = useMark(target);
  const [open, setOpen] = useState(false);
  const login = useRequireLogin();
  const on = n > 0;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? `已加入 ${n} 份清單，點一下調整` : "加入我的清單"}
        onPress={() => login() && setOpen(true)}
        hitSlop={6}
        style={[styles.headBtn, on && { backgroundColor: "#FFD43B" }]}
      >
        <ListIcon size={22} color={c.accent} added={on} />
        <AppText style={{ color: c.accent, fontSize: 17, fontWeight: "600" }}>清單</AppText>
        {on ? (
          <View style={[styles.badge, { backgroundColor: c.accent }]}>
            <AppText variant="caption" style={{ color: "#fff", fontWeight: "800", fontSize: 11, lineHeight: 14 }}>
              {n}
            </AppText>
          </View>
        ) : null}
      </Pressable>
      {open ? <AddToListSheet target={target} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 教材列右側的圓形「加入清單」鈕（業主 2026-11-21 配方案 1：和分享鈕並排，已加入變黃色）。 */
export function RowAddToList({ target, title }: { target: ListRef; title: string }) {
  const { c } = useTheme();
  const n = useMark(target);
  const [open, setOpen] = useState(false);
  const login = useRequireLogin();
  const on = n > 0;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? `已加入 ${n} 份清單：${title}` : `加入我的清單：${title}`}
        onPress={() => login() && setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }}
        style={({ pressed }) => [styles.rowBtn, pressed && { opacity: 0.6 }]}
      >
        <ListIcon size={22} color={c.accent} added={on} />
      </Pressable>
      {open ? <AddToListSheet target={target} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 選要加入哪些清單（可複選，勾選／取消立刻生效），也可以直接新增清單並加入。 */
export function AddToListSheet({ target, title, onClose }: { target: ListRef; title: string; onClose: () => void }) {
  const { c } = useTheme();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const qs = `kind=${target.kind}&ref=${encodeURIComponent(target.ref)}`;
  useEffect(() => {
    let alive = true;
    api<Resp>("GET", `/my-lists?${qs}`)
      .then((r) => alive && setData(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [qs]);

  const toggle = async (l: OwnList) => {
    if (busy) return;
    const on = !l.has;
    setBusy(l.id);
    setData((d) => d && { ...d, lists: d.lists.map((x) => (x.id === l.id ? { ...x, has: on, count: x.count + (on ? 1 : -1) } : x)) });
    try {
      await api("PUT", `/my-lists/${l.id}/item`, { kind: target.kind, ref: target.ref, ref2: target.ref2 ?? "", on });
      bumpMark(target, on ? 1 : -1);
      if (on) trackFeature("list_add");
      flashText(on ? `已加入「${l.title}」` : `已從「${l.title}」移除`);
    } catch (e) {
      setData((d) => d && { ...d, lists: d.lists.map((x) => (x.id === l.id ? { ...x, has: !on, count: x.count + (on ? -1 : 1) } : x)) });
      flashText(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    const t = name.trim();
    if (!t || busy) return;
    setBusy("new");
    try {
      const r = await api<Resp>("POST", "/my-lists", { title: t, kind: target.kind, ref: target.ref, ref2: target.ref2 ?? "" });
      setData(r);
      bumpMark(target, 1);
      trackFeature("list_create");
      trackFeature("list_add");
      setName("");
      setCreating(false);
      flashText(`已建立「${t}」並加入`);
    } catch (e) {
      flashText(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(null);
    }
  };

  const full = data ? data.quota.used >= data.quota.total : false;
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ gap: space.sm, paddingBottom: space.sm }}>
        <View style={{ gap: 2 }}>
          <AppText variant="headline">加入我的清單</AppText>
          <AppText variant="callout" tone="muted" numberOfLines={2}>
            {title}
          </AppText>
        </View>
        {error ? (
          <AppText variant="callout" style={{ color: c.danger }}>
            {error}
          </AppText>
        ) : !data ? (
          <AppText variant="callout" tone="muted">
            讀取中…
          </AppText>
        ) : (
          <SheetScroll>
            {data.lists.map((l) => (
              <Pressable key={l.id} accessibilityRole="checkbox" accessibilityState={{ checked: !!l.has }} accessibilityLabel={l.title} onPress={() => void toggle(l)} style={[styles.row, { borderTopColor: c.border }]}>
                <Ionicons name={l.has ? "checkbox" : "square-outline"} size={28} color={l.has ? c.accent : c.textMuted} />
                <View style={{ flex: 1 }}>
                  <AppText variant="body" style={{ fontWeight: "700" }} numberOfLines={1}>
                    {l.title}
                  </AppText>
                  <AppText variant="callout" tone="muted">
                    {l.count} 項
                  </AppText>
                </View>
              </Pressable>
            ))}
            {creating && !full ? (
              <View style={[styles.newBox, { borderTopColor: c.border }]}>
                <TextInput value={name} onChangeText={setName} placeholder="清單名稱，例如：新夥伴必看" placeholderTextColor={c.textMuted} maxLength={30} autoFocus returnKeyType="done" onSubmitEditing={() => void create()} style={[styles.input, { borderColor: c.accent, color: c.text, backgroundColor: c.surface }]} />
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="cancel" label="取消" onPress={() => setCreating(false)} fullWidth />
                  </View>
                  <View style={{ flex: 1.4 }}>
                    <Button label="建立並加入" onPress={() => void create()} loading={busy === "new"} disabled={!name.trim()} fullWidth />
                  </View>
                </View>
              </View>
            ) : (
              <Pressable accessibilityRole="button" disabled={full} onPress={() => setCreating(true)} style={[styles.row, { borderTopColor: c.border }, full && { opacity: 0.7 }]}>
                <Ionicons name={full ? "lock-closed-outline" : "add-circle-outline"} size={28} color={full ? c.textMuted : c.accent} />
                <View style={{ flex: 1 }}>
                  <AppText variant="body" style={{ fontWeight: "700", color: full ? c.textMuted : c.accent }}>
                    新增清單（已用 {data.quota.used} / {data.quota.total}）
                  </AppText>
                  {full ? (
                    <AppText variant="callout" tone="muted">
                      {quotaHint(data.quota)}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            )}
          </SheetScroll>
        )}
        {creating ? null : (
          <View style={{ flexDirection: "row", gap: space.sm, paddingTop: space.xs }}>
            <View style={{ flex: 1 }}>
              <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="我的清單" onPress={() => { onClose(); router.push("/my-lists"); }} fullWidth />
            </View>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headBtn: { minWidth: 40, height: 40, borderRadius: 20, flexDirection: "row", gap: 4, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  rowBtn: { width: 30, height: 28, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: minTouch + 8, borderTopWidth: StyleSheet.hairlineWidth },
  newBox: { gap: space.sm, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: minTouch, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
});
