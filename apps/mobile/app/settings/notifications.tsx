import { trackFeature } from "@/lib/feature-track";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/web-push";
import { Switch, View } from "react-native";
import { api, NOTICE_KINDS, type NotificationSettings } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { AppText, Button, Card, EmptyState, ErrorView, Field, InstallCard, LoadingView, LoadingLadybug, NoticeBox, Screen, Section } from "@/ui";

/** 通知設定：Email 是會員中心「聯絡信箱」的同一個欄位，這裡改就是改會員中心。 */
export default function NotificationSettingsScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const { data, error, reload } = useApi<NotificationSettings>(member ? "/me/notification-settings" : null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (data) setEmail(data.email ?? "");
  }, [data]);
  if (!member) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="請先登入" /></Screen>;
  if (!data) return <Screen header={false}>{error ? <ErrorView message={error} onRetry={reload} /> : <LoadingView />}</Screen>;

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api<NotificationSettings>("PUT", "/me/notification-settings", body);
      trackFeature("notify_settings");
      setMsg({ text: done, ok: true });
      reload();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "儲存失敗，請稍後再試", ok: false });
    }
    setBusy(false);
  };
  const changed = email.trim().toLowerCase() !== (data.email ?? "");

  return (
    <Screen header={false}>
      <Section title="通知方式">
        {/* 手機推播放最前面（業主 2026-11-18）；推播一律全收，不能逐項關閉 */}
        <PushCard />
        <InstallCard />
        <Card>
          <AppText variant="headline">站內通知</AppText>
          <AppText tone="muted">一定會收到，在「通知」分頁查看。</AppText>
        </Card>
        <Card>
          <AppText variant="headline">Email 通知</AppText>
          {!data.emailReady ? <NoticeBox text="Email 通知尚未開放，之後開放時會依你的設定寄出。" /> : null}
          <Field
            label="聯絡信箱"
            value={email}
            onChange={setEmail}
            placeholder="name@example.com"
            hint={data.source === "central" ? "這和會員中心的「聯絡信箱」是同一個欄位，在這裡修改會同步更新會員中心，不影響登入。" : "測試帳號的信箱只存在本 App。"}
          />
          <Button label="儲存信箱" disabled={busy || !changed} onPress={() => save({ email: email.trim() || null }, email.trim() ? "已儲存信箱" : "已清除信箱")} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="body" style={{ fontWeight: "600" }}>
                寄 Email 給我
              </AppText>
              <AppText variant="caption" tone="muted">
                {data.notifyEmail ? "開啟：有通知時也會寄到信箱" : "關閉：只在 App 內通知"}
              </AppText>
            </View>
            <Switch
              value={data.notifyEmail}
              disabled={busy}
              onValueChange={(v) => save({ notifyEmail: v }, v ? "已開啟 Email 通知" : "已關閉 Email 通知")}
              trackColor={{ false: c.border, true: c.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={c.border}
              accessibilityLabel="Email 通知開關"
            />
          </View>
          {!data.email ? <AppText variant="caption" tone="muted">還沒有信箱，所以目前不會寄 Email。</AppText> : null}
          <View style={{ gap: 4, opacity: data.notifyEmail ? 1 : 0.5 }}>
            <AppText variant="headline">哪些情況要寄 Email</AppText>
            <AppText variant="caption" tone="muted">
              預設只寄「付費課程相關的審核通知」，其他想收到再打開。（手機推播不受這裡影響，所有通知都會推播。）
            </AppText>
            {NOTICE_KINDS.map((k) => (
              <View key={k.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 6 }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="body" style={{ fontWeight: "600" }}>
                    {k.label}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {k.desc}
                  </AppText>
                </View>
                <Switch
                  value={!!data.emailKinds?.[k.key]}
                  disabled={busy || !data.notifyEmail}
                  onValueChange={(v) => save({ emailKinds: { [k.key]: v } }, v ? `已開啟「${k.label}」的 Email` : `已關閉「${k.label}」的 Email`)}
                  trackColor={{ false: c.border, true: c.accent }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={c.border}
                  accessibilityLabel={`${k.label} Email 通知開關`}
                />
              </View>
            ))}
          </View>
        </Card>
      </Section>
      {msg ? <NoticeBox text={msg.text} tone={msg.ok ? "success" : "danger"} /> : null}
    </Screen>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  on: "開啟：有新通知時，手機會跳出提醒（關掉 App 也收得到）。",
  off: "關閉：只在 App 內的「通知」分頁看得到。",
  denied: "你之前拒絕了通知權限。請到瀏覽器或手機的「網站設定 > 通知」允許本網站，再回來開啟。",
  "ios-needs-install": "iPhone／iPad 要先把本網站「加入主畫面」：按 Safari 下方的分享鈕 →「加入主畫面」，再從主畫面的圖示開啟，就能在這裡開啟推播（需要 iOS 16.4 以上）。",
  unsupported: "這個瀏覽器不支援推播通知，請改用 Chrome、Edge 或 Safari（iPhone 需加入主畫面）。",
  "not-ready": "手機推播尚未開放，開放後就能在這裡開啟。",
};

/** 手機推播（業主 2026-11-17）：這個裝置的開關＋傳一則測試通知。每個裝置各自開啟。 */
function PushCard() {
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
      await api("POST", "/push/test");
      setMsg({ text: "已送出測試通知，幾秒內手機會跳出提醒。", ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "送出失敗", ok: false });
    }
    setBusy(false);
  };
  if (Platform.OS !== "web")
    return (
      <Card>
        <AppText variant="headline">手機推播</AppText>
        <AppText tone="muted">App 版的推播會在正式上架時開放；目前請用網頁版開啟。</AppText>
      </Card>
    );
  const canToggle = state === "on" || state === "off";
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">手機推播</AppText>
          <AppText variant="caption" tone="muted">
            所有通知都會直接推到這支手機（不能逐項關閉，要收就是全部收）。
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
    </Card>
  );
}
