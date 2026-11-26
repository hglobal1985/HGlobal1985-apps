import { router } from "expo-router";
import { Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ActivityCard } from "../../../api/src/contract";
import { deleteAccount, devSignOut, openMemberCenter, signOutAll, webLoginAvailable } from "@/central/auth";
import { APP_VERSION, INTEGRATED_VERSION, PRIVACY_URL } from "@/central/config";
import { useData, useSession } from "@/session";
import { size, useColors } from "@/theme";
import { Avatar, Btn, Card, confirmSheet, flash, flashError, Section, T, TopBar } from "@/ui";

export default function MePage() {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const { me } = useSession();
  const home = useData<ActivityCard[]>("/home");
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="我的" back={false} />
      <ScrollView contentContainerStyle={{ padding: size.gap, gap: 12, maxWidth: size.pageMax, width: "100%", alignSelf: "center", paddingBottom: 24 + ins.bottom }}>
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
          <Btn
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
          />
        </Card>
        <T tiny muted style={{ textAlign: "center" }}>寰宇繳作業系統 {APP_VERSION}・串接 {INTEGRATED_VERSION}</T>
      </ScrollView>
    </View>
  );
}
