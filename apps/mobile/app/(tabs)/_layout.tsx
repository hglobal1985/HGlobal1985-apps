import { Tabs } from "expo-router/tabs";

/**
 * 五個分頁的容器。分頁列本身改由根版面的 BottomBar 顯示（所有頁面都看得到），這裡只負責切換內容。
 * 舊版 iOS／Android 原生分頁列與 Web 版分頁列都已移除。
 */
export default function TabsLayout() {
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="courses" />
      <Tabs.Screen name="learning" />
      {/* 通知頁一開站就載入（杜杜龍 2026-11-24 回報第一次進通知整頁空白）：不等第一次點才下載程式檔。 */}
      <Tabs.Screen name="notices" options={{ lazy: false }} />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
