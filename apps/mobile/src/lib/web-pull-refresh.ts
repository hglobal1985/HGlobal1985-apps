import { Platform } from "react-native";
import { DIM_BLUR, DIM_COLOR } from "@/ui/dim-backdrop";
import { FRAME_GRADIENT, FRAME_KEYFRAMES, FRAME_PAD, FRAME_SHADOW } from "@/ui/gradient-frame.web";

/**
 * 網頁版（含 Chrome「安裝」或「建立捷徑」到桌面）的下拉重新整理。
 * react-native 的 RefreshControl 在網頁上不會動，而且整頁（body）不捲動，Chrome 內建的下拉重新整理也不會出現，
 * 所以這裡自己做：頁面已經捲到最上面時往下拉，拉過門檻放開就整頁重新載入（順便拿到最新版本）。
 * 不處理：從底部彈出面板、輸入框裡的手勢、橫向滑動、頁面還沒捲到最上面的情況。
 */
export function installWebPullRefresh(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;
  // 業主 2026-11-17：原本太靈敏。改成「要拉到完整距離（FULL）的一半以上」才觸發，並用小樹苗長成結綠色櫻桃的樹來顯示進度百分比。
  const FULL = 280; // 拉到 100% 所需的手指位移（px）
  const THRESHOLD = FULL / 2; // 過半（50%）才會重新整理
  const MIN_GAP_MS = 2000; // 連續兩次觸發至少間隔 2 秒（中央有每分鐘 120 次的讀取限制）
  let startY = 0;
  let startX = 0;
  let active = false;
  let pull = 0;
  let bar: HTMLDivElement | null = null;
  let dim: HTMLDivElement | null = null;

  const atTop = (el: Element | null): boolean => {
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return false;
    }
    return true;
  };
  /** 小樹苗→長成樹→樹冠邊緣結滿綠色櫻桃（p：0～1）。全程連續成長：一開始就看得到小樹苗，不會突然變大樹；過 50%（可以放開了）開始結櫻桃，到 100% 結滿。 */
  const treeSvg = (p: number): string => {
    // 小樹苗階段拉長（0～30% 都是小樹苗慢慢長大），30%～60% 才長出樹冠變成樹。
    const sap = Math.min(1, Math.max(0.05, p) / 0.3);
    const cr = Math.min(1, Math.max(0, (p - 0.3) / 0.3));
    const h = 10 + 12 * sap + 22 * cr; // 樹幹高
    const r = 26 * Math.pow(cr, 1.3); // 樹冠半徑
    const cy = 86 - h - r * 0.35;
    const leafOp = Math.max(0, 1 - cr * 1.6); // 小樹苗的兩片葉子，樹冠長出後淡出
    const k = 0.55 + 0.45 * sap; // 葉子大小
    const top = 86 - h;
    const leaves = leafOp > 0 ? `<g opacity="${leafOp}"><path d="M50 ${top} q${-12 * k} -2 ${-15 * k} ${-12 * k} q${12 * k} 0 ${15 * k} ${12 * k} M50 ${top} q${12 * k} -2 ${15 * k} ${-12 * k} q${-12 * k} 0 ${-15 * k} ${12 * k}" fill="#4C8A5B"/></g>` : "";
    const crown = r > 3 ? `<circle cx="50" cy="${cy}" r="${r}" fill="#2F7A46"/><circle cx="${50 - r * 0.35}" cy="${cy - r * 0.2}" r="${r * 0.62}" fill="#3F9A5A"/>` : "";
    // 櫻桃：只吊掛在樹冠邊緣（上方頂端不放），6 顆；一顆一顆依序長出來，用短梗從樹冠邊緣垂吊下來。
    const angles = [-30, 20, 70, 110, 160, 210]; // 度，0＝右、90＝正下方；避開頂端（270）
    let cherries = "";
    angles.forEach((deg, i) => {
      const c = Math.min(1, Math.max(0, (p - (0.5 + i * 0.05)) / 0.2));
      if (c <= 0 || r < 10) return;
      const a = (deg * Math.PI) / 180;
      const x = 50 + Math.cos(a) * r * 0.97;
      const y = cy + Math.sin(a) * r * 0.97;
      const rr = (4 + 3 * Math.max(0, (p - 0.5) / 0.5)) * c;
      const len = 7 * c;
      cherries += `<path d="M${x} ${y} L${x} ${y + len}" stroke="#4E7D2F" stroke-width="1.4" stroke-linecap="round"/><circle cx="${x}" cy="${y + len + rr * 0.85}" r="${rr}" fill="#7CC043" stroke="#4E7D2F" stroke-width=".6"/><circle cx="${x - rr * 0.35}" cy="${y + len + rr * 0.85 - rr * 0.35}" r="${rr * 0.28}" fill="#fff" opacity=".75"/>`;
    });
    return `<svg width="104" height="104" viewBox="0 0 100 100"><ellipse cx="50" cy="90" rx="22" ry="5" fill="#8B6B4A"/><rect x="${48 - cr * 1.5}" y="${top}" width="${4 + cr * 3}" height="${h}" rx="2" fill="#7A5A3A"/>${crown}${leaves}${cherries}</svg>`;
  };
  /** 全螢幕暗化＋模糊（跟全站彈出層同一組 DIM_COLOR／DIM_BLUR），隨拉動程度漸漸變暗。 */
  const showDim = (opacity: number) => {
    if (!dim) {
      dim = document.createElement("div");
      dim.style.cssText = `position:fixed;inset:0;z-index:99998;pointer-events:none;background:${DIM_COLOR};backdrop-filter:blur(${DIM_BLUR}px);-webkit-backdrop-filter:blur(${DIM_BLUR}px)`;
      document.body.appendChild(dim);
    }
    dim.style.opacity = String(Math.min(1, Math.max(0, opacity)));
  };
  /** 小卡跟著手指：水平對齊手指、垂直在手指上方；外框是全站「流光漸層邊框」同一組樣式。 */
  const show = (progress: number, y: number, label?: string) => {
    if (!bar) {
      bar = document.createElement("div");
      bar.setAttribute("aria-live", "polite");
      bar.style.cssText = `position:fixed;left:0;top:0;z-index:99999;box-sizing:border-box;padding:${FRAME_PAD}px;border-radius:26px;background:${FRAME_GRADIENT};background-size:300% 300%;box-shadow:${FRAME_SHADOW};animation:hg-sheen 7s linear infinite;pointer-events:none;will-change:transform`;
      bar.innerHTML = `<style>${FRAME_KEYFRAMES}</style><div data-in style="display:flex;flex-direction:column;align-items:center;padding:6px 16px 8px;border-radius:${26 - FRAME_PAD}px;background:#fff;color:#2F5D3A;font:700 14px sans-serif;white-space:nowrap"></div>`;
      document.body.appendChild(bar);
    }
    const pct = Math.round(Math.min(1, progress) * 100);
    (bar.querySelector("[data-in]") as HTMLElement).innerHTML = `${treeSvg(Math.min(1, progress))}<span>${label ?? (progress >= 0.5 ? `${pct}%　放開重新整理` : `${pct}%　再往下拉`)}</span>`;
    const cx = window.innerWidth / 2; // 只跟上下，左右永遠置中
    const top = Math.max(8, y - 190);
    bar.style.transform = `translate(${Math.round(cx)}px, calc(env(safe-area-inset-top, 0px) + ${Math.round(top)}px)) translateX(-50%)`;
    showDim(label ? 1 : progress / 0.5);
  };
  const hide = () => {
    bar?.remove();
    bar = null;
    dim?.remove();
    dim = null;
  };
  const start = (e: TouchEvent) => {
    active = false;
    pull = 0;
    if (e.touches.length !== 1) return;
    const t = e.target as Element | null;
    // data-no-pull-refresh：自己有上下拖曳手勢的區塊（課程 EDM 封面、影片放大拖曳）不觸發下拉重新整理（業主 2026-11-17）。
    if (!t || t.closest('[role="dialog"],[aria-modal="true"],input,textarea,select,video,iframe,[contenteditable="true"],[data-no-pull-refresh]')) return;
    if (!atTop(t)) return;
    startY = e.touches[0]!.clientY;
    startX = e.touches[0]!.clientX;
    active = true;
  };
  const move = (e: TouchEvent) => {
    if (!active) return;
    const dy = e.touches[0]!.clientY - startY;
    const dx = Math.abs(e.touches[0]!.clientX - startX);
    if (dy <= 8 || dx > dy * 0.7) {
      pull = 0;
      hide();
      return;
    }
    const t = e.target as Element | null;
    if (t && !atTop(t)) {
      active = false;
      hide();
      return;
    }
    pull = dy;
    show(pull / FULL, e.touches[0]!.clientY);
  };
  const end = () => {
    if (active && pull >= THRESHOLD) {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem("hg-last-pull") ?? 0);
        sessionStorage.setItem("hg-last-pull", String(Date.now()));
      } catch {
        /* 沒有 sessionStorage 就不限制 */
      }
      if (Date.now() - last < MIN_GAP_MS) hide();
      else {
        show(1, 190, "更新中…");
        window.location.reload();
      }
    } else hide();
    active = false;
    pull = 0;
  };
  document.addEventListener("touchstart", start, { passive: true });
  document.addEventListener("touchmove", move, { passive: true });
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
  return () => {
    document.removeEventListener("touchstart", start);
    document.removeEventListener("touchmove", move);
    document.removeEventListener("touchend", end);
    document.removeEventListener("touchcancel", end);
    hide();
  };
}
