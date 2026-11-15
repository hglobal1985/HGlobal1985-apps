/** 時間軸區間用的「時：分：秒」輸入（影音上傳模組專用）。 */
export type Hms = { h: string; m: string; s: string };

export const toHms = (sec: number | null): Hms =>
  sec == null ? { h: "", m: "", s: "" } : { h: String(Math.floor(sec / 3600)), m: String(Math.floor((sec % 3600) / 60)), s: String(sec % 60) };

export const fromHms = ({ h, m, s }: Hms): number | null | "invalid" => {
  if (!h.trim() && !m.trim() && !s.trim()) return null;
  const [a, b, c] = [h, m, s].map((x) => (x.trim() ? Number(x) : 0));
  if (![a, b, c].every((n) => Number.isInteger(n) && n >= 0) || b > 59 || c > 59) return "invalid";
  return a * 3600 + b * 60 + c;
};

export const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h} 小時 ${m} 分 ${s} 秒` : `${m} 分 ${s} 秒`;
};
