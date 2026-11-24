import { router, useNavigation } from "expo-router";
import { useEffect } from "react";
import { hasUnsaved, runGuarded } from "@/lib/unsaved-guard";
import { View } from "react-native";
import { MemberHeader } from "@/features/member-header";
import { ProfilePrompt } from "@/features/profile-prompt";
import { MODE_PROFILES } from "@/lib/app-mode";
import { useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { Button, GuestGate, LoadingView, Screen } from "@/ui";
import { askSwitchToMaker, FontSizeCard } from "./mode-actions";

/**
 * 至尊模式頁（業主 2026-11-24：按底部「至尊」鍵整頁顯示，至尊模式一律不用上拉選單）。由上到下：
 * 最上方並排「訂單紀錄｜超派模式」（業主 2026-11-24）→ 會員抬頭（頭像＋姓名／獎銜，獎章在右邊與頭像同高）→ 會員資料表單（與超派模式是同一個元件 ProfilePrompt，不加標題）
 * → 字體大小（勾「跟著手機」時＋／－灰掉）→ 帳號。
 */
export function ModePage() {
  const { member, ready } = useSession();
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
      {/* 最上方並排：訂單紀錄｜超派模式（業主 2026-11-24） */}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="訂單紀錄" onPress={() => runGuarded(() => router.push(member ? "/orders" : "/me"))} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="cancel" label={`${MODE_PROFILES.super.name}模式`} onPress={() => runGuarded(() => void askSwitchToMaker())} fullWidth />
        </View>
      </View>
      {!ready ? <LoadingView /> : null}
      {member ? (
        <>
          <MemberHeader member={member} scale={1.15} stacked />
          {member.demo ? null : <ProfilePrompt inline initial={member.profileForm ?? null} onClose={() => undefined} />}
        </>
      ) : ready ? (
        <GuestGate body="登入後即可報名課程、記錄學習進度。" />
      ) : null}
      <FontSizeCard />
      <Button variant="secondary" icon="person-circle-outline" label={member ? "帳號" : "登入"} onPress={() => runGuarded(() => router.push("/me"))} fullWidth />
    </Screen>
  );
}
