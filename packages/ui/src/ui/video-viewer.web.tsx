import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { unstable_createElement } from "react-native-web";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBackToClose } from "@/lib/back-close";
import { ControlsBar } from "@/features/player/controls-bar";
import { nextRate } from "@/features/player/time-format";
import { useDimLayer } from "@/ui/dim-backdrop";
import { AppText } from "@/ui/text";

/**
 * 影片檢視（共用元件；杜杜龍 2026-11-27）：全黑全螢幕播放一支影片（例如老師看學員交的短影片），右上 ✕ 關閉。
 * 下方是共用的播放控制列 ControlsBar（與行動大學課程頁同一條：播放、時間軸、剩餘時間、倍數、全螢幕）。
 * 瀏覽器／手機「上一頁」＝關閉（useBackToClose）。iOS／Android App 版見 video-viewer.tsx。
 */
export function VideoViewer({ uri, title, onClose }: { uri: string; title?: string; onClose: () => void }) {
  useDimLayer();
  useBackToClose(onClose);
  const ins = useSafeAreaInsets();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [s, setS] = useState({ playing: false, loading: true, position: 0, total: 0, rate: 1 });
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const sync = () => setS({ playing: !v.paused && !v.ended, loading: v.readyState < 3 && !v.paused, position: v.currentTime, total: Number.isFinite(v.duration) ? v.duration : 0, rate: v.playbackRate });
    const evs = ["play", "pause", "timeupdate", "durationchange", "loadedmetadata", "waiting", "playing", "ratechange", "ended", "canplay"];
    evs.forEach((e) => v.addEventListener(e, sync));
    v.play().catch(() => sync());
    return () => evs.forEach((e) => v.removeEventListener(e, sync));
  }, [uri]);
  const v = () => ref.current;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }} {...({ dataSet: { noPullRefresh: "" } } as object)}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {unstable_createElement("video", { ref, src: uri, playsInline: true, onClick: () => (v()?.paused ? v()?.play() : v()?.pause()), style: { width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } })}
        </View>
        <View style={{ paddingBottom: ins.bottom }}>
          <ControlsBar
            overlay
            playing={s.playing}
            loading={s.loading}
            position={s.position}
            total={s.total}
            rate={s.rate}
            onToggle={() => (v()?.paused ? v()?.play() : v()?.pause())}
            onSeek={(sec) => {
              const el = v();
              if (el) el.currentTime = sec;
            }}
            onRate={() => {
              const el = v();
              if (el) el.playbackRate = nextRate(el.playbackRate);
            }}
            onFullscreen={() => void v()?.requestFullscreen?.().catch(() => undefined)}
          />
        </View>
        <View style={{ position: "absolute", top: ins.top + 12, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 }} pointerEvents="box-none">
          {title ? (
            <AppText numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>
              {title}
            </AppText>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={onClose} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
