import "@/lib/global-scale"; // 共用：全站字體、圖示、按鈕放大（平板、電腦、至尊模式）
import "@/lib/install-app"; // 共用：「加入主畫面」要最早載入
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { installBottomGap } from "@/lib/bottom-gap";
import { installErrorReporting } from "@/lib/error-report";
import { BottomBar } from "@/ui/bottom-bar";
import { installNoPageZoom } from "@/lib/no-page-zoom";
import { installStableScrollbar } from "@/lib/stable-scrollbar";
import { installWebPullRefresh } from "@/lib/web-pull-refresh";
import { devSignIn, signIn, webLoginAvailable } from "@/central/auth";
import { PRIVACY_URL } from "@/central/config";
import { SessionProvider, useSession } from "@/state/session";
import { font, useColors } from "@/kit";
import { Btn, Field, flashError, Hosts, Loading, T } from "@/kit";

installErrorReporting(); // 共用：前台錯誤自動回報（lib/error-report.ts，與行動大學同一份）；舊版網頁檔案失效時自動重新載入

export default function Root() {
  // 共用的全站行為（與行動大學相同）：禁止雙指縮放頁面、底部安全區、下拉重新整理、固定捲軸位置。
  useEffect(() => installNoPageZoom(), []);
  useEffect(() => installBottomGap(), []);
  useEffect(() => installWebPullRefresh(), []);
  useEffect(() => installStableScrollbar(), []);
  return (
    <SafeAreaProvider>
      <Hosts>
        <SessionProvider>
          <StatusBar style="auto" />
          <Gate />
        </SessionProvider>
      </Hosts>
    </SafeAreaProvider>
  );
}

function Gate() {
  const s = useSession();
  const c = useColors();
  const path = usePathname();
  if (s.gate === "paused") return <Message title="系統維護中" note="請稍後再回來，造成不便請見諒。" />;
  if (s.gate === "killed") return <Message title="這個 App 已停止服務" note="如有問題請聯絡你的作業管理員。" />;
  if (s.gate === "update") return <Message title="請更新 App" note="目前的版本太舊了，請到 App Store 或 Google Play 更新後再使用。" />;
  if (!s.ready) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: "center" }}><Loading /></View>;
  // 從中央登入回來（/auth/done）：交給 auth/done 頁導回原本要去的頁面（不用先登入）
  if (!s.signedIn && !path.startsWith("/auth/")) return <Login deleted={s.deleted} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
      </View>
      {/* 底部主選單：共用元件（與行動大學同一個；分頁設定在 src/lib/nav-tabs.tsx） */}
      <BottomBar />
    </View>
  );
}

function Message({ title, note }: { title: string; note: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
      <Text style={[font.page, { color: c.fg, textAlign: "center" }]}>{title}</Text>
      <T muted style={{ textAlign: "center" }}>{note}</T>
    </View>
  );
}

function Login({ deleted }: { deleted: boolean }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [dev, setDev] = useState("");
  const canGoogle = webLoginAvailable();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ width: "100%", maxWidth: 360, alignItems: "center", gap: 18 }}>
        <View style={{ width: 96, height: 96, borderRadius: 26, backgroundColor: c.green, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.on, fontSize: 48, fontWeight: "800" }}>✓</Text>
        </View>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={[font.page, { color: c.fg }]}>寰宇繳作業系統</Text>
          <T small muted>交作業、看批改、組員互相打氣</T>
        </View>
        {deleted ? <T small muted style={{ textAlign: "center" }}>你的帳號已刪除。</T> : null}
        {canGoogle ? (
          <Btn
            label="使用 Google 登入"
            busy={busy}
            flex={false}
            onPress={async () => {
              setBusy(true);
              try {
                await signIn();
              } catch (e) {
                flashError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <View style={{ width: "100%", gap: 8 }}>
            <T small muted>本機測試：輸入測試代號登入（admin 開頭＝超級管理員）</T>
            <Field value={dev} onChangeText={setDev} placeholder="例如 admin1、amy" autoCapitalize="none" />
            <Btn label="測試登入" flex={false} disabled={!dev.trim()} onPress={() => devSignIn(dev.trim())} />
          </View>
        )}
        <T tiny muted style={{ textAlign: "center" }}>和其他寰宇 App 共用同一個帳號；在同一支手機登入過任何一個，就會自動登入。</T>
        <Pressable accessibilityRole="link" onPress={() => (Platform.OS === "web" ? window.open(PRIVACY_URL, "_blank") : Linking.openURL(PRIVACY_URL))} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: c.green, fontWeight: "700" }}>隱私權政策</Text>
        </Pressable>
      </View>
    </View>
  );
}
