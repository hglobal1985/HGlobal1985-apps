import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognizer(): (new () => Rec) | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 音波條數。 */
export const WAVE_BARS = 9;
const QUIET = Array.from({ length: WAVE_BARS }, () => 0.08);

/**
 * Android 的 Chrome 語音辨識用系統麥克風，同時再開一個麥克風來量音量可能讓辨識失敗，
 * 所以 Android 不量真實音量，改成「有聽到聲音」時跳動的擬真音波（瀏覽器的 onsoundstart／onsoundend）。
 */
const canMeter = () => Platform.OS === "web" && typeof navigator !== "undefined" && !/android/i.test(navigator.userAgent) && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && !!((window as unknown as { AudioContext?: unknown }).AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);

/**
 * 用說的找課程（至尊模式，杜杜龍 2026-11-24）：網頁版用瀏覽器內建的語音辨識（中文・台灣）。
 * 說話時 levels＝每條音波的高度（0～1），跟著麥克風的聲音大小即時跳動（杜杜龍 2026-11-24：偵測到聲音要有音波高低動態）。
 * 不支援的瀏覽器（或 App）回傳 supported=false，畫面改成提示「按鍵盤上的麥克風說話」。
 */
export function useVoice(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(QUIET);
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const meter = useRef<{ stop: () => void } | null>(null);
  const supported = !!recognizer();

  const stopMeter = useCallback(() => {
    meter.current?.stop();
    meter.current = null;
    setLevels(QUIET);
  }, []);

  /** 真實音量：麥克風 → 頻譜分析，每 50 毫秒更新一次音波高度。 */
  const startRealMeter = useCallback(async () => {
    let raf = 0;
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    meter.current = {
      stop: () => {
        stopped = true;
        cancelAnimationFrame(raf);
        stream?.getTracks().forEach((t) => t.stop());
        void ctx?.close().catch(() => undefined);
      },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (stopped) return void stream.getTracks().forEach((t) => t.stop());
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(an);
      const bins = new Uint8Array(an.frequencyBinCount);
      let last = 0;
      const tick = (t: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (t - last < 50) return;
        last = t;
        an.getByteFrequencyData(bins);
        // 人聲大約在前 40 個頻帶（約 0～7kHz），分成幾段取平均；中間的條比較高，看起來像音波。
        const n = WAVE_BARS;
        const usable = Math.min(40, bins.length);
        const per = Math.max(1, Math.floor(usable / n));
        const raw = Array.from({ length: n }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < per; j++) sum += bins[i * per + j] ?? 0;
          return sum / per / 255;
        });
        // 低頻在中間、往兩邊遞減（對稱排列）。
        const order = Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2));
        const sorted = [...raw].sort((a, b) => b - a);
        const rank = [...order].map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
        const out = new Array<number>(n);
        rank.forEach((r, k) => (out[r.i] = Math.max(0.08, Math.min(1, (sorted[k] ?? 0) * 1.8))));
        setLevels(out);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      // 量不到（沒給權限、瀏覽器不准同時用兩次麥克風）：改用擬真音波。
      if (!stopped) startFakeMeter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 擬真音波：有聽到聲音時隨機跳動，沒聲音時趴平。 */
  const sound = useRef(false);
  const startFakeMeter = useCallback(() => {
    meter.current?.stop();
    const t = setInterval(() => setLevels(sound.current ? Array.from({ length: WAVE_BARS }, (_, i) => 0.25 + Math.random() * (0.75 - Math.abs(i - (WAVE_BARS - 1) / 2) * 0.1)) : QUIET), 110);
    meter.current = { stop: () => clearInterval(t) };
  }, []);

  useEffect(() => () => (rec.current?.abort(), meter.current?.stop()), []);

  /** 說完停多久才自動結束（杜杜龍 2026-11-25：不要太快偵測結束就送出）：開始說話後停 4 秒；一直沒開口則等 12 秒。 */
  const SILENCE_MS = 4000;
  const NO_SPEECH_MS = 12000;
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const lastText = useRef(""); // 這一輪辨識到的字（重連時併入 heard）
  const heard = useRef(""); // 瀏覽器中途自己斷線重連時，前面聽到的字要保留

  const start = useCallback(() => {
    const R = recognizer();
    if (!R) return false;
    rec.current?.abort();
    if (idle.current) clearTimeout(idle.current);
    heard.current = "";
    running.current = true;
    let spoke = false;
    const finish = () => {
      running.current = false;
      if (idle.current) clearTimeout(idle.current);
      rec.current?.stop();
    };
    const arm = () => {
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(finish, spoke ? SILENCE_MS : NO_SPEECH_MS);
    };
    const launch = (): boolean => {
      const r = new R();
      r.lang = "zh-TW";
      r.interimResults = true;
      r.continuous = true; // 連續聽，不因為短暫停頓就結束
      r.onresult = (e) => {
        let text = "";
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]!;
          text += res[0]?.transcript ?? "";
          if (res.isFinal) final = true;
        }
        lastText.current = text;
        const all = (heard.current + text).replace(/[。．.！!？?，,]+$/g, "").trim();
        if (all) spoke = true;
        arm(); // 每聽到新的字就重新計時
        cb.current(all, final && !running.current);
      };
      r.onsoundstart = () => {
        sound.current = true;
        spoke = true;
        arm();
      };
      r.onsoundend = () => (sound.current = false);
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          running.current = false;
          setError("請允許使用麥克風，才能用說的找課程。");
        } else if (e.error === "no-speech" && !running.current) setError("沒有聽到聲音，請再按一次麥克風。");
      };
      r.onend = () => {
        // 還沒到自己設的結束時間、瀏覽器卻先斷了：接著重新聽（Android 常這樣），把已聽到的字留著。
        if (running.current && rec.current === r) {
          heard.current = (heard.current + lastText.current).trim();
          lastText.current = "";
          try {
            if (launch()) return;
          } catch {
            /* 重連失敗就結束 */
          }
        }
        if (rec.current === r || !rec.current) {
          running.current = false;
          if (idle.current) clearTimeout(idle.current);
          setListening(false);
          sound.current = false;
          stopMeter();
        }
      };
      try {
        r.start();
        rec.current = r;
        return true;
      } catch {
        return false;
      }
    };
    setError(null);
    setListening(true);
    if (!launch()) {
      running.current = false;
      setListening(false);
      return false;
    }
    arm();
    if (canMeter()) void startRealMeter();
    else startFakeMeter();
    return true;
  }, [startRealMeter, startFakeMeter, stopMeter]);
  const stop = useCallback(() => {
    running.current = false;
    if (idle.current) clearTimeout(idle.current);
    rec.current?.stop();
    setListening(false);
    stopMeter();
  }, [stopMeter]);
  return { supported, listening, error, levels, start, stop };
}
