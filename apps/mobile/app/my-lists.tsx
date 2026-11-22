import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type AchievementType } from "@/api/client";
import { conditionText } from "@/features/achievements/text";
import { ListCover } from "@/features/my-lists/list-cover";
import { quotaHint, type OwnList, type Quota } from "@/features/my-lists/add-to-list";
import { trackFeature } from "@/lib/feature-track";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, GuestGate, LoadingView, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/** 設定 › 我的清單：自己建立的所有清單（點進去編輯、看點擊）。新增清單在這裡或在任何內容的「加入我的清單」面板都可以。 */
export default function MyListsScreen() {
  const { c } = useTheme();
  const { member, ready } = useSession();
  const { data, error, loading, reload } = useApi<{ lists: OwnList[]; quota: Quota }>(member ? "/my-lists" : null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (ready && !member) return <Screen header={false}><GuestGate body="登入後就能建立自己的清單，分享給朋友" /></Screen>;
  if (error && !data) return <Screen header={false}><ErrorView message={error} onRetry={reload} /></Screen>;
  if (loading && !data) return <Screen header={false}><LoadingView /></Screen>;
  const full = !!data && data.quota.used >= data.quota.total;
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api("POST", "/my-lists", { title: name.trim() });
      trackFeature("list_create");
      setName("");
      setCreating(false);
      reload();
    } catch (e) {
      flashText(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={false}>
      <View style={{ gap: 2 }}>
        <AppText variant="caption" tone="muted">
          已用 {data?.quota.used ?? 0} / {data?.quota.total ?? 0} 份{full && data ? `・${quotaHint(data.quota)}` : ""}
        </AppText>
      </View>
      {data && data.lists.length === 0 ? <EmptyState icon="list-outline" title="還沒有清單" body="在任何課程、教材、系列或中心按「加入我的清單」，就能建立並加入" /> : null}
      {data?.lists.map((l) => (
        <Pressable key={l.id} accessibilityRole="button" accessibilityLabel={l.title} onPress={() => router.push(`/my-list/${l.id}` as never)}>
          <Card style={styles.card}>
            <View style={styles.cover}>
              <ListCover mode={l.coverMode} imageUrl={l.coverUrl} bgUrl={l.coverBgUrl} title={l.title} height={54} minFont={8} radius={radius.sm} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="headline" numberOfLines={1}>
                {l.title}
              </AppText>
              <AppText variant="callout" tone="muted">
                {l.count} 項・{l.people} 人・{l.clicks} 次點擊
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={25} color={c.textMuted} />
          </Card>
        </Pressable>
      ))}
      {creating && !full ? (
        <Card style={{ gap: space.sm }}>
          <TextInput value={name} onChangeText={setName} placeholder="清單名稱，例如：新夥伴必看" placeholderTextColor={c.textMuted} maxLength={30} autoFocus style={[styles.input, { borderColor: c.accent, color: c.text, backgroundColor: c.surface }]} />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button variant="cancel" label="取消" onPress={() => setCreating(false)} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="建立" onPress={() => void create()} loading={busy} disabled={!name.trim()} fullWidth />
            </View>
          </View>
        </Card>
      ) : (
        <Button label={full ? "清單數量已用完" : "新增清單"} icon={full ? "lock-closed-outline" : "add"} disabled={full} onPress={() => setCreating(true)} fullWidth />
      )}
      {data && data.quota.unlocks.length > 0 ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="headline">如何擴充更多清單數量？</AppText>
          {data.quota.unlocks.map((u) => (
            <Pressable key={u.achievementId} accessibilityRole="button" accessibilityLabel={`${u.name}，多 ${u.extra} 份清單${u.earned ? "，已完成" : ""}`} onPress={() => router.push("/achievements" as never)} style={[styles.unlock, { borderTopColor: c.border }]}>
              <Ionicons name={u.earned ? "checkmark-circle" : "lock-closed-outline"} size={26} color={u.earned ? c.accent : c.textMuted} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body" style={{ fontWeight: "700" }}>
                  {u.name}
                </AppText>
                <AppText variant="callout" tone="muted">
                  {u.description || conditionText(u.type as AchievementType, u.threshold, null, u.feature)}
                </AppText>
              </View>
              <View style={[styles.extra, { backgroundColor: u.earned ? c.accent : c.accentSoft }]}>
                <AppText variant="callout" style={{ fontWeight: "800", color: u.earned ? c.textOnAccent : c.accentText }}>
                  {u.earned ? "已解鎖" : `+${u.extra} 份`}
                </AppText>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.md },
  cover: { width: 72, height: 54, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  unlock: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch + 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.xs },
  extra: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  input: { minHeight: minTouch, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
});
