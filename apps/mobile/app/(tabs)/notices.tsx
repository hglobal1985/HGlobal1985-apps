import { useModeProfile } from "@/lib/app-mode";
import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { api, type Notice, type NoticeCategory } from "@/api/client";
import { noticeTarget } from "@/features/format";
import { CentralReviewList, groupByDay, hhmm, useCentralReviews } from "@/features/notices/central-reviews";
import { NoticeSheet } from "@/features/notices/notice-sheet";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { ElderTabs } from "@/ui/elder-controls";
import { AppText, GuestGate, Button, Card, EmptyState, ErrorView, LoadingView, Screen } from "@/ui";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";

import { useBorderW } from "@/lib/elder-mode";

export default function NoticesScreen() {
  const elder = useModeProfile().bigLayout; // 大字版面（至尊模式）：一欄直排、內文展開、不顯示大標題
  const { c } = useTheme();
  const pinBw = useBorderW(2); // 框線粗細統一用全站規範（至尊 4、超派 2；業主 2026-11-25），審核置頂框用紅色
  const { member, invalidate } = useSession();
  const { data, error, loading, reload } = useApi<Notice[]>(member ? "/notifications" : null);
  const unread = (data ?? []).filter((n) => !n.read).length;
  // 檢視模式（業主 2026-11-17）：全部、審核、訂閱、留言。審核裡另外會顯示中央的獎銜、中心新申請（沒有權限就不顯示）。
  // 標籤順序與內容（業主 2026-11-24）：留言 > 訂閱 > 審核 > 成就，沒有「全部」；伺服器分類 other 歸到訂閱。預設停在第一個有未讀的標籤。
  type Tab = "comment" | "subscribe" | "review" | "achievement";
  const tabOf = (n: Notice): Tab => (n.category === "other" ? "subscribe" : n.category);
  const [picked, setPicked] = useState<Tab | null>(null);
  const central = useCentralReviews();
  const centralCount = central.data?.available ? central.data.reviews.length : 0;
  const count = (cat: Tab) => (data ?? []).filter((n) => tabOf(n) === cat && !n.read).length + (cat === "review" ? centralCount : 0);
  const MODES: { key: Tab; label: string }[] = [
    { key: "comment", label: "留言" },
    { key: "subscribe", label: "訂閱" },
    { key: "review", label: "審核" },
    { key: "achievement", label: "成就" },
  ];
  const mode: Tab = picked ?? MODES.find((m) => count(m.key) > 0)?.key ?? "comment";
  const setMode = setPicked;
  const list = (data ?? []).filter((n) => tabOf(n) === mode);
  // 審核相關而且還沒處理的置頂（伺服器標 pending）；其他分頁不需要。
  const pinned = mode === "review" ? list.filter((n) => n.pending) : [];
  const rest = pinned.length ? list.filter((n) => !n.pending) : list;
  // 成就分頁：畫面上看得到的成就通知自動標為已讀，不必逐則點開（業主 2026-11-24）。
  const seen = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSeen = (n: Notice) => {
    if (n.read || seen.current.has(n.id)) return;
    seen.current.add(n.id);
    api("POST", `/notifications/${n.id}/read`).catch(() => undefined);
    if (flush.current) clearTimeout(flush.current);
    flush.current = setTimeout(invalidate, 500);
  };
  // 點一則通知：先標為已讀並彈出摘要（完整內容），再由摘要的「前往查看」（或往上拉到最高處）進入對應頁面。
  const [preview, setPreview] = useState<Notice | null>(null);
  const open = async (n: Notice) => {
    setPreview(n);
    if (!n.read) await api("POST", `/notifications/${n.id}/read`).catch(() => undefined);
    invalidate();
  };
  const markAll = async () => {
    await api("POST", "/notifications/read-all").catch(() => undefined);
    invalidate();
  };
  const wrapSeen = (n: Notice, row: ReactNode) => (mode === "achievement" ? <SeenRow key={n.id} onSeen={() => markSeen(n)}>{row}</SeenRow> : row);
  const renderRow = (n: Notice, i: number) => (
      <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.title}${n.read ? "" : "，未讀"}`} onPress={() => open(n)} style={({ pressed }) => [{ flexDirection: elder ? "column" : "row", alignItems: elder ? "stretch" : "center", gap: elder ? 8 : 10, paddingVertical: 12, minHeight: 64 }, i > 0 && { borderTopWidth: 1, borderColor: c.border }, pressed && { opacity: 0.7 }]}>
        <View style={elder ? { flexDirection: "row", alignItems: "center", gap: 10 } : { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: n.read ? c.surfaceMuted : c.accentSoft }}>
          <Ionicons name={n.category === "achievement" ? "trophy-outline" : n.category === "review" ? "ribbon-outline" : n.category === "comment" ? "chatbubble-outline" : "notifications-outline"} size={20} color={n.read ? c.textMuted : c.accentText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="body" numberOfLines={elder ? undefined : 2} style={{ fontWeight: n.read ? "600" : "800" }}>
            {n.title}
          </AppText>
          {n.body && !elder ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {n.body}
            </AppText>
          ) : null}
        </View>
        </View>
        {n.body && elder ? (
          <AppText variant="caption" tone="muted">
            {n.body}
          </AppText>
        ) : null}
        <View style={elder ? { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } : { alignItems: "flex-end", gap: 4 }}>
          <AppText variant="caption" tone="muted">
            {hhmm(n.createdAt)}
          </AppText>
          {!n.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} /> : <View style={{ width: 10, height: 10 }} />}
        </View>
      </Pressable>
  );
  if (!member)
    return (
      <Screen>
        <GuestGate icon="notifications-outline" body="登入後可在這裡收到開課、報名審核等通知。" />
      </Screen>
    );
  return (
    <Screen
      title={elder ? undefined : "通知"}
      subtitle={elder ? undefined : data ? (unread ? `${unread} 則未讀` : "全部已讀") : undefined}
      right={elder ? undefined : (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {unread ? <Button variant="ghost" label="全部標為已讀" onPress={markAll} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="通知設定" onPress={() => router.push("/settings/notifications")} hitSlop={8} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="settings-outline" size={26} color={c.text} />
          </Pressable>
        </View>
      )}
    >
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {elder ? (
        <View style={{ marginBottom: space.sm }}>
          <ElderTabs tabs={MODES.map((m) => ({ key: m.key, label: m.label, count: count(m.key) }))} value={mode} onChange={(k) => (trackFeature("notices_filter"), setMode(k))} />
        </View>
      ) : (
      <View style={{ flexDirection: "row", gap: 8, marginBottom: space.sm }} accessibilityRole="radiogroup">
        {MODES.map((m) => {
          const on = mode === m.key;
          const n = count(m.key);
          return (
            <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${m.label}${n ? `，${n} 則未處理` : ""}`} onPress={() => (trackFeature("notices_filter"), setMode(m.key))} style={{ flex: 1, minWidth: 0, minHeight: elder ? Math.round(72 * UI_SCALE) : 44, borderRadius: elder ? radius.lg + 6 : radius.md, borderWidth: elder ? 4 : 1, borderColor: on ? c.accent : elder ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }}>
              <AppText variant={elder ? "headline" : "callout"} numberOfLines={1} style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
                {m.label}
              </AppText>
              {n ? (
                <View style={[{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: on ? c.textOnAccent : c.danger, alignItems: "center", justifyContent: "center" }, elder && { position: "absolute", top: -6, right: -2 }]}>
                  <AppText variant="caption" style={{ color: on ? c.accent : "#fff", fontWeight: "800", fontSize: 11, lineHeight: 14 }}>
                    {n > 99 ? "99+" : n}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      )}
      {mode === "review" && central.data?.available ? <CentralReviewList data={central.data} onChanged={central.reload} /> : null}
      {data && !list.length && !(mode === "review" && centralCount) ? <EmptyState icon="notifications-outline" title="這個分類目前沒有通知" /> : null}
      {/* 審核相關而且還沒處理的一律置頂（業主 2026-11-23）：在「全部」與「審核」都放在最上面，處理完（或已讀）才回到下面依日期排列。 */}
      {pinned.length ? (
        <View style={{ gap: 6, marginTop: space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="pin" size={14} color={c.danger} />
            <AppText variant="caption" style={{ fontWeight: "800", color: c.danger }}>{`等待處理的審核（${pinned.length}）`}</AppText>
          </View>
          <Card style={{ paddingVertical: 4, borderWidth: pinBw, borderColor: c.danger }}>{pinned.map((n, i) => renderRow(n, i))}</Card>
        </View>
      ) : null}
      {groupByDay(rest, (n) => n.createdAt).map((g) => (
        <View key={g.day} style={{ gap: 6, marginTop: space.xs }}>
          <AppText variant="caption" tone="muted" style={{ fontWeight: "800" }}>
            {g.day}
          </AppText>
          <Card style={{ paddingVertical: 4 }}>{g.rows.map((n, i) => wrapSeen(n, renderRow(n, i)))}</Card>
        </View>
      ))}
      {preview ? (
        <NoticeSheet notice={preview} onClose={() => setPreview(null)} onOpen={preview.link ? () => router.push(noticeTarget(preview.link) as Href) : undefined} />
      ) : null}
    </Screen>
  );
}

/** 這一列出現在畫面上（網頁用 IntersectionObserver；App 沒有觀察器就開啟後 1 秒視為看到）就呼叫 onSeen。 */
function SeenRow({ onSeen, children }: { onSeen: () => void; children: ReactNode }) {
  const ref = useRef<unknown>(null);
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const el = ref.current as Element | null;
    if (Platform.OS === "web" && el && typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (cb.current(), io.disconnect()), { threshold: 0.5 });
      io.observe(el);
      return () => io.disconnect();
    }
    const t = setTimeout(() => cb.current(), 1000);
    return () => clearTimeout(t);
  }, []);
  return <View ref={(r: unknown) => { ref.current = r; }}>{children}</View>;
}
