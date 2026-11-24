import { useEffect, useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { trackFeature } from "@/lib/feature-track";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/web-push";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

export const PUSH_TEXT: Record<PushState, string> = {
  on: "開啟：有新通知時，手機會跳出提醒（關掉 App 也收得到）。",
  off: "關閉：只在 App 內的「通知」分頁看得到。",
  denied: "你之前拒絕了通知權限。請到瀏覽器或手機的「網站設定 > 通知」允許本網站，再回來開啟。",
  "ios-needs-install": "iPhone／iPad 要先把本網站「加入主畫面」：按 Safari 下方的分享鈕 →「加入主畫面」，再從主畫面的圖示開啟，就能在這裡開啟推播（需要 iOS 16.4 以上）。",
  unsupported: "這個瀏覽器不支援推播通知，請改用 Chrome、Edge 或 Safari（iPhone 需加入主畫面）。",
  "not-ready": "手機推播尚未開放，開放後就能在這裡開啟。",
};

/** 基本資料面板第一步驟的「手機推播」一列（業主 2026-11-22）：這支裝置的開關，按下立刻生效，不用按儲存；其他狀態只在下方多一行小字。 */
export function PushSwitchRow({ banner, compact }: { banner?: boolean; /** 縮小版（業主 2026-11-23：放在本名旁邊的小位置）：單行 40 高、較小字與圖示。 */ compact?: boolean } = {}) {
  const { c, scheme } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  const toggle = async (v: boolean) => {
    // 按下去立刻變色（業主 2026-11-23：以前要等好幾秒向瀏覽器與伺服器登記完才變綠）；登記完再用真實結果校正，失敗就退回原狀。
    const before = state;
    setBusy(true);
    setErr(null);
    setState(v ? "on" : "off");
    try {
      const next = v ? await enablePush() : await disablePush();
      if (v && next === "on") trackFeature("push_enable");
      setState(next);
    } catch (e) {
      setState(before);
      setErr(e instanceof Error ? e.message : "開啟失敗，請稍後再試");
    }
    setBusy(false);
  };
  const canToggle = state === "on" || state === "off";
  const hint = err ?? (Platform.OS !== "web" ? "App 版的推播會在正式上架時開放。" : state && state !== "on" && state !== "off" ? PUSH_TEXT[state] : null);
  const on = state === "on";
  /** 按鈕文字顯示目前狀態（業主 2026-11-24）。 */
  const label = state === "on" ? "訊息通知：已開啟" : state === "off" ? "訊息通知：未開啟" : state === null ? "訊息通知" : state === "denied" ? "訊息通知：已被封鎖" : "訊息通知：無法使用";
  // 橫幅版（業主 2026-11-23）：整列可點、打勾開啟；沒開啟＝整列紅色（含圖示），開啟後整列變綠色。
  if (banner) {
    const bg = on ? c.accent : c.danger;
    const fg = on ? c.textOnAccent : scheme === "dark" ? "#601410" : "#FFFFFF";
    return (
      <View style={{ gap: 4 }}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on, disabled: busy || !canToggle }}
          accessibilityLabel="訊息通知"
          disabled={!canToggle}
          onPress={() => !busy && void toggle(!on)}
          style={{ flexDirection: "row", alignItems: "center", gap: compact ? 6 : space.sm, minHeight: compact ? 40 : 76, borderRadius: radius.md, backgroundColor: bg, paddingHorizontal: compact ? 8 : space.sm, opacity: 1 }}
        >
          {/* 鈴鐺與主選單「通知」分頁同款：沒開啟＝線條鈴鐺、開啟＝實心鈴鐺（業主 2026-11-24）。 */}
          {compact ? (
            <Icon name={on ? "notifications" : "notifications-outline"} size={24} color={fg} />
          ) : (
            <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.2)" }}>
              <Icon name={on ? "notifications" : "notifications-outline"} size={20} color={fg} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            {compact ? (
              <AppText numberOfLines={1} style={{ fontWeight: "900", fontSize: 15, lineHeight: 20, color: fg }}>{label}</AppText>
            ) : (
              // 兩行顯示（業主 2026-11-24）：第一行「訊息通知」、第二行目前狀態。
              <>
                <AppText numberOfLines={1} style={{ fontWeight: "900", fontSize: 22, lineHeight: 28, color: fg }}>訊息通知</AppText>
                <AppText numberOfLines={1} style={{ fontWeight: "800", fontSize: 18, lineHeight: 24, color: fg }}>{label.replace("訊息通知：", "") || "尚未設定"}</AppText>
              </>
            )}
          </View>
          <Icon name={on ? "checkbox" : "square-outline"} size={compact ? 22 : 34} color={fg} />
        </Pressable>
        {hint ? (
          <AppText variant="caption" tone={err ? "danger" : "muted"} numberOfLines={2}>
            {hint}
          </AppText>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 46, borderRadius: radius.md, backgroundColor: c.surfaceMuted, paddingHorizontal: space.sm }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSoft }}>
          <Icon name="notifications" size={20} color={c.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText style={{ fontWeight: "900", fontSize: 16, lineHeight: 22 }}>訊息通知</AppText>
        </View>
        <Switch value={on} disabled={busy || !canToggle} onValueChange={toggle} trackColor={{ false: c.border, true: c.accent }} thumbColor="#FFFFFF" ios_backgroundColor={c.border} accessibilityLabel="手機推播開關" />
      </View>
      {hint ? (
        <AppText variant="caption" tone={err ? "danger" : "muted"} numberOfLines={2}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
