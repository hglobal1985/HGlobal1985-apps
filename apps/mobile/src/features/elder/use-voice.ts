import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognizer(): (new () => Rec) | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 用說的找課程（至尊模式，業主 2026-11-24）：網頁版用瀏覽器內建的語音辨識（中文・台灣）。
 * 不支援的瀏覽器（或 App）回傳 supported=false，畫面改成提示「按鍵盤上的麥克風說話」。
 */
export function useVoice(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = !!recognizer();
  useEffect(() => () => rec.current?.abort(), []);
  const start = useCallback(() => {
    const R = recognizer();
    if (!R) return false;
    rec.current?.abort();
    const r = new R();
    r.lang = "zh-TW";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        text += res[0]?.transcript ?? "";
        if (res.isFinal) final = true;
      }
      // 去掉句尾標點（辨識常加「。」），搜尋時不需要。
      cb.current(text.replace(/[。．.！!？?，,]+$/g, "").trim(), final);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "請允許使用麥克風，才能用說的找課程。" : e.error === "no-speech" ? "沒有聽到聲音，請再按一次麥克風。" : null);
    r.onend = () => setListening(false);
    setError(null);
    setListening(true);
    try {
      r.start();
      rec.current = r;
    } catch {
      setListening(false);
      return false;
    }
    return true;
  }, []);
  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);
  return { supported, listening, error, start, stop };
}
