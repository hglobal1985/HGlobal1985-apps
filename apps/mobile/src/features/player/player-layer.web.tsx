import { lessonHref } from "@/lib/lesson-href";
import { MiniWindow } from "@/ui/mini-window";
import { MINI_CIRCLE, MINI_RADIUS } from "@/ui/mini-spec";
import { router } from "expo-router";
import { PlayerControls } from "./player-controls";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useSession } from "@/state/session";
import { FRAME_KEYFRAMES, FRAME_PAD, frameBoxStyle } from "@/ui/gradient-frame.web";
import { engine } from "./engine.web";
import { setStayMini } from "./stay-mini";
import { usePlayer } from "./use-player";
import { PipHelp } from "./pip-help";

const CIRCLE = MINI_CIRCLE;
/** 頁面往下滑多少像素，影片就完全縮成迷你播放器。 */
const SHRINK_PX = 140;


function bottomEdge() {
  const bar = document.querySelector('[role="tablist"]');
  return bar ? bar.getBoundingClientRect().top : window.innerHeight;
}
// 迷你播放器的按鈕：實心黑底白字（業主 2026-11-17：取消半透明）。
/** 長按快轉的最高倍數：YouTube 內嵌播放器最高 2 倍（不分會員、免費，Premium 不影響內嵌播放速度）。 */
const MAX_RATE = 2;
const btn: CSSProperties = { position: "absolute", border: 0, borderRadius: 999, background: "#000", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", font: "700 16px sans-serif", padding: 0 };

/**
 * Web 全站播放畫面層（只有一份、永遠存在）：
 * - 在課程頁：疊在頁面上方釘住的影片區塊上（內嵌，用瀏覽器原生控制列）。
 * - 離開課程頁：縮成右下角浮動小視窗，手指按住可任意拖曳位置；點一下回到課程頁；有播放／暫停、縮小與關閉。
 * - 按「縮小」：變成一個小圓圖（課程 EDM，播放中 360 度旋轉），可拖曳，點一下恢復小視窗。
 * - 純音檔平常由底部迷你列控制；按「縮小」後也會變成同樣的小圓圖。
 */
export function PlayerLayer() {
  const s = usePlayer();
  const { ready, member } = useSession();
  const boxRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<unknown>(null); // 共用迷你小視窗（ui/mini-window.tsx）裡放畫面的那一格；真正的影片疊在它上面
  const [mini, setMini] = useState<"off" | "fade" | "on">("off"); // 迷你小視窗：off＝不顯示、fade＝縮小途中（只有影片在動）、on＝已縮成迷你
  // 手機、平板橫放且影片播放中＝自動全螢幕；轉回直式就還原（業主 2026-11-24）。fullRef 給 tick 用（鋪滿整個視窗），pFull 給畫面（縮小鈕）。
  const fullRef = useRef(false);
  const dismissed = useRef(false); // 使用者在橫放時自己按了縮小／退出全螢幕：這次橫放不再自動進入
  const realFs = useRef(false);
  const [pFull, setPFull] = useState(false);
  // 往下滑頁面時，內嵌影片慢慢縮成迷你播放器（業主 2026-11-24）：scrollP＝頁面捲動的進度（0～1）、shrinkC＝畫面上平滑後的進度；
  // 暫停播放且手機橫放（空間不夠）也直接縮成迷你。shrunk＝已完全縮成迷你播放器（顯示三顆按鈕、可拖曳）。
  const scrollP = useRef(0);
  const scroller = useRef<HTMLElement | null>(null);
  const shrinkC = useRef(0);
  const [shrunk, setShrunk] = useState(false);
  const [barOn, setBarOn] = useState(true); // 全螢幕控制列：2 秒沒動作自動隱藏，點畫面任意處再顯示
  const barTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barHold = useRef(false);
  const barOnRef = useRef(true);
  const barRef = useRef<HTMLDivElement>(null);
  const tap = useRef<{ x: number; y: number; t: number; onBar: boolean; wasOn: boolean } | null>(null);
  const wakeBar = useCallback(() => {
    barOnRef.current = true;
    setBarOn(true);
    if (barTimer.current) clearTimeout(barTimer.current);
    if (!barHold.current) barTimer.current = setTimeout(() => setBarOn(false), 2000);
  }, []);
  // 全螢幕手勢（業主 2026-11-24）：點左半邊＝倒退 10 秒、點右半邊＝快轉 10 秒；連續點（每次間隔不到 0.7 秒）每下 30 秒；
  // 長按＝用最快速度（2 倍）播放，放開還原。每次都在畫面上顯示簡短提示。控制列：碰一下畫面就顯示，2 秒沒動作自動隱藏。
  const [gHint, setGHint] = useState<{ text: string; side: "l" | "r" | "c"; n: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHint = (text: string, side: "l" | "r" | "c", hold = false) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setGHint((h) => ({ text, side, n: (h?.n ?? 0) + 1 }));
    if (!hold) hintTimer.current = setTimeout(() => setGHint(null), 800);
  };
  const combo = useRef<{ side: "l" | "r"; total: number; at: number } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const hideBar = () => {
    if (barTimer.current) clearTimeout(barTimer.current);
    barOnRef.current = false;
    setBarOn(false);
  };
  const barDown = (e: PointerEvent<HTMLDivElement>) => {
    barHold.current = true;
    if (barTimer.current) clearTimeout(barTimer.current);
    tap.current = { x: e.clientX, y: e.clientY, t: Date.now(), onBar: !!barRef.current?.contains(e.target as Node), wasOn: barOnRef.current };
    if (!(fullRef.current || document.fullscreenElement === boxRef.current) || tap.current.onBar) return;
    if (press.current) clearTimeout(press.current);
    press.current = setTimeout(() => {
      holding.current = true;
      engine.holdRate(MAX_RATE);
      showHint(`${MAX_RATE}× 快轉中`, "c", true);
    }, 400);
  };
  const endHold = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
    if (holding.current) {
      holding.current = false;
      engine.holdRate(null);
      setGHint(null);
    }
  };
  const barUp = (e: PointerEvent<HTMLDivElement>) => {
    barHold.current = false;
    const d = tap.current;
    tap.current = null;
    const wasHolding = holding.current;
    endHold();
    const inFull = fullRef.current || document.fullscreenElement === boxRef.current;
    const isTap = !!d && !wasHolding && !d.onBar && Date.now() - d.t < 400 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12;
    if (!isTap || !inFull) return void wakeBar();
    // 畫面分三塊各 33%：左＝倒退、中間＝顯示／隱藏控制列、右＝快轉（業主 2026-11-24）
    const r = boxRef.current?.getBoundingClientRect();
    const frac = (e.clientX - (r?.left ?? 0)) / (r?.width || window.innerWidth);
    if (frac >= 1 / 3 && frac < 2 / 3) return void (d.wasOn ? hideBar() : wakeBar());
    wakeBar();
    const side: "l" | "r" = frac < 1 / 3 ? "l" : "r";
    const now = Date.now();
    const c = combo.current;
    const chain = !!c && c.side === side && now - c.at < 700;
    const step = chain ? 30 : 10;
    const total = chain ? c!.total + step : step;
    combo.current = { side, total, at: now };
    engine.skip(side === "l" ? -step : step);
    showHint(side === "l" ? `⏪ 倒退 ${total} 秒` : `快轉 ${total} 秒 ⏩`, side);
  };
  const [fsOn, setFsOn] = useState(false); // 這個播放框正處於瀏覽器全螢幕
  useEffect(() => {
    if (pFull || fsOn) wakeBar();
    return () => {
      if (barTimer.current) clearTimeout(barTimer.current);
    };
  }, [pFull, fsOn, wakeBar]);
  const exitRef = useRef<(() => void) | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // YouTube 影片上的點擊一律擋掉（業主永久指示：不讓使用者點到 YouTube 自己的按鈕與連結，播放暫停只用下方控制列）。
  // 業主 2026-11-17：LINE 等 App 內建瀏覽器也一律封鎖（不再有「第一次播放前放行」的例外），使用者要改用系統瀏覽器開啟才能播放（見紅色警示條）。
  const justSwitched = () => engine.recentlySwitched();
  const t = s.track;
  const isAudio = t?.mode === "audio";
  const inlineSlot = !!t && s.slotKey === t.key;
  // 影片／YouTube：在課程頁內嵌，其餘時間是浮動小視窗；純音檔只有「縮小」時才有畫面（小圓圖）。
  const inline = !!t && !isAudio && inlineSlot;
  const floating = !!t && !inlineSlot && (!isAudio || s.collapsed);
  const circle = (floating || (inline && shrunk)) && s.collapsed; // 課程頁往下滑縮成的迷你播放器也能最小化成小圓圖（業主 2026-11-24）
  const windowed = (floating && !s.collapsed) || (inline && shrunk && !s.collapsed);

  // 影片區的點擊擋板（只擋 YouTube 自己的按鈕與連結；播放暫停只用下方控制列）。已移除雙指放大與拖曳（業主 2026-11-24）。
  const canBlock = inline && !shrunk && (t?.mode === "video" || t?.mode === "youtube");

  // 播放／暫停時，外框的反光流動跟著動或停。
  useEffect(() => {
    if (boxRef.current) boxRef.current.style.animationPlayState = s.playing ? "running" : "paused";
  }, [s.playing]);

  useEffect(() => {
    hostRef.current?.appendChild(engine.element());
    engine.setFullscreenTarget(boxRef.current);
  }, []);

  // 登出就關閉播放（不留下上一位會員的聲音）。
  useEffect(() => {
    if (ready && !member) engine.close();
  }, [ready, member]);

  // 播放控制列在影片外面（PlayerControls）；只有全螢幕時才用瀏覽器內建的控制列（全螢幕裡看不到外面的控制列）。
  useEffect(() => {
    const el = engine.element();
    const sync = () => {
      el.controls = false; // 全螢幕裡改在播放框內放自家控制列（含時間軸），不用瀏覽器內建的（YouTube 本來就關掉了）
      setFsOn(!!document.fullscreenElement && document.fullscreenElement === boxRef.current);
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // 橫放自動全螢幕：影片（不含純音檔）播放中、觸控裝置（手機、平板）轉成橫放 → 進入全螢幕；轉回直式 → 退出。
  // 瀏覽器常拒絕「沒有手指點擊」的全螢幕要求，拒絕時改用「鋪滿整個視窗」的假全螢幕，效果一樣（業主 2026-11-24）。
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const land = window.matchMedia("(orientation: landscape)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const leave = () => {
      fullRef.current = false;
      setPFull(false);
      if (realFs.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      realFs.current = false;
      engine.element().controls = false;
    };
    exitRef.current = () => {
      dismissed.current = true;
      leave();
    };
    const enter = () => {
      fullRef.current = true;
      setPFull(true);
      const box = boxRef.current;
      if (document.fullscreenEnabled && box && !document.fullscreenElement) {
        box.requestFullscreen().then(() => { realFs.current = true; setPFull(false); }).catch(() => undefined); // 被拒絕就維持鋪滿視窗
      }
    };
    const check = () => {
      const sn = engine.getSnapshot();
      const isVideo = !!sn.track && sn.track.mode !== "audio" && !sn.collapsed;
      if (!land.matches) {
        dismissed.current = false;
        if (fullRef.current) leave();
        return;
      }
      if (!isVideo && fullRef.current) leave();
      else if (isVideo && sn.playing && coarse.matches && !fullRef.current && !dismissed.current) enter();
    };
    const onFs = () => {
      if (realFs.current && !document.fullscreenElement) {
        realFs.current = false;
        dismissed.current = true; // 使用者自己退出全螢幕
        fullRef.current = false;
        setPFull(false);
      }
    };
    const id = window.setInterval(check, 400);
    land.addEventListener("change", check);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearInterval(id);
      land.removeEventListener("change", check);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el || el === (document as unknown) || el.clientHeight < 200 || el.scrollHeight - el.clientHeight < 40) return; // 只看頁面主要的上下捲動區
      scroller.current = el;
      scrollP.current = Math.min(1, Math.max(0, el.scrollTop / SHRINK_PX));
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);
  useEffect(() => {
    scrollP.current = 0;
    shrinkC.current = 0;
  }, [s.slotKey, t?.key]);

  // 每個畫面更新時對齊位置：內嵌＝貼齊課程頁的播放區塊；浮動＝使用者拖曳過的位置；縮小＝小圓圖。
  useEffect(() => {
    let raf = 0;
    let last = "";
    const landMq = window.matchMedia?.("(orientation: landscape)");
    const coarseMq = window.matchMedia?.("(pointer: coarse)");
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const box = boxRef.current;
      if (!box) return;
      const sn = engine.getSnapshot();
      const tr = sn.track;
      // 共用迷你小視窗（ui/mini-window.tsx）畫好的那一格：影片疊在它上面。MiniWindow 沒顯示時 slotRef 是空的。
      const miniRect = () => {
        const el = slotRef.current as unknown as HTMLElement | null;
        const m = el && el.isConnected ? el.getBoundingClientRect() : null;
        return m && m.width > 0 ? m : null;
      };
      // fl：0＝內嵌／全螢幕（無邊框）、3＝縮小途中（自帶流光邊框）、4＝在迷你小視窗的畫面格裡、5＝小圓圖（影片藏起來，畫面由 MiniWindow 畫封面）
      let css = "none";
      let nextMini: "off" | "fade" | "on" = "off";
      if (tr) {
        const slot = sn.slotKey === tr.key ? engine.slotElement() : null;
        if (fullRef.current && tr.mode !== "audio") {
          css = `0|0|${window.innerWidth}|${window.innerHeight}|0`; // 橫放全螢幕：鋪滿整個視窗
        } else if (tr.mode !== "audio" && slot && slot.isConnected) {
          const r = slot.getBoundingClientRect();
          const band = slot.parentElement as HTMLElement | null;
          const phoneLand = !!coarseMq?.matches && !!landMq?.matches && window.innerHeight < 520;
          const target = Math.max(scrollP.current, phoneLand && !sn.playing && !fullRef.current ? 1 : 0);
          shrinkC.current += (target - shrinkC.current) * 0.3;
          if (Math.abs(target - shrinkC.current) < 0.01) shrinkC.current = target;
          const pr = shrinkC.current;
          // 舞台區塊跟著縮矮，頁面的課程文字才看得到更多內容。
          if (band) {
            band.style.overflow = pr > 0 ? "hidden" : "";
            band.style.height = pr > 0 ? `${Math.round(slot.offsetHeight * (1 - pr))}px` : "";
          }
          const atMini = pr >= 0.99;
          setShrunk((v) => (v === atMini ? v : atMini));
          if (pr <= 0 && sn.collapsed) engine.setCollapsed(false); // 回到頁面最上方：小圓圖還原，不留著下次直接變圓
          const m = pr > 0 ? miniRect() : null;
          if (r.width > 0 && pr <= 0) css = `${r.left}|${r.top}|${r.width}|${r.height}|0`;
          else if (r.width > 0 && m) {
            nextMini = atMini ? "on" : "fade";
            if (atMini) css = `${m.left}|${m.top}|${m.width}|${m.height}|${sn.collapsed ? 5 : 4}`;
            else {
              const f = (a: number, b: number) => Math.round(a + (b - a) * pr);
              css = `${f(r.left, m.left - FRAME_PAD)}|${f(r.top, m.top - FRAME_PAD)}|${f(r.width, m.width + FRAME_PAD * 2)}|${f(r.height, m.height + FRAME_PAD * 2)}|3`;
            }
          } else if (r.width > 0) {
            nextMini = "fade"; // 小視窗剛要出現、還沒量到位置：先留在原處
            css = `${r.left}|${r.top}|${r.width}|${r.height}|0`;
          }
        } else if (sn.slotKey !== tr.key && (tr.mode !== "audio" || sn.collapsed) && !engine.isPip()) {
          // 影片已經浮到手機桌面（系統浮動視窗）時，頁面內的迷你播放器不顯示，避免出現兩個小視窗。
          nextMini = "on";
          const m = miniRect();
          if (m) css = `${m.left}|${m.top}|${m.width}|${m.height}|${sn.collapsed ? 5 : 4}`;
        }
      }
      if (sn.switching && nextMini === "on") nextMini = "fade"; // 換章節的空檔：小視窗不顯示（聲音照常播）
      setMini((v) => (v === nextMini ? v : nextMini));
      const flNow = css.split("|")[4];
      box.style.opacity = sn.switching || flNow === "5" ? "0" : "1";
      box.style.pointerEvents = sn.switching || flNow === "3" || flNow === "4" || flNow === "5" ? "none" : "auto"; // 迷你時觸摸交給 MiniWindow（拖曳、按鈕、點一下暫停）
      if (css === last) return;
      last = css;
      if (css === "none") {
        box.style.display = "none";
        return;
      }
      const [l, tp, w, h, fl] = css.split("|");
      const framed = fl === "3";
      box.style.setProperty("--pad", framed ? `${FRAME_PAD}px` : "0px");
      Object.assign(box.style, {
        display: "block",
        left: `${l}px`,
        top: `${tp}px`,
        width: `${w}px`,
        height: `${h}px`,
        borderRadius: fl === "5" ? "50%" : fl === "3" ? `${MINI_RADIUS}px` : fl === "4" ? `${Math.max(0, MINI_RADIUS - FRAME_PAD)}px` : "0",
        ...frameBoxStyle(framed),
      });
      box.style.animationPlayState = engine.getSnapshot().playing ? "running" : "paused"; // 暫停播放時，外框反光也暫停
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setFrame = useCallback((f: HTMLIFrameElement | null) => engine.setYoutubeFrame(f), []);

  /** 最大化＝進入這支影片的課程頁。 */
  const maximize = () => {
    // 已在課程頁、只是被滑動縮成迷你：回到頁面最上方就會自動還原。
    if (inline && shrunk) return void scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    setStayMini(false); // 最大化＝回到整頁播放
    if (t) router.push(lessonHref(t.courseId, t.lessonId) as never);
  };

  // YouTube 的 iframe 在「連續播放 YouTube」期間固定不重建：第一次載入用網址，之後換章節用 loadVideoById 在原 iframe 內切換。
  const ytNow = t?.mode === "youtube" && t.playback.kind === "youtube" ? t.playback : null;
  const ytKeyNow = t ? `${t.key}:${s.loadId}` : "";
  const ytFirst = useRef<string | null>(null);
  if (!ytNow) ytFirst.current = null;
  else if (ytFirst.current === null) ytFirst.current = ytKeyNow;
  const ytShown = useRef<string | null>(null);
  const ytSrc = useRef<string | null>(null); // iframe 網址只在第一次載入時決定，之後不再變（變了會重建、歸零播放許可）
  useEffect(() => {
    if (!ytNow) return void (ytShown.current = null);
    if (ytShown.current === null) ytShown.current = ytKeyNow; // 第一次：iframe 自己用網址載入
    else if (ytShown.current !== ytKeyNow) {
      ytShown.current = ytKeyNow;
      engine.loadYoutube(ytNow.videoId, Math.floor(ytNow.resumeAt ?? ytNow.start ?? 0), ytNow.end || undefined);
    }
  }, [ytKeyNow, ytNow?.videoId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (typeof document === "undefined") return null;
  const yt = t?.mode === "youtube" && t.playback.kind === "youtube" ? t.playback : null;
  // 起點：有續播記憶（resumeAt）就從那一秒接著播，否則從這一堂的起點（YouTube 只接受整數秒）。
  const ytBegin = yt ? Math.floor(yt.resumeAt ?? yt.start ?? 0) : 0;
  const range = yt ? `${ytBegin ? `&start=${ytBegin}` : ""}${yt.end ? `&end=${yt.end}` : ""}` : "";
  if (!yt) ytSrc.current = null;
  else if (!ytSrc.current) ytSrc.current = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt.videoId)}?controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&rel=0&modestbranding=1&autoplay=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${range}`;
  const art = s.artworkUrl ? (/^(https?:|blob:|data:)/.test(s.artworkUrl) ? s.artworkUrl : s.artworkUrl) : "/icon-512.png";
  return createPortal(
    <>
    <div ref={boxRef} onPointerDownCapture={barDown} onPointerUpCapture={barUp} onPointerCancelCapture={() => { barHold.current = false; tap.current = null; endHold(); wakeBar(); }} style={{ position: "fixed", left: 0, top: 0, display: "none", zIndex: 1000, overflow: "hidden", background: "#000" }}>
      <style>{`@keyframes hg-spin{to{transform:rotate(360deg)}}${FRAME_KEYFRAMES}`}</style>
      {pFull ? (
        <button type="button" aria-label="縮小回原本大小" onClick={() => exitRef.current?.()} style={{ position: "absolute", top: 10, left: 10, zIndex: 5, opacity: barOn ? 1 : 0, pointerEvents: barOn ? "auto" : "none", transition: "opacity 0.25s", minHeight: 44, padding: "0 16px", borderRadius: 22, border: 0, background: "rgba(0,0,0,0.55)", color: "#fff", font: "700 15px system-ui, sans-serif" }}>
          縮小
        </button>
      ) : null}
      {gHint && (pFull || fsOn) ? (
        <div key={gHint.n} style={{ position: "absolute", top: "42%", zIndex: 7, pointerEvents: "none", ...(gHint.side === "l" ? { left: "4%" } : gHint.side === "r" ? { right: "4%" } : { left: "50%", transform: "translateX(-50%)" }), padding: "14px 30px", borderRadius: 48, background: "rgba(0,0,0,0.6)", color: "#fff", font: "800 50px/1.25 system-ui, sans-serif", whiteSpace: "nowrap" }}>
          {gHint.text}
        </div>
      ) : null}
      {pFull || fsOn ? (
        // 全螢幕裡看不到頁面下方的播放控制列，所以在播放框內放同一個控制列（時間軸、播放／暫停、倍速…；業主 2026-11-24 回報時間軸不見了）
        <div ref={barRef} style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 6, paddingBottom: "env(safe-area-inset-bottom, 0px)", opacity: barOn ? 1 : 0, pointerEvents: barOn ? "auto" : "none", transition: "opacity 0.25s" }}>
          <PlayerControls overlay />
        </div>
      ) : null}
      <div style={{ position: "absolute", inset: "var(--pad, 0px)", borderRadius: "inherit", overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0, display: yt ? "none" : "block" }} />
        {yt ? (
          <iframe
            key="yt-frame"
            ref={setFrame}
            title="課程影片"
            src={ytSrc.current ?? undefined}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : null}
      </div>
      {/* 影片上的點擊一律擋掉（只用下方控制列）；僅 App 內建瀏覽器第一次播放前放行，見上面 everPlayed 的說明。 */}
      {canBlock ? <div data-no-pull-refresh="" style={{ position: "absolute", inset: 0, touchAction: "pan-y", pointerEvents: "auto" }} aria-hidden /> : null}
      {windowed && !s.playing ? (
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 52, height: 52, transform: "translate(-50%,-50%)", borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "700 20px sans-serif", pointerEvents: "none" }}>▶</div>
      ) : null}
      </div>
    </div>
    <PipHelp />
    {/* 迷你小視窗＝全站同一個元件（ui/mini-window.tsx，封面迷你小視窗也用它）：按鈕列、拖曳、位置記憶、小圓圖都由它負責；這裡只提供畫面格（影片疊在上面）與動作 */}
    <div style={{ position: "fixed", inset: 0, zIndex: 999, pointerEvents: "none" }}>
      <MiniWindow
        visible={mini !== "off" && !pFull && !fsOn}
        opacity={mini === "on" ? 1 : 0}
        windowContent={<div style={{ width: "100%", height: "100%", background: "#000" }} />}
        circleContent={
          <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
            <img src={art} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", animation: "hg-spin 8s linear infinite", animationPlayState: s.playing ? "running" : "paused" }} />
            {!s.playing ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)", color: "#fff", font: "700 20px sans-serif" }}>▶</div> : null}
          </div>
        }
        label={s.playing ? "暫停（按住可拖曳移動）" : "播放（按住可拖曳移動）"}
        maximizeLabel="最大化（進入課程頁）"
        onMaximize={() => !justSwitched() && maximize()}
        onClose={() => !justSwitched() && engine.close()}
        onTap={() => !justSwitched() && engine.toggle()}
        collapsed={s.collapsed}
        onCollapsedChange={(v) => engine.setCollapsed(v)}
        priority={2}
        slotRef={slotRef}
        running={s.playing}
        getBottomEdge={bottomEdge}
      />
    </div>
    </>,
    document.body,
  );
}
