import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GradientFrame } from "@/ui/gradient-frame";
import type { Rect } from "@/ui/band-rect";
import { MINI_BAR, MINI_BAR_BG, MINI_BTN, MINI_BTN_COLORS, MINI_BTN_GLYPH_COLOR, MINI_CIRCLE, MINI_GLYPHS, MINI_MARGIN, MINI_POS_KEY, MINI_RADIUS, miniFloatWidth } from "./mini-spec";

type Pos = { x: number; y: number };

/**
 * 全站「永遠只有一個」迷你小視窗／圓球（杜杜龍 2026-11-25：頁面疊著好幾層時，每層的封面圓球與影片迷你播放器同時出現，大亂）。
 * 每個 MiniWindow 登記自己是否想顯示與優先權（影片／音檔播放器 2 > 封面 1）；只有「優先權最高、同優先權最後才出現」的那一個真的畫出來。
 */
const reg = new Map<string, { prio: number; seq: number }>();
let seqNo = 0;
const regSubs = new Set<() => void>();
const winner = (): string | null => {
  let best: [string, { prio: number; seq: number }] | null = null;
  for (const e of reg) if (!best || e[1].prio > best[1].prio || (e[1].prio === best[1].prio && e[1].seq > best[1].seq)) best = e;
  return best ? best[0] : null;
};
const setWant = (id: string, want: boolean, prio: number) => {
  const had = reg.get(id);
  if (want && !had) reg.set(id, { prio, seq: ++seqNo });
  else if (!want && had) reg.delete(id);
  else return;
  regSubs.forEach((f) => f());
};
/** 預設位置的底邊：網頁版＝底部分頁列的上緣（小視窗放在分頁列上方），其他＝這一層的底部。 */
function defaultBottomEdge(h: number): number {
  if (Platform.OS !== "web" || typeof document === "undefined") return h;
  const bar = document.querySelector('[role="tablist"]');
  return bar ? bar.getBoundingClientRect().top : h;
}

/**
 * 封面迷你小視窗（杜杜龍 2026-11-24 永久指示：與影片迷你小視窗一模一樣的參數與功能）：
 * 右下角浮動小視窗（16:9、同樣寬度、流光漸層邊框），上方一條按鈕列——黃＝最小化（縮成小圓圖）、綠＝最大化（onMaximize）、紅＝關閉（onClose）；
 * 三顆按鈕永遠顯示；手指按住可任意拖曳位置，位置記在本機（與影片迷你播放器共用同一個位置）；小圓圖也能拖曳、點一下恢復小視窗。
 * 尺寸、顏色、時間都來自 ui/mini-spec.ts（影片迷你播放器用同一份）。放在頁面最外層（滿版透明層，只有小視窗本身會接觸摸）。
 */
export function MiniWindow({ visible, opacity = 1, windowContent, circleContent, label, maximizeLabel, onMaximize, onClose, onTap, collapsed: collapsedProp, onCollapsedChange, slotRef, running = true, getBottomEdge, morph, priority = 1 }: {
  visible: boolean;
  opacity?: number;
  /** 小視窗裡的畫面（16:9，填滿）。 */
  windowContent: ReactNode;
  /** 小圓圖裡的畫面（填滿）。 */
  circleContent: ReactNode;
  label: string;
  /** 綠色按鈕的說明（例如「最大化（回到頂端）」）。 */
  maximizeLabel: string;
  onMaximize: () => void;
  onClose: () => void;
  /** 點一下小視窗畫面（沒有拖曳）：沒傳就只是喚醒三顆按鈕（手機上第一下觸摸不可以直接跳走）。 */
  onTap?: () => void;
  /** 小圓圖狀態由外面控制（影片／音檔播放器用引擎的 collapsed）；沒傳＝自己管。 */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** 畫面槽（小視窗裡放畫面的那一格，或小圓圖）的 DOM 節點：網頁版的影片播放器靠它把真正的 <video>／iframe 疊在這一格上（影片不能被銷毀重建）。 */
  slotRef?: Ref<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** false＝流光邊框暫停（影片暫停時）。 */
  running?: boolean;
  /** 預設位置（還沒拖曳過）的底邊 y 座標；沒傳＝這一層的底部。網頁版影片用它避開底部分頁列。 */
  getBottomEdge?: () => number;
  /** 往下滑縮小的變形過程（0～1）：有給 from（封面原本的位置）就畫「大邊框由大到小」的框，p 到 1 才換成真正的小視窗／圓球（與影片縮成迷你播放器同一種動畫）。 */
  morph?: { p: number; from: Rect | null };
  /** 同時有好幾個想顯示時，優先權高的留下（影片／音檔播放器 2、封面 1）。 */
  priority?: number;
}) {
  const myId = useId();
  useEffect(() => {
    setWant(myId, visible, priority);
    return () => setWant(myId, false, priority);
  }, [myId, visible, priority]);
  const win = useSyncExternalStore((f) => (regSubs.add(f), () => void regSubs.delete(f)), winner, () => null);
  const mine = win === myId;
  const [area, setArea] = useState({ w: 0, h: 0 });
  const root = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any;
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [collapsedOwn, setCollapsedOwn] = useState(false);
  const collapsed = collapsedProp ?? collapsedOwn;
  const setCollapsed = (v: boolean) => {
    setCollapsedOwn(v);
    onCollapsedChange?.(v);
  };
  const [saved, setSaved] = useState<Pos | null>(null);
  const wake = () => undefined; // 三顆按鈕永遠顯示（杜杜龍 2026-11-25，不再自動隱藏）
  useEffect(() => {
    AsyncStorage.getItem(MINI_POS_KEY)
      .then((raw) => raw && setSaved(JSON.parse(raw) as Pos))
      .catch(() => undefined);
  }, []);

  const mw = miniFloatWidth(area.w || 390);
  const mh = Math.round((mw * 9) / 16);
  const W = collapsed ? MINI_CIRCLE : mw;
  const H = collapsed ? MINI_CIRCLE : mh + MINI_BAR; // 小視窗＝按鈕列＋畫面；位置記的是整組左上角
  const clampPos = (p: Pos): Pos => ({ x: Math.min(area.w - W - MINI_MARGIN, Math.max(MINI_MARGIN, p.x)), y: Math.min(area.h - H - MINI_MARGIN, Math.max(MINI_MARGIN, p.y)) });
  const cur = clampPos(saved ?? { x: area.w - W - 12, y: (getBottomEdge?.() ?? defaultBottomEdge(area.h)) - H - 12 });
  const live = useRef<{ cur: Pos; clampPos: (p: Pos) => Pos; onTap?: () => void; collapsed: boolean; restore: () => void }>({ cur, clampPos, onTap, collapsed, restore: () => undefined });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const savedRef = useRef<Pos | null>(null);
  const persist = (p: Pos) => {
    savedRef.current = p;
    AsyncStorage.setItem(MINI_POS_KEY, JSON.stringify(p)).catch(() => undefined);
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          drag.current = { x: live.current.cur.x, y: live.current.cur.y, moved: false };
          wake();
        },
        onPanResponderMove: (_, g) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.hypot(g.dx, g.dy) < 6) return;
          d.moved = true;
          const p = live.current.clampPos({ x: d.x + g.dx, y: d.y + g.dy });
          savedRef.current = p;
          setSaved(p);
        },
        onPanResponderRelease: () => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (d.moved) return void (savedRef.current && persist(savedRef.current));
          if (live.current.collapsed) return live.current.restore(); // 點一下小圓圖＝恢復小視窗（拖曳時不會觸發）
          live.current.onTap?.(); // 點一下畫面只會喚醒三顆按鈕（onGrant 已做）；有傳 onTap 才另外做事（影片是暫停／播放，封面沒有）
        },
        onPanResponderTerminate: () => {
          drag.current = null;
        },
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** 縮小／恢復時，讓小圓圖貼著小視窗的右上角（同影片迷你播放器的 resizeAround）。 */
  const resize = (toCircle: boolean) => {
    const from = toCircle ? mw : MINI_CIRCLE;
    const to = toCircle ? MINI_CIRCLE : mw;
    const toH = toCircle ? MINI_CIRCLE : Math.round((to * 9) / 16) + MINI_BAR;
    const right = cur.x + from;
    const p = { x: Math.min(area.w - to - MINI_MARGIN, Math.max(MINI_MARGIN, right - to)), y: Math.min(area.h - toH - MINI_MARGIN, Math.max(MINI_MARGIN, cur.y)) };
    setSaved(p);
    persist(p);
    setCollapsed(toCircle);
  };
  live.current = { cur, clampPos, onTap, collapsed, restore: () => resize(false) };
  // 縮小途中：外框從封面原本的位置與大小，平順縮到圓球／小視窗的位置（流光大邊框，與影片一致）
  const t = morph ? Math.min(1, morph.p / 0.98) : 1;
  const morphing = !!morph?.from && morph.p < 0.98;
  const tx = cur.x, ty = collapsed ? cur.y : cur.y + MINI_BAR, tw = collapsed ? W : mw, th = collapsed ? W : mh;
  const fr = morph?.from ?? { x: tx + origin.x, y: ty + origin.y, w: tw, h: th };
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  const mx = lerp(fr.x - origin.x, tx), my = lerp(fr.y - origin.y, ty), mwid = lerp(fr.w, tw), mhei = lerp(fr.h, th);
  const mrad = lerp(10, collapsed ? W / 2 : MINI_RADIUS);
  const buttons = [
    { key: "min", label: "最小化（縮成小圓圖）", glyph: MINI_GLYPHS.min, color: MINI_BTN_COLORS.min, act: () => resize(true) },
    { key: "max", label: maximizeLabel, glyph: MINI_GLYPHS.max, color: MINI_BTN_COLORS.max, act: onMaximize },
    { key: "close", label: "關閉小視窗", glyph: MINI_GLYPHS.close, color: MINI_BTN_COLORS.close, act: onClose },
  ];
  const tree = (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 30 }]} ref={root} onLayout={(e) => (setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }), root.current?.measureInWindow((x: number, y: number) => setOrigin({ x, y })))}>
      {visible && mine && area.w && morphing ? (
        <View pointerEvents="none" style={{ position: "absolute", left: mx, top: my, width: mwid, height: mhei }}>
          <GradientFrame width={mwid} height={mhei} radius={mrad} flush>
            <View style={{ width: "100%", height: "100%", overflow: "hidden" }}>{collapsed ? circleContent : windowContent}</View>
          </GradientFrame>
        </View>
      ) : null}
      {visible && mine && area.w && !morphing ? (
        <View {...responder.panHandlers} {...({ dataSet: { noPullRefresh: "" } } as object)} accessibilityLabel={label} style={[{ position: "absolute", left: cur.x, top: cur.y, width: W, opacity }, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab", userSelect: "none", WebkitUserSelect: "none" } as object) : null]}>
          {collapsed ? (
            <View accessibilityRole="button" accessibilityLabel="恢復小視窗（可按住拖曳移動）" style={{ width: MINI_CIRCLE, height: MINI_CIRCLE }}>
              <GradientFrame width={MINI_CIRCLE} height={MINI_CIRCLE} radius={MINI_CIRCLE / 2} running={running} flush>
                <View ref={slotRef} pointerEvents="none" style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: MINI_CIRCLE / 2 }}>
                  {circleContent}
                </View>
              </GradientFrame>
            </View>
          ) : (
            <>
              <View style={{ height: MINI_BAR, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, paddingHorizontal: 10, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: MINI_BAR_BG }}>
                {buttons.map((b) => (
                  <Pressable key={b.key} accessibilityRole="button" accessibilityLabel={b.label} onPress={b.act} style={{ width: MINI_BTN, height: MINI_BTN, borderRadius: 999, backgroundColor: b.color, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: MINI_BTN_GLYPH_COLOR, fontSize: 14, fontWeight: "900", lineHeight: 16 }}>{b.glyph}</Text>
                  </Pressable>
                ))}
              </View>
              <GradientFrame width={mw} height={mh} radius={MINI_RADIUS} running={running} flush>
                <View ref={slotRef} pointerEvents="none" style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                  {windowContent}
                </View>
              </GradientFrame>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
  // 網頁版：放在整個視窗最上層的固定層（杜杜龍 2026-11-25：小視窗／圓球可以拖到上方標題列的位置，不被頁面內容區裁住）。
  if (Platform.OS !== "web" || typeof document === "undefined") return tree;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPortal } = require("react-dom") as typeof import("react-dom");
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 900, pointerEvents: "none" }}>{tree}</div>, document.body);
}
