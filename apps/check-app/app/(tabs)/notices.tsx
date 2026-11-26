import { router } from "expo-router";
import { View } from "react-native";
import type { Notice } from "@check/contract";
import { api } from "@/api/client";
import { useData, useSession } from "@/state/session";
import { Btn, Card, Empty, Loading, Screen, T, useColors } from "@/kit";

export default function Notices() {
  const c = useColors();
  const { reloadMe } = useSession();
  const { data, reload } = useData<Notice[]>("/notices");
  const open = async (n: Notice) => {
    if (!n.read) await api("/notices/read", "POST", { id: n.id }).catch(() => {});
    void reloadMe();
    if (n.link) router.push(n.link as never);
    else void reload();
  };
  return (
    <Screen title="通知" back={false} right={data?.some((n) => !n.read) ? <Btn small flex={false} kind="grey" label="全部已讀" onPress={async () => { await api("/notices/read", "POST", {}); await reload(); void reloadMe(); }} /> : undefined}>
        {!data ? <Loading /> : !data.length ? <Empty title="還沒有通知" note="出新作業、評分、退回、留言、截止提醒都會通知你。" /> : null}
        {data?.map((n) => (
          <Card key={n.id} onPress={() => open(n)} style={!n.read ? { borderColor: c.green, borderWidth: 1.5 } : undefined}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <T bold style={{ flex: 1 }}>{`${n.read ? "" : "● "}${n.title}`}</T>
              <T tiny muted>{new Date(n.createdAt).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</T>
            </View>
            <T small muted>{n.body}</T>
          </Card>
        ))}
    </Screen>
  );
}
