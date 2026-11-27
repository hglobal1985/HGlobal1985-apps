import { Tabs } from "expo-router";
import { useColors } from "@/kit";

/** 主分頁：底部選單是共用元件 BottomBar（放在根版面，app/_layout.tsx），這裡不畫內建的分頁列。 */
export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="review" />
      <Tabs.Screen name="notices" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
