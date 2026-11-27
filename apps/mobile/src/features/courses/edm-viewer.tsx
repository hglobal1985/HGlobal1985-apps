import { EdmLightbox, lightboxItem, registerLightboxParts } from "@/features/courses/lightbox";
import { useThumb } from "@/lib/thumb";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { LightboxLibrary } from "@/features/courses/lightbox-library";
import { displayName } from "./sort";
import { useTheme } from "@/theme/theme";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { BrandCover, AppText, CornerRibbon, CourseCover, StageFrame } from "@/ui";
import { ribbonsFor } from "./ribbons";
import { CoverAlbum } from "@/features/courses/album";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { CoverCarousel } from "./cover-carousel";
import { useCoverMedia } from "./cover-media";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { CoverBadges, type CoverStats } from "./cover-stats";
import { EdmInfoPanel } from "@/features/courses/edm-info";

/**
 * 課程介紹頁與教材清單頁上方的封面（杜杜龍 2026-11-18：封面上不放任何提示文字，全部封面一致；左下角固定是封面統計模組的訂閱鈕＋點閱）。
 * EDM：圖片寬度自動符合畫面最大寬度、停在管理員設定的預設位置，只有「點一下放大」，不能拖曳，
 * 點一下彈出小視窗可放大縮小、下載、分享。
 * 沒有 EDM 時顯示色塊。外框用 StageFrame，高度與上課頁的影片區完全相同。
 */
/** 封面縮成迷你小視窗時裡面顯示的封面（杜杜龍 2026-11-24；選圖規則同 EdmStage：品牌 logo ＞ EDM／封面圖 ＞ 文字封面）。 */
export function CourseMiniCover({ course }: { course: CourseSummary }) {
  const thumb = useThumb();
  const uri = course.coverUrl || course.edmUrl;
  if (course.brand) return <BrandCover brand={course.brand} fill />;
  if (uri) return <Image source={{ uri: thumb(resolveUrl(uri), 480) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return <CourseCover theme={course.theme} label={course.category} title={displayName(course)} fill />;
}

export function EdmStage({ course, stats, canManageAlbum = false }: { course: CourseSummary; stats?: CoverStats; /** 編輯模式：右上角出現「封面相簿」鈕（上傳輪播用的照片與短影音）。 */ canManageAlbum?: boolean }) {
  const thumb = useThumb();
  const { width: winW } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const { scheme } = useTheme();
  const { member } = useSession();
  const { config } = useUiConfig();
  const ribbons = ribbonsFor(course, member, config);
  // 封面輪播（杜杜龍 2026-11-21）：這門課上傳了照片或短影音就輪播（手動上傳 > 品牌 logo 的規則之外，輪播最優先）。
  const cm = useCoverMedia("course", course.id);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const images = cm.items.filter((x) => x.kind === "image");
  return (
    <StageFrame>
      {cm.items.length ? (
        <View style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {box.w ? <CoverCarousel items={cm.items} width={box.w} height={box.h} paused={openId !== null || albumOpen} onOpen={setOpenId} /> : null}
        </View>
      ) : course.brand ? (
        // 品牌 logo 封面點一下也能放大、下載、分享（杜杜龍 2026-11-18：與一般課程 EDM 同一個放大視窗）。
        <Pressable accessibilityRole="button" accessibilityLabel="放大封面" onPress={() => setOpen(true)} style={StyleSheet.absoluteFill}>
          <BrandCover brand={course.brand} fill />
        </Pressable>
      ) : course.edmUrl ? <EdmCoverImage uri={thumb(resolveUrl(course.edmUrl), winW)} viewY={course.edmViewY} onOpen={() => setOpen(true)} /> : <CourseCover theme={course.theme} label={course.category} title={displayName(course)} fill />}
      {ribbons.left ? <CornerRibbon label={ribbons.left.label} bg={ribbons.left.bg} fg={ribbons.left.fg} side="left" scale={2} /> : null}
      {/* 左下角：訂閱鈕＋點閱次數（共用封面統計模組 cover-stats.tsx，與中心頁、系列頁封面同一組）。 */}
      {stats ? (
        <View style={{ position: "absolute", left: 12, right: 12, bottom: 10 }} pointerEvents="box-none">
          <CoverBadges stats={stats} />
        </View>
      ) : null}
      {ribbons.right ? <CornerRibbon label={ribbons.right.label} bg={ribbons.right.bg} fg={ribbons.right.fg} side="right" scale={2} /> : null}
      {canManageAlbum ? (
        <Pressable accessibilityRole="button" accessibilityLabel="封面相簿" onPress={() => setAlbumOpen(true)} style={{ position: "absolute", right: 12, top: 12, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)" }}>
          <Ionicons name="images-outline" size={18} color="#fff" />
          <AppText variant="callout" style={{ color: "#fff", fontWeight: "800" }}>{`封面相簿 ${cm.items.length}`}</AppText>
        </Pressable>
      ) : null}
      {albumOpen ? (
        <BottomSheet onClose={() => setAlbumOpen(false)}>
          <AppText variant="headline">封面輪播相簿</AppText>
          <SheetScroll>
            <View style={{ gap: 12 }}>
              <AlbumUploadButton kind="course" ownerKey={course.id} count={cm.items.length} onDone={cm.reload} />
              <CoverAlbum kind="course" ownerKey={course.id} title={course.title} items={cm.items} canEdit onChanged={cm.reload} />
            </View>
          </SheetScroll>
        </BottomSheet>
      ) : null}
      {openId !== null && images.length ? <EdmLightbox uri={images[0]!.url} title={course.title} items={images.map((x) => lightboxItem(x, course.title))} index={Math.max(0, images.findIndex((x) => x.id === openId))} onClose={() => setOpenId(null)} /> : null}
      {course.brand && open ? <EdmLightbox uri={course.brand.logoUrl} bg={(scheme === "dark" && course.brand.bgColorDark) || course.brand.bgColor || undefined} title={course.title} onClose={() => setOpen(false)} /> : null}
      {!course.brand && course.edmUrl && open ? <EdmLightbox uri={course.edmUrl} title={course.title} onClose={() => setOpen(false)} /> : null}
    </StageFrame>
  );
}


/**
 * EDM 封面（杜杜龍 2026-11-18：所有封面都只有「點一下放大」，不能拖曳）：圖片寬度符合舞台寬度，停在管理員設定的預設位置（edmViewY），
 * 超出舞台的部分不顯示；要看完整圖點一下放大。圖比舞台矮（例如寬長條 logo）就置中、四周留安全距離。
 */
function EdmCoverImage({ uri, viewY, onOpen }: { uri: string; viewY: number; onOpen: () => void }) {
  const { c } = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState<number | null>(null); // 寬 / 高
  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (w, h) => alive && h && setRatio(w / h), () => undefined);
    return () => {
      alive = false;
    };
  }, [uri]);
  const imgH = ratio && box.w ? box.w / ratio : 0;
  const top = -Math.min(Math.max(0, imgH - box.h), Math.max(0, viewY * imgH));
  return (
    <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel="課程封面，點一下放大">
      {imgH && imgH < box.h - 1 ? (
        // 圖比舞台「矮」（例如寬長條的 logo）：置中、四周保留安全距離，不貼上緣（杜杜龍 2026-11-18）。
        (() => {
          const pad = Math.round(box.w * 0.08);
          const maxW = box.w - pad * 2;
          const maxH = box.h - pad * 2;
          const w = Math.min(maxW, maxH * (ratio ?? 1));
          return <Image source={{ uri }} resizeMode="contain" style={{ position: "absolute", width: w, height: w / (ratio ?? 1), left: (box.w - w) / 2, top: (box.h - w / (ratio ?? 1)) / 2 }} accessibilityIgnoresInvertColors />;
        })()
      ) : imgH ? (
        <Image source={{ uri }} resizeMode="stretch" style={{ position: "absolute", left: 0, top, width: box.w, height: imgH }} accessibilityIgnoresInvertColors />
      ) : null}
      {!imgH ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surfaceMuted }]} /> : null}
    </Pressable>
  );
}

// 看圖程式已搬到共用元件（packages/ui/src/features/courses/lightbox.tsx，杜杜龍 2026-11-26）；這裡接上行動大學專屬的相簿資料夾與圖片資訊。
export { EdmLightbox, AlbumViewer, lightboxItem, registerLightboxParts, type LightboxItem } from "@/features/courses/lightbox";
registerLightboxParts({ library: LightboxLibrary as never, info: EdmInfoPanel as never });
