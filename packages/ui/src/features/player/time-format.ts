/** 播放時間與倍數的顯示（共用：行動大學課程播放、繳作業系統看影片；杜杜龍 2026-11-27 從 engine.types.ts 搬來）。 */

/** 倍數播放的檔位：1 → 1.2 → 1.5 → 1.8 → 2 → 回到 1。 */
export const RATES = [1, 1.2, 1.5, 1.8, 2] as const;
export const nextRate = (r: number): number => RATES[(RATES.findIndex((x) => x === r) + 1) % RATES.length] ?? 1;
/** 倍數的顯示文字：1.2×、2×。 */
export const rateText = (r: number): string => `${r}×`;

/** 倒數剩餘時間：-12:34（整個網站的播放時間顯示一律用這個）。 */
export const remainingText = (sec: number): string => `-${formatClock(Math.ceil(Math.max(0, sec)))}`;

/** 秒數 → m:ss 或 h:mm:ss */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
