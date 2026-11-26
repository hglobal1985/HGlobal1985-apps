import { router, Stack } from "expo-router";
import { Platform, View } from "react-native";
import { AlbumViewer } from "@/features/courses/edm-viewer";

/**
 * 相簿專區（杜杜龍 2026-11-26）：不再蓋滿全螢幕，是一般頁面——上方有工具列、下方有綠色主選單列。
 * 「退出相簿」＝回上一頁，沒有上一頁（直接開網址）就回課程頁。
 */
export default function AlbumRoute() {
  const leave = () => {
    if (router.canGoBack()) return router.back();
    if (Platform.OS === "web" && typeof window !== "undefined") return window.location.replace("/courses");
    router.replace("/courses");
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ title: "相簿", backTo: "/courses" } as never} />
      <AlbumViewer inline onClose={leave} />
    </View>
  );
}
