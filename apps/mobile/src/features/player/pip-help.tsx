import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform, View } from "react-native";
import { AppText, Button } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { space } from "@/theme/tokens";
import { usePlayer } from "./use-player";
import { closePipHelp, maybeShowPipHelp, pipForceBlocked, pipOpen, pipStartedReset, pipWasStarted, subscribePip } from "./pip-help-store";

/** App 版：影片播放中離開 App，卻沒進入子母畫面＝授權沒開，回來時教一次。 */
export function useNativePipHelp() {
  const s = usePlayer();
  const video = s.track?.mode === "video";
  const playing = s.playing;
  useEffect(() => {
    if (Platform.OS === "web") return;
    let leftWhilePlaying = false;
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "background" || st === "inactive") {
        pipStartedReset();
        leftWhilePlaying = video && playing;
      } else if (st === "active") {
        if (leftWhilePlaying && !pipWasStarted()) {
          pipForceBlocked();
          void maybeShowPipHelp();
        }
        leftWhilePlaying = false;
      }
    });
    return () => sub.remove();
  }, [video, playing]);
}

export function PipHelp() {
  const on = useSyncExternalStore(subscribePip, pipOpen, () => false);
  if (!on) return null;
  const close = closePipHelp;
  const android = Platform.OS !== "ios";
  return (
    <BottomSheet onClose={close}>
      <View style={{ gap: space.sm }}>
        <AppText variant="headline">要讓影片縮小後留在手機的浮動視窗</AppText>
        <AppText>手機還沒允許「子母畫面（浮動視窗）」，所以離開畫面時影片不會浮在最上層。請照下面打開：</AppText>
        {android ? (
          <>
            <AppText>1. 打開手機「設定」→「應用程式」</AppText>
            <AppText>2. 選你正在用的程式（網頁請選 Chrome，App 請選「寰宇行動大學」）</AppText>
            <AppText>3. 找到「子母畫面」（或「Picture-in-picture」）→ 打開「允許」</AppText>
          </>
        ) : (
          <>
            <AppText>1. 打開手機「設定」→「一般」</AppText>
            <AppText>2. 點「子母畫面」→ 打開「自動啟動子母畫面」</AppText>
          </>
        )}
        <AppText tone="muted">設定好之後，播放影片時縮小瀏覽器（或離開 App），影片就會留在螢幕上的小視窗。只有直接播放的影片可以；YouTube 內嵌影片受 YouTube 限制，手機系統不一定會浮出。</AppText>
        <Button label="我知道了" onPress={close} fullWidth />
      </View>
    </BottomSheet>
  );
}
