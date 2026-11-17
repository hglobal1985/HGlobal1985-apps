import { Platform } from "react-native";

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

  const atTop = (el: Element | null): boolean => {
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return false;
    }
    return true;
  };
  /** 小樹苗→長成樹→結出綠色櫻桃（p：0～1）。0～60% 長高長大；過 50%（可以放開了）開始結出綠色櫻桃，到 100% 結滿。 */
  const treeSvg = (p: number): string => {
    const g = Math.min(1, p / 0.6);
    const h = 8 + 38 * g; // 樹幹高
    const r = 5 + 24 * g; // 樹冠半徑
    const cy = 86 - h - r * 0.35;
    const cherry = Math.max(0, (p - 0.5) / 0.5); // 櫻桃大小進度
    const spots = [[-0.55, -0.1], [0.5, -0.2], [-0.15, 0.45], [0.45, 0.42], [-0.05, -0.55]];
    const cherries = cherry > 0
      ? spots.map(([dx, dy]) => {
          const x = 50 + dx! * r;
          const y = cy + dy! * r;
          const rr = 1.5 + 3.6 * cherry;
          return `<path d="M${x} ${y - rr} q2 -6 5 -7" stroke="#4E7D2F" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="${rr}" fill="#7CC043"/><circle cx="${x - rr * 0.35}" cy="${y - rr * 0.35}" r="${rr * 0.28}" fill="#fff" opacity=".7"/>`;
        }).join("")
      : "";
    const sap = p < 0.18 ? `<path d="M50 ${86 - h} q-9 -2 -11 -9 q9 0 11 9 M50 ${86 - h} q9 -2 11 -9 q-9 0 -11 9" fill="#4C8A5B"/>` : "";
    return `<svg width="72" height="72" viewBox="0 0 100 100"><ellipse cx="50" cy="90" rx="22" ry="5" fill="#8B6B4A"/><rect x="${48 - g * 1.5}" y="${86 - h}" width="${4 + g * 3}" height="${h}" rx="2" fill="#7A5A3A"/>${p >= 0.18 ? `<circle cx="50" cy="${cy}" r="${r}" fill="#2F7A46"/><circle cx="${50 - r * 0.35}" cy="${cy - r * 0.2}" r="${r * 0.62}" fill="#3F9A5A"/>` : sap}${cherries}</svg>`;
  };
  const show = (progress: number, y: number, label?: string) => {
    if (!bar) {
      bar = document.createElement("div");
      bar.setAttribute("aria-live", "polite");
      bar.style.cssText = "position:fixed;left:50%;top:0;z-index:99999;display:flex;flex-direction:column;align-items:center;padding:8px 18px 8px;border-radius:24px;background:#fff;color:#2F5D3A;font:700 14px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap;border:3px solid #2F5D3A";
      document.body.appendChild(bar);
    }
    const pct = Math.round(Math.min(1, progress) * 100);
    bar.innerHTML = `${treeSvg(Math.min(1, progress))}<span>${label ?? (progress >= 0.5 ? `${pct}%　放開重新整理` : `${pct}%　再往下拉`)}</span>`;
    bar.style.transform = `translate(-50%, calc(env(safe-area-inset-top, 0px) + ${Math.round(y)}px))`;
  };
  const hide = () => {
    bar?.remove();
    bar = null;
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
    show(pull / FULL, Math.min(pull * 0.5, 150) - 90);
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
        show(1, 14, "更新中…");
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
