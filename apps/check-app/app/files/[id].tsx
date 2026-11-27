import { useLocalSearchParams } from "expo-router";
import { Linking, Platform, View } from "react-native";
import { KINDS, type Kind } from "@check/contract";
import { WEB_ORIGIN } from "@/central/config";
import { dateOnly, mb } from "@/format";
import { useData } from "@/state/session";
import { Btn, Card, Empty, Loading, Note, Screen, T } from "@/kit";

type Part = { index: number; files: number; bytes: number; url: string };
type F = { id: string; kind: Kind; name: string; size: number; url: string; body?: string; member: string; item: string; lesson: string };

/** 備份：最上面是「一鍵下載備份」（整份打包成壓縮檔，杜杜龍 2026-11-27），下面列出每個檔案可以單獨下載（連結 1 小時內有效）。 */
export default function Files() {
  const { id, all } = useLocalSearchParams<{ id: string; all?: string }>();
  const { data, error } = useData<{ retentionUntil: string | null; purged: boolean; files: F[] }>(`/activities/${id}/files${all ? "" : "?mine=1"}`);
  const { data: zip } = useData<{ purged: boolean; retentionUntil: string | null; parts: Part[] }>(`/activities/${id}/backup${all ? "?all=1" : ""}`);
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
      {zip && !zip.purged && data.files.length ? (
        <Card>
          <T bold>一鍵下載備份</T>
          <T small muted>
            {zip.parts.length > 1
              ? `檔案比較多，分成 ${zip.parts.length} 包壓縮檔，請每一包都按一次下載。下載完在手機的「檔案」或電腦的「下載」資料夾找得到。`
              : "全部作業打包成一個壓縮檔（.zip），下載完在手機的「檔案」或電腦的「下載」資料夾找得到。"}
          </T>
          {zip.parts.map((p) => (
            <Btn
              key={p.index}
              flex={false}
              icon="download-outline"
              label={zip.parts.length > 1 ? `下載第 ${p.index} 包（${p.files} 個檔案・${mb(p.bytes)}）` : `一鍵下載備份（${data.files.length} 個・${mb(p.bytes)}）`}
              onPress={() => open(p.url)}
            />
          ))}
          <T tiny muted>下載按鈕 1 小時內有效；超過時間請重新進入這一頁。</T>
        </Card>
      ) : null}
      {downloadable.length ? <T small muted>也可以一個一個下載：</T> : null}
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
