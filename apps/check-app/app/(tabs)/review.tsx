import { router } from "expo-router";
import { View } from "react-native";
import type { ActivityCard } from "@check/contract";
import { useData } from "@/state/session";
import { Card, Chip, Empty, Loading, T, Screen } from "@/kit";

/** 批改分頁：選一份作業進批改台（老師評分、組長確認）。 */
export default function ReviewTab() {
  const { data } = useData<ActivityCard[]>("/home");
  const list = (data ?? []).filter((a) => a.role !== "student" || a.isLeader);
  return (
    <Screen title="批改" back={false}>
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
    </Screen>
  );
}
