import { trackFeature } from "@/lib/feature-track";
import { useFeature } from "@/lib/app-mode";
import { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, NoticeBox } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import type { BroadcastItem } from "./use-broadcasts";

type Items = BroadcastItem[];

/**
 * 中心頁封面正下方的「廣播公告」黃色橫條（業主 2026-11-17；2026-11-21 改成緊貼封面、左右滿版、沒有圖示的樣式，只有文字與「更多」）：強制只顯示一行，太長就「… 更多」；
 * 依設定的秒數（預設 2 秒）自動輪播；手指上下左右滑動可切換；點一下彈出完整公告清單（日期＋內容）。顏色用網站標準亮黃色（同「已付費」標籤）。
 */
export function BroadcastBand({ items, seconds, onOpen, labelOf, gutter: gutterOverride }: { items: Items; seconds: number; onOpen: () => void; /** 每則公告左邊的來源簡稱（中心／系列名稱）；橫條顯示「📢新竹公告：內容」。 */ labelOf?: (scope: Items[number]["scope"]) => string; /** 頁面左右留白（預設跟版面規則；頁面自訂留白時要傳同一個值，橫條才會左右滿版）。 */ gutter?: number }) {
  const { scheme } = useTheme();
  const lay = useLayout();
  const gutter = gutterOverride ?? lay.gutter;
  const [i, setI] = useState(0);
  const touching = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;
  const n = items.length;
  const go = (d: number) => {
    if (n < 2) return;
    Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }).start(() => {
      setI((x) => (x + d + n) % n);
      Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }).start();
    });
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => !touching.current && goRef.current(1), Math.max(1, seconds) * 1000);
    return () => clearInterval(t);
  }, [n, seconds]);
  useEffect(() => {
    if (i >= n) setI(0);
  }, [n, i]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10,
      onPanResponderGrant: () => void (touching.current = true),
      onPanResponderRelease: (_e, g) => {
        touching.current = false;
        const horizontal = Math.abs(g.dx) >= Math.abs(g.dy);
        const d = horizontal ? g.dx : g.dy;
        if (Math.abs(d) > 24) goRef.current(d < 0 ? 1 : -1); // 往左／往上＝下一則；往右／往下＝上一則
      },
      onPanResponderTerminate: () => void (touching.current = false),
    }),
  ).current;
  if (!n) return null;
  const bg = scheme === "dark" ? "#F5C518" : "#FFD43B";
  const fg = scheme === "dark" ? "#2A1D00" : "#5A3B00";
  const cur = items[Math.min(i, n - 1)]!;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`公告：${cur.text}，點一下看全部`} onPress={onOpen} hitSlop={{ top: 8, bottom: 8 }} style={[styles.band, { backgroundColor: bg, marginTop: -space.lg, marginLeft: -gutter, marginRight: -gutter, paddingHorizontal: gutter, alignSelf: "stretch", width: "auto" }]} {...pan.panHandlers} data-no-pull-refresh="">
      <Animated.View style={[styles.textWrap, { opacity: fade }]}>
        <AppText variant="callout" numberOfLines={1} ellipsizeMode="tail" style={{ color: fg, fontWeight: "700", flexShrink: 1 }}>
          {`📢${labelOf?.(cur.scope) ?? ""}公告：${cur.text}`}
        </AppText>
      </Animated.View>
      <AppText variant="callout" style={{ color: fg, fontWeight: "800" }}>
        更多
      </AppText>
      {n > 1 ? (
        <AppText variant="caption" style={{ color: fg, fontWeight: "700" }}>
          {Math.min(i, n - 1) + 1}/{n}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** 全部公告：日期＋內容（用統一的上拉面板，高度依內容自動調整）；有權限的人每則下面有「修改」「刪除」（業主 2026-11-21：不必另外進設定頁）。 */
export function BroadcastSheet({ title, items, onClose, onChanged }: { title: string; items: Items; onClose: () => void; onChanged?: () => void }) {
  useEffect(() => trackFeature("broadcast_open"), []);
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">{title}</AppText>
      <SheetScroll>
        <BroadcastList items={items} onChanged={onChanged} />
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

/**
 * 公告清單本體（日期＋完整內容；有權限的人可修改、刪除）：超派模式的公告面板與至尊模式展開的公告區塊共用同一份（業主 2026-11-24）。
 * 修改／刪除鈕要不要顯示由模式設定檔決定（至尊模式 adminEdit＝false 不顯示）。
 */
export function BroadcastList({ items, onChanged }: { items: Items; onChanged?: () => void }) {
  const { c } = useTheme();
  const adminEdit = useFeature("adminEdit");
  const [editId, setEditId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      flashText(done);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = (id: string) => run(async () => (await api("PATCH", `/admin/broadcasts/${id}`, { text }), setEditId(null)), "已更新公告");
  const remove = async (id: string) => {
    if (!(await confirmAsk("刪除公告", "確定刪除這則公告？", "刪除"))) return;
    await run(() => api("DELETE", `/admin/broadcasts/${id}`), "已刪除公告");
  };
  return (
    <>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      {items.map((x) => (
        <View key={x.id} style={[styles.row, { borderTopColor: c.border }]}>
          <AppText variant="callout" tone="muted" style={{ fontWeight: "700" }}>
            {x.date}
          </AppText>
          {editId === x.id ? (
            <>
              <TextInput value={text} onChangeText={setText} multiline maxLength={300} accessibilityLabel="公告內容" placeholderTextColor={c.textMuted} style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
              <View style={styles.btns}>
                <Button variant="cancel" label="取消" disabled={busy} onPress={() => setEditId(null)} />
                <Button label="儲存" loading={busy} disabled={busy || !text.trim()} onPress={() => void save(x.id)} />
              </View>
            </>
          ) : (
            <>
              <AppText variant="body">{x.text}</AppText>
              {x.canEdit && adminEdit ? (
                <View style={styles.btns}>
                  <Button variant="secondary" label="修改" disabled={busy} onPress={() => (setEditId(x.id), setText(x.text))} />
                  <Button variant="ghost" label="刪除" disabled={busy} onPress={() => void remove(x.id)} />
                </View>
              ) : null}
            </>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  // 高度剛好等於文字高度（業主 2026-11-21）：不再墊最小觸控高度，上下只留 3px。
  band: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 3, borderRadius: 0 },
  textWrap: { flex: 1, minWidth: 0 },
  row: { gap: 4, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  btns: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  input: { minHeight: minTouch + 20, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top" },
});
