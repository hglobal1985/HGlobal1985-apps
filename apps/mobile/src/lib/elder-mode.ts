import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { PixelRatio, Platform } from "react-native";

/**
 * 使用模式（業主 2026-11-24）：「至尊模式」＝給長輩用的簡易大字版；「超派模式」＝原本的完整版。
 * 只存在這支手機／這個瀏覽器（不上傳伺服器）。字體放大倍數可自訂，也可選擇跟著手機系統的字體大小。
 * 全站文字、圖示的放大由 lib/global-scale.ts 讀 elderTextScale() 統一處理。
 */
export type ElderPrefs = {
  /** true＝至尊模式。 */
  on: boolean;
  /** 至尊模式的字體倍數（1.2～2.2，每次 0.1）。 */
  size: number;
  /** 再乘上手機系統的字體大小設定（輔助使用）。 */
  followSystem: boolean;
  /** 全站文字加粗（業主 2026-11-24 增加，長輩看得更清楚）。 */
  bold: boolean;
};

export const ELDER_MIN = 1.2;
export const ELDER_MAX = 2.2;
export const ELDER_DEFAULT = 1.5;
const KEY = "elder-mode:v1";
const DEFAULTS: ElderPrefs = { on: false, size: ELDER_DEFAULT, followSystem: true, bold: false };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

function parse(raw: string | null): ElderPrefs {
  if (!raw) return DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<ElderPrefs>;
    return { on: v.on === true, size: clamp(round1(Number(v.size) || ELDER_DEFAULT), ELDER_MIN, ELDER_MAX), followSystem: v.followSystem !== false, bold: v.bold === true };
  } catch {
    return DEFAULTS;
  }
}

function readWebSync(): ElderPrefs {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return DEFAULTS;
  try {
    return parse(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
}

// 網頁同步讀取（第一次畫面就是正確的模式與字體）；手機 App 讀完儲存的設定後再通知畫面更新。
let prefs: ElderPrefs = readWebSync();
/** 每次「會影響全站字體」的改變 +1：根版面用它重建畫面，讓已經畫好的字也換成新大小。 */
let version = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

if (Platform.OS !== "web") {
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      prefs = parse(raw);
      version += 1;
      emit();
    })
    .catch(() => undefined);
}

/**
 * 至尊模式的文字換行（業主 2026-11-24：換行後孤零零多出一兩個字很難看）：網頁在至尊模式時，所有多行文字用 text-wrap: balance
 * 讓每行長度平均（不會剩一兩個字掉到下一行）。只在至尊模式生效（html[data-elder]），超派模式不變。
 */
function applyWrap() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const el = document.documentElement;
  if (prefs.on) el.setAttribute("data-elder", "1");
  else el.removeAttribute("data-elder");
  if (!document.getElementById("elder-wrap-3")) {
    const st = document.createElement("style");
    st.id = "elder-wrap-3";
    st.textContent = ""; // 不再平均斷行（業主 2026-11-24：至尊模式所有頁面一律依寬度自然換行）
    document.head.appendChild(st);
  }
}
applyWrap();

let systemCache: number | null = null;
/**
 * 手機系統的字體大小（1＝標準）。iOS／Android App 用系統提供的倍數；
 * 網頁版在 iPhone／iPad 的 Safari 用 -apple-system-body 量出「設定 › 顯示與亮度 › 文字大小」（標準 17px）；
 * 其他瀏覽器量不到時當作 1。
 */
export function systemFontScale(): number {
  if (systemCache != null) return systemCache;
  let s = 1;
  if (Platform.OS !== "web") s = PixelRatio.getFontScale() || 1;
  else if (typeof document !== "undefined" && document.body) {
    try {
      const el = document.createElement("span");
      el.style.fontSize = "1px";
      el.style.font = "-apple-system-body";
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      el.textContent = "字";
      document.body.appendChild(el);
      const px = parseFloat(getComputedStyle(el).fontSize);
      el.remove();
      if (px > 1) s = px / 17;
    } catch {
      s = 1;
    }
  }
  systemCache = clamp(s, 0.8, 3);
  return systemCache;
}

/** 目前全站文字要乘的「至尊模式」倍數（超派模式＝1）。 */
export function elderTextScale(p: ElderPrefs = prefs): number {
  if (!p.on) return 1;
  return round1(clamp(p.size * (p.followSystem ? systemFontScale() : 1), 1, 3));
}

export const getElder = () => prefs;
export const elderVersion = () => version;

/** 改設定：存起來並通知畫面。字體或模式有變才重建畫面（version +1）。 */
export function setElder(patch: Partial<ElderPrefs>) {
  const next = { ...prefs, ...patch };
  next.size = clamp(round1(next.size), ELDER_MIN, ELDER_MAX);
  const changed = elderTextScale(next) !== elderTextScale(prefs) || next.on !== prefs.on || next.bold !== prefs.bold;
  prefs = next;
  applyWrap();
  if (changed) version += 1;
  const raw = JSON.stringify(prefs);
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      /* 私密模式存不了：這次開啟期間仍有效 */
    }
  } else void AsyncStorage.setItem(KEY, raw).catch(() => undefined);
  emit();
}

/** 目前的使用模式設定（會隨切換更新）。 */
export const useElder = () => useSyncExternalStore(subscribe, getElder, getElder);
/** true＝至尊模式。 */
export const useElderOn = () => useSyncExternalStore(subscribe, () => prefs.on, () => prefs.on);
/** 根版面用：全站字體倍數改變時換一個新值。 */
export const useElderVersion = () => useSyncExternalStore(subscribe, elderVersion, elderVersion);
