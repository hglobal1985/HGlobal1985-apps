import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 「縮小瀏覽器／離開 App 時，影片要留在手機的浮動小視窗」的授權教學（杜杜龍 2026-11-25，網頁版與 App 版共用這一份）：
 * 系統沒有讓子母畫面（浮動視窗）自動出現時，回到畫面會自動跳出一次教學（只跳一次，記在本機）：到手機設定把子母畫面打開。
 * 網頁版由 engine.web.ts 在縮小瀏覽器要進入子母畫面被拒絕時呼叫 pipBlocked()；App 版由下面的 useNativePipHelp 偵測。
 */
const KEY = "pip-help-seen:v1";
let open = false;
let started = false; // 這次離開有沒有真的進入浮動視窗
let blocked = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribePip = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const pipOpen = () => open;
export const closePipHelp = () => {
  open = false;
  emit();
};
export const pipStartedReset = () => {
  started = false;
};
export const pipWasStarted = () => started;
export const pipForceBlocked = () => {
  blocked = true;
};

export const notePipStarted = () => {
  started = true;
};
/** 網頁版：縮小瀏覽器時進入浮動視窗被拒絕。 */
export const pipBlocked = () => {
  blocked = true;
};
/** 回到畫面時呼叫：之前被拒絕、而且還沒教過，就跳出教學。 */
export async function maybeShowPipHelp(): Promise<void> {
  if (!blocked) return;
  blocked = false;
  try {
    if (await AsyncStorage.getItem(KEY)) return;
    await AsyncStorage.setItem(KEY, "1");
  } catch {
    /* 存不了就照樣顯示一次 */
  }
  open = true;
  emit();
}

