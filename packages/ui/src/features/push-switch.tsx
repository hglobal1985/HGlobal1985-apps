import { useEffect, useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { trackFeature } from "@/lib/feature-track";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/web-push";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { api } from "@/api/client";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Icon } from "@/ui/icon";
import { LoadingLadybug } from "@/ui/loading-ladybug";
import { NoticeBox } from "@/ui/notice-box";
import { AppText } from "@/ui/text";

/*
 * 手機推播的開關與設定卡（共用元件：行動大學與寰宇繳作業系統同一份；杜杜龍 2026-11-27 從行動大學搬來）。
 * 兩個 App 的伺服器都提供 /push/key、/push/subscribe、/push/unsubscribe、/push/test。
 */

export const PUSH_TEXT: Record<PushState, string> = {
  on: "開啟：有新通知時，手機會跳出提醒（關掉 App 也收得到）。",
  off: "關閉：只在 App 內的「通知」分頁看得到。",
  denied: "你之前拒絕了通知權限。請到瀏覽器或手機的「網站設定 > 通知」允許本網站，再回來開啟。",
  "ios-needs-install": "iPhone／iPad 要先把本網站「加入主畫面」：按 Safari 下方的分享鈕 →「加入主畫面」，再從主畫面的圖示開啟，就能在這裡開啟推播（需要 iOS 16.4 以上）。",
  unsupported: "這個瀏覽器不支援推播通知，請改用 Chrome、Edge 或 Safari（iPhone 需加入主畫面）。",
  "not-ready": "手機推播尚未開放，開放後就能在這裡開啟。",
};

/** 基本資料面板第一步驟的「手機推播」一列（杜杜龍 2026-11-22）：這支裝置的開關，按下立刻生效，不用按儲存；其他狀態只在下方多一行小字。 */
export function PushSwitchRow({ banner, compact }: { banner?: boolean; /** 縮小版（杜杜龍 2026-11-23：放在本名旁邊的小位置）：單行 40 高、較小字與圖示。 */ compact?: boolean } = {}) {
  const { c, scheme } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  const toggle = async (v: boolean) => {
    // 按下去立刻變色（杜杜龍 2026-11-23：以前要等好幾秒向瀏覽器與伺服器登記完才變綠）；登記完再用真實結果校正，失敗就退回原狀。
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
  /** 按鈕文字顯示目前狀態（杜杜龍 2026-11-24）。 */
  const label = state === "on" ? "訊息通知：已開啟" : state === "off" ? "訊息通知：未開啟" : state === null ? "訊息通知" : state === "denied" ? "訊息通知：已被封鎖" : "訊息通知：無法使用";
  // 橫幅版（杜杜龍 2026-11-23）：整列可點、打勾開啟；沒開啟＝整列紅色（含圖示），開啟後整列變綠色。
  // 不能操作（瀏覽器不支援、要先加入主畫面、被封鎖、App 版尚未開放…）時不再畫整塊紅色、右邊空方框的假開關（杜杜龍 2026-11-26）：
  // 改成一個小的灰底提示列（鈴鐺＋「訊息通知：狀態」），原因與做法完整顯示在下面小字，不佔版面、不會被誤以為能點。
  if (banner && !canToggle) {
    const checking = Platform.OS === "web" && state === null && !err;
    return (
      <View accessibilityRole="text" style={{ gap: 2, borderRadius: radius.md, backgroundColor: c.surfaceMuted, paddingHorizontal: space.sm, paddingVertical: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="notifications-off-outline" size={compact ? 18 : 22} color={c.textMuted} />
          <AppText style={{ fontWeight: "800", fontSize: compact ? 14 : 17, lineHeight: compact ? 20 : 24, flexShrink: 1 }}>{checking ? "訊息通知：確認中…" : label}</AppText>
        </View>
        {hint ? (
          <AppText variant="caption" tone={err ? "danger" : "muted"}>
            {hint}
          </AppText>
        ) : null}
      </View>
    );
  }
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
          {/* 鈴鐺與主選單「通知」分頁同款：沒開啟＝線條鈴鐺、開啟＝實心鈴鐺（杜杜龍 2026-11-24）。 */}
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
              // 兩行顯示（杜杜龍 2026-11-24）：第一行「訊息通知」、第二行目前狀態。
              <>
                <AppText numberOfLines={1} style={{ fontWeight: "900", fontSize: 22, lineHeight: 28, color: fg }}>訊息通知</AppText>
                <AppText numberOfLines={1} style={{ fontWeight: "800", fontSize: 18, lineHeight: 24, color: fg }}>{label.replace("訊息通知：", "") || "尚未設定"}</AppText>
              </>
            )}
          </View>
          <Icon name={on ? "checkbox" : "square-outline"} size={compact ? 22 : 34} color={fg} />
        </Pressable>
        {hint ? (
          <AppText variant="caption" tone={err ? "danger" : "muted"}>
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
        <AppText variant="caption" tone={err ? "danger" : "muted"}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

/** 收不到推播時的排查步驟（杜杜龍 2026-11-27：讓杜杜龍自己就能一步一步檢查）。 */
export const PUSH_TROUBLESHOOT =
  "沒跳出通知？請檢查：①手機設定 › 應用程式 › Chrome › 通知：要開啟 ②Chrome 右上角 ⋮ › 設定 › 通知：這個網站要「允許」③iPhone：設定 › 通知 › 這個 App 要允許 ④手機的勿擾／專注模式要關閉。按完測試鈕先回到手機桌面等幾秒，比較看得出來。";

/** 手機推播設定卡（杜杜龍 2026-11-17）：這個裝置的開關＋傳一則測試通知＋排查說明。每個裝置各自開啟。 */
export function PushCard({ title = "手機推播", note = "所有通知都會直接推到這支手機（不能逐項關閉，要收就是全部收）。" }: { title?: string; note?: string } = {}) {
  const { c } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  const toggle = async (v: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = v ? await enablePush() : await disablePush();
      if (v && next === "on") trackFeature("push_enable");
      setState(next);
      if (v && next === "on") setMsg({ text: "已開啟手機推播", ok: true });
      if (!v) setMsg({ text: "已關閉這個裝置的推播", ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "開啟失敗，請稍後再試", ok: false });
    }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // 伺服器可回報送到幾支裝置（{ devices, ok }）；只回 { ok: true } 時照常顯示已送出。
      const r = await api<{ devices?: number; ok?: number | boolean }>("POST", "/push/test");
      if (typeof r?.devices === "number" && typeof r.ok === "number") {
        if (r.ok > 0) setMsg({ text: `已送出到 ${r.ok} 支裝置，幾秒內手機會跳出提醒。`, ok: true });
        else setMsg({ text: r.devices ? "送出失敗：請把開關關掉再重新開啟一次。" : "這個帳號還沒有裝置開啟推播：請把開關關掉再重新開啟一次。", ok: false });
      } else setMsg({ text: "已送出測試通知，幾秒內手機會跳出提醒。", ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "送出失敗", ok: false });
    }
    setBusy(false);
  };
  if (Platform.OS !== "web")
    return (
      <Card>
        <AppText variant="headline">{title}</AppText>
        <AppText tone="muted">App 版的推播會在正式上架時開放；目前請用網頁版開啟。</AppText>
      </Card>
    );
  const canToggle = state === "on" || state === "off";
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{title}</AppText>
          <AppText variant="caption" tone="muted">
            {note}
          </AppText>
        </View>
        <Switch
          value={state === "on"}
          disabled={busy || !canToggle}
          onValueChange={toggle}
          trackColor={{ false: c.border, true: c.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={c.border}
          accessibilityLabel="手機推播開關"
        />
      </View>
      {state ? <NoticeBox tone={state === "on" ? "success" : state === "off" ? "info" : "warning"} text={PUSH_TEXT[state]} /> : <LoadingLadybug />}
      {state === "on" ? <Button variant="secondary" icon="notifications-outline" label="傳一則測試通知給我" disabled={busy} onPress={test} /> : null}
      {msg ? <NoticeBox text={msg.text} tone={msg.ok ? "success" : "danger"} /> : null}
      {state === "on" ? <NoticeBox tone="info" text={PUSH_TROUBLESHOOT} /> : null}
    </Card>
  );
}
