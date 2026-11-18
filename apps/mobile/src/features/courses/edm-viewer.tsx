import { trackFeature } from "@/lib/feature-track";
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

/**
 * 課程介紹頁上方的 EDM：圖片寬度自動符合畫面最大寬度，只能上下拖曳（滑鼠或手指，禁止左右），
 * 一進來停在管理員設定的預設位置（edmViewY）；點一下彈出小視窗可放大縮小、下載、分享。
 * 沒有 EDM 時顯示色塊。外框用 StageFrame，高度與上課頁的影片區完全相同。
 */
export function EdmStage({ course }: { course: CourseSummary }) {
  const [open, setOpen] = useState(false);
  const { member } = useSession();
  const { config } = useUiConfig();
  const ribbons = ribbonsFor(course, member, config);
  return (
    <StageFrame>
      {course.brand ? (
        // 品牌 logo 封面點一下也能放大、下載、分享（業主 2026-11-18：與一般課程 EDM 同一個放大視窗）。
        <Pressable accessibilityRole="button" accessibilityLabel="放大封面" onPress={() => setOpen(true)} style={StyleSheet.absoluteFill}>
          <BrandCover brand={course.brand} fill />
        </Pressable>
      ) : course.edmUrl ? <EdmPan uri={resolveUrl(course.edmUrl)} viewY={course.edmViewY} onOpen={() => setOpen(true)} /> : <CourseCover theme={course.theme} label={course.category} title={displayName(course)} fill />}
      {ribbons.left ? <CornerRibbon label={ribbons.left.label} bg={ribbons.left.bg} fg={ribbons.left.fg} side="left" scale={2} /> : null}
      {ribbons.right ? <CornerRibbon label={ribbons.right.label} bg={ribbons.right.bg} fg={ribbons.right.fg} side="right" scale={2} /> : null}
      {course.brand && open ? <EdmLightbox uri={course.brand.logoUrl} bg={course.brand.bgColor ?? undefined} title={course.title} onClose={() => setOpen(false)} /> : null}
      {!course.brand && course.edmUrl && open ? <EdmLightbox uri={course.edmUrl} title={course.title} onClose={() => setOpen(false)} /> : null}
    </StageFrame>
  );
}

/** 一般的 EDM 舞台（中心 EDM 等）：與課程頁相同的 16:9 外框、可上下拖曳、點一下放大。 */
export function EdmImageStage({ url, title, viewY = 0 }: { url: string; title: string; viewY?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <StageFrame>
      <EdmPan uri={resolveUrl(url)} viewY={viewY} onOpen={() => setOpen(true)} />
      {open ? <EdmLightbox uri={url} title={title} onClose={() => setOpen(false)} /> : null}
    </StageFrame>
  );
}

/** 網頁：在 EDM 上上下拖曳查看時，不觸發整頁的下拉重新整理（lib/web-pull-refresh.ts 認得 data-no-pull-refresh；業主 2026-11-17）。 */
const NO_PULL = Platform.OS === "web" ? ({ dataSet: { noPullRefresh: "" } } as object) : {};

function EdmPan({ uri, viewY, onOpen }: { uri: string; viewY: number; onOpen: () => void }) {
  const { c } = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState<number | null>(null); // 寬 / 高
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef(0);
  const maxUp = useRef(0);
  const startY = useRef(0);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [pressed, setPressed] = useState(false); // 手指按著時，下方提示暫時消失

  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (w, h) => alive && h && setRatio(w / h), () => undefined);
    return () => {
      alive = false;
    };
  }, [uri]);

  const imgH = ratio && box.w ? box.w / ratio : 0;
  maxUp.current = Math.max(0, imgH - box.h);
  const set = (v: number) => {
    cur.current = Math.min(0, Math.max(-maxUp.current, v));
    ty.setValue(cur.current);
  };
  // 一進來停在管理員指定的預設位置。
  useEffect(() => {
    if (imgH && box.h) set(-viewY * imgH);
  }, [imgH, box.h, viewY]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startY.current = cur.current;
        setPressed(true);
      },
      onPanResponderMove: (_e, g) => set(startY.current + g.dy), // 只看上下，左右拖曳完全忽略
      onPanResponderRelease: (_e, g) => {
        setPressed(false);
        if (Math.hypot(g.dx, g.dy) < 6) openRef.current(); // 點一下＝放大
      },
      onPanResponderTerminate: () => setPressed(false),
    }),
  ).current;
  const wheel = Platform.OS === "web" ? { onWheel: (e: { deltaY: number; preventDefault?: () => void }) => set(cur.current - e.deltaY) } : {};

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...pan.panHandlers} {...wheel} {...NO_PULL} accessibilityRole="imagebutton" accessibilityLabel="課程海報，點一下放大，上下拖曳查看">
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
        <Animated.Image source={{ uri }} resizeMode="stretch" style={{ width: box.w, height: imgH, transform: [{ translateY: ty }] }} accessibilityIgnoresInvertColors />
      ) : null}
      {maxUp.current > 8 && !pressed ? (
        <View style={[styles.hint, { backgroundColor: "rgba(0,0,0,0.8)" }]} pointerEvents="none">
          <Ionicons name="swap-vertical" size={14} color="#fff" />
          <AppText variant="caption" style={{ color: "#fff" }}>
            上下拖曳 · 點一下放大
          </AppText>
        </View>
      ) : null}
      {!imgH ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surfaceMuted }]} /> : null}
    </View>
  );
}

/**
 * 站內小視窗：視窗大小剛好貼合圖片（沒有標題、沒有多餘留白），放大縮小、下載、分享按鈕都疊在圖片上。
 * 分享會呼叫系統分享選單，直接把「圖片」傳出去（圖示用系統預設的 ShareIcon）。
 */
export function EdmLightbox({ uri, title, onClose, bg }: { uri: string; title: string; onClose: () => void; /** 透明背景的圖（品牌 logo）底色，預設白色。 */ bg?: string }) {
  useEffect(() => trackFeature("edm_zoom"), []);
  useDimLayer();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState(0.7); // 寬 / 高
  const [touching, setTouching] = useState(false); // 手指或滑鼠按著圖片時，按鈕暫時消失
  const full = resolveUrl(uri);
  useEffect(() => {
    Image.getSize(full, (w, h) => h && setRatio(w / h), () => undefined);
  }, [full]);
  const maxW = Math.min(win.width - 24, 560);
  const maxH = win.height - insets.top - insets.bottom - 40;
  const frameW = Math.min(maxW, maxH * ratio);
  const frameH = frameW / ratio;

  // 放大後可以上下左右自由拖曳（自己處理手勢，不用巢狀捲動）。
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const off = useRef({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const live = useRef({ scale: 1, w: frameW, h: frameH });
  live.current = { scale, w: frameW, h: frameH };
  const place = (x: number, y: number) => {
    const { scale: sc, w, h } = live.current;
    off.current = { x: Math.min(0, Math.max(-(w * sc - w), x)), y: Math.min(0, Math.max(-(h * sc - h), y)) };
    tx.setValue(off.current.x);
    ty.setValue(off.current.y);
  };
  const zoomTo = (next: number) => {
    const { scale: sc, w, h } = live.current;
    // 以畫面中心為基準放大縮小
    const cx = (w / 2 - off.current.x) / sc;
    const cy = (h / 2 - off.current.y) / sc;
    live.current = { scale: next, w, h };
    setScale(next);
    place(w / 2 - cx * next, h / 2 - cy * next);
  };
  const clampScale = (v: number) => Math.min(4, Math.max(1, v));
  const pinch = useRef<{ dist: number; scale: number; mx: number; my: number } | null>(null);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = { ...off.current };
        pinch.current = null;
        setTouching(true);
      },
      onPanResponderMove: (e, g) => {
        const t = e.nativeEvent.touches;
        if (t && t.length >= 2) {
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
      onPanResponderRelease: () => {
        pinch.current = null;
        setTouching(false);
      },
      onPanResponderTerminate: () => {
        pinch.current = null;
        setTouching(false);
      },
    }),
  ).current;
  const wheel = Platform.OS === "web" ? { onWheel: (e: { deltaY: number }) => zoomTo(clampScale(live.current.scale * Math.exp(-e.deltaY * 0.002))) } : {};

  const share = async () => {
    const r = await shareImage(title, uri, `${title}.jpg`);
    if (r === "copied") flashText("已複製連結");
  };
  const download = async () => {
    try {
      await downloadImage(uri, `${title}.jpg`);
    } catch {
      flashText("下載失敗，請稍後再試");
    }
  };
  const tool = (label: string, onPress: () => void, child: React.ReactNode, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={[styles.tool, { opacity: disabled ? 0.45 : 1 }]}>
      {child}
    </Pressable>
  );
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="關閉" />
        <View style={[styles.frame, { width: frameW, height: frameH }, bg ? { backgroundColor: bg } : null]}>
          <View style={[StyleSheet.absoluteFill, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null]} {...pan.panHandlers} {...wheel} {...NO_PULL}>
            <Animated.Image source={{ uri: full }} resizeMode="stretch" style={{ width: frameW * scale, height: frameH * scale, transform: [{ translateX: tx }, { translateY: ty }] }} accessibilityIgnoresInvertColors />
          </View>
          <View style={[StyleSheet.absoluteFill, { opacity: touching ? 0 : 1 }]} pointerEvents={touching ? "none" : "box-none"}>
            <View style={styles.topRight} pointerEvents="box-none">
              {tool("關閉", onClose, <Ionicons name="close" size={26} color="#fff" />)}
            </View>
            <View style={styles.bottom} pointerEvents="box-none">
              <View style={styles.help} pointerEvents="none">
                <Ionicons name="move" size={18} color="#fff" />
                <AppText variant="caption" style={{ color: "#fff", fontWeight: "700", flexShrink: 1 }}>
                  可拖曳移動、兩指放大縮小
                </AppText>
              </View>
              {tool("下載", download, <Ionicons name="download-outline" size={24} color="#fff" />)}
              {tool("分享", share, <ShareIcon size={24} color="#fff" />)}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", ...dimStyle },
  frame: { overflow: "hidden", borderRadius: radius.md, backgroundColor: "#fff" },
  topRight: { position: "absolute", top: 16, right: 16 },
  bottom: { position: "absolute", left: 16, right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: space.xs },
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  help: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, minHeight: 36, borderRadius: 18, backgroundColor: "#000" },
});
