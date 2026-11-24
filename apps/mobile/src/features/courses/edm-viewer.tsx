import { trackFeature } from "@/lib/feature-track";
import { useBackToClose } from "@/lib/back-close";
import { enterFullscreen, exitFullscreen } from "@/lib/fullscreen";
import { useThumb } from "@/lib/thumb";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Modal, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { downloadImage, shareImage } from "@/lib/share";
import { displayName } from "./sort";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { useSession } from "@/state/session";
import { flashText } from "@/ui/flash-notice";
import { useUiConfig } from "@/state/ui-config";
import { BrandCover, AppText, CornerRibbon, CourseCover, ShareIcon, StageFrame, dimStyle, useDimLayer } from "@/ui";
import { ribbonsFor } from "./ribbons";
import { CoverAlbum } from "./album";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { CoverCarousel } from "./cover-carousel";
import { useCoverMedia } from "./cover-media";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { CoverBadges, type CoverStats } from "./cover-stats";
import { EdmInfoPanel } from "./edm-info";

/**
 * 課程介紹頁與教材清單頁上方的封面（業主 2026-11-18：封面上不放任何提示文字，全部封面一致；左下角固定是封面統計模組的訂閱鈕＋點閱）。
 * EDM：圖片寬度自動符合畫面最大寬度、停在管理員設定的預設位置，只有「點一下放大」，不能拖曳，
 * 點一下彈出小視窗可放大縮小、下載、分享。
 * 沒有 EDM 時顯示色塊。外框用 StageFrame，高度與上課頁的影片區完全相同。
 */
/** 封面縮成迷你小視窗時裡面顯示的封面（業主 2026-11-24；選圖規則同 EdmStage：品牌 logo ＞ EDM／封面圖 ＞ 文字封面）。 */
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
  // 封面輪播（業主 2026-11-21）：這門課上傳了照片或短影音就輪播（手動上傳 > 品牌 logo 的規則之外，輪播最優先）。
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
        // 品牌 logo 封面點一下也能放大、下載、分享（業主 2026-11-18：與一般課程 EDM 同一個放大視窗）。
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
      {openId !== null && images.length ? <EdmLightbox uri={images[0]!.url} title={course.title} items={images.map((x) => ({ uri: x.url, title: course.title }))} index={Math.max(0, images.findIndex((x) => x.id === openId))} onClose={() => setOpenId(null)} /> : null}
      {course.brand && open ? <EdmLightbox uri={course.brand.logoUrl} bg={(scheme === "dark" && course.brand.bgColorDark) || course.brand.bgColor || undefined} title={course.title} onClose={() => setOpen(false)} /> : null}
      {!course.brand && course.edmUrl && open ? <EdmLightbox uri={course.edmUrl} title={course.title} onClose={() => setOpen(false)} /> : null}
    </StageFrame>
  );
}

/** 網頁：放大視窗裡拖曳圖片時，不觸發整頁的下拉重新整理（lib/web-pull-refresh.ts 認得 data-no-pull-refresh；業主 2026-11-17）。 */
const NO_SCALE = Platform.OS === "web" ? ({ dataSet: { noScale: "" } } as object) : {};
const NO_PULL = Platform.OS === "web" ? ({ dataSet: { noPullRefresh: "" } } as object) : {};

/**
 * EDM 封面（業主 2026-11-18：所有封面都只有「點一下放大」，不能拖曳）：圖片寬度符合舞台寬度，停在管理員設定的預設位置（edmViewY），
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
        // 圖比舞台「矮」（例如寬長條的 logo）：置中、四周保留安全距離，不貼上緣（業主 2026-11-18）。
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

/**
 * 站內小視窗：視窗大小剛好貼合圖片（沒有標題、沒有多餘留白），放大縮小、下載、分享按鈕都疊在圖片上。
 * 分享會呼叫系統分享選單，直接把「圖片」傳出去（圖示用系統預設的 ShareIcon）。
 */
/** 操作說明縮成十字圖示後，這次開啟網站期間都記住（不用每張圖再按一次）。 */
let helpHiddenMemory = true; // 預設縮成十字圖示，點圖示才展開（業主 2026-11-24）
/** id＝相簿照片編號（有給、而且看的人有管理權限時，右上角多一顆「圖片資訊」驚嘆號鈕；業主 2026-11-24）。 */
export type LightboxItem = { uri: string; title: string; bg?: string; id?: string };
export function EdmLightbox({ uri, title, onClose, showInfo = false, bg, items, index = 0 }: { uri: string; title: string; onClose: () => void; /** 看的人有管理權限時才傳 true：顯示「圖片資訊」鈕（內容含上傳者與 EXIF）。 */ showInfo?: boolean; /** 透明背景的圖（品牌 logo）底色，預設白色。 */ bg?: string; /** 一組圖（例如歷年課表）：手機左右滑、電腦點兩側箭頭／鍵盤方向鍵切換上一張、下一張。 */ items?: LightboxItem[]; index?: number }) {
  useEffect(() => trackFeature("edm_zoom"), []);
  // 真正的全螢幕：進來時收起瀏覽器的網址列與按鈕，關閉時還原（lib/fullscreen.ts；不支援的瀏覽器略過）。
  useEffect(() => {
    enterFullscreen();
    return exitFullscreen;
  }, []);
  const [hideHelp, setHideHelp] = useState(helpHiddenMemory);
  const setHelp = (hide: boolean) => {
    helpHiddenMemory = hide;
    setHideHelp(hide);
  };
  useDimLayer();
  useBackToClose(onClose); // 瀏覽器／手機「上一頁」＝直接關閉這個全螢幕視窗（業主 2026-11-24）
  const [infoOpen, setInfoOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const list = items && items.length ? items : [{ uri, title, bg }];
  const [idx, setIdx] = useState(Math.min(Math.max(0, index), list.length - 1));
  const cur = list[idx] ?? list[0]!;
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState(0.7); // 寬 / 高
  const [touching, setTouching] = useState(false); // 手指或滑鼠按著圖片時，按鈕暫時消失
  const full = resolveUrl(cur.uri);
  useEffect(() => {
    Image.getSize(full, (w, h) => h && setRatio(w / h), () => undefined);
  }, [full]);
  // 全螢幕（業主 2026-11-21）：圖片依整個螢幕等比貼合；放大後「整個螢幕」都是可看、可拖曳的範圍（不再被圖片原本的外框切掉）。
  const frameW = Math.min(win.width, win.height * ratio);
  const frameH = frameW / ratio;

  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const off = useRef({ x: 0, y: 0 }); // 0,0＝圖片置中
  const start = useRef({ x: 0, y: 0 });
  const live = useRef({ scale: 1, w: frameW, h: frameH, ww: win.width, wh: win.height });
  live.current = { scale, w: frameW, h: frameH, ww: win.width, wh: win.height };
  const place = (x: number, y: number) => {
    const { scale: sc, w, h, ww, wh } = live.current;
    const mx = Math.max(0, (w * sc - ww) / 2);
    const my = Math.max(0, (h * sc - wh) / 2);
    off.current = { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
    tx.setValue(off.current.x);
    ty.setValue(off.current.y);
  };
  const reset = () => {
    live.current = { ...live.current, scale: 1 };
    setScale(1);
    off.current = { x: 0, y: 0 };
    tx.setValue(0);
    ty.setValue(0);
  };
  // 螢幕轉向或換一張圖：縮放與位移歸零，圖片重新貼合。
  useEffect(reset, [win.width, win.height, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomTo = (next: number) => {
    const { scale: sc } = live.current;
    const k = next / sc; // 以畫面中心為基準放大縮小
    live.current = { ...live.current, scale: next };
    setScale(next);
    place(off.current.x * k, off.current.y * k);
  };
  const clampScale = (v: number) => Math.min(4, Math.max(1, v));
  const go = (d: number) => setIdx((i) => Math.min(list.length - 1, Math.max(0, i + d)));
  const goRef = useRef(go);
  goRef.current = go;
  const pinch = useRef<{ dist: number; scale: number; mx: number; my: number } | null>(null);
  const multi = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = { ...off.current };
        pinch.current = null;
        multi.current = false;
        setTouching(true);
      },
      onPanResponderMove: (e, g) => {
        const t = e.nativeEvent.touches;
        if (t && t.length >= 2) {
          multi.current = true;
          // 兩指：捏合放大縮小（以畫面中心為基準），兩指一起移動也會平移。
          const a = t[0]!;
          const b = t[1]!;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          const mx = (a.pageX + b.pageX) / 2;
          const my = (a.pageY + b.pageY) / 2;
          if (!pinch.current) pinch.current = { dist: dist || 1, scale: live.current.scale, mx, my };
          const p = pinch.current;
          zoomTo(clampScale(p.scale * (dist / p.dist)));
          place(off.current.x + (mx - p.mx), off.current.y + (my - p.my));
          pinch.current = { ...p, mx, my };
          return;
        }
        if (pinch.current) {
          pinch.current = null; // 兩指變一指：以目前位置重新計算拖曳的起點
          start.current = { x: off.current.x - g.dx, y: off.current.y - g.dy };
        }
        place(start.current.x + g.dx, start.current.y + g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        pinch.current = null;
        setTouching(false);
        // 沒放大時，往左／右滑＝下一張／上一張。
        if (!multi.current && live.current.scale <= 1.02 && Math.abs(g.dx) > 60 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5) goRef.current(g.dx < 0 ? 1 : -1);
      },
      onPanResponderTerminate: () => {
        pinch.current = null;
        setTouching(false);
      },
    }),
  ).current;
  const wheel = Platform.OS === "web" ? { onWheel: (e: { deltaY: number }) => zoomTo(clampScale(live.current.scale * Math.exp(-e.deltaY * 0.002))) } : {};
  // 電腦：鍵盤左右鍵切換、Esc 關閉。
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goRef.current(-1);
      else if (e.key === "ArrowRight") goRef.current(1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = async () => {
    const r = await shareImage(cur.title, cur.uri, `${cur.title}.jpg`);
    if (r === "copied") flashText("已複製連結");
  };
  const download = async () => {
    try {
      await downloadImage(cur.uri, `${cur.title}.jpg`);
    } catch {
      flashText("下載失敗，請稍後再試");
    }
  };
  const tool = (label: string, onPress: () => void, child: React.ReactNode, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={[styles.tool, { opacity: disabled ? 0.45 : 1 }]}>
      {child}
    </Pressable>
  );
  const many = list.length > 1;
  const land = win.width > win.height; // 橫放：說明與按鈕合併在同一列
  const hint = many ? "左右滑動換張、兩指放大縮小" : "可拖曳移動、兩指放大縮小";
  const [helpW, setHelpW] = useState(0);
  // 單行自動縮小：中文每字約一個字寬；可用寬度＝長條寬度扣掉圖示與左右留白。
  const helpSize = helpW ? Math.max(11, Math.min(26, Math.floor((helpW - 32 - 24 - 10 - 60) / (hint.length * 1.05)))) : 18;
  // 電腦（有滑鼠）才顯示左右切換按鈕；手機、平板橫放用手指滑動（業主 2026-11-21）。
  const desktop = Platform.OS === "web" && typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  const imgBg = cur.bg ?? bg;
  const canInfo = !!cur.id && showInfo;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="關閉" />
        {/* 整個螢幕都是手勢範圍：放大後可拖曳到螢幕的任何位置，不會被圖片原本的外框切掉。 */}
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", overflow: "hidden" }, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null]} {...pan.panHandlers} {...wheel} {...NO_PULL}>
          <Animated.Image source={{ uri: full }} resizeMode="stretch" style={{ width: frameW * scale, height: frameH * scale, backgroundColor: imgBg ?? "#fff", transform: [{ translateX: tx }, { translateY: ty }] }} accessibilityIgnoresInvertColors />
        </View>
        <View style={[StyleSheet.absoluteFill, { opacity: touching ? 0 : 1, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]} pointerEvents={touching ? "none" : "box-none"}>
          {many && desktop ? (
            <>
              <View style={[styles.side, { left: 16 }]} pointerEvents="box-none">
                {tool("上一張", () => go(-1), <Ionicons name="chevron-back" size={28} color="#fff" />, idx === 0)}
              </View>
              <View style={[styles.side, { right: 16 }]} pointerEvents="box-none">
                {tool("下一張", () => go(1), <Ionicons name="chevron-forward" size={28} color="#fff" />, idx === list.length - 1)}
              </View>
            </>
          ) : null}
          {/* 說明文字與下載、分享、關閉全部在最上面同一列（業主 2026-11-21）。 */}
          <View style={[styles.top, land && { flexDirection: "row-reverse", alignItems: "flex-start" }]} pointerEvents="box-none">
            <View style={{ alignItems: "flex-end", gap: space.xs }} pointerEvents="box-none">
              <View style={styles.row} pointerEvents="box-none">
                {hideHelp ? tool("顯示操作說明", () => setHelp(false), <Ionicons name="move" size={24} color="#fff" />) : null}
                {canInfo ? tool("圖片資訊", () => setInfoOpen((v) => !v), <Ionicons name={infoOpen ? "alert-circle" : "alert-circle-outline"} size={26} color={infoOpen ? "#ffd54f" : "#fff"} />) : null}
                {tool("下載", download, <Ionicons name="download-outline" size={24} color="#fff" />)}
                {tool("分享", share, <ShareIcon size={24} color="#fff" />)}
                {tool("關閉", onClose, <Ionicons name="close" size={26} color="#fff" />)}
              </View>
              {/* 第幾張、共幾張：獨立標籤，放在「關閉」鈕正下方（業主 2026-11-21）。 */}
              {many ? (
                <View style={styles.counter} pointerEvents="none">
                  <AppText variant="callout" style={{ color: "#fff", fontWeight: "800" }}>{`第 ${idx + 1} 張，共 ${list.length} 張`}</AppText>
                </View>
              ) : null}
            </View>
            {/* 操作說明：強制單行，字太多時自動縮小（業主 2026-11-21）。 */}
            {!hideHelp ? (
              <View style={[styles.help, land && { flex: 1, alignSelf: "auto" }]} onLayout={(e) => setHelpW(e.nativeEvent.layout.width)} pointerEvents="box-none">
                <Ionicons name="move" size={24} color="#fff" />
                <AppText variant="caption" numberOfLines={1} {...NO_SCALE} style={{ color: "#fff", fontWeight: "800", fontSize: helpSize, lineHeight: helpSize + 8, flexShrink: 1, flexGrow: 1 }}>
                  {hint}
                </AppText>
                {/* 縮小：按了變成十字圖示，排在下載鈕左邊（業主 2026-11-21）。 */}
                {tool("縮小操作說明", () => setHelp(true), <Ionicons name="contract" size={24} color="#fff" />)}
              </View>
            ) : null}
          </View>
          {infoOpen && canInfo ? <EdmInfoPanel id={cur.id!} top={land ? 84 : 150} onClose={() => setInfoOpen(false)} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  frame: { overflow: "hidden", backgroundColor: "#fff" },
  side: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  counter: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)" },
  top: { position: "absolute", left: 16, right: 16, top: 16, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.xs },
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  help: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, borderRadius: 30, backgroundColor: "rgba(0,0,0,0.5)" },
});
