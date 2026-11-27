import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch } from "@/theme/tokens";
import { AppText } from "@/ui/text";
import { LoadingLadybug } from "@/ui/loading-ladybug";
import { SeekBar } from "./seek-bar";
import { rateText, remainingText } from "./time-format";

/**
 * 播放控制列的外觀（共用元件；杜杜龍 2026-11-27 從行動大學 PlayerControls 拆出來）：播放／暫停（讀取中＝小瓢蟲）、可拖曳的時間軸、倒數剩餘時間、倍數、（有的話）小視窗、全螢幕。
 * 只負責畫面，不管播放引擎：行動大學課程頁的 PlayerControls 接上自己的播放引擎；繳作業系統的影片檢視接上瀏覽器的 video。
 * 以後要改播放控制列的外觀，只改這個檔案（與 seek-bar.tsx），所有地方一起變。
 */
export function ControlsBar({
  playing,
  loading = false,
  position,
  total,
  rate,
  onToggle,
  onSeek,
  onRate,
  pip,
  onFullscreen,
  overlay = false,
  maxWidth,
}: {
  playing: boolean;
  loading?: boolean;
  /** 目前位置（秒，從 0 起算）。 */
  position: number;
  /** 總長（秒）。 */
  total: number;
  rate: number;
  onToggle: () => void;
  onSeek: (sec: number) => void;
  onRate: () => void;
  pip?: { active: boolean; onPress: () => void };
  onFullscreen?: () => void;
  /** 全螢幕疊在影片上：黑色半透明底、白色圖示（杜杜龍 2026-11-24）。 */
  overlay?: boolean;
  maxWidth?: number;
}) {
  const theme = useTheme();
  const c = overlay ? { ...theme.c, text: "#fff", textMuted: "rgba(255,255,255,0.85)", accentText: "#fff", surface: "rgba(0,0,0,0.55)", border: "transparent" } : theme.c;
  const at = Math.min(total, Math.max(0, position));
  return (
    <View style={[styles.outer, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
      <View style={[styles.box, maxWidth ? { maxWidth } : null]}>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? "暫停" : "播放"} onPress={onToggle} style={styles.btn}>
          {loading ? <LoadingLadybug size={32} /> : <Ionicons name={playing ? "pause" : "play"} size={22} color={c.text} />}
        </Pressable>
        <View style={styles.bar}>
          <SeekBar dark={overlay} value={at} max={total || 1} onSeek={onSeek} />
        </View>
        {/* 倒數剩餘時間（-12:34）。寬度依「整段長度」固定，播放中數字變動時時間軸不會跟著抖動。 */}
        <AppText variant="caption" tone="muted" numberOfLines={1} style={[styles.time, { minWidth: total >= 3600 ? 58 : 44 }]}>
          {remainingText(total - at)}
        </AppText>
        {/* 倍數播放：每按一次跳一檔（1 → 1.2 → 1.5 → 1.8 → 2 → 1）；正常速度顯示加速圖示，加速中改顯示目前倍數。 */}
        <Pressable accessibilityRole="button" accessibilityLabel={`播放速度，目前 ${rate} 倍，點一下切換`} onPress={onRate} style={styles.btnTight}>
          {rate === 1 ? (
            <Ionicons name="speedometer-outline" size={22} color={c.text} />
          ) : (
            <AppText variant="callout" style={{ color: c.accentText, fontWeight: "800" }} numberOfLines={1}>
              {rateText(rate)}
            </AppText>
          )}
        </Pressable>
        {pip ? (
          <Pressable accessibilityRole="button" accessibilityLabel="浮動小視窗" onPress={pip.onPress} style={styles.btn}>
            <Ionicons name="albums-outline" size={20} color={pip.active ? c.accentText : c.text} />
            <AppText variant="caption" tone="muted" style={styles.pipLabel} numberOfLines={1}>
              小視窗
            </AppText>
          </Pressable>
        ) : null}
        {onFullscreen ? (
          <Pressable accessibilityRole="button" accessibilityLabel="全螢幕" onPress={onFullscreen} style={styles.btnTight}>
            <Ionicons name="expand" size={20} color={c.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { borderBottomWidth: 1, alignItems: "center" },
  // 時間軸是主角：外距與按鈕間距都壓到最小，讓時間軸盡可能拉長（按鈕寬 36、高 44，圖示之間幾乎貼在一起）。
  box: { flexDirection: "row", alignItems: "center", paddingHorizontal: 2, minHeight: minTouch, width: "100%" },
  btn: { width: 36, height: minTouch, alignItems: "center", justifyContent: "center" },
  // 倍速與全螢幕兩顆貼得更近（寬度壓到 30、倍速文字不加寬），讓時間軸更長。
  btnTight: { minWidth: 30, height: minTouch, alignItems: "center", justifyContent: "center" },
  bar: { flex: 1, minWidth: 0 },
  pipLabel: { fontSize: 10, lineHeight: 12 },
  time: { textAlign: "right", fontVariant: ["tabular-nums"], paddingRight: 2 },
});
