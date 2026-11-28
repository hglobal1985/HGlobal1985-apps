import { router } from "expo-router";
import { Linking, Platform, View } from "react-native";
import { useState } from "react";
import type { LearnNotices, Notice } from "@check/contract";
import { api } from "@/api/client";
import { useData, useSession } from "@/state/session";
import { Btn, Card, Chip, Empty, Loading, Screen, Seg, T, useColors } from "@/kit";

// 「行動大學」分頁可選的通知類別（杜杜龍 2026-11-28：行動大學的特定通知也顯示在這裡，預設只有留言）。
const LEARN_CATS: [string, string][] = [["comment", "留言"], ["review", "審核"], ["subscribe", "訂閱"], ["achievement", "成就"]];

export default function Notices() {
  const c = useColors();
  const { reloadMe } = useSession();
  const [tab, setTab] = useState<"check" | "learn">("check");
  const [cats, setCats] = useState<string[]>(["comment"]);
  const mine = useData<Notice[]>(tab === "check" ? "/notices" : null);
  const learn = useData<LearnNotices>(tab === "learn" ? `/notices/learn?categories=${cats.join(",")}` : null);
  const learnList = learn.data?.notices ?? [];
  const data = tab === "check" ? mine.data : learn.data ? learnList : null;
  const reload = tab === "check" ? mine.reload : learn.reload;
  // 行動大學的通知：點開後標為已讀（寫回行動大學），再用瀏覽器開啟行動大學對應頁面。
  const openLearn = async (n: Notice) => {
    if (!n.read) await api("POST", "/notices/learn/read", { id: n.id, categories: cats }).catch(() => {});
    void reload();
    const url = `${learn.data?.origin ?? "https://learn.hglobal1985.com"}${n.link}`;
    if (Platform.OS === "web") window.open(url, "_blank", "noopener");
    else void Linking.openURL(url);
  };
  const open = async (n: Notice) => {
    if (!n.read) await api("POST", "/notices/read", { id: n.id }).catch(() => {});
    void reloadMe();
    if (tab === "learn") return void openLearn(n);
    if (n.link) router.push(n.link as never);
    else void reload();
  };
  return (
    <Screen title="通知" back={false} right={data?.some((n) => !n.read) ? <Btn small flex={false} kind="grey" label="全部已讀" onPress={async () => { await api("POST", tab === "learn" ? "/notices/learn/read" : "/notices/read", tab === "learn" ? { categories: cats } : {}); await reload(); void reloadMe(); }} /> : undefined}>
        <Seg items={[["check", "作業"], ["learn", "行動大學"]]} value={tab} onChange={setTab} />
        {tab === "learn" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LEARN_CATS.map(([k, label]) => (
              <Chip key={k} label={label} tone={cats.includes(k) ? "ok" : "plain"} onPress={() => setCats((x) => (x.includes(k) ? (x.length > 1 ? x.filter((y) => y !== k) : x) : [...x, k]))} />
            ))}
          </View>
        ) : null}
        {tab === "learn" && learn.data && !learn.data.available ? <Empty title="暫時讀不到行動大學的通知" note="請稍後再試。" /> : null}
        {!data ? <Loading /> : !data.length && !(tab === "learn" && learn.data && !learn.data.available) ? <Empty title="還沒有通知" note={tab === "learn" ? "行動大學裡你選的這幾類通知會顯示在這裡。" : "出新作業、評分、退回、留言、截止提醒都會通知你。"} /> : null}
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
