import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import type { ActivityCard } from "../../../api/src/contract";
import { useData } from "@/session";
import { size, useColors } from "@/theme";
import { Card, Chip, Empty, Loading, T, TopBar } from "@/ui";

/** 批改分頁：選一份作業進批改台（老師評分、組長確認）。 */
export default function ReviewTab() {
  const c = useColors();
  const { data } = useData<ActivityCard[]>("/home");
  const list = (data ?? []).filter((a) => a.role !== "student" || a.isLeader);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="批改" back={false} />
      <ScrollView contentContainerStyle={{ padding: size.gap, gap: 10, maxWidth: size.pageMax, width: "100%", alignSelf: "center" }}>
        {!data ? <Loading /> : !list.length ? <Empty title="沒有需要批改的作業" /> : null}
        {list.map((a) => (
          <Card key={a.id} onPress={() => router.push(`/review/${a.id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T bold style={{ flex: 1 }}>{a.title}</T>
              <Chip tone={a.toReview ? "wait" : "ok"} label={a.toReview ? `待處理 ${a.toReview}` : "都處理完了"} />
            </View>
            <T small muted>{a.role === "student" ? "組長：確認或退回組員的作業" : "老師：評分、評語、退回重交"}</T>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
