import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, resolveUrl, type AlbumInfo, type AlbumPermissions } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { useApi } from "@/state/session";
import { AppText } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

export const formatBytes = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const when = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 相簿管理面板【共用模組】（業主 2026-11-25，只有超級管理員）：疊在全黑的相簿畫面上，放在 `LightboxLibrary` 裡。
 * ①`AlbumPermissionsPanel`：資料夾清單右上角的齒輪——檢視並調整所有相簿（大類別與資料夾）的「誰可以上傳」最低獎銜。
 * ②`AlbumInfoPanel`：每個資料夾上傳鈕右邊的齒輪——這個相簿的資訊總覽（R2 佔用、上傳者排名、最近上傳、檔案大小與瀏覽數排序）與上傳權限。
 */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} pointerEvents="box-none">
      <Pressable accessibilityLabel="關閉" style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)" }]} onPress={onClose} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: insets.top + 56, backgroundColor: "#1c1c1f", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
          <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 18, fontWeight: "800" }}>{title}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={onClose} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={24} color="#fff" {...UI_ONLY} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>{children}</ScrollView>
      </View>
    </View>
  );
}

/** 獎銜選擇：橫向一排標籤。inherit＝這個資料夾沿用類別設定（只有資料夾才有）。 */
function RankPicker({ value, ranks, onChange, inheritLabel }: { value: string | null; ranks: { code: string; name: string }[]; onChange: (v: string | null) => void; inheritLabel?: string }) {
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: "center", backgroundColor: on ? "#2e7d32" : "#2a2a2e" }}>
      <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{label}</AppText>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {inheritLabel ? chip(inheritLabel, value === null, () => onChange(null)) : null}
      {chip("只有管理員", value === "", () => onChange(""))}
      {ranks.map((r) => chip(`${r.name}以上`, value === r.code, () => onChange(r.code)))}
    </ScrollView>
  );
}

const save = async (key: string, uploadMinRank: string | null) => {
  try {
    await api("PUT", "/admin/albums/permission", { key, uploadMinRank });
    flashText("已儲存");
    return true;
  } catch (e) {
    flashText((e as Error).message);
    return false;
  }
};

/** 所有相簿的權限總覽與調整（資料夾清單右上角的齒輪）。 */
export function AlbumPermissionsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useApi<AlbumPermissions>("/admin/albums/permissions");
  const [open, setOpen] = useState<string | null>(null);
  const rankName = (code: string | null) => (code === null ? "沿用類別" : code === "" ? "只有管理員" : `${data?.ranks.find((r) => r.code === code)?.name ?? code}以上`);
  const change = async (key: string, v: string | null) => {
    if (await save(key, v)) (reload(), onChanged());
  };
  return (
    <Sheet title="相簿權限設定" onClose={onClose}>
      <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14, lineHeight: 20 }}>設定「誰可以在這個相簿上傳照片」：選到的獎銜（含）以上的會員就能上傳；不選＝只有原本的管理人員（超級管理員、該中心／課程的管理人員）。資料夾自己的設定優先於類別。</AppText>
      {!data ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>讀取中…</AppText> : null}
      {data?.groups.map((g) => (
        <View key={g.id} style={{ gap: 10, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="folder-open-outline" size={20} color="#fff" {...UI_ONLY} />
            <AppText {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 17, fontWeight: "800" }}>{g.label}</AppText>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#cfcfd4", fontSize: 14 }}>{rankName(g.uploadMinRank)}</AppText>
          </View>
          <RankPicker value={g.uploadMinRank} ranks={data.ranks} onChange={(v) => void change(`group:${g.id}`, v)} />
          {data.folders.filter((f) => f.groupId === g.id).map((f) => (
            <View key={f.id}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === f.id }} onPress={() => setOpen(open === f.id ? null : f.id)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 38 }}>
                <Ionicons name="folder-outline" size={16} color="#cfcfd4" {...UI_ONLY} />
                <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 15 }}>{f.title}</AppText>
                <AppText {...UI_ONLY_TEXT} style={{ color: f.uploadMinRank === null ? "#7c7c82" : "#ffd54f", fontSize: 13 }}>{rankName(f.uploadMinRank)}</AppText>
                <Ionicons name={open === f.id ? "chevron-up" : "chevron-down"} size={18} color="#fff" {...UI_ONLY} />
              </Pressable>
              {open === f.id ? <View style={{ paddingVertical: 6 }}><RankPicker value={f.uploadMinRank} ranks={data.ranks} inheritLabel="沿用類別" onChange={(v) => void change(f.id, v)} /></View> : null}
            </View>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

/** 單一相簿的資訊總覽與上傳權限（上傳鈕右邊的齒輪）。 */
export function AlbumInfoPanel({ folderId, title, onClose, onChanged }: { folderId: string; title: string; onClose: () => void; onChanged: () => void }) {
  const thumb = useThumb();
  const { data, reload } = useApi<AlbumInfo>(`/admin/albums/info?id=${encodeURIComponent(folderId)}`);
  const { data: perms } = useApi<AlbumPermissions>("/admin/albums/permissions");
  const rankName = (code: string) => (code === "" ? "只有管理員" : `${perms?.ranks.find((r) => r.code === code)?.name ?? code}以上`);
  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 15, width: 96 }}>{label}</AppText>
      <AppText {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" }}>{value}</AppText>
    </View>
  );
  const strip = (items: { id: string; url: string; label: string }[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map((p, i) => (
        <View key={p.id} style={{ width: 84, gap: 3 }}>
          <View style={{ width: 84, height: 84, borderRadius: 10, overflow: "hidden", backgroundColor: "#2a2a2e" }}>
            <Image source={{ uri: thumb(resolveUrl(p.url), 160) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
            <View style={{ position: "absolute", left: 4, top: 4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
              <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>{i + 1}</AppText>
            </View>
          </View>
          <AppText {...UI_ONLY_TEXT} style={{ color: "#cfcfd4", fontSize: 13, textAlign: "center" }}>{p.label}</AppText>
        </View>
      ))}
    </ScrollView>
  );
  const change = async (v: string | null) => {
    if (await save(folderId, v)) (reload(), onChanged());
  };
  return (
    <Sheet title={`${title}・相簿資訊`} onClose={onClose}>
      {!data || !perms ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>讀取中…</AppText> : null}
      {data && perms ? (
        <>
          <View style={{ gap: 8, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
            {row("照片數", `${data.count} 張`)}
            {row("R2 佔用容量", formatBytes(data.bytes))}
            {row("最近上傳", when(data.lastUploadAt))}
            {row("上傳者人數", `${data.uploaders.length} 人`)}
          </View>
          <View style={{ gap: 10, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>誰可以上傳</AppText>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontSize: 14, lineHeight: 20 }}>{`目前生效：${rankName(data.effectiveRank)}${data.uploadMinRank === null ? "（沿用類別）" : "（資料夾自己的設定）"}`}</AppText>
            <RankPicker value={data.uploadMinRank} ranks={perms.ranks} inheritLabel="沿用類別" onChange={(v) => void change(v)} />
          </View>
          <View style={{ gap: 8, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>上傳者排名</AppText>
            {data.uploaders.map((u, i) => (
              <View key={`${u.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 }}>
                <AppText {...UI_ONLY_TEXT} style={{ width: 28, color: i < 3 ? "#ffd54f" : "#9a9aa0", fontSize: 15, fontWeight: "800" }}>{i + 1}</AppText>
                <AppText numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontSize: 15 }}>{u.name}</AppText>
                <AppText {...UI_ONLY_TEXT} style={{ color: "#cfcfd4", fontSize: 14 }}>{`${u.count} 張・${formatBytes(u.bytes)}`}</AppText>
              </View>
            ))}
            {!data.uploaders.length ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>還沒有上傳紀錄</AppText> : null}
          </View>
          <View style={{ gap: 8, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>檔案大小排序（大到小）</AppText>
            {strip(data.bySize.map((p) => ({ id: p.id, url: p.url, label: formatBytes(p.bytes) })))}
          </View>
          <View style={{ gap: 8, backgroundColor: "#232326", borderRadius: 14, padding: 12 }}>
            <AppText {...UI_ONLY_TEXT} style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>瀏覽數排序（多到少）</AppText>
            {strip(data.byViews.map((p) => ({ id: p.id, url: p.url, label: `${p.views} 次` })))}
          </View>
        </>
      ) : null}
    </Sheet>
  );
}
