import { Image, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { resolveUrl } from "@/api/client";
import { centerTitle } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { AppText } from "@/ui";

/**
 * 「寰宇教育中心」清單的卡片：整張 16:10 的圖，中心名稱（統一格式「XX中心」）用白字壓在左下角的暗色漸層上，名稱只出現一次、貼著卡片底部（七個中文字以內不換行，減少遮住照片）；
 * 有上傳 EDM 就用照片，沒有就用品牌綠色漸層底，兩種長得一樣。整張可點。
 */
export function CenterTile({ name, edmUrl, width, onPress }: { name: string; edmUrl?: string | null; width: number; onPress: () => void }) {
  useCenterNames();
  const title = centerTitle(name);
  const height = Math.round((width * 10) / 16);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[styles.card, { width, height }]}>
      {edmUrl ? (
        <Image source={{ uri: resolveUrl(edmUrl) }} style={{ width, height }} resizeMode="cover" />
      ) : (
        <Gradient id="brand" from="#2F5D3A" to="#4C8A5B" fromOpacity={1} toOpacity={1} diagonal />
      )}
      <Gradient id="shade" from="#000000" to="#000000" fromOpacity={0} toOpacity={0.6} startY={0.62} />
      <View style={styles.label} pointerEvents="none">
        <AppText numberOfLines={2} style={styles.name}>
          {title}
        </AppText>
      </View>
    </Pressable>
  );
}

/** 鋪滿整張卡的漸層（react-native-svg，網頁與 App 都支援）。 */
function Gradient({ id, from, to, fromOpacity, toOpacity, diagonal = false, startY = 0 }: { id: string; from: string; to: string; fromOpacity: number; toOpacity: number; diagonal?: boolean; startY?: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1={diagonal ? "0" : "0"} y1={diagonal ? "0" : String(startY)} x2={diagonal ? "1" : "0"} y2="1">
          <Stop offset="0" stopColor={from} stopOpacity={fromOpacity} />
          <Stop offset="1" stopColor={to} stopOpacity={toOpacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, overflow: "hidden", backgroundColor: "#2F5D3A" },
  label: { position: "absolute", left: 10, right: 8, bottom: 6 },
  name: { color: "#FFFFFF", fontSize: 16, lineHeight: 20, fontWeight: "600", letterSpacing: 0.3 },
});
