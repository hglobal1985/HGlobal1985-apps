import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Playback } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { AppText, LoadingLadybug } from "@/ui";
import { CollapseBand } from "@/ui/collapse-band";
import { InlineAudio } from "./audio-bar";
import { LessonPlayer } from "./lesson-player";
import { PlayerControls } from "./player-controls";
import { PlayerSlot } from "./player-slot";

/**
 * 課程頁「播放區」模版（杜杜龍 2026-11-24：至尊模式與超派模式的播放器必須同一份，改一邊兩邊一起變）。
 * 超派模式（app/course/[id].tsx）與至尊模式（app/course/[id].tsx 的 elder 分支）都只用這個元件：
 * 影片＝播放舞台（PlayerSlot）＋控制列（PlayerControls）；純音檔＝InlineAudio；舊版 YouTube＝LessonPlayer；
 * 還沒開始播放＝idle（封面）＋待機控制列（idleBar，沒給就不顯示）。
 * 轉橫放自動全螢幕、縮小成小視窗、全螢幕控制列等行為都在全站播放器（player-layer.web.tsx／engine）：兩個模式本來就共用，
 * 只要這裡的畫面骨架一致，兩邊就完全相同；以後要改播放區的長相或位置，只改這個檔案。
 */
export function LessonStage({
  stage,
  legacy,
  onLegacyEnd,
  idle,
  idleBar,
  collapseIdle = true,
}: {
  /** 還沒播放時，封面隨頁面下滑縮成窄橫幅（杜杜龍 2026-11-24，共用 ui/collapse-band；大螢幕左右分欄傳 false）。 */
  collapseIdle?: boolean;
  /** 目前釘住的播放軌（沒有＝還沒播放）。 */
  stage: { key: string; audio: boolean } | null;
  /** 舊版 YouTube 播放來源。 */
  legacy?: Playback | null;
  onLegacyEnd?: () => void;
  /** 還沒播放時顯示的封面（EDM）。 */
  idle?: ReactNode;
  /** 還沒播放時的待機控制列：有可播的課就給（minutes＝倒數分鐘、loading＝已按下載入中、onPlay＝開始播放）。 */
  idleBar?: { minutes: number; loading: boolean; onPlay: () => void } | null;
}) {
  const { c } = useTheme();
  if (stage) {
    return (
      <View>
        {stage.audio ? (
          <InlineAudio trackKey={stage.key} />
        ) : (
          <>
            <PlayerSlot trackKey={stage.key} />
            <PlayerControls />
          </>
        )}
      </View>
    );
  }
  if (legacy) return <LessonPlayer playback={legacy} onSegmentEnd={onLegacyEnd} />;
  return (
    <>
      {idle ? <CollapseBand enabled={collapseIdle}>{idle}</CollapseBand> : null}
      {idleBar ? (
        <View style={[styles.idleBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="播放" onPress={idleBar.onPlay} hitSlop={8} style={styles.idlePlay}>
            {idleBar.loading ? <LoadingLadybug size={32} /> : <Ionicons name="play" size={26} color={c.text} />}
          </Pressable>
          <View style={[styles.idleTrack, { backgroundColor: c.border }]} />
          <AppText variant="callout" tone="muted">{`-${Math.floor(idleBar.minutes)}:00`}</AppText>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  idleBar: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, borderBottomWidth: 1 },
  idlePlay: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  idleTrack: { flex: 1, height: 6, borderRadius: 3 },
});
