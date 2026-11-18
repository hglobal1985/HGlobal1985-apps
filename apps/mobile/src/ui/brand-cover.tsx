import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { resolveUrl, type BrandCover as Brand } from "@/api/client";

/**
 * 品牌 logo 封面（業主 2026-11-18）：底圖（優先）或底色（沒設定＝白色）＋ logo 置中、四周留安全距離（完整顯示不裁切）。
 * 課程與素材勾選「使用品牌 logo 作為封面」且分類對得到品牌時，所有顯示封面／EDM 的地方都用它。
 * fill＝填滿父層；否則 16:9。
 */
export function BrandCover({ brand, fill, style }: { brand: Brand; fill?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[fill ? StyleSheet.absoluteFill : styles.ratio, { backgroundColor: brand.bgColor ?? "#fff", overflow: "hidden" }, style]} accessibilityRole="image" accessibilityLabel="品牌封面">
      {brand.bgUrl ? <Image source={{ uri: resolveUrl(brand.bgUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <Image source={{ uri: resolveUrl(brand.logoUrl) }} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  ratio: { width: "100%", aspectRatio: 16 / 9 },
  logo: { position: "absolute", top: "12%", bottom: "12%", left: "12%", right: "12%", width: "76%", height: "76%" },
});
