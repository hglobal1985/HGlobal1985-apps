import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { useSession } from "@/state/session";
import { AppText, Icon } from "@/ui";
import { FLASH_ICON, showFlash } from "@/ui/flash-notice";

/**
 * 訂閱模組（杜杜龍 2026-11-17：中心首頁圖、系列首頁圖的訂閱鈕設計、尺寸、樣式統一，之後要調整只改這個檔案）：
 *  - `SubscribeButton`：訂閱鈕本體（高 44、鈴鐺＋下面小字「訂閱／已訂閱」＋人數；已訂閱＝深綠底＋黃色實心鈴鐺、未訂閱＝白底＋綠色空心鈴鐺）。
 *  - `useSubscribe(kind, name, loginNext)`：讀取人數與狀態、按一下訂閱／取消（訪客先去登入）、全螢幕提醒，由封面統計模組（`cover-stats.tsx`）使用，不要直接在頁面呼叫。
 * 中心、系列、課程與教材清單共用同一張資料表（系列用 `series:`、課程用 `course:` 開頭的鍵）；顯示人數都從 688 開始算（後端 `SUBSCRIBER_BASE`）。
 */
export type SubState = { count: number; subscribed: boolean };
export type SubscribeProps = SubState & { onPress: () => void; noun: string };
export type SubKind = "center" | "series" | "course";

const GREEN = "#0C603C";
const YELLOW = "#FFD43B";

export function SubscribeButton({ count, subscribed, onPress, noun }: SubscribeProps) {
  const fg = subscribed ? "#FFFFFF" : GREEN;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: subscribed }}
      accessibilityLabel={subscribed ? `已訂閱，共 ${count} 人，再按一下取消訂閱` : `訂閱這個${noun}，目前 ${count} 人`}
      onPress={onPress}
      style={[styles.sub, { backgroundColor: subscribed ? GREEN : "#FFFFFF" }]}
    >
      <View style={styles.icon}>
        <Icon name={subscribed ? "notifications" : "notifications-outline"} size={22} color={subscribed ? YELLOW : GREEN} />
        <AppText style={{ color: fg, fontSize: 10, fontWeight: "800", lineHeight: 12 }}>{subscribed ? "已訂閱" : "訂閱"}</AppText>
      </View>
      <AppText style={{ color: fg, fontSize: 16, fontWeight: "800" }}>{count}</AppText>
    </Pressable>
  );
}

export function useSubscribe(kind: SubKind, name: string | null, loginNext: string, nounOverride?: string): SubscribeProps | undefined {
  const { member } = useSession();
  const noun = nounOverride ?? (kind === "center" ? "中心" : kind === "series" ? "系列" : "課程");
  const path = `/${kind}-subscription`;
  const [sub, setSub] = useState<SubState | null>(null);
  useEffect(() => {
    setSub(null);
    if (!name) return;
    api<SubState>("GET", `${path}?${kind}=${encodeURIComponent(name)}`)
      .then(setSub)
      .catch(() => undefined);
  }, [name, kind, path, member?.sub]);
  const toggle = useCallback(async () => {
    if (!name) return;
    if (!member) return void router.push({ pathname: "/me", params: { next: loginNext } });
    try {
      const r = await api<SubState>("POST", path, { [kind]: name });
      setSub(r);
      if (r.subscribed) trackFeature("subscribe");
      showFlash({
        icon: <Ionicons name={r.subscribed ? "notifications" : "notifications-off-outline"} size={FLASH_ICON - 3} color={r.subscribed ? "#E0A800" : "#8A8A8A"} />,
        title: r.subscribed ? "已訂閱" : "已取消訂閱",
        body: r.subscribed ? (kind === "course" ? `這個${noun}有新章節或新教材會通知你` : "新課程或新公告都會通知你") : `不會再收到這個${noun}的通知`,
      });
    } catch (e) {
      showFlash({ icon: <Ionicons name="alert-circle-outline" size={FLASH_ICON - 3} color="#B3261E" />, title: "操作失敗", body: (e as Error).message });
    }
  }, [name, member, loginNext, path, kind, noun]);
  return sub ? { ...sub, noun, onPress: () => void toggle() } : undefined;
}

const styles = StyleSheet.create({
  icon: { alignItems: "center", justifyContent: "center" },
  sub: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingVertical: 3, paddingHorizontal: 12, borderRadius: 22, marginRight: 2, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
});
