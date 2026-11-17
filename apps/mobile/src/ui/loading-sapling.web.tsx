import { useTheme } from "@/theme/theme";

/**
 * 全站「讀取中」動畫：灌溉小樹苗（業主 2026-11-17 定稿）。網頁版；iOS／Android 版在 loading-sapling.tsx（先用系統轉圈圈）。
 * 小樹苗長高、土裡探頭的蚯蚓、葉上爬的瓢蟲（沒有太陽、水壺、老鷹）。compact＝小區塊用的縮小版（只有小樹苗，沒有文字）。
 * 要改動畫只改這個檔案（所有 LoadingView 都用它）。
 */
const CSS = ".hgls{display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none}.hgls svg{overflow:visible}.hgls .cap{font:700 15px/1.3 -apple-system,\"PingFang TC\",\"Noto Sans TC\",sans-serif}.hgls .dots span{display:inline-block;width:5px;height:5px;border-radius:50%;margin-left:3px;background:currentColor;animation:hgls-dot .8s infinite}.hgls .dots span:nth-child(2){animation-delay:.2s}.hgls .dots span:nth-child(3){animation-delay:.4s}@keyframes hgls-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}.hgls .grow{transform-box:fill-box;transform-origin:50% 100%}.hgls .plant{animation:hgls-grow 1.2s ease-in-out infinite}@keyframes hgls-grow{0%,25%{transform:scale(.7)}80%,100%{transform:scale(1.04)}}.hgls .worm{transform-box:fill-box;transform-origin:50% 100%;animation:hgls-worm 2.4s ease-in-out infinite}@keyframes hgls-worm{0%,6%{transform:translateY(30px) rotate(0)}18%{transform:translateY(0) rotate(0)}28%{transform:translateY(0) rotate(-9deg)}40%{transform:translateY(0) rotate(9deg)}52%{transform:translateY(0) rotate(-6deg)}64%{transform:translateY(0) rotate(5deg)}74%{transform:translateY(0) rotate(0)}88%,100%{transform:translateY(30px) rotate(0)}}.hgls .pupil{animation:hgls-look 2.4s ease-in-out infinite}@keyframes hgls-look{0%,24%{transform:translateX(0)}32%{transform:translateX(-1.4px)}48%{transform:translateX(1.4px)}60%,100%{transform:translateX(0)}}.hgls .eyeblink{transform-box:fill-box;transform-origin:center;animation:hgls-blink 2.4s infinite}@keyframes hgls-blink{0%,54%,58%,100%{transform:scaleY(1)}56%{transform:scaleY(.1)}}.hgls .lady{animation:hgls-crawl 1.5s ease-in-out infinite}@keyframes hgls-crawl{0%{transform:translate(99px,90px) rotate(-50deg)}45%{transform:translate(110px,77px) rotate(-50deg)}50%{transform:translate(110px,77px) rotate(130deg)}95%{transform:translate(99px,90px) rotate(130deg)}100%{transform:translate(99px,90px) rotate(-50deg)}}.hgls .leg{animation:hgls-leg .25s linear infinite;transform-box:fill-box;transform-origin:center}@keyframes hgls-leg{50%{transform:scaleX(.8)}}@media (prefers-reduced-motion:reduce){.hgls *{animation-duration:.01ms!important;animation-iteration-count:1!important}}";

export function LoadingSapling({ compact = false }: { compact?: boolean }) {
  const { c } = useTheme();
  const size = compact ? 88 : 200;
  const green = c.accent;
  const leaf = "#2F8A5B";
  const leaf2 = "#5DB383";
  return (
    <div className="hgls" role="status" aria-label="載入中" style={{ padding: compact ? 8 : 24, color: c.accentText }}>
      <style>{CSS}</style>
      <svg viewBox="40 62 110 90" width={size} height={Math.round((size * 90) / 110)} aria-hidden="true">
        <defs>
          <clipPath id="hgls-wclip">
            <rect x="50" y="90" width="60" height="42" />
          </clipPath>
        </defs>
        <g className="plant grow">
          <path d="M96 128 V92" stroke={green} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M96 100 C84 98 76 90 76 80 C88 80 96 88 96 100Z" fill={leaf} />
          <path d="M96 92 C106 90 114 82 114 72 C102 72 96 80 96 92Z" fill={leaf2} />
          {compact ? null : (
            <g className="lady">
              <g className="leg"><path d="M-2 -3 l-2 -2 M0 -3.4 l0 -2.6 M2 -3 l2 -2 M-2 3 l-2 2 M0 3.4 l0 2.6 M2 3 l2 2" stroke="#1D2A22" strokeWidth=".9" strokeLinecap="round" /></g>
              <ellipse rx="4.4" ry="3.6" fill="#D6342A" />
              <path d="M-4.2 0 H4.4" stroke="#1D2A22" strokeWidth=".8" />
              <circle cx="-1.2" cy="-1.5" r=".9" fill="#1D2A22" /><circle cx="-1.2" cy="1.5" r=".9" fill="#1D2A22" /><circle cx="1.8" cy="-1.5" r=".9" fill="#1D2A22" /><circle cx="1.8" cy="1.5" r=".9" fill="#1D2A22" />
              <circle cx="5" cy="0" r="1.9" fill="#1D2A22" />
            </g>
          )}
        </g>
        {compact ? null : (
          <g clipPath="url(#hgls-wclip)">
            <g className="worm">
              <path d="M76 138 C70 128 82 124 76 114" fill="none" stroke="#D68A84" strokeWidth="7" strokeLinecap="round" />
              <path d="M73 130 l6 -1 M74 124 l6 -1 M75 119 l5 -1" stroke="#B9645F" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="76" cy="112" r="6.5" fill="#D68A84" />
              <g className="eyeblink">
                <circle cx="73" cy="110" r="3.6" fill="#fff" /><circle cx="80" cy="110" r="3.6" fill="#fff" />
                <g className="pupil"><circle cx="73" cy="110.4" r="1.7" fill="#1D2A22" /><circle cx="80" cy="110.4" r="1.7" fill="#1D2A22" /></g>
              </g>
              <path d="M74 116 q2 2 4 0" fill="none" stroke="#9A4B47" strokeWidth="1.1" strokeLinecap="round" />
            </g>
          </g>
        )}
        <ellipse cx="96" cy="132" rx="30" ry="8" fill="#8A6A4B" />
        <path d="M66 132 q30 14 60 0 v6 q-30 14 -60 0z" fill="#6E5239" />
      </svg>
      {compact ? null : (
        <div className="cap">
          灌溉中<span className="dots"><span /><span /><span /></span>
        </div>
      )}
    </div>
  );
}
