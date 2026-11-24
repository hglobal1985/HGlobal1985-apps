import { router } from "expo-router";
import { View } from "react-native";
import { MemberHeader } from "@/features/member-header";
import { ProfilePrompt } from "@/features/profile-prompt";
import { MODE_PROFILES } from "@/lib/app-mode";
import { useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, GuestGate, LoadingView, Screen } from "@/ui";
import { askSwitchToMaker, FontSizeCard } from "./mode-actions";

/**
 * 至尊模式頁（業主 2026-11-24：按底部「至尊」鍵整頁顯示，至尊模式一律不用上拉選單）。由上到下：
 * 會員抬頭（頭像＋姓名／獎銜＋獎章兩列）→ 完善會員資料（與超派模式的資料面板是同一個表單元件 ProfilePrompt，欄位改了兩邊一起變）
 * → 字體大小 → 訂單紀錄、帳號 → 換回超派模式（先確認）。
 */
export function ModePage() {
  const { member, ready } = useSession();
  return (
    <Screen>
      {!ready ? <LoadingView /> : null}
      {member ? (
        <>
          <MemberHeader member={member} scale={1.15} stacked />
          {member.demo ? null : (
            <View style={{ gap: space.sm }}>
              <AppText variant="title" accessibilityRole="header">
                完善會員資料
              </AppText>
              <ProfilePrompt inline initial={member.profileForm ?? null} onClose={() => undefined} />
            </View>
          )}
        </>
      ) : ready ? (
        <GuestGate body="登入後即可報名課程、記錄學習進度。" />
      ) : null}
      <FontSizeCard />
      <View style={{ gap: space.sm }}>
        <Button variant="secondary" icon="document-text-outline" label="訂單紀錄" onPress={() => router.push(member ? "/orders" : "/me")} fullWidth />
        <Button variant="secondary" icon="person-circle-outline" label={member ? "帳號" : "登入"} onPress={() => router.push("/me")} fullWidth />
      </View>
      <Button variant="cancel" icon="rocket-outline" label={`換回${MODE_PROFILES.super.name}模式`} onPress={() => void askSwitchToMaker()} fullWidth />
    </Screen>
  );
}
