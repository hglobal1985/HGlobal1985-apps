import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { centerTitle } from "@/features/format";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { confirmAsk } from "@/features/confirm";
import { MemberHeader } from "@/features/member-header";
import { useProfileGate } from "@/features/profile-gate";
import { startDeleteReauth } from "@/api/central";
import { openAccountCenter } from "@/features/account-link";
import type { AppConfig, LibraryMine, Member } from "@/api/client";
import { canManageCourses, canManageEditors } from "@/lib/roles";
import { useModeProfile } from "@/lib/app-mode";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { GuestGate, AppText, Button, Card, ListRow, LoadingView, NoticeBox, Pill, SandboxBanner, Screen, Section } from "@/ui";

/**
 * 頁尾：與寰宇中央會員網站的頁尾相同（淡色小字：左邊「隱私權政策」連結、右邊設計者署名）。
 * 只放在「設定」頁面最下方，其他頁面不顯示。尺寸與淺色模式的顏色照中央會員（14px、#5d6b62、署名 #cfd2c9）；深色模式用等比例的淡化色。
 */
function SiteFooter() {
  const { scheme } = useTheme();
  const link = scheme === "dark" ? "#a6adab" : "#5d6b62";
  const credit = scheme === "dark" ? "#3d4441" : "#cfd2c9";
  return (
    <View style={styles.foot}>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL("https://id.hglobal1985.com/privacy")}>
        <Text style={[styles.footText, { color: link, textDecorationLine: "underline" }]}>隱私權政策</Text>
      </Pressable>
      <Text style={[styles.footText, styles.credit, { color: credit }]}>系統設計 杜杜龍</Text>
    </View>
  );
}

export default function MeScreen() {
  const { member, ready, signInGoogle, signInDemo, signOut, deleteAccount, deleteCentralAccount, refreshMember } = useSession();
  // 進入設定頁就向會員中心更新一次獎銜與資料（1 分鐘內不重複）：App 沒有重新整理鈕，這裡是最自然的更新時機。
  useFocusEffect(
    useCallback(() => {
      void refreshMember(60_000);
    }, [refreshMember]),
  );
  const { next } = useLocalSearchParams<{ next?: string }>();
  const back = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const config = useApi<AppConfig>("/config");
  const gate = useProfileGate(member);
  const myLibrary = useApi<LibraryMine>(member ? "/library/mine" : null);
  // 「會員職務指派」入口：只有中央判斷有權限的人才顯示（任何非 200 都當沒有權限）。
  const staffAccess = useApi<{ available: boolean }>(member ? "/staff-roles/access" : null);
  const demo = useApi<Member[]>(!member && config.data?.demoLogin ? "/demo-members" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const isWeb = Platform.OS === "web";
  // 至尊模式（業主 2026-11-24）：這頁只從模式面板的「帳號」進來；不顯示我的清單、我的書櫃與管理功能。
  const { features } = useModeProfile();

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage({ tone: "success", text: done });
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const removeAccount = async () => {
    const central = !member?.demo;
    const ok = await confirmAsk(
      "刪除帳號",
      central
        ? "會刪除你在所有寰宇 App 的帳號與資料（包含會員中心的個人資料與 Amway 資料、本 App 的學習紀錄、報名紀錄、徽章、通知），無法復原。\n\n確定後會請你再按一次 Google 登入確認身分。"
        : "將刪除這個測試帳號在本 App 的所有資料（學習紀錄、報名紀錄、徽章、通知）。",
      "確定刪除",
    );
    if (!ok) return;
    if (!central) return run("delete", deleteAccount, "已刪除測試帳號的資料。");
    // App 內直接刪除（中央串接指令 2026-11-23.3）：重新驗證 → 中央刪除 → 成功才清本 App 資料；網頁版整頁跳去驗證，回來由 /auth/done 接手。
    await run("delete", async () => {
      const r = await startDeleteReauth();
      if (r.status === "ok") await deleteCentralAccount(r.reauthToken);
    });
  };

  return (
    <Screen>
      {gate.element}
      {message ? <NoticeBox tone={message.tone} text={message.text} /> : null}
      {!ready ? <LoadingView /> : null}
      {member ? (
        <View style={styles.headWho}>
          <MemberHeader member={member} onPress={member.demo ? undefined : gate.open} />
          <View style={[styles.row, { justifyContent: "center" }]}>
            {member.titles.length ? member.titles.map((t) => <Pill key={t} label={t} />) : <Pill label={member.role === "admin" ? "管理員" : "學員"} />}
            {member.center ? <Pill label={centerTitle(member.center)} tone="accent" /> : null}
            {member.demo ? <Pill label="測試帳號" tone="warning" /> : null}
          </View>
        </View>
      ) : ready ? (
        <Section title="">
          <GuestGate
            body="登入後即可報名課程、記錄學習進度。課程的獎銜資格會依你在會員中心的資料自動判斷。"
            loading={busy === "google"}
            onLogin={() => void run("google", async () => {
              await signInGoogle(back ?? "/");
              router.replace((back ?? "/") as Href); // 登入後預設回首頁
            })}
          />
          {config.data?.demoLogin ? (
            <>
              <SandboxBanner text="內部測試：也可以用以下測試身分登入（資料為示範用）。" />
              <Card style={{ paddingVertical: 0 }}>
                {(demo.data ?? []).map((m) => (
                  <ListRow
                    key={m.sub}
                    icon={m.role === "admin" ? "shield-checkmark-outline" : "person-outline"}
                    title={m.name}
                    subtitle={m.rank ? `示範獎銜：${m.rank.name}` : undefined}
                    onPress={() => run(`in-${m.sub}`, async () => {
                      await signInDemo(m.sub);
                      router.replace((back ?? "/") as Href);
                    })}
                    right={busy === `in-${m.sub}` ? <AppText tone="muted">登入中…</AppText> : undefined}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </Section>
      ) : null}

      {member && isWeb ? (
        <Card style={{ paddingVertical: 0 }}>
          {!features.myLists ? null : <ListRow icon="list-outline" title="我的清單" subtitle="自己建立的清單：分享網址、點擊人數、備註" onPress={() => router.push("/my-lists")} />}
          {!features.library ? null : <ListRow icon="library-outline" title="我的書櫃" subtitle={myLibrary.data?.library ? "個人專屬頁面：書架、影片、簡報、連結，可設密碼" : "尚未解鎖書櫃鑰匙"} onPress={() => router.push("/library")} />}
          <ListRow icon="document-text-outline" title="訂單紀錄" onPress={() => router.push("/orders")} />
        </Card>
      ) : null}

      {member && features.manageSection && (member.reviewer || member.role === "admin" || canManageCourses(member) || member.canViewStats) ? (
        <Section title="管理">
          <Card style={{ paddingVertical: 0 }}>
            {canManageEditors(member) ? <ListRow icon="people-circle-outline" title="小編管理" subtitle="指派同中心的會員協助編輯課程與章節" onPress={() => router.push("/admin/editors")} /> : null}
            {staffAccess.data?.available ? <ListRow icon="key-outline" title="會員職務指派" subtitle="依中心或姓名找會員，直接修改會員中心的職務" onPress={() => router.push("/admin/staff-roles")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="chatbubble-ellipses-outline" title="編輯學習金句" subtitle="首頁「繼續學習」下方的金句" onPress={() => router.push("/admin/quotes")} /> : null}
            {isWeb && member.reviewer ? <ListRow icon="receipt-outline" title="報名審核" subtitle="確認繳費後開通、匯出對帳報表" onPress={() => router.push("/admin/orders")} /> : null}
            {member.reviewer ? <ListRow icon="bar-chart-outline" title="報名與營收報表" subtitle="依中心、課程、月份統計報名與繳費金額，可匯出 Excel" onPress={() => router.push("/admin/report")} /> : null}
            {isWeb && (member.role === "admin" || member.titles.includes("會長") || member.titles.includes("音控")) ? (
              <ListRow icon="people-outline" title="審核群組" subtitle="指定各中心的報名窗口、收費窗口、審核員" onPress={() => router.push("/admin/review-groups")} />
            ) : null}
            {member.canViewStats ? <ListRow icon="stats-chart-outline" title="統計分析" subtitle="Mux 免費額度用量、觀看與播放品質統計" onPress={() => router.push("/admin/stats")} /> : null}
            {member.canViewStats ? <ListRow icon="analytics-outline" title="使用統計" subtitle="手機／電腦／平板、iOS／Android、時段與首頁卡片點閱，可交叉統計" onPress={() => router.push("/admin/usage")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="swap-vertical-outline" title="課程排序與條件" subtitle="全部課程的排序優先順位、卡片緞帶文字與顏色" onPress={() => router.push("/admin/list-rules")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="pricetags-outline" title="關鍵字管理" subtitle="集中新增、改名、刪除課程的分類、系列、場地" onPress={() => router.push("/admin/keywords")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="options-outline" title="APP 數值設定" subtitle="首頁推薦規則、輪播秒數與其他全站數值" onPress={() => router.push("/admin/app-settings")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="share-social-outline" title="分享預設值" subtitle="分享選單的文字、LINE 預覽卡片的標題與備註格式" onPress={() => router.push("/admin/share-defaults")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="list-outline" title="清單解鎖設定" subtitle="每位會員一開始能建幾份清單，完成指定成就再多解鎖幾份" onPress={() => router.push("/admin/list-unlocks")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="library-outline" title="書櫃管理" subtitle="產生「我的書櫃」邀請網址、查看與移除書櫃" onPress={() => router.push("/admin/libraries")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="link-outline" title="短網址" subtitle="集中設定分類、系列、中心的短網址與課程專屬網址" onPress={() => router.push("/admin/short-links")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="sparkles-outline" title="AI 模型" subtitle="切換逐字稿、關鍵字、語意搜尋用的 AI 模型，並比較花費" onPress={() => router.push("/admin/ai-models")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="document-text-outline" title="AI 文字辨識" subtitle="自訂 EDM 辨識文字要整理成哪些欄位（日期、時間、主題、講師…）" onPress={() => router.push("/admin/ai-text")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="trophy-outline" title="徽章任務設定" subtitle="依分類新增、修改所有徽章任務，並設定書櫃鑰匙門檻" onPress={() => router.push("/admin/achievements")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="images-outline" title="品牌 Logo" subtitle="上傳品牌 logo、選底圖或底色，並對應分類，課程與清單卡可用它當封面" onPress={() => router.push("/admin/brand-logos")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="happy-outline" title="縮圖符號" subtitle="總覽並設定中心卡、系列卡、課程卡的小縮圖符號（emoji 或文字）與顏色" onPress={() => router.push("/admin/thumb-badges")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="albums-outline" title="清單封面底圖" subtitle="上傳「我的清單」文字封面可選的底圖，清單名稱會自動放大並加光暈" onPress={() => router.push("/admin/list-cover-bgs")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="logo-youtube" title="同步 YouTube 清單" subtitle="貼上播放清單網址，手動按同步就把新影片匯成教材" onPress={() => router.push("/admin/youtube-syncs")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="image-outline" title="Cloudflare即時縮圖" subtitle="手機小螢幕的卡片縮圖即時縮小，設定所有縮圖選項與試算" onPress={() => router.push("/admin/thumbnails")} /> : null}
            {member.titles.includes("超級管理員") ? <ListRow icon="cloud-outline" title="儲存空間管理" subtitle="各中心已使用的檔案容量，以及圖片、文件、音檔的佔用比例" onPress={() => router.push("/admin/storage")} /> : null}
            {member.role === "admin" ? <ListRow icon="flag-outline" title="留言檢舉" subtitle="處理被檢舉的留言" onPress={() => router.push("/admin/comments")} /> : null}
          </Card>
        </Section>
      ) : null}

      {member ? (
        <Section title="帳號">
          <Card style={{ paddingVertical: 0 }}>
            {!member.demo ? (
              <ListRow icon="person-circle-outline" title="完整版會員中心" subtitle="修改基本資料" onPress={openAccountCenter} />
            ) : null}
            {features.deleteAccount ? <ListRow icon="trash-outline" title="刪除帳號" subtitle="刪除你在所有寰宇 App 的帳號與資料" onPress={removeAccount} /> : null}
          </Card>
        </Section>
      ) : null}

      {member ? (
        <Button
          variant="secondary"
          label={member.demo ? "登出" : "登出所有 App"}
          icon="log-out-outline"
          loading={busy === "logout"}
          onPress={() => run("logout", signOut)}
          fullWidth
        />
      ) : null}

      <SiteFooter />
      {member && !member.demo ? (
        <AppText variant="caption" tone="muted" selectable style={{ textAlign: "center" }}>
          會員 ID：{member.sub}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ foot: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 4, paddingBottom: 40 }, footText: { fontSize: 14, lineHeight: 23 }, credit: { flex: 1, textAlign: "right" }, row: { flexDirection: "row", flexWrap: "wrap", gap: space.xs + 2, marginTop: space.xs }, headWho: { alignItems: "center", gap: space.xs } });
