import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { usePlayer } from "@/features/player/use-player";
import { useTheme } from "@/theme/theme";

/**
 * 章節清單裡「這一列是目前選的章節」的圖示，狀態一律以全站播放器的實際狀態為準（與下方播放控制列同一份資料）：
 * - 播放器真的在播這一堂：實心三角形（主色）像呼吸一樣放大縮小＋變淡再變回來。
 * - 這一堂播放過又暫停：動畫停止、改成暫停圖示。
 * - 還沒開始播放（載入中、手機瀏覽器擋掉自動播放、播放器還在換上一堂）：靜止的三角形——不是暫停，也不會誤用上一堂的狀態。
 * lessonId＝這一列的章節編號；播放器的目前章節不是它時，一律當作「還沒開始」。
 */
export function NowPlayingIcon({ size = 36, lessonId }: { size?: number; lessonId?: string }) {
  const { c } = useTheme();
  const s = usePlayer();
  const mine = !lessonId || s.track?.lessonId === lessonId;
  const live = mine && s.playing;
  // 「播放過」只在同一次載入（loadId）內有效：換章節、關閉播放後自動歸零，不會把上一堂的狀態帶過來。
  const played = useRef({ load: -1, ever: false });
  if (live) played.current = { load: s.loadId, ever: true };
  const paused = mine && !s.playing && played.current.ever && played.current.load === s.loadId;
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) {
      t.setValue(0); // 沒在播：動畫停住，回到原本大小
      return;
    }
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [t, live]);
  // 0 → 0.5 → 1：縮放 1 → 1.14 → 1、透明度 1 → 0.6 → 1（只有一個小圖示，用 JS 驅動；網頁上 useNativeDriver:true 實測不會動）
  const scale = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.14, 1] });
  const opacity = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.6, 1] });
  return (
    <Animated.View style={{ transform: [{ scale }], opacity }} accessibilityLabel={paused ? "已暫停" : live ? "正在播放" : "準備播放"}>
      <Ionicons name={paused ? "pause-circle" : "play-circle"} size={size} color={c.accent} />
    </Animated.View>
  );
}
