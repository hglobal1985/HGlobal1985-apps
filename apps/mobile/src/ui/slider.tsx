import { useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch } from "@/theme/tokens";

/**
 * 滑桿（杜杜龍 2026-11-18 起品牌 logo 底色的「變淡」「色彩飽和度」用）：value 0～1；手指按住左右拖曳或點一下就即時變化，不需要精準點小圓點。
 * 觸控區高 minTouch、圓點直徑 26。要改滑桿外觀只改這個檔案。
 */
export function Slider({ value, onChange, label, trackColor }: { value: number; onChange: (v: number) => void; label: string; trackColor?: string }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(1);
  const geo = useRef({ left: 0, width: 1 });
  geo.current.width = width;
  const cb = useRef(onChange);
  cb.current = onChange;
  const frac = (pageX: number) => Math.min(1, Math.max(0, (pageX - geo.current.left) / geo.current.width));
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        geo.current.left = e.nativeEvent.pageX - e.nativeEvent.locationX;
        cb.current(frac(e.nativeEvent.pageX));
      },
      onPanResponderMove: (e) => cb.current(frac(e.nativeEvent.pageX)),
    }),
  ).current;
  return (
    <View style={styles.touch} onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} {...responder.panHandlers}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: trackColor ?? c.border }]}>
        <View style={{ height: 8, borderRadius: 4, width: `${value * 100}%`, backgroundColor: c.accent }} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${value * 100}%`, backgroundColor: c.accent, borderColor: c.surface }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: minTouch, justifyContent: "center", marginHorizontal: 13 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  thumb: { position: "absolute", width: 26, height: 26, borderRadius: 13, borderWidth: 3, marginLeft: -13 },
});
