import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { resolveUrl, type BrandCover as Brand } from "@/api/client";
import { useTheme } from "@/theme/theme";

/**
 * 品牌 logo 封面（業主 2026-11-18）：底圖（優先）或底色（沒設定＝白色）＋ logo 置中、四周留安全距離（完整顯示不裁切）。
 * 課程與素材勾選「使用品牌 logo 作為封面」且分類對得到品牌時，所有顯示封面／EDM 的地方都用它。
 * fill＝填滿父層；否則 16:9。
 * 深色模式底色（業主 2026-11-18）：使用者切換成深色模式、而且品牌有設定深色底色時，改用深色底色（優先於底色與底圖）；
 * 所有品牌 logo 出現的地方都用這個元件，所以全站一起套用。scheme 只給後台預覽用（強制看淺色／深色的樣子）。
 */
export function BrandCover({ brand, fill, style, scheme }: { brand: Brand; fill?: boolean; style?: StyleProp<ViewStyle>; scheme?: "light" | "dark" }) {
  const theme = useTheme();
  const dark = (scheme ?? theme.scheme) === "dark" && !!brand.bgColorDark;
  return (
    <View style={[fill ? StyleSheet.absoluteFill : styles.ratio, { backgroundColor: dark ? brand.bgColorDark! : brand.bgColor ?? "#fff", overflow: "hidden" }, style]} accessibilityRole="image" accessibilityLabel="品牌封面">
      {brand.bgUrl && !dark ? <Image source={{ uri: resolveUrl(brand.bgUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <Image source={{ uri: resolveUrl(brand.logoUrl) }} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  ratio: { width: "100%", aspectRatio: 16 / 9 },
  logo: { position: "absolute", top: "12%", bottom: "12%", left: "12%", right: "12%", width: "76%", height: "76%" },
});
