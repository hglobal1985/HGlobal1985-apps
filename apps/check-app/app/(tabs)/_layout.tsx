import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ActivityCard } from "@check/contract";
import { useData, useSession } from "@/state/session";
import { useColors } from "@/kit";

export default function TabsLayout() {
  const c = useColors();
  const { me } = useSession();
  const home = useData<ActivityCard[]>("/home");
  const staff = !!me?.superAdmin || !!home.data?.some((a) => a.role !== "student" || a.isLeader);
  const toReview = home.data?.reduce((n, a) => n + a.toReview, 0) ?? 0;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color }: { color: unknown }) => <Ionicons name={name} size={24} color={String(color)} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.green,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "作業", tabBarIcon: icon("document-text-outline") }} />
      <Tabs.Screen name="review" options={{ title: "批改", href: staff ? undefined : null, tabBarIcon: icon("checkmark-done-outline"), tabBarBadge: toReview || undefined }} />
      <Tabs.Screen name="notices" options={{ title: "通知", tabBarIcon: icon("notifications-outline"), tabBarBadge: me?.unread || undefined }} />
      <Tabs.Screen name="me" options={{ title: "我的", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
