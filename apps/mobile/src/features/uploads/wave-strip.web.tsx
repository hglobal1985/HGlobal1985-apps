import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/theme/theme";

const PER_SEC = 10; // 每秒 10 個音量取樣
const RANGE_DB = 42; // 比最大聲小超過這麼多 dB 就算靜音（畫成最低谷）

/** 解碼音檔，算出每 0.1 秒的音量（dB）；失敗（格式不支援）回 null。 */
async function analyse(file: Blob): Promise<Float32Array | null> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();
    const data = buf.getChannelData(0);
    const size = Math.max(1, Math.floor(buf.sampleRate / PER_SEC));
    const n = Math.ceil(data.length / size);
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const from = i * size;
      const to = Math.min(data.length, from + size);
      for (let j = from; j < to; j++) sum += data[j]! * data[j]!;
      db[i] = 20 * Math.log10(Math.sqrt(sum / Math.max(1, to - from)) + 1e-7);
    }
    return db;
  } catch {
    return null;
  }
}

/**
 * 音波（業主 2026-11-17）：貼在時間軸正下方，水平座標與時間軸完全一致。目的是看出「靜音在哪裡」：
 * 音量用分貝換算，比最大聲小 42 dB 以上的靜音一律畫成最低谷（只剩一條細線），有聲音的地方才長出柱子。
 * 只有「音檔」來源能算（瀏覽器讀得到檔案內容）；YouTube 的聲音瀏覽器拿不到，所以沒有音波。
 */
export function WaveStrip({ file, total, pos, pps, w, full, height }: { file: Blob | null; total: number; pos: number; pps: number; w: number; full: boolean; height: number }) {
  const { c } = useTheme();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [db, setDb] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    setDb(null);
    if (file) void analyse(file).then((r) => alive && setDb(r));
    return () => void (alive = false);
  }, [file]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !db) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(w * dpr);
    el.height = Math.round(height * dpr);
    const g = el.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);
    let top = -120;
    for (let i = 0; i < db.length; i++) if (db[i]! > top) top = db[i]!;
    const left = full ? 0 : pos - w / 2 / pps;
    for (let px = 0; px < w; px++) {
      const t0 = left + px / pps;
      const t1 = left + (px + 1) / pps;
      if (t1 < 0 || t0 > total) continue;
      let m = -120;
      const a = Math.max(0, Math.floor(t0 * PER_SEC));
      const b = Math.min(db.length - 1, Math.max(a, Math.floor(t1 * PER_SEC)));
      for (let i = a; i <= b; i++) if (db[i]! > m) m = db[i]!;
      const h = Math.max(0, Math.min(1, (m - (top - RANGE_DB)) / RANGE_DB));
      if (h < 0.03) {
        g.fillStyle = c.border; // 靜音：最低谷
        g.fillRect(px, height - 2, 1, 2);
      } else {
        g.fillStyle = c.accent;
        const bar = Math.max(2, h * (height - 2));
        g.fillRect(px, height - bar, 1, bar);
      }
    }
    // 中線（紅線）
    g.fillStyle = c.danger;
    g.fillRect((full ? pos * pps : w / 2) - 1, 0, 2, height);
  }, [db, pos, pps, w, full, total, height, c]);
  if (!file) return null;
  return <canvas ref={canvas} style={{ width: w, height, display: "block", pointerEvents: "none" }} />;
}
