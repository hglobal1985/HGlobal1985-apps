import { trackUsage } from "@/lib/usage";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useThumb } from "@/lib/thumb";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { resolveUrl } from "@/api/client";
import { centerTitle } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useThumbBadge } from "@/lib/thumb-badges";
import { AppText, ThumbBadgeView } from "@/ui";
import { CardCount } from "@/ui/card-count";

/**
 * 「寰宇教育中心」清單的卡片：整張 16:10 的圖，中心名稱（統一格式「XX中心」）用白字壓在左下角的暗色漸層上，名稱只出現一次、強制一行不換行（杜杜龍 2026-11-21；白字加黑色半透明文字陰影，杜杜龍 2026-11-17：照片亮時才看得清楚）、貼著卡片底部；右下角教材數量標籤在最上層，可蓋住名稱；
 * 有上傳 EDM 就用照片，沒有就用品牌綠色漸層底，兩種長得一樣。整張可點。
 */
export function CenterTile({ name, edmUrl, width, count, onPress }: { name: string; edmUrl?: string | null; width: number; count?: number; onPress: () => void }) {
  const thumb = useThumb();
  useCenterNames();
  const title = centerTitle(name);
  const badge = useThumbBadge("center", name);
  const height = Math.round((width * 10) / 16);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => (trackUsage("card_center", name), onPress())} style={[styles.card, { width, height }, edmUrl ? { backgroundColor: "#fff" } : null]}>
      {edmUrl ? (
        <Image source={{ uri: thumb(resolveUrl(edmUrl), width) }} style={{ width, height }} resizeMode="cover" />
      ) : badge ? (
        <ThumbBadgeView symbol={badge.symbol} fg={badge.fg} bg={badge.bg} />
      ) : (
        <Gradient id="brand" from="#2F5D3A" to="#4C8A5B" fromOpacity={1} toOpacity={1} diagonal />
      )}
      <Gradient id="shade" from="#000000" to="#000000" fromOpacity={0} toOpacity={0.7} startY={0.5} />
      <View style={styles.label} pointerEvents="none">
        <AppText numberOfLines={1} style={styles.name}>
          {title}
        </AppText>
      </View>
      {/* 教材數量標籤放在最上層、可以蓋住中心名稱（杜杜龍 2026-11-21）；名稱強制一行，不換行。 */}
      {count !== undefined ? <CardCount count={count} /> : null}
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
  name: { color: "#FFFFFF", fontSize: 16, lineHeight: 20, fontWeight: "700", letterSpacing: 0.3, textShadowColor: "rgba(0,0,0,0.75)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
});
