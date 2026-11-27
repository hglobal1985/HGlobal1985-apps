/**
 * 看圖程式（共用元件：寰宇行動大學與寰宇繳作業系統同一個；杜杜龍 2026-11-26 從 edm-viewer.tsx 拆出來）。
 * 全螢幕看圖：兩指放大縮小、拖曳、左右滑換張（電腦：箭頭鍵與左右按鈕）、檢視全部、下載、分享、上傳者、第幾張。
 * 行動大學的「相簿資料夾」與「圖片資訊」由行動大學在 features/courses/edm-viewer.tsx 用 registerLightboxParts 接上；
 * 沒有接上的 App（例如繳作業系統）就沒有那兩顆按鈕。每個 App 要提供 lib/app-assets（APP_LOGO：左上角的標誌）。
 */
import { trackFeature } from "@/lib/feature-track";
import { useBackToClose } from "@/lib/back-close";
import { InlinePage } from "@/lib/inline-page";
import { usePageBack } from "@/lib/page-back";
import { enterFullscreen, exitFullscreen } from "@/lib/fullscreen";
import { APP_LOGO } from "@/lib/app-assets";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Animated, Image, Modal, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, resolveUrl, type CoverMediaItem } from "@/api/client";
import { downloadImage, shareImage } from "@/lib/share";
import { LightboxGrid } from "./lightbox-grid";
import { loadAlbumPos, saveAlbumPos } from "@/lib/album-memory";
import { space } from "@/theme/tokens";
import { flashText } from "@/ui/flash-notice";
import { AppText } from "@/ui/text";
import { ShareIcon } from "@/ui/share-icon";
import { useDimLayer } from "@/ui/dim-backdrop";
import { trackUsage } from "@/lib/usage";

/** 行動大學專屬的兩塊（相簿資料夾檢視、圖片資訊面板）：由 App 自己註冊，看圖程式本身不依賴它們。 */
export type LibraryPick = { folder: { id: string; title: string } | null; title: string; items: CoverMediaItem[]; index?: number };
type LibraryProps = { restore?: { group: string | null; folder: string | null } | null; initial?: { folder: NonNullable<LibraryPick["folder"]>; items: CoverMediaItem[]; focusId?: string } | null; onPick: (p: LibraryPick) => void; [k: string]: unknown };
type InfoProps = { id?: string; imageKey?: string; top: number; onClose: () => void };
let LightboxLibrary: ComponentType<LibraryProps> | null = null;
let EdmInfoPanel: ComponentType<InfoProps> | null = null;
export function registerLightboxParts(p: { library?: ComponentType<never>; info?: ComponentType<never> }): void {
  if (p.library) LightboxLibrary = p.library as unknown as ComponentType<LibraryProps>;
  if (p.info) EdmInfoPanel = p.info as unknown as ComponentType<InfoProps>;
}

/** 網頁：放大視窗裡拖曳圖片時，不觸發整頁的下拉重新整理（lib/web-pull-refresh.ts 認得 data-no-pull-refresh；杜杜龍 2026-11-17）。 */
const NO_SCALE = Platform.OS === "web" ? ({ dataSet: { noScale: "" } } as object) : {};
/** 全螢幕看圖的上方工具列：圖示與文字只吃平板／電腦倍數、不吃至尊倍數，至尊模式與超派模式長得一樣（杜杜龍 2026-11-25）。 */
const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;
const NO_PULL = Platform.OS === "web" ? ({ dataSet: { noPullRefresh: "" } } as object) : {};

/**
 * 站內小視窗：視窗大小剛好貼合圖片（沒有標題、沒有多餘留白），放大縮小、下載、分享按鈕都疊在圖片上。
 * 分享會呼叫系統分享選單，直接把「圖片」傳出去（圖示用系統預設的 ShareIcon）。
 */
/** 操作說明縮成十字圖示後，這次開啟網站期間都記住（不用每張圖再按一次）。 */
const viewedIds = new Set<string>(); // 這次開啟網站已回報過瀏覽的照片編號
let helpHiddenMemory = true; // 預設縮成十字圖示，點圖示才展開（杜杜龍 2026-11-24）
/** id＝相簿照片編號（有給、而且看的人有管理權限時，右上角多一顆「圖片資訊」驚嘆號鈕；杜杜龍 2026-11-24）。 */
export type LightboxItem = { uri: string; title: string; bg?: string; id?: string; /** 上傳者暱稱與頭像（相簿照片）：單張看圖時顯示在「第幾張，共幾張」同一列最左邊。 */ uploader?: { name: string; avatar?: string } };
/** 相簿照片 → 看圖項目（所有入口共用，確保上傳者資訊一致帶進看圖畫面；杜杜龍 2026-11-25）。 */
export const lightboxItem = (x: { url: string; id: string; uploader?: string; uploaderAvatar?: string }, title: string): LightboxItem => ({ uri: x.url, title, id: x.id, ...(x.uploader ? { uploader: { name: x.uploader, ...(x.uploaderAvatar ? { avatar: x.uploaderAvatar } : {}) } } : {}) });
export function EdmLightbox({ uri, title, onClose, showInfo = false, bg, items, index = 0, library = false, inline = false }: { /** 放在一般頁面裡（相簿頁：保留上方工具列與下方選單列）：不用蓋滿全螢幕的視窗、不進瀏覽器全螢幕、不多記瀏覽紀錄（杜杜龍 2026-11-26）。 */ inline?: boolean; /** 直接以「相簿」資料夾檢視開場（相簿專區入口：沒有照片、先選資料夾；杜杜龍 2026-11-25）。 */ library?: boolean; uri: string; title: string; onClose: () => void; /** 看的人有管理權限時才傳 true：顯示「圖片資訊」鈕（內容含上傳者與 EXIF）。 */ showInfo?: boolean; /** 透明背景的圖（品牌 logo）底色，預設白色。 */ bg?: string; /** 一組圖（例如歷年課表）：手機左右滑、電腦點兩側箭頭／鍵盤方向鍵切換上一張、下一張。 */ items?: LightboxItem[]; index?: number }) {
  useEffect(() => trackFeature("edm_zoom"), []);
  // 真正的全螢幕：進來時收起瀏覽器的網址列與按鈕，關閉時還原（lib/fullscreen.ts；不支援的瀏覽器略過）。
  useEffect(() => {
    if (inline) return;
    enterFullscreen();
    return exitFullscreen;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [hideHelp, setHideHelp] = useState(helpHiddenMemory);
  const setHelp = (hide: boolean) => {
    helpHiddenMemory = hide;
    setHideHelp(hide);
  };
  useDimLayer();
  // 「關閉」的行為（杜杜龍 2026-11-25）：從相簿資料夾打開某張照片時，按 ✕／返回＝退回相簿資料夾畫面，不是退出全螢幕；
  // 從課程教材中心等一般入口打開的照片，按 ✕ 才是退出全螢幕。
  const closeNow = useRef<() => void>(onClose);
  useBackToClose(() => closeNow.current(), !inline); // 瀏覽器／手機「上一頁」同 ✕（杜杜龍 2026-11-24）
  const [infoOpen, setInfoOpen] = useState(false);
  const [grid, setGrid] = useState(false); // 「檢視全部」格狀畫面（杜杜龍 2026-11-25）
  // 相簿專區入口：記住上次位置（杜杜龍 2026-11-25）。上次停在單張看圖＝直接開回那張照片；停在資料夾檢視＝開到那個資料夾。
  const [restore] = useState(() => (library ? loadAlbumPos() : null));
  const photoRestore = !!restore && restore.mode === "photo" && !!restore.folder && !!restore.photo;
  const [libOpen, setLibOpen] = useState(library && !photoRestore && !!LightboxLibrary); // 「相簿」資料夾檢視（杜杜龍 2026-11-25）
  const [over, setOver] = useState<{ title: string; items: LightboxItem[]; folder: LibraryPick["folder"] } | null>(null); // 從相簿選了資料夾：整個看圖換成這個資料夾的照片
  const photoSaved = useRef(!photoRestore); // 單張位置還原完成前不記，免得蓋掉上次的位置
  useEffect(() => {
    if (!photoRestore || !restore?.folder) return;
    let alive = true;
    api<{ folder: NonNullable<LibraryPick["folder"]>; items: CoverMediaItem[] }>("GET", `/albums/folder?id=${encodeURIComponent(restore.folder)}`)
      .then((r) => {
        if (!alive) return;
        const imgs = r.items.filter((x) => x.kind === "image");
        const at = imgs.findIndex((x) => x.id === restore.photo);
        if (!imgs.length) throw new Error("empty");
        setOver({ title: r.folder.title, folder: r.folder, items: imgs.map((x) => lightboxItem(x, r.folder.title)) });
        setIdx(Math.max(0, at));
      })
      .catch(() => alive && setLibOpen(true)) // 這張／這個資料夾不在了或沒有權限：回到資料夾檢視
      .finally(() => void (photoSaved.current = true));
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  closeNow.current = () => (grid ? setGrid(false) : over && !libOpen ? setLibOpen(true) : onClose());
  // 全螢幕被系統收起（例如管理員按「上傳照片」開檔案選擇視窗）：下一次點一下畫面就自動再進全螢幕，停留在相簿裡操作（杜杜龍 2026-11-25）。
  useEffect(() => {
    if (inline || Platform.OS !== "web" || typeof document === "undefined") return;
    let lost = false;
    const onFs = () => {
      if (!document.fullscreenElement) lost = true;
    };
    const onTap = () => {
      if (lost) {
        lost = false;
        enterFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("pointerdown", onTap, true);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("pointerdown", onTap, true);
    };
  }, []);
  const gridRef = useRef(false);
  gridRef.current = grid;
  const safe = useSafeAreaInsets();
  const insets = inline ? { top: 0, bottom: 0, left: 0, right: 0 } : safe;
  usePageBack(() => (closeNow.current(), true), 1, inline); // 相簿頁：上方工具列的返回鍵＝按 ✕（單張退回資料夾，最上層離開相簿）
  const win = useWindowDimensions();
  const base: LightboxItem[] = items && items.length ? items : uri ? [{ uri, title, bg }] : [];
  const list = over ? over.items : base;
  const [idx, setIdx] = useState(Math.min(Math.max(0, index), list.length - 1));
  const cur = list[idx] ?? list[0] ?? { uri: "", title: "" };
  const [scale, setScale] = useState(1);
  const [ratio, setRatio] = useState(0.7); // 寬 / 高
  const [touching, setTouching] = useState(false); // 手指或滑鼠按著圖片時，按鈕暫時消失
  const full = resolveUrl(cur.uri);
  // 照片瀏覽數（相簿資訊總覽的「瀏覽數排序」用）：看過一張就算一次，同一次開啟網站同一張只送一次。
  useEffect(() => {
    const id = list[idx]?.id;
    if (!id || viewedIds.has(id)) return;
    viewedIds.add(id);
    api("POST", `/cover-media/${id}/view`).catch(() => undefined);
  }, [list, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (library && over?.folder && !libOpen && photoSaved.current && list[idx]?.id) saveAlbumPos({ folder: over.folder.id, photo: list[idx]!.id!, mode: "photo" });
  }, [library, over?.folder?.id, libOpen, idx, list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cur.uri) Image.getSize(full, (w, h) => h && setRatio(w / h), () => undefined);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  // 全螢幕（杜杜龍 2026-11-21）：圖片依整個螢幕等比貼合；放大後「整個螢幕」都是可看、可拖曳的範圍（不再被圖片原本的外框切掉）。
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
      else if (e.key === "Escape") (gridRef.current ? setGrid(false) : closeNow.current());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 使用統計（相簿操作習慣）：每看一張相簿照片記一次。
  useEffect(() => {
    if (cur.id) trackUsage("album_photo", "單張檢視");
  }, [cur.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = async () => {
    if (cur.id) trackUsage("album_share", "單張");
    const r = await shareImage(cur.title, cur.uri, `${cur.title}.jpg`);
    if (r === "copied") flashText("已複製連結");
  };
  const download = async () => {
    if (cur.id) trackUsage("album_download", "單張");
    try {
      await downloadImage(cur.uri, `${cur.title}.jpg`);
    } catch {
      flashText("下載失敗，請稍後再試");
    }
  };
  // 工具列最多 7 顆圓鈕（說明、相簿、檢視全部、資訊、下載、分享、關閉）：窄螢幕自動縮小直徑，一定排得下（杜杜龍 2026-11-25）。
  const toolSize = Math.min(50, Math.floor((win.width - 32 - 4 * 6) / 7));
  const tool = (label: string, onPress: () => void, child: React.ReactNode, disabled?: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={[styles.tool, { width: toolSize, height: toolSize, borderRadius: toolSize / 2, opacity: disabled ? 0.45 : 1 }]}>
      {child}
    </Pressable>
  );
  const many = list.length > 1;
  const land = win.width > win.height; // 橫放：說明與按鈕合併在同一列
  const hint = many ? "左右滑動換張、兩指放大縮小" : "可拖曳移動、兩指放大縮小";
  const smallLand = win.width > win.height && win.height < 520; // 小螢幕手機橫放（杜杜龍 2026-11-25）
  const topY = inline ? 10 : smallLand ? 10 : 30;
  const [helpW, setHelpW] = useState(0);
  // 單行自動縮小：中文每字約一個字寬；可用寬度＝長條寬度扣掉圖示與左右留白。
  const helpSize = helpW ? Math.max(11, Math.min(26, Math.floor((helpW - 32 - 24 - 10 - 60) / (hint.length * 1.05)))) : 18;
  const upl = cur.uploader;
  const uploaderChip = upl ? (
    <View style={[styles.counter, { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 4, flexShrink: 1 }]}>
      {upl.avatar ? (
        <Image source={{ uri: upl.avatar }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#444" }} accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#4a4a4f", alignItems: "center", justifyContent: "center" }}>
          <AppText variant="caption" {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800" }}>{[...upl.name][0] ?? "?"}</AppText>
        </View>
      )}
      <AppText variant="callout" numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800", flexShrink: 1 }}>{upl.name}</AppText>
    </View>
  ) : null;
  const helpBar = (
    <View style={[styles.help, land && { flex: 1, alignSelf: "auto" }]} onLayout={(e) => setHelpW(e.nativeEvent.layout.width)} pointerEvents="box-none">
      <Ionicons name="move" size={24} color="#fff" {...UI_ONLY} />
      <AppText variant="caption" numberOfLines={1} {...NO_SCALE} style={{ color: "#fff", fontWeight: "800", fontSize: helpSize, lineHeight: helpSize + 8, flexShrink: 1, flexGrow: 1 }}>
        {hint}
      </AppText>
      {/* 縮小：按了變成十字圖示，排在下載鈕左邊（杜杜龍 2026-11-21）。 */}
      {tool("縮小操作說明", () => setHelp(true), <Ionicons name="contract" size={24} color="#fff" {...UI_ONLY} />)}
    </View>
  );
  // 電腦（有滑鼠）才顯示左右切換按鈕；手機、平板橫放用手指滑動（杜杜龍 2026-11-21）。
  const desktop = Platform.OS === "web" && typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  const imgBg = cur.bg ?? bg;
  // 圖片資訊開放給所有人、所有照片都有（杜杜龍 2026-11-25）：相簿照片用編號查；其他（課程封面、品牌 logo、課表…）用網址裡的儲存檔名查。showInfo 保留相容、不再限制。
  const imageKey = (() => {
    try {
      return /[?&]k=([^&]+)/.exec(cur.uri)?.[1] ? decodeURIComponent(/[?&]k=([^&]+)/.exec(cur.uri)![1]!) : undefined;
    } catch {
      return undefined;
    }
  })();
  const canInfo = !!EdmInfoPanel && (!!cur.id || !!imageKey);
  const Shell = inline ? InlineShell : Modal;
  return (
    <Shell transparent animationType="fade" onRequestClose={() => closeNow.current()} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => closeNow.current()} accessibilityLabel="關閉" />
        {/* 整個螢幕都是手勢範圍：放大後可拖曳到螢幕的任何位置，不會被圖片原本的外框切掉。 */}
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", overflow: "hidden" }, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null]} {...pan.panHandlers} {...wheel} {...NO_PULL}>
          {list.length ? <Animated.Image source={{ uri: full }} resizeMode="stretch" style={{ width: frameW * scale, height: frameH * scale, backgroundColor: imgBg ?? "#fff", transform: [{ translateX: tx }, { translateY: ty }] }} accessibilityIgnoresInvertColors /> : null}
        </View>
        <View style={[StyleSheet.absoluteFill, { opacity: touching ? 0 : 1, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]} pointerEvents={touching ? "none" : "box-none"}>
          {many && desktop ? (
            <>
              <View style={[styles.side, { left: 16 }]} pointerEvents="box-none">
                {tool("上一張", () => go(-1), <Ionicons name="chevron-back" size={28} color="#fff" {...UI_ONLY} />, idx === 0)}
              </View>
              <View style={[styles.side, { right: 16 }]} pointerEvents="box-none">
                {tool("下一張", () => go(1), <Ionicons name="chevron-forward" size={28} color="#fff" {...UI_ONLY} />, idx === list.length - 1)}
              </View>
            </>
          ) : null}
          {/* 工具列（杜杜龍 2026-11-21；2026-11-25 調整）：寰宇 logo 在最左邊（純標誌，點了沒有任何反應）；按鈕在右邊。
              位置往下移一點；小螢幕手機橫放時，按鈕改成靠右由上到下一欄，不蓋住照片。所有看圖畫面（含不是從相簿進來的）都用這個。 */}
          <View style={{ position: "absolute", left: 16, top: topY, width: toolSize, height: toolSize, borderRadius: toolSize / 2, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
            <Image source={APP_LOGO} style={{ width: toolSize - 10, height: toolSize - 10 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          </View>
          {upl && smallLand ? <View style={{ position: "absolute", left: 16, top: topY + toolSize + 8, maxWidth: win.width * 0.4 }} pointerEvents="none">{uploaderChip}</View> : null}
          <View style={[styles.top, { top: topY }, smallLand ? { left: undefined, right: 12 } : null, !smallLand && land && { flexDirection: "row-reverse", alignItems: "flex-start" }]} pointerEvents="box-none">
            <View style={{ alignItems: "flex-end", gap: space.xs }} pointerEvents="box-none">
              <View style={[styles.row, smallLand && { flexDirection: "column", alignItems: "flex-end" }]} pointerEvents="box-none">
                {hideHelp ? tool("顯示操作說明", () => setHelp(false), <Ionicons name="move" size={24} color="#fff" {...UI_ONLY} />) : null}
                {many ? tool("檢視全部", () => (over?.folder ? setLibOpen(true) : setGrid(true)), <Ionicons name="grid-outline" size={24} color="#fff" {...UI_ONLY} />) : null}
                {list.length && canInfo ? tool("圖片資訊", () => (!infoOpen && trackUsage("album_info", cur.id ? "相簿照片" : "其他圖片"), setInfoOpen((v) => !v)), <Ionicons name={infoOpen ? "alert-circle" : "alert-circle-outline"} size={26} color={infoOpen ? "#ffd54f" : "#fff"} {...UI_ONLY} />) : null}
                {list.length ? tool("下載", download, <Ionicons name="download-outline" size={24} color="#fff" {...UI_ONLY} />) : null}
                {list.length ? tool("分享", share, <ShareIcon size={24} color="#fff" uiOnly />) : null}
                {tool("關閉", () => closeNow.current(), <Ionicons name="close" size={26} color="#fff" {...UI_ONLY} />)}
              </View>
              {/* 上傳者（頭像＋暱稱）在最左、「第幾張，共幾張」在最右，同一列（杜杜龍 2026-11-25；小螢幕橫放時上傳者改放左上 logo 下方）。 */}
              {many || (upl && !smallLand) ? (
                <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }} pointerEvents="none">
                  {upl && !smallLand ? uploaderChip : <View />}
                  {many ? (
                    <View style={styles.counter}>
                      <AppText variant="callout" {...UI_ONLY_TEXT} style={{ color: "#fff", fontWeight: "800" }}>{`第 ${idx + 1} 張，共 ${list.length} 張`}</AppText>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* 操作說明：強制單行，字太多時自動縮小（杜杜龍 2026-11-21）。 */}
            {!hideHelp && !smallLand ? helpBar : null}
          </View>
          {!hideHelp && smallLand ? <View style={{ position: "absolute", left: toolSize + 28, right: toolSize + 28, top: topY }} pointerEvents="box-none">{helpBar}</View> : null}
          {grid && list.length ? <LightboxGrid list={list} current={idx} heading={over?.title} onPick={(i) => { setIdx(i); setGrid(false); }} onClose={() => setGrid(false)} /> : null}
          {libOpen && LightboxLibrary ? <LightboxLibrary restore={restore ? { group: restore.group, folder: restore.folder } : null} initial={over?.folder ? { folder: over.folder, items: [], focusId: list[idx]?.id } : null} onPick={(p) => { setOver({ title: p.title, folder: p.folder, items: p.items.map((x) => lightboxItem(x, p.title)) }); setIdx(p.index ?? 0); setGrid(p.index === undefined); setLibOpen(false); }} /> : null}
          {infoOpen && canInfo && EdmInfoPanel ? <EdmInfoPanel id={cur.id} imageKey={imageKey} top={land ? 84 : 150} onClose={() => setInfoOpen(false)} /> : null}
        </View>
      </View>
    </Shell>
  );
}

/** 相簿頁用：不開視窗，直接填滿頁面內容區（上方工具列與下方選單列照常顯示）。 */
function InlineShell({ children }: { children?: ReactNode; transparent?: boolean; animationType?: string; onRequestClose?: () => void; statusBarTranslucent?: boolean }) {
  return <View style={{ flex: 1, backgroundColor: "#000" }}><InlinePage>{children}</InlinePage></View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  frame: { overflow: "hidden", backgroundColor: "#fff" },
  side: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  counter: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)" },
  top: { position: "absolute", left: 16, right: 16, top: 30, gap: space.xs },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.xs },
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  help: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, borderRadius: 30, backgroundColor: "rgba(0,0,0,0.5)" },
});

/** 相簿專區入口開的看圖畫面（第五大分類，杜杜龍 2026-11-25）：全黑的全螢幕看圖，直接以「相簿」資料夾檢視開場。超派、至尊共用。 */
export function AlbumViewer({ onClose, inline = false }: { onClose: () => void; inline?: boolean }) {
  return <EdmLightbox library inline={inline} uri="" title="相簿" onClose={onClose} />;
}
