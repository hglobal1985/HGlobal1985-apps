import { useLocalSearchParams } from "expo-router";
import { Linking, Platform, View } from "react-native";
import { KINDS, type Kind } from "@check/contract";
import { WEB_ORIGIN } from "@/central/config";
import { dateOnly, mb } from "@/format";
import { useData } from "@/state/session";
import { Btn, Card, Empty, Loading, Note, Screen, T } from "@/kit";

type F = { id: string; kind: Kind; name: string; size: number; url: string; body?: string; member: string; item: string; lesson: string };

/** 備份：列出作業檔案，一個一個存到手機或電腦（連結 1 小時內有效）。 */
export default function Files() {
  const { id, all } = useLocalSearchParams<{ id: string; all?: string }>();
  const { data, error } = useData<{ retentionUntil: string | null; purged: boolean; files: F[] }>(`/activities/${id}/files${all ? "" : "?mine=1"}`);
  if (!data) return <Screen title="備份">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  const open = (u: string) => {
    const full = u.startsWith("/") ? (Platform.OS === "web" ? "" : WEB_ORIGIN) + u : u;
    if (Platform.OS === "web") window.open(full, "_blank", "noopener");
    else void Linking.openURL(full);
  };
  const downloadable = data.files.filter((f) => f.url && f.kind !== "link");
  return (
    <Screen title={all ? "備份全部檔案" : "我的作業備份"}>
      {data.purged ? <Note>檔案已刪除，成績與評語保留。</Note> : data.retentionUntil ? <Note tone="wait">{`檔案預定 ${dateOnly(data.retentionUntil)} 自動刪除，請在那之前下載。`}</Note> : null}
      {downloadable.length > 1 && Platform.OS === "web" ? <Btn flex={false} label={`全部依序下載（${downloadable.length} 個）`} onPress={() => downloadable.forEach((f, i) => setTimeout(() => open(f.url), i * 700))} /> : null}
      {!data.files.length ? <Empty title="沒有檔案" /> : null}
      {data.files.map((f) => (
        <Card key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <T small bold numberOfLines={1}>{f.name}</T>
            <T tiny muted>{[all ? f.member : "", f.lesson, f.item, KINDS[f.kind], f.size ? mb(f.size) : ""].filter(Boolean).join("・")}</T>
            {f.kind === "text" ? <T tiny numberOfLines={3}>{f.body}</T> : null}
          </View>
          {f.url ? <Btn small flex={false} kind="grey" label={f.kind === "link" ? "開啟" : "下載"} onPress={() => open(f.url)} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
