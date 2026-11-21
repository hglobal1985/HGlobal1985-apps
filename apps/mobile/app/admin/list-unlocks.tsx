import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_TYPES, api, type AchievementCategory, type AdminAchievement } from "@/api/client";
import { BadgeIcon } from "@/features/achievements/badge-icon";
import { conditionText } from "@/features/achievements/text";
import { confirmSheet } from "@/features/confirm";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, ErrorView, LoadingView, Screen, Section } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";

type Rule = { achievementId: string; extra: number };

/**
 * 設定 › 清單解鎖設定（業主 2026-11-21，超級管理員）：每位會員一開始能建立幾份「我的清單」，
 * 以及完成指定的學習成就後，各多解鎖幾份。點「新增解鎖條件」挑一個成就，再設定解鎖幾份。
 */
export default function ListUnlocksScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { config, reload } = useUiConfig();
  const list = useApi<AdminAchievement[]>(isSuper ? "/admin/achievements" : null);
  const [base, setBase] = useState<number | null>(null);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [pick, setPick] = useState(false);
  const [cat, setCat] = useState<"all" | AchievementCategory>("all");
  const [busy, setBusy] = useState(false);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;
  const curBase = base ?? config.app.listBaseQuota ?? 2;
  const cur = rules ?? config.app.listUnlocks ?? [];
  const byId = new Map(list.data.map((a) => [a.id, a]));
  const total = curBase + cur.reduce((a, r) => a + r.extra, 0);
  const dirty = base !== null || rules !== null;
  const save = async () => {
    setBusy(true);
    try {
      await api("PUT", "/admin/ui-config", { app: { ...config.app, listBaseQuota: curBase, listUnlocks: cur } });
      await reload();
      setBase(null);
      setRules(null);
      flashText("已儲存清單解鎖設定");
    } catch (e) {
      flashText(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };
  const setExtra = (id: string, d: number) => setRules(cur.map((r) => (r.achievementId === id ? { ...r, extra: Math.min(20, Math.max(1, r.extra + d)) } : r)));
  const remove = async (id: string) => {
    if (await confirmSheet({ title: "移除解鎖條件", message: `不再用「${byId.get(id)?.name ?? id}」解鎖清單？已經多出來的清單不會被刪除，只是之後不能再新增超過額度。`, confirmLabel: "移除", danger: true })) setRules(cur.filter((r) => r.achievementId !== id));
  };
  const choices = list.data.filter((a) => a.active && !cur.some((r) => r.achievementId === a.id) && (cat === "all" || ACHIEVEMENT_TYPES[a.type].category === cat));
  return (
    <Screen header={false} footer={dirty ? <View style={styles.foot}><View style={{ flex: 1 }}><Button variant="cancel" label="取消" onPress={() => { setBase(null); setRules(null); }} fullWidth /></View><View style={{ flex: 1 }}><Button label="儲存" onPress={() => void save()} loading={busy} fullWidth /></View></View> : undefined}>
      <Section title="基本數量">
        <Card style={{ gap: space.sm }}>
          <AppText variant="callout">每位會員一開始可以建立的清單份數：</AppText>
          <View style={styles.stepRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="減少" onPress={() => setBase(Math.max(0, curBase - 1))} style={[styles.step, { borderColor: c.border }]}>
              <Ionicons name="remove" size={22} color={c.text} />
            </Pressable>
            <AppText variant="title" style={{ minWidth: 48, textAlign: "center" }}>
              {curBase}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="增加" onPress={() => setBase(Math.min(50, curBase + 1))} style={[styles.step, { borderColor: c.border }]}>
              <Ionicons name="add" size={22} color={c.text} />
            </Pressable>
            <AppText variant="callout" tone="muted">
              份
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            全部條件都達成時，一位會員最多可以建立 {total} 份。
          </AppText>
        </Card>
      </Section>
      <Section title="解鎖條件">
        {cur.length === 0 ? <AppText variant="callout" tone="muted">還沒有解鎖條件。新增後，會員完成該學習成就就多解鎖幾份。</AppText> : null}
        {cur.map((r) => {
          const a = byId.get(r.achievementId);
          return (
            <Card key={r.achievementId} style={{ gap: space.sm }}>
              <View style={styles.ruleHead}>
                {a ? <BadgeIcon icon={a.icon} size={36} /> : null}
                <View style={{ flex: 1 }}>
                  <AppText variant="body" style={{ fontWeight: "700" }} numberOfLines={2}>
                    {a?.name ?? "（這個成就已被刪除）"}
                  </AppText>
                  {a ? (
                    <AppText variant="callout" tone="muted" numberOfLines={2}>
                      {conditionText(a.type, a.threshold, a.courseTitle, a.feature, a.lessonTitle)}
                    </AppText>
                  ) : null}
                </View>
              </View>
              <View style={styles.stepRow}>
                <AppText variant="callout">完成後多解鎖</AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="減少" onPress={() => setExtra(r.achievementId, -1)} style={[styles.step, { borderColor: c.border }]}>
                  <Ionicons name="remove" size={20} color={c.text} />
                </Pressable>
                <AppText variant="headline" style={{ minWidth: 28, textAlign: "center" }}>
                  {r.extra}
                </AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="增加" onPress={() => setExtra(r.achievementId, 1)} style={[styles.step, { borderColor: c.border }]}>
                  <Ionicons name="add" size={20} color={c.text} />
                </Pressable>
                <AppText variant="callout">份</AppText>
                <View style={{ flex: 1 }} />
                <Pressable accessibilityRole="button" accessibilityLabel="移除這個條件" onPress={() => void remove(r.achievementId)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={22} color={c.danger} />
                </Pressable>
              </View>
            </Card>
          );
        })}
        <Button variant="secondary" label="新增解鎖條件" icon="add" onPress={() => setPick(true)} fullWidth />
      </Section>
      {pick ? (
        <BottomSheet onClose={() => setPick(false)}>
          <View style={{ gap: space.sm, paddingBottom: space.sm }}>
            <AppText variant="headline">選一個學習成就</AppText>
            <Chips title="分類" value={cat} onChange={setCat} options={[{ key: "all", label: "全部" }, ...ACHIEVEMENT_CATEGORIES.map((k) => ({ key: k.key, label: k.label }))]} />
            <SheetScroll>
              {choices.length === 0 ? <AppText variant="callout" tone="muted">這個分類沒有可選的成就</AppText> : null}
              {choices.map((a) => (
                <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.name} onPress={() => { setRules([...cur, { achievementId: a.id, extra: 1 }]); setPick(false); }} style={[styles.pickRow, { borderTopColor: c.border }]}>
                  <BadgeIcon icon={a.icon} size={32} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" style={{ fontWeight: "700" }} numberOfLines={1}>
                      {a.name}
                    </AppText>
                    <AppText variant="callout" tone="muted" numberOfLines={1}>
                      {conditionText(a.type, a.threshold, a.courseTitle, a.feature, a.lessonTitle)}
                    </AppText>
                  </View>
                </Pressable>
              ))}
            </SheetScroll>
            <Button variant="cancel" label="關閉" onPress={() => setPick(false)} fullWidth />
          </View>
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  foot: { flexDirection: "row", gap: space.sm, padding: space.md },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  step: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ruleHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  pickRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth },
});
