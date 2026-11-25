import { notePipStarted } from "./pip-help-store";
import { VideoView } from "expo-video";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { StageFrame } from "@/ui/stage-frame";
import { engine } from "./engine";
import { resetPlayerShrink, useShrink } from "./shrink";
import { usePlayer } from "./use-player";

/**
 * 課程頁的影片區塊（手機 App）：顯示全站同一個播放器的畫面；離開頁面後播放器由浮動小視窗接手。
 * 已移除雙指放大與拖曳（業主 2026-11-24）。
 */
export function PlayerSlot({ trackKey }: { trackKey: string }) {
  const s = usePlayer();
  const view = useRef<VideoView>(null);
  const shrink = useShrink();
  const [h0, setH0] = useState(0); // 舞台原本的高度
  useFocusEffect(
    useCallback(() => {
      resetPlayerShrink();
      engine.setSlot(trackKey);
      engine.setFullscreenTarget(view.current);
      return () => (engine.clearSlot(trackKey), engine.setFullscreenTarget(null));
    }, [trackKey]),
  );
  const p = s.track?.key === trackKey ? engine.player() : null;
  const atMini = shrink >= 0.99;
  // 往下滑：舞台跟著縮矮（頁面露出更多文字），縮到底就交給浮動小視窗（player-layer.tsx）。
  return (
    <View onLayout={(e) => shrink === 0 && setH0(e.nativeEvent.layout.height)} style={shrink > 0 && h0 ? { height: Math.round(h0 * (1 - shrink)), overflow: "hidden" } : undefined}>
    <StageFrame>
      <View style={StyleSheet.absoluteFill}>{p && !atMini ? <VideoView ref={view} player={p} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" allowsPictureInPicture startsPictureInPictureAutomatically onPictureInPictureStart={notePipStarted} /> : null}</View>
    </StageFrame>
    </View>
  );
}
