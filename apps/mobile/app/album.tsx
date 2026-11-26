import { router } from "expo-router";
import { Platform, View } from "react-native";
import { AlbumViewer } from "@/features/courses/edm-viewer";
import { HeaderSlotScreen } from "@/ui/header-slot";

/**
 * 相簿專區（杜杜龍 2026-11-26）：不再蓋滿全螢幕，是一般頁面——上方有工具列、下方有綠色主選單列。
 * 上方工具列的返回鍵＝先退一層（食譜、資料夾…，見 `lib/page-back.ts`），已在首頁就回上一頁，沒有上一頁（直接開網址）就回課程頁。
 */
export default function AlbumRoute() {
  const leave = () => {
    if (router.canGoBack()) return router.back();
    if (Platform.OS === "web" && typeof window !== "undefined") return window.location.replace("/courses");
    router.replace("/courses");
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <HeaderSlotScreen title="相簿" backTo="/courses" />
      <AlbumViewer inline onClose={leave} />
    </View>
  );
}
