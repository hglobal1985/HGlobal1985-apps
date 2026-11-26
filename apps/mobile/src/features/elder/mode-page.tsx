import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { hasUnsaved, runGuarded } from "@/lib/unsaved-guard";
import { View } from "react-native";
import { MemberHeader } from "@/features/member-header";
import { PushSwitchRow } from "@/features/push-switch";
import { AccountCenterLink, ProfilePrompt } from "@/features/profile-prompt";
import { MODE_PROFILES } from "@/lib/app-mode";
import { useSession } from "@/state/session";
import { useLayout } from "@/theme/layout";
import { space } from "@/theme/tokens";
import { Button, GuestGate, InstallCard, LoadingView, Screen } from "@/ui";
import { askSwitchToMaker, FontSizeCard } from "./mode-actions";

/**
 * 至尊模式頁（杜杜龍 2026-11-24：按底部「至尊」鍵整頁顯示，至尊模式一律不用上拉選單）。由上到下：
 * 最上方並排「訂單紀錄｜超派模式」（杜杜龍 2026-11-24）→ 會員抬頭（頭像＋姓名／獎銜，獎章在右邊與頭像同高）→ 會員資料表單（與超派模式是同一個元件 ProfilePrompt，不加標題）
 * → 字體大小（勾「跟著手機」時＋／－灰掉）→ 帳號。
 */
export function ModePage() {
  const { member, ready } = useSession();
  const lay = useLayout();
  const { fill } = useLocalSearchParams<{ fill?: string }>(); // 登入後自動帶過來（會員資料沒填完）：捲到沒填的欄位
  // 返回（含瀏覽器／手機返回鍵）離開前：表單有未儲存的改動就攔下，交給表單顯示「尚未儲存」與「放棄」。
  const nav = useNavigation();
  useEffect(
    () =>
      (nav as unknown as { addListener: (n: string, f: (e: { preventDefault: () => void; data: { action: never } }) => void) => () => void }).addListener("beforeRemove", (e) => {
        if (!hasUnsaved()) return;
        e.preventDefault();
        runGuarded(() => nav.dispatch(e.data.action));
      }),
    [nav],
  );
  return (
    <Screen>
      {/* 平板／電腦：內容欄收窄到 720 並置中（杜杜龍 2026-11-26：iPad 上字與欄位一路拉滿、表單很長）；手機維持滿版。 */}
      <View style={{ gap: space.lg, width: "100%", maxWidth: lay.large ? 720 : undefined, alignSelf: "center" }}>
      {/* 最上方：「加到主畫面」邀請卡（杜杜龍 2026-11-24）；與超派首頁同一個元件，安裝後自動不再顯示。 */}
      <InstallCard dismissible />
      {/* 最上方：訊息通知（勾選）→ 前往完整版會員中心 → 並排「訂單紀錄｜超派模式」（杜杜龍 2026-11-24） */}
      {member ? (
        <>
          <PushSwitchRow banner />
        </>
      ) : null}
      {/* 最上方並排：訂單紀錄｜超派模式（杜杜龍 2026-11-24） */}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="訂單紀錄" onPress={() => runGuarded(() => router.push(member ? "/orders" : "/me"))} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="cancel" label={`${MODE_PROFILES.super.name}模式`} onPress={() => runGuarded(() => void askSwitchToMaker())} fullWidth />
        </View>
      </View>
      {member && !member.demo ? <AccountCenterLink /> : null}
      {!ready ? <LoadingView /> : null}
      {member ? (
        <>
          <MemberHeader member={member} scale={1.15} stacked />
          {member.demo ? null : <ProfilePrompt inline focusMissing={fill === "1"} initial={member.profileForm ?? null} onClose={() => undefined} />}
        </>
      ) : ready ? (
        <GuestGate body="登入後即可報名課程、記錄學習進度。" />
      ) : null}
      <FontSizeCard />
      {member ? null : <Button variant="secondary" icon="person-circle-outline" label="登入" onPress={() => runGuarded(() => router.push("/me"))} fullWidth />}
      </View>
    </Screen>
  );
}
