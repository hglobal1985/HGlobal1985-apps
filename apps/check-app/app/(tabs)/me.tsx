import { router } from "expo-router";
import { Linking, Platform, View } from "react-native";
import type { ActivityCard } from "@check/contract";
import { deleteAccount, devSignOut, openMemberCenter, signOutAll, webLoginAvailable } from "@/central/auth";
import { APP_VERSION, INTEGRATED_VERSION, PRIVACY_URL } from "@/central/config";
import { setElder, useElderOn } from "@/lib/elder-mode";
import { useFeature } from "@/lib/app-mode";
import { useData, useSession } from "@/state/session";
import { PushCard } from "@/features/push-card";
import { InstallCard } from "@/ui/install-card";
import { Avatar, Btn, Card, confirmSheet, flash, flashError, Screen, Section, T, Toggle } from "@/kit";

export default function MePage() {
  const { me } = useSession();
  const home = useData<ActivityCard[]>("/home");
  const elder = useElderOn();
  const canDelete = useFeature("deleteAccount");
  return (
    <Screen title="我的" back={false}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={me?.name || "會員"} url={me?.avatarUrl} sizePx={56} />
          <View style={{ flex: 1 }}>
            <T bold>{me?.name || "會員"}</T>
            <T tiny muted>{me?.superAdmin ? "超級管理員・" : ""}資料來自會員中心</T>
          </View>
        </Card>
        <Section title="我的作業檔案" />
        {(home.data ?? []).filter((a) => !a.pending).map((a) => (
          <Card key={a.id} onPress={() => router.push(`/files/${a.id}`)} style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <T bold>{a.title}</T>
              <T tiny muted>{a.filesPurged ? "檔案已刪除，成績保留" : "下載我的作業備份"}</T>
            </View>
            <T muted>›</T>
          </Card>
        ))}
        {me?.superAdmin ? (
          <>
            <Section title="管理" />
            <Card onPress={() => router.push("/settings/upload")} style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <T bold>上傳設定</T>
                <T tiny muted>照片、影片壓縮畫質（與行動大學共用同一份）</T>
              </View>
              <T muted>›</T>
            </Card>
            <Card onPress={() => router.push("/settings/backups")} style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <T bold>備份還原</T>
                <T tiny muted>每週備份的預覽與還原（還原正式資料須杜杜龍核准）</T>
              </View>
              <T muted>›</T>
            </Card>
          </>
        ) : null}
        <Section title="通知" />
        <InstallCard />
        <PushCard />
        <Section title="顯示模式" />
        <Card>
          <Toggle label="至尊模式（大字簡易版）" note="字放大、選單改成整頁顯示；和寰宇行動大學的至尊模式相同" value={elder} onChange={(on) => setElder({ on })} />
        </Card>
        <Section title="帳號" />
        <Card style={{ gap: 10 }}>
          <Btn kind="grey" flex={false} label="編輯會員資料" onPress={() => openMemberCenter().catch(flashError)} />
          <Btn kind="grey" flex={false} label="隱私權政策" onPress={() => (Platform.OS === "web" ? window.open(PRIVACY_URL, "_blank") : Linking.openURL(PRIVACY_URL))} />
          <Btn
            kind="grey"
            flex={false}
            label="登出所有 App"
            onPress={async () => {
              if (!(await confirmSheet("登出所有 App？", "這支裝置上所有寰宇 App 都會一起登出。", "登出"))) return;
              if (!webLoginAvailable()) return devSignOut();
              await signOutAll();
            }}
          />
          {canDelete ? <Btn
            kind="cancel"
            flex={false}
            label="刪除帳號"
            onPress={async () => {
              if (!(await confirmSheet("刪除帳號？", "會刪除你在所有寰宇 App 的帳號與資料，無法復原。接著會請你再用 Google 登入一次確認是本人。", "刪除", true))) return;
              try {
                const r = await deleteAccount();
                if (r === "done") flash("帳號已刪除");
              } catch (e) {
                flashError(e);
              }
            }}
          /> : null}
        </Card>
        <T tiny muted style={{ textAlign: "center" }}>寰宇繳作業系統 {APP_VERSION}・串接 {INTEGRATED_VERSION}</T>
    </Screen>
  );
}
