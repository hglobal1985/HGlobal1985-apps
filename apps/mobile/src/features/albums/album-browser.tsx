import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { resolveUrl, type AlbumFolder, type AlbumsResponse, type CoverMediaKind } from "@/api/client";
import { canEditCenterArt } from "@/features/courses/center-rights";
import { SearchableAlbum } from "@/features/courses/album-search";
import { useCoverMedia } from "@/features/courses/cover-media";
import { centerTitle } from "@/features/format";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { useModeProfile } from "@/lib/app-mode";
import { useThumb } from "@/lib/thumb";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Card, EmptyState, ErrorView, LoadingView, ThumbFallback } from "@/ui";

/**
 * 「相簿」專區（業主 2026-11-25，第五大分類）：自動彙整全站所有用到相簿上傳功能的照片，依來源分成資料夾（像相簿檔案總管）：
 * 先看「來源」（中心 EDM、中心封面照片、系列封面照片、課程封面照片、課程區塊相簿），再點資料夾看裡面的照片。
 * 資料夾裡的照片格、搜尋、全螢幕看圖（含「檢視全部」複選分享下載）都用與各頁面完全相同的元件（`SearchableAlbum`＝`CoverAlbum`＋共用搜尋）；
 * 有該相簿權限的人在資料夾裡可直接上傳（`AlbumUploadButton`，權限由伺服器再檢查）。課程區塊相簿有鎖定與權限遮罩，點開前往該課程的相簿分頁。
 */
export function AlbumBrowser() {
  const { data, loading, error, reload } = useApi<AlbumsResponse>("/albums");
  const [open, setOpen] = useState<AlbumFolder | null>(null);
  if (open) return <FolderView folder={open} onBack={() => setOpen(null)} />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  if (loading && !data) return <LoadingView />;
  if (!data?.groups.length) return <EmptyState icon="images-outline" title="還沒有相簿照片" body="中心、系列、課程上傳的照片會自動出現在這裡" />;
  return (
    <View style={{ gap: space.lg }}>
      {data.groups.map((g) => (
        <View key={g.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Ionicons name="folder-open-outline" size={22} color="#5B3B8C" />
            <AppText variant="headline" style={{ flex: 1, fontWeight: "800" }}>{g.label}</AppText>
            <AppText variant="callout" tone="muted">{`${g.folders.length} 個資料夾`}</AppText>
          </View>
          <Card style={{ paddingVertical: 0, paddingHorizontal: space.sm }}>
            {g.folders.map((f, i) => (
              <FolderRow key={f.id} folder={f} last={i === g.folders.length - 1} onPress={() => (f.kind === "block" ? router.push(`/course/${f.courseId}?album=${f.key}` as never) : setOpen(f))} />
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}

function FolderRow({ folder, last, onPress }: { folder: AlbumFolder; last: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const thumb = useThumb();
  const title = folder.kind === "center" ? centerTitle(folder.title) : folder.title;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}，${folder.count} 張`} onPress={onPress} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, paddingVertical: space.sm, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border }, pressed && { opacity: 0.7 }]}>
      <View style={{ width: 56, height: 56, borderRadius: radius.sm, overflow: "hidden", backgroundColor: c.surfaceMuted }}>
        {folder.thumb ? <Image source={{ uri: thumb(resolveUrl(folder.thumb), 160) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <ThumbFallback />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="headline" numberOfLines={2} style={{ fontWeight: "800" }}>{title}</AppText>
        {folder.subtitle ? <AppText variant="caption" tone="muted" numberOfLines={1}>{folder.subtitle}</AppText> : null}
      </View>
      <AppText variant="callout" tone="muted">{`${folder.count} 張`}</AppText>
      <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
    </Pressable>
  );
}

/** 打開一個資料夾：返回列、（有權限才有）上傳按鈕、搜尋框與照片格（與中心 EDM／系列／課程相簿同一套元件）。 */
function FolderView({ folder, onBack }: { folder: AlbumFolder; onBack: () => void }) {
  const { c } = useTheme();
  const { member } = useSession();
  const big = useModeProfile().coursePage === "twoTabs";
  const kind = folder.kind as CoverMediaKind;
  const cm = useCoverMedia(kind, folder.key);
  const items = folder.scope === "edm" ? cm.edm : folder.scope === "cover" ? cm.cover : cm.items;
  const canEdit = folder.kind === "center" ? canEditCenterArt(member, folder.key) : !!member?.courseRights?.all;
  const title = folder.kind === "center" ? centerTitle(folder.title) : folder.title;
  return (
    <View style={{ gap: space.md }}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回相簿資料夾" onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48 }}>
        <Ionicons name="chevron-back" size={big ? 30 : 24} color={c.accentText} />
        <AppText variant="headline" numberOfLines={2} style={{ flex: 1, fontWeight: "800", color: c.accentText }}>{title}</AppText>
        <AppText variant="callout" tone="muted">{`${items.length} 張`}</AppText>
      </Pressable>
      {canEdit ? <AlbumUploadButton kind={kind} ownerKey={folder.key} count={items.length} onDone={cm.reload} scope={folder.scope} label={folder.scope === "edm" ? "上傳EDM" : "上傳照片或影片"} /> : null}
      <SearchableAlbum kind={kind} ownerKey={folder.key} title={title} items={items} canEdit={canEdit} onChanged={cm.reload} scope={folder.scope} />
    </View>
  );
}
