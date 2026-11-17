import { useTheme } from "@/theme/theme";

/**
 * 全站「讀取中」動畫：灌溉小樹苗（業主 2026-11-17 定稿）。網頁版；iOS／Android 版在 loading-sapling.tsx（先用系統轉圈圈）。
 * 水壺傾斜澆水、小樹苗長高、太陽、土裡探頭的蚯蚓、葉上爬的瓢蟲、遠飛近的老鷹。compact＝小區塊用的縮小版（只有水壺、太陽、小樹苗，沒有文字）。
 * 要改動畫只改這個檔案（所有 LoadingView 都用它）。
 */
const CSS = ".hgls{display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none}.hgls svg{overflow:visible}.hgls .cap{font:700 15px/1.3 -apple-system,\"PingFang TC\",\"Noto Sans TC\",sans-serif}.hgls .dots span{display:inline-block;width:5px;height:5px;border-radius:50%;margin-left:3px;background:currentColor;animation:hgls-dot 1.2s infinite}.hgls .dots span:nth-child(2){animation-delay:.2s}.hgls .dots span:nth-child(3){animation-delay:.4s}@keyframes hgls-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}.hgls .grow{transform-box:fill-box;transform-origin:50% 100%}.hgls .can{transform-box:fill-box;transform-origin:20% 60%;animation:hgls-tilt 2s ease-in-out infinite}@keyframes hgls-tilt{0%,12%{transform:rotate(0)}30%,80%{transform:rotate(-24deg)}100%{transform:rotate(0)}}.hgls .d{animation:hgls-fall 2s linear infinite;opacity:0}.hgls .d2{animation-delay:.12s}.hgls .d3{animation-delay:.24s}@keyframes hgls-fall{0%,28%{opacity:0;transform:translate(0,0)}34%{opacity:1}76%{opacity:1;transform:translate(0,54px)}82%,100%{opacity:0;transform:translate(0,58px)}}.hgls .plant{animation:hgls-grow 2s ease-in-out infinite}@keyframes hgls-grow{0%,25%{transform:scale(.7)}80%,100%{transform:scale(1.04)}}.hgls .sunrays{transform-box:fill-box;transform-origin:center;animation:hgls-spin 6s linear infinite}@keyframes hgls-spin{to{transform:rotate(360deg)}}.hgls .sunbody{transform-box:fill-box;transform-origin:center;animation:hgls-pulse 1.4s ease-in-out infinite}@keyframes hgls-pulse{50%{transform:scale(1.08)}}.hgls .glow{animation:hgls-glow 2s ease-in-out infinite}@keyframes hgls-glow{0%,25%{opacity:.25}80%,100%{opacity:.6}}.hgls .worm{transform-box:fill-box;transform-origin:50% 100%;animation:hgls-worm 4s ease-in-out infinite}@keyframes hgls-worm{0%,6%{transform:translateY(30px) rotate(0)}18%{transform:translateY(0) rotate(0)}28%{transform:translateY(0) rotate(-9deg)}40%{transform:translateY(0) rotate(9deg)}52%{transform:translateY(0) rotate(-6deg)}64%{transform:translateY(0) rotate(5deg)}74%{transform:translateY(0) rotate(0)}88%,100%{transform:translateY(30px) rotate(0)}}.hgls .pupil{animation:hgls-look 4s ease-in-out infinite}@keyframes hgls-look{0%,24%{transform:translateX(0)}32%{transform:translateX(-1.4px)}48%{transform:translateX(1.4px)}60%,100%{transform:translateX(0)}}.hgls .eyeblink{transform-box:fill-box;transform-origin:center;animation:hgls-blink 4s infinite}@keyframes hgls-blink{0%,54%,58%,100%{transform:scaleY(1)}56%{transform:scaleY(.1)}}.hgls .lady{animation:hgls-crawl 2.6s ease-in-out infinite}@keyframes hgls-crawl{0%{transform:translate(99px,90px) rotate(-50deg)}45%{transform:translate(110px,77px) rotate(-50deg)}50%{transform:translate(110px,77px) rotate(130deg)}95%{transform:translate(99px,90px) rotate(130deg)}100%{transform:translate(99px,90px) rotate(-50deg)}}.hgls .leg{animation:hgls-leg .25s linear infinite;transform-box:fill-box;transform-origin:center}@keyframes hgls-leg{50%{transform:scaleX(.8)}}.hgls .eagle{animation:hgls-fly 3.2s cubic-bezier(.45,0,.9,.5) infinite;opacity:0}@keyframes hgls-fly{0%{transform:translate(-14px,16px) scale(.28);opacity:0}4%{opacity:1}34%{transform:translate(206px,92px) scale(3.1);opacity:1}35%,100%{transform:translate(206px,92px) scale(3.1);opacity:0}}.hgls .wing{transform-box:fill-box;transform-origin:50% 100%;animation:hgls-flap .22s ease-in-out infinite}@keyframes hgls-flap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(-.5)}}@media (prefers-reduced-motion:reduce){.hgls *{animation-duration:.01ms!important;animation-iteration-count:1!important}}";

export function LoadingSapling({ compact = false }: { compact?: boolean }) {
  const { c } = useTheme();
  const size = compact ? 96 : 240;
  const green = c.accent;
  const leaf = "#2F8A5B";
  const leaf2 = "#5DB383";
  return (
    <div className="hgls" role="status" aria-label="載入中" style={{ padding: compact ? 8 : 24, color: c.accentText }}>
      <style>{CSS}</style>
      <svg viewBox="0 0 160 160" width={size} height={size} aria-hidden="true">
        <defs>
          <clipPath id="hgls-wclip">
            <rect x="50" y="90" width="60" height="42" />
          </clipPath>
        </defs>
        {compact ? null : (
          <g className="eagle">
            <g className="wing"><path d="M0 4 C-8 -8 -20 -8 -30 -2 C-20 -2 -10 2 0 6Z" fill="#5A3E2B" /></g>
            <g className="wing"><path d="M0 4 C8 -8 20 -8 30 -2 C20 -2 10 2 0 6Z" fill="#5A3E2B" /></g>
            <ellipse cx="0" cy="6" rx="8" ry="3.4" fill="#6B4A33" />
            <circle cx="8" cy="5" r="3" fill="#fff" />
            <path d="M10.5 5 l4 1.4 l-3.6 1.4z" fill="#F2B21D" />
            <circle cx="9" cy="4.3" r=".7" fill="#1D2A22" />
            <path d="M-8 6 l-6 2 l6 1z" fill="#4A3222" />
          </g>
        )}
        <g>
          <circle className="glow" cx="132" cy="28" r="26" fill="#F2C63D" />
          <g className="sunrays"><g stroke="#F2B21D" strokeWidth="3" strokeLinecap="round"><line x1="132" y1="2" x2="132" y2="9" /><line x1="132" y1="47" x2="132" y2="54" /><line x1="106" y1="28" x2="113" y2="28" /><line x1="151" y1="28" x2="158" y2="28" /><line x1="114" y1="10" x2="119" y2="15" /><line x1="145" y1="41" x2="150" y2="46" /><line x1="150" y1="10" x2="145" y2="15" /><line x1="119" y1="41" x2="114" y2="46" /></g></g>
          <circle className="sunbody" cx="132" cy="28" r="12" fill="#F7CB45" />
        </g>
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
        <g className="can">
          <rect x="14" y="30" width="44" height="32" rx="7" fill="#C9CFC9" />
          <path d="M58 38 L84 24 L88 30 L60 50z" fill="#9AA39C" />
          <path d="M14 38 C2 38 2 58 14 58" fill="none" stroke="#9AA39C" strokeWidth="5" strokeLinecap="round" />
          <rect x="82" y="20" width="10" height="14" rx="3" fill="#9AA39C" transform="rotate(-24 86 27)" />
        </g>
        <circle className="d" cx="92" cy="56" r="3" fill="#4FA3D1" />
        <circle className="d d2" cx="99" cy="50" r="3" fill="#4FA3D1" />
        <circle className="d d3" cx="85" cy="52" r="3" fill="#4FA3D1" />
      </svg>
      {compact ? null : (
        <div className="cap">
          灌溉中<span className="dots"><span /><span /><span /></span>
        </div>
      )}
    </div>
  );
}
