import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppGate } from "@/features/app-gate";
import { ConfirmSheetHost } from "@/features/confirm";
import { ToastHost } from "@/ui/toast";
import { MiniAudioBar } from "@/features/player/audio-bar";
import { PlayerLayer } from "@/features/player/player-layer";
import { SwitchSheet } from "@/features/player/switch-sheet";
import { installNoPageZoom } from "@/lib/no-page-zoom";
import { installWebPullRefresh } from "@/lib/web-pull-refresh";
import { CenterNamesProvider } from "@/state/center-names";
import { SessionProvider } from "@/state/session";
import { UiConfigProvider } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { UpdateNotice } from "@/features/update-notice";
import { BottomBar, TopBar, TopBarShadow } from "@/ui";

/**
 * 全站頁面堆疊與上方標題列。標題列高度＝固定的 barHeight＋手機上方的安全區（瀏海、狀態列）；
 * 網頁在 iPhone 以 App 方式開啟時畫面會延伸到狀態列底下，所以要把這一塊算進標題列高度，標題與分享鈕才不會被時間、訊號蓋住。
 */
function AppStack() {
  const { c } = useTheme();
  return (
    <Stack
            screenOptions={{
              // 全站上方返回工具列只用一個元件 TopBar（src/ui/top-bar.tsx）：頁面用 Stack.Screen／PageHeader 設定的 title 與 headerRight 會傳給它。
              header: ({ options, route }) => <TopBar title={typeof options.title === "string" ? options.title : route.name} right={options.headerRight?.({ canGoBack: true })} safeTop />,
              contentStyle: { backgroundColor: c.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "寰宇行動大學" }} />
            <Stack.Screen name="course/[id]" options={{ title: "課程介紹" }} />
            <Stack.Screen name="[slug]" options={{ title: "課程" }} />
            <Stack.Screen name="series/[name]" options={{ title: "課程" }} />
            <Stack.Screen name="learn/[courseId]/[lessonId]" options={{ title: "上課" }} />
            <Stack.Screen name="admin/list-rules" options={{ title: "課程排序與條件" }} />
            <Stack.Screen name="admin/stats" options={{ title: "統計分析" }} />
            <Stack.Screen name="admin/keywords" options={{ title: "關鍵字管理" }} />
            <Stack.Screen name="admin/editors" options={{ title: "小編管理" }} />
            <Stack.Screen name="admin/ai-models" options={{ title: "AI 模型" }} />
            <Stack.Screen name="achievements" options={{ title: "學習成就" }} />
            <Stack.Screen name="admin/achievements" options={{ title: "學習成就徽章設定" }} />
            <Stack.Screen name="orders/index" options={{ title: "訂單紀錄" }} />
            <Stack.Screen name="orders/[id]" options={{ title: "報名明細" }} />
            <Stack.Screen name="admin/orders/index" options={{ title: "報名審核" }} />
            <Stack.Screen name="admin/orders/[id]" options={{ title: "審核報名" }} />
            <Stack.Screen name="settings/notifications" options={{ title: "通知設定" }} />
            <Stack.Screen name="admin/announcements" options={{ title: "跑馬燈公告" }} />
            <Stack.Screen name="admin/quotes" options={{ title: "編輯學習金句" }} />
            <Stack.Screen name="admin/review-groups" options={{ title: "審核群組" }} />
            <Stack.Screen name="admin/comments" options={{ title: "留言檢舉" }} />
            <Stack.Screen name="admin/mux-picker" options={{ title: "從 Mux 選擇影片" }} />
            <Stack.Screen name="auth/done" options={{ headerShown: false }} />
            <Stack.Screen name="auth/google" options={{ headerShown: false }} />
            <Stack.Screen name="auth/sso" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * 網頁（iPhone 以 App 方式開啟）狀態列底下的底色：畫面延伸到狀態列底下時，塗上品牌深綠，
 * 讓白色的時間、訊號清楚可讀，也不會跟標題列混在一起。手機沒有這塊安全區時不顯示。
 */
function StatusBarCover() {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "web" || insets.top <= 0) return null;
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: insets.top, backgroundColor: "#2F5D3A", zIndex: 1000 }} />;
}

export default function RootLayout() {
  const { scheme, c } = useTheme();
  useEffect(() => installNoPageZoom(), []);
  useEffect(() => installWebPullRefresh(), []);
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.background, card: c.surface, text: c.text, border: c.border },
  };
  return (
    <SafeAreaProvider>
      <AppGate>
      <SessionProvider>
        <UiConfigProvider>
        <CenterNamesProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <View style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ flex: 1 }}>
          <AppStack />
          <TopBarShadow />
          </View>
          <MiniAudioBar />
          <UpdateNotice />
          <BottomBar />
          <PlayerLayer />
          <SwitchSheet />
          <ConfirmSheetHost />
          <ToastHost />
          <StatusBarCover />
          </View>
        </ThemeProvider>
        </CenterNamesProvider>
        </UiConfigProvider>
      </SessionProvider>
      </AppGate>
    </SafeAreaProvider>
  );
}
