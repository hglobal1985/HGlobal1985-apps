import { router, usePathname } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { Button } from "@/ui/button";

/**
 * 訪客登入提示（杜杜龍 2026-11-17 定稿，全站唯一來源）：單一按鈕「尚未登入 免費註冊」（杜杜龍 2026-11-20：刪除旁邊的備註小字），置中。
 * 只有「未登入」才顯示；放在除了「學習中、通知、設定」三個分頁以外所有頁面的上方內容區（首頁、課程頁、系列頁、中心頁、
 * 全部課程各檢視…）。登入後回到原本的頁面（next 預設＝目前網址，可自訂）。要改文字、字級、按鈕只改這個檔案。
 */
export function LoginPrompt({ next }: { next?: string }) {
  const { member, ready } = useSession();
  const path = usePathname();
  if (!ready || member) return null;
  const back = next ?? (Platform.OS === "web" && typeof window !== "undefined" ? window.location.pathname + window.location.search : path);
  return (
    <View style={styles.row} accessibilityLabel="登入提示">
      <Button variant="secondary" label="尚未登入 免費註冊" icon="log-in-outline" onPress={() => router.push({ pathname: "/me", params: { next: back } })} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
});
