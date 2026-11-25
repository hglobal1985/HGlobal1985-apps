import "@/lib/global-scale"; // 全站字體、圖示、按鈕放大（平板 1.3、電腦 1.1，theme/ui-scale.ts）
import "@/lib/install-app"; // 要最早載入，才接得到瀏覽器只送一次的「可安裝」事件
import { installErrorReporting, reportClientError } from "@/lib/error-report";
import { Stack } from "expo-router/stack";
import { router } from "expo-router";
import { useEffect } from "react";
import { installVisitTracking } from "@/lib/usage";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { Platform, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppGate } from "@/features/app-gate";
import { ConfirmSheetHost } from "@/features/confirm";
import { FlashHost } from "@/ui/flash-notice";
import { MiniAudioBar } from "@/features/player/audio-bar";
import { PlayerLayer } from "@/features/player/player-layer";
import { installNoPageZoom } from "@/lib/no-page-zoom";
import { installStableScrollbar } from "@/lib/stable-scrollbar";
import { installWebPullRefresh } from "@/lib/web-pull-refresh";
import { CenterNamesProvider } from "@/state/center-names";
import { SessionProvider } from "@/state/session";
import { UiConfigProvider } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { installBottomGap } from "@/lib/bottom-gap";
import { useElderVersion } from "@/lib/elder-mode";
import { restoreScroll, trackScroll } from "@/lib/keep-scroll";
import { useLayout } from "@/theme/layout";
import { UpdateNotice } from "@/features/update-notice";
import { BottomBar, InAppBrowserBanner, TopBar, TopBarShadow } from "@/ui";

installErrorReporting(); // 前台錯誤自動回報（lib/error-report.ts）

/** 任何頁面畫面出錯時顯示的白話畫面（Expo Router 的根錯誤邊界）：自動回報錯誤，提供「重新載入」。 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => reportClientError("render", error), [error]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16, backgroundColor: "#F8F6EF" }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#1B2A22", textAlign: "center" }}>這個畫面暫時出了點問題</Text>
      <Text style={{ fontSize: 15, color: "#55605A", textAlign: "center" }}>已自動回報給我們。請按下方按鈕重新載入。</Text>
      <Pressable accessibilityRole="button" onPress={() => (Platform.OS === "web" && typeof location !== "undefined" ? location.reload() : void retry())} style={{ minHeight: 48, paddingHorizontal: 28, borderRadius: 12, backgroundColor: "#0C603C", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>重新載入</Text>
      </Pressable>
    </View>
  );
}

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
              header: ({ options }) => <TopBar title={typeof options.title === "string" ? options.title : ""} right={options.headerRight?.({ canGoBack: true })} backTo={(options as { backTo?: string }).backTo} backAlways={(options as { backAlways?: boolean }).backAlways} safeTop />,
              contentStyle: { backgroundColor: c.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "寰宇行動大學" }} />
            <Stack.Screen name="course/[id]" options={{ title: "課程介紹" }} />
            <Stack.Screen name="review-invite/[token]" options={{ title: "審核人員邀請" }} />
            <Stack.Screen name="library" options={{ headerShown: false }} />
            <Stack.Screen name="my-lists" options={{ title: "我的清單" }} />
            <Stack.Screen name="my-list/[id]" options={{ title: "清單設定" }} />
            <Stack.Screen name="library-settings" options={{ title: "書櫃設定" }} />
            <Stack.Screen name="library-invite/[code]" options={{ title: "我的書櫃邀請" }} />
            <Stack.Screen name="admin/libraries" options={{ title: "書櫃管理" }} />
            <Stack.Screen name="admin/list-unlocks" options={{ title: "清單解鎖設定" }} />
            <Stack.Screen name="[slug]" options={{ title: "課程" }} />
            <Stack.Screen name="series/[name]" options={{ title: "課程" }} />
            <Stack.Screen name="learn/[courseId]/[lessonId]" options={{ title: "上課" }} />
            <Stack.Screen name="admin/list-rules" options={{ title: "課程排序與條件" }} />
            <Stack.Screen name="admin/stats" options={{ title: "統計分析" }} />
            <Stack.Screen name="admin/usage" options={{ title: "使用統計" }} />
            <Stack.Screen name="admin/report" options={{ title: "報名與營收報表" }} />
            <Stack.Screen name="admin/keywords" options={{ title: "關鍵字管理" }} />
            <Stack.Screen name="admin/short-links" options={{ title: "短網址" }} />
            <Stack.Screen name="admin/app-settings" options={{ title: "APP 數值設定" }} />
            <Stack.Screen name="admin/share-defaults" options={{ title: "分享預設值" }} />
            <Stack.Screen name="admin/editors" options={{ title: "小編管理" }} />
            <Stack.Screen name="admin/staff-roles" options={{ title: "會員職務指派" }} />
            <Stack.Screen name="admin/ai-models" options={{ title: "AI 模型" }} />
            <Stack.Screen name="admin/ai-text" options={{ title: "AI 文字辨識" }} />
            <Stack.Screen name="admin/thumb-badges" options={{ title: "縮圖符號" }} />
            <Stack.Screen name="achievements" options={{ title: "學習成就" }} />
            <Stack.Screen name="mode" options={{ title: "至尊模式" }} />
            <Stack.Screen name="admin/achievements" options={{ title: "徽章任務設定" }} />
            <Stack.Screen name="admin/brand-logos" options={{ title: "品牌 Logo" }} />
            <Stack.Screen name="admin/list-cover-bgs" options={{ title: "清單封面底圖" }} />
            <Stack.Screen name="admin/synonyms" options={{ title: "搜尋關聯詞" }} />
            <Stack.Screen name="admin/search-settings" options={{ title: "搜尋與 AI 設定" }} />
            <Stack.Screen name="admin/youtube-syncs" options={{ title: "同步 YouTube 清單" }} />
            <Stack.Screen name="admin/thumbnails" options={{ title: "Cloudflare即時縮圖" }} />
            <Stack.Screen name="admin/storage" options={{ title: "儲存空間管理" }} />
            <Stack.Screen name="comments/[courseId]" options={{ title: "留言板" }} />
            <Stack.Screen name="orders/index" options={{ title: "訂單紀錄" }} />
            <Stack.Screen name="orders/[id]" options={{ title: "報名明細" }} />
            <Stack.Screen name="admin/orders/index" options={{ title: "報名審核" }} />
            <Stack.Screen name="admin/orders/[id]" options={{ title: "審核報名" }} />
            <Stack.Screen name="settings/notifications" options={{ title: "通知設定" }} />
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
  const { c } = useTheme();
  const { large } = useLayout();
  if (Platform.OS !== "web" || insets.top <= 0) return null;
  // 平板（業主 2026-11-20）：狀態列底下用頁面底色，不要一塊深綠壓在工具列上方。
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: insets.top, backgroundColor: large ? c.background : "#2F5D3A", zIndex: 1000 }} />;
}

/** 閒置時預先載入底部五個分頁的程式檔（不切換畫面、不抓資料）。 */
function warmTabChunks(): () => void {
  if (Platform.OS !== "web") return () => undefined;
  const t = setTimeout(() => {
    for (const href of ["/notices", "/courses", "/learning", "/me"]) {
      try {
        router.prefetch(href as never);
      } catch {
        /* 預載失敗不影響使用，點進去時照常載入 */
      }
    }
  }, 400);
  return () => clearTimeout(t);
}

export default function RootLayout() {
  const { scheme, c } = useTheme();
  useEffect(() => installVisitTracking(), []);
  useEffect(() => installNoPageZoom(), []);
  useEffect(() => installBottomGap(), []);
  useEffect(() => installWebPullRefresh(), []);
  useEffect(() => installStableScrollbar(), []);
  // 網頁版：開站後稍等，把其他分頁的程式檔先載入（每個分頁是獨立檔案，手機網路慢時第一次點進去會空白一陣子，業主 2026-11-22 回報）。
  useEffect(() => warmTabChunks(), []);
  // 至尊模式切換或改字體大小（lib/elder-mode.ts）：重建頁面，已經畫好的字才會換成新大小（業主 2026-11-24）。
  const elderV = useElderVersion();
  useEffect(() => trackScroll(), []);
  // 字體倍數改變、頁面重建後，捲回原本的位置（不要跳回頁首）。
  useEffect(() => (elderV > 0 ? restoreScroll() : undefined), [elderV]);
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
          {/* App 內建瀏覽器警示條：所有頁面最上方（業主 2026-11-17），只有這一處。 */}
          <InAppBrowserBanner />
          <View style={{ flex: 1 }} key={`elder-${elderV}`}>
          <AppStack />
          <TopBarShadow />
          </View>
          <MiniAudioBar />
          <UpdateNotice />
          <BottomBar />
          <PlayerLayer />
          <ConfirmSheetHost />
          <FlashHost />
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
