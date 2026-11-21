import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, HQ_UNIT, type Announcement, type CourseSummary } from "@/api/client";
import { HomeBroadcastSheet } from "@/features/broadcast/broadcast-zone";
import { MemberHeader } from "@/features/member-header";
import { useProfileGate } from "@/features/profile-gate";
import { HOME_INFO_SPACE, HomeRail } from "@/features/courses/home-rail";
import { collapseSeries } from "@/features/courses/sort";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/theme";
import { maxContentWidth, space } from "@/theme/tokens";
import { usePullRefresh } from "@/ui/pull-refresh";
import { AppText, BrandTitle, ErrorView, InstallCard, LoginPrompt, LoadingView, Ticker } from "@/ui";

/**
 * 首頁：固定一頁、不上下捲動。上方置中顯示大標題與會員頭像＋姓名（點擊進入會員中心編輯基本資料）、跑馬燈公告，下方左右兩個直式區塊（繼續學習、推薦課程），
 * 各自可以原地左右滑動瀏覽課程海報（EDM 本身，沒有 EDM 就用課程名稱）。推薦課程只顯示符合會員獎銜、尚未報名的課程。
 */
// 每次登入只彈一次（登出後再登入會再提示）。

export default function HomeScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // 大螢幕（業主 2026-11-18）：內容放寬到 960、左右留白加大；海報區在 HomeRail 依欄寬保留足夠高度（橫放時頁面可往下捲，不把海報裁成扁條）。
  const lay = useLayout();
  // 首頁一律一頁顯示、不上下捲動（業主永久指示）：橫式（寬 > 高，平板、手機、電腦都一樣）標題與會員資料並排成一行；
  // 直式維持兩行，並依視窗比例放大（寬度越大放越大，上限 1.55 倍）。
  const landscape = lay.width > lay.height;
  const shortLand = landscape && lay.height < 500; // 手機橫放：空間很矮，隱藏安裝提醒與備註
  const k = landscape ? Math.max(0.75, Math.min(1, lay.height / 600)) : lay.large ? 1.15 : 1; // 字體本身的放大由 lib/global-scale.ts 統一處理，這裡只調標題區比例
  const { member } = useSession();
  const { data, error, reload } = useApi<CourseSummary[]>("/courses");
  const [quote, setQuote] = useState<string | null>(null);
  const [noticeClosed, setNoticeClosed] = useState(false);
  // 版面太擠（上面的安裝提醒、公告占掉空間）時，先隱藏左右海報下方的資訊；使用者關掉提醒騰出空間後自動恢復（業主 2026-11-19）。
  // 判斷用「顯示資訊時海報還剩多高」：已隱藏時要扣掉資訊區的高度；加 12px 緩衝避免在邊界來回閃動。
  const stageH = useRef({ a: 0, b: 0 });
  const [tight, setTight] = useState(false);
  const reportStage = (key: "a" | "b") => (h: number) => {
    stageH.current[key] = h;
    const hs = [stageH.current.a, stageH.current.b].filter((x) => x > 0);
    if (!hs.length) return;
    const stage = Math.min(...hs);
    setTight((prev) => (prev ? stage - HOME_INFO_SPACE < HOME_MIN_POSTER + 12 : stage < HOME_MIN_POSTER));
  };
  const gate = useProfileGate(member);
  const refreshControl = usePullRefresh(); // 首頁也能下拉：立刻更新名字旁的獎銜標籤
  // 每次進入首頁換一則學習金句。
  useFocusEffect(
    useCallback(() => {
      setNoticeClosed(false); // 每次進入首頁，公告都會再顯示
      api<{ text: string | null }>("GET", "/quotes/random")
        .then((r) => setQuote(r.text))
        .catch(() => undefined);
    }, []),
  );
  const { config } = useUiConfig();
  const notices = useApi<Announcement[]>("/announcements", { early: true });
  const [noticeOpen, setNoticeOpen] = useState(false); // 點跑馬燈：開完整公告清單（超級管理員可在裡面修改、刪除）
  const courses = data ?? [];
  const mine = courses
    // 與「學習中」頁同一個規則：已開通或播放超過 1% 的課程（被隱藏的不列）。
    .filter((x) => !x.isList && (x.enrollment === "opened" || x.started) && !x.hiddenFromLearning) // 清單類別（清單卡）不列入繼續學習
    .sort((a, b) => Number(b.completedLessons < b.lessonCount) - Number(a.completedLessons < a.lessonCount));
  // 會員：符合獎銜、尚未報名的課程；訪客：完全公開的課程。
  // 推薦課程的規則由「設定 > APP 數值設定」控制：範圍（我的中心／全部）、是否納入總部主辦、獎銜資格、已結束、同系列只推最近一場、排序、上限。
  const rules = config.app.rec;
  const norm = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const myCenter = norm(member?.center ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const inScope = (x: CourseSummary) => {
    if (rules.scope === "all") return true;
    const hosts = x.hostUnit.split(/[、,，]+/).map((h) => h.trim()).filter((h) => h && h !== HQ_UNIT);
    return hosts.length ? !!myCenter && hosts.some((h) => norm(h) === myCenter) : rules.includeHq;
  };
  const recommendedAll = courses.filter(
    (x) =>
      x.status === "published" &&
      x.enrollment !== "opened" &&
      !x.started &&
      x.viewScope !== "link_login" && x.viewScope !== "link_guest" && (member ? (!rules.onlyEligible || x.eligible) && !x.isPublic && inScope(x) : x.isPublic) &&
      !(rules.hideEnded && (x.eventEnd ?? x.eventStart ?? "9999") < today),
  );
  const ordered =
    rules.order === "soonest"
      ? [...recommendedAll].sort((a, b) => (a.eventStart ?? "9999-12-31").localeCompare(b.eventStart ?? "9999-12-31"))
      : rules.order === "newest"
        ? [...recommendedAll].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        : recommendedAll;
  const collapsed = rules.collapseSeries ? collapseSeries(ordered, ordered).map((e) => e.course) : ordered;
  const recommended = rules.max > 0 ? collapsed.slice(0, rules.max) : collapsed;
  return (
    <>
    {gate.element}
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={[styles.page, { paddingTop: insets.top + space.md, paddingHorizontal: lay.large ? lay.gutter : space.md }]} refreshControl={refreshControl} alwaysBounceVertical keyboardShouldPersistTaps="handled">
      <View style={[styles.inner, lay.large ? { maxWidth: Math.min(lay.wideMax, 960), gap: space.lg } : null]}>
        <View style={[styles.head, landscape && { flexDirection: "row", justifyContent: "center", gap: space.xl }]}>
          <BrandTitle scale={k} />
          {member ? (
            <MemberHeader member={member} scale={k} onPress={member.demo ? undefined : gate.open} />
          ) : null}
        </View>
        <LoginPrompt />
        {shortLand ? null : <InstallCard dismissible />}
        {noticeClosed ? null : <Ticker items={(notices.data ?? []).map((n) => n.text)} everyMs={config.app.tickerSec * 1000} pauseMs={config.app.tickerPauseSec * 1000} onPress={() => setNoticeOpen(true)} onClose={() => setNoticeClosed(true)} />}
        {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
        {!data && !error ? <LoadingView /> : null}
        {data ? (
          <View style={styles.middle}>
          <View style={[styles.rails, lay.large ? { gap: space.lg } : null]}>
            <HomeRail
              title="繼續學習"
              icon="book-outline"
              tone="green"
              courses={mine}
              scale={k}
              compact={shortLand}
              hideInfo={tight && !shortLand}
              onStageHeight={reportStage("a")}
              autoSec={config.app.homeLeftSec}
              pauseSec={config.app.homePauseSec}
              note={quote ?? undefined}
              progress
              empty={
                member ? (
                  <AppText variant="callout" tone="muted" style={{ textAlign: "center" }}>
                    還沒有已報名的課程，到「寰宇大學」看看。
                  </AppText>
                ) : (
                  <>
                    <AppText variant="callout" tone="muted" style={{ textAlign: "center" }}>
                      登入後顯示你已報名的課程。
                    </AppText>
                  </>
                )
              }
            />
            <HomeRail
              title="推薦課程"
              icon="sparkles-outline"
              tone="orange"
              courses={recommended}
              scale={k}
              compact={shortLand}
              hideInfo={tight && !shortLand}
              onStageHeight={reportStage("b")}
              autoSec={config.app.homeRightSec}
              pauseSec={config.app.homePauseSec}
              note={rules.scope === "all" ? "顯示您可報名的課程" : "顯示您中心、您可報名的課程"}
              empty={
                <AppText variant="callout" tone="muted" style={{ textAlign: "center" }}>
                  {member ? "目前沒有符合你獎銜、尚未報名的課程。" : "目前沒有公開的課程，登入後顯示您可報名的課程。"}
                </AppText>
              }
            />
          </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
    {noticeOpen ? <HomeBroadcastSheet onClose={() => setNoticeOpen(false)} onChanged={notices.reload} /> : null}
    </>
  );
}

/** 海報區至少要有這麼高才算夠用（太矮就先隱藏海報下方的資訊）。 */
const HOME_MIN_POSTER = 150;

const styles = StyleSheet.create({
  page: { flexGrow: 1, alignItems: "center", paddingHorizontal: space.md, overflow: "hidden" },
  inner: { width: "100%", maxWidth: maxContentWidth, gap: space.md, flex: 1 },
  head: { alignItems: "center", gap: space.sm, flexWrap: "nowrap" },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  logo: { width: 44, height: 44 },
  rails: { flex: 1, flexDirection: "row", gap: space.md, alignItems: "stretch" },
  middle: { flex: 1, paddingBottom: space.sm },
});
