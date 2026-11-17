const CSS =
  ".hgll{display:block;overflow:visible;pointer-events:none}" +
  ".hgll .fly{transform-box:fill-box;transform-origin:50% 50%;animation:hgll-hover 1.6s ease-in-out infinite}" +
  "@keyframes hgll-hover{0%{transform:translate(0,0) rotate(-8deg)}25%{transform:translate(4px,-5px) rotate(6deg)}50%{transform:translate(0,-2px) rotate(10deg)}75%{transform:translate(-4px,-6px) rotate(-6deg)}100%{transform:translate(0,0) rotate(-8deg)}}" +
  ".hgll .el{transform-box:view-box;transform-origin:32px 24px;animation:hgll-open .5s ease-in-out infinite}" +
  ".hgll .el.l{--a:42deg}.hgll .el.r{--a:-42deg}" +
  "@keyframes hgll-open{0%,100%{transform:rotate(0)}50%{transform:rotate(var(--a))}}" +
  ".hgll .hw{transform-box:view-box;animation:hgll-flutter .14s linear infinite}" +
  ".hgll .hw.l{transform-origin:28px 26px;--t:-8deg}.hgll .hw.r{transform-origin:36px 26px;--t:8deg}" +
  "@keyframes hgll-flutter{0%,100%{transform:scaleX(1) rotate(0)}50%{transform:scaleX(.7) rotate(var(--t,0deg))}}" +
  ".hgll .shadow{animation:hgll-sh 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}" +
  "@keyframes hgll-sh{50%{transform:scale(.8);opacity:.12}}" +
  "@media (prefers-reduced-motion:reduce){.hgll *{animation-duration:.01ms!important;animation-iteration-count:1!important}}";

/**
 * 小範圍讀取動畫「小瓢蟲」（業主 2026-11-17 定稿）：按鈕送出中、播放鈕等待播放、小區塊／清單底部讀取用；
 * 紅色硬殼開闔、透明翅膀快速拍動、原地輕輕飛舞。整頁／整個區塊讀取用 LoadingSapling。網頁版；iOS／Android 在 loading-ladybug.tsx。
 * 要改動畫只改這個檔案。
 */
export function LoadingLadybug({ size = 44 }: { size?: number }) {
  return (
    <svg className="hgll" viewBox="0 0 64 64" width={size} height={size} role="status" aria-label="載入中">
      <style>{CSS}</style>
      <ellipse className="shadow" cx="32" cy="60" rx="12" ry="2.5" fill="#000" opacity=".18" />
      <g className="fly">
        <ellipse className="hw l" cx="14" cy="38" rx="15" ry="6.5" transform="rotate(-18 14 38)" fill="#C3D3E2" opacity=".9" />
        <ellipse className="hw r" cx="50" cy="38" rx="15" ry="6.5" transform="rotate(18 50 38)" fill="#C3D3E2" opacity=".9" />
        <ellipse cx="32" cy="37" rx="9" ry="15" fill="#1D2A22" />
        <circle cx="32" cy="19" r="6.5" fill="#1D2A22" />
        <circle cx="29.6" cy="17.5" r="1.5" fill="#fff" />
        <circle cx="34.4" cy="17.5" r="1.5" fill="#fff" />
        <path d="M29 14 q-3 -5 -7 -5 M35 14 q3 -5 7 -5" fill="none" stroke="#1D2A22" strokeWidth="1.6" strokeLinecap="round" />
        <g className="el l">
          <path d="M32 23 C20 23 15 32 16 43 C17 53 25 57 32 57Z" fill="#D6342A" />
          <circle cx="23" cy="33" r="2.4" fill="#1D2A22" /><circle cx="26" cy="45" r="2.8" fill="#1D2A22" /><circle cx="20" cy="43" r="1.8" fill="#1D2A22" />
        </g>
        <g className="el r">
          <path d="M32 23 C44 23 49 32 48 43 C47 53 39 57 32 57Z" fill="#D6342A" />
          <circle cx="41" cy="33" r="2.4" fill="#1D2A22" /><circle cx="38" cy="45" r="2.8" fill="#1D2A22" /><circle cx="44" cy="43" r="1.8" fill="#1D2A22" />
        </g>
      </g>
    </svg>
  );
}
