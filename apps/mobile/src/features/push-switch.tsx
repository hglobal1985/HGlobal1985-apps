import { useEffect, useState } from "react";
import { Platform, Switch, View } from "react-native";
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
export function PushSwitchRow() {
  const { c } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  const toggle = async (v: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const next = v ? await enablePush() : await disablePush();
      if (v && next === "on") trackFeature("push_enable");
      setState(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "開啟失敗，請稍後再試");
    }
    setBusy(false);
  };
  const canToggle = state === "on" || state === "off";
  const hint = err ?? (Platform.OS !== "web" ? "App 版的推播會在正式上架時開放。" : state && state !== "on" && state !== "off" ? PUSH_TEXT[state] : null);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 46, borderRadius: radius.md, backgroundColor: c.surfaceMuted, paddingHorizontal: space.sm }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSoft }}>
          <Icon name="notifications" size={20} color={c.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText style={{ fontWeight: "800" }}>開啟手機推播</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            開課提醒、報名與審核結果
          </AppText>
        </View>
        <Switch value={state === "on"} disabled={busy || !canToggle} onValueChange={toggle} trackColor={{ false: c.border, true: c.accent }} thumbColor="#FFFFFF" ios_backgroundColor={c.border} accessibilityLabel="手機推播開關" />
      </View>
      {hint ? (
        <AppText variant="caption" tone={err ? "danger" : "muted"}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
