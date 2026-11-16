import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { useTheme } from "@/theme/theme";

/**
 * 章節清單裡「正在播放這一則」的圖示：實心三角形（主色），像呼吸一樣放大縮小＋變淡再變回來，一直循環。
 * 主講章節播放中時也用它（學士帽換成這個統一的三角形）。
 */
export function NowPlayingIcon({ size = 36 }: { size?: number }) {
  const { c } = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  // 只有一個小圖示，用 JS 驅動（網頁與手機都確定會動）。0 → 0.5 → 1：縮放 1 → 1.14 → 1、透明度 1 → 0.6 → 1
  const scale = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.14, 1] });
  const opacity = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.6, 1] });
  return (
    <Animated.View style={{ transform: [{ scale }], opacity }} accessibilityLabel="正在播放">
      <Ionicons name="play-circle" size={size} color={c.accent} />
    </Animated.View>
  );
}
