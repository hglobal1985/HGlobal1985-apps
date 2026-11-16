import { Platform } from "react-native";

/**
 * 網頁版（含 Chrome「安裝」或「建立捷徑」到桌面）的下拉重新整理。
 * react-native 的 RefreshControl 在網頁上不會動，而且整頁（body）不捲動，Chrome 內建的下拉重新整理也不會出現，
 * 所以這裡自己做：頁面已經捲到最上面時往下拉，拉過門檻放開就整頁重新載入（順便拿到最新版本）。
 * 不處理：從底部彈出面板、輸入框裡的手勢、橫向滑動、頁面還沒捲到最上面的情況。
 */
export function installWebPullRefresh(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;
  const THRESHOLD = 70; // 串接指令 2026-11-14.3：往下拖超過約 70 px 才觸發
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
  const show = (text: string, y: number) => {
    if (!bar) {
      bar = document.createElement("div");
      bar.setAttribute("aria-live", "polite");
      bar.style.cssText = "position:fixed;left:50%;top:0;z-index:99999;padding:10px 18px;border-radius:999px;background:#2F5D3A;color:#fff;font:600 15px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap";
      document.body.appendChild(bar);
    }
    bar.textContent = text;
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
    show(pull >= THRESHOLD ? "放開重新整理" : "下拉重新整理", Math.min(pull * 0.5, 70) - 8);
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
        show("更新中…", 14);
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
