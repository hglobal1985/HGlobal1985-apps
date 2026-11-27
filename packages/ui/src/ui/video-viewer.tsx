import Ionicons from "@expo/vector-icons/Ionicons";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ControlsBar } from "@/features/player/controls-bar";
import { nextRate } from "@/features/player/time-format";
import { AppText } from "@/ui/text";

/**
 * 影片檢視（iOS／Android App 版；杜杜龍 2026-11-27）：在 App 內全螢幕播放（expo-video），下方是共用播放控制列 ControlsBar，右上 ✕ 關閉；手機返回鍵＝關閉。
 * 網頁版見 video-viewer.web.tsx。
 */
export function VideoViewer({ uri, title, onClose }: { uri: string; title?: string; onClose: () => void }) {
  const ins = useSafeAreaInsets();
  const view = useRef<VideoView>(null);
  const [s, setS] = useState({ playing: false, loading: true, position: 0, total: 0, rate: 1 });
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.5;
    p.play();
  });
  const sync = () => setS({ playing: player.playing, loading: player.status === "loading", position: player.currentTime, total: player.duration || 0, rate: player.playbackRate });
  useEventListener(player, "statusChange", sync);
  useEventListener(player, "playingChange", sync);
  useEventListener(player, "timeUpdate", sync);
  useEventListener(player, "playbackRateChange", sync);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", paddingTop: ins.top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, minHeight: 56 }}>
          <AppText numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>
            {title ?? ""}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={onClose} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        <VideoView ref={view} player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" />
        <View style={{ paddingBottom: ins.bottom }}>
          <ControlsBar
            overlay
            playing={s.playing}
            loading={s.loading}
            position={s.position}
            total={s.total}
            rate={s.rate}
            onToggle={() => (player.playing ? player.pause() : player.play())}
            onSeek={(sec) => (player.currentTime = sec)}
            onRate={() => (player.playbackRate = nextRate(player.playbackRate))}
            onFullscreen={() => void view.current?.enterFullscreen()}
          />
        </View>
      </View>
    </Modal>
  );
}
