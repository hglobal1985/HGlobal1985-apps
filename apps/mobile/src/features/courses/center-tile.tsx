import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/** 「中心」模式的小卡片：中心 EDM 的 16:9 封面（沒上傳就用淡色底加中心名稱當封面），中心名稱與堂數另外寫在卡片正下方；整張可點。 */
export function CenterTile({ name, edmUrl, count, width, onPress }: { name: string; edmUrl?: string | null; count: number; width: number; onPress: () => void }) {
  const { c } = useTheme();
  const height = Math.round((width * 9) / 16);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}，${count} 堂`} onPress={onPress} style={{ width, opacity: count ? 1 : 0.6 }}>
      <View style={[styles.art, { width, height, backgroundColor: c.accentSoft }]}>
        {edmUrl ? (
          <Image source={{ uri: resolveUrl(edmUrl) }} style={{ width, height }} resizeMode="cover" />
        ) : (
          <AppText variant="headline" style={{ color: c.accentText, textAlign: "center", paddingHorizontal: space.sm }}>
            {name}
          </AppText>
        )}
      </View>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
        {name}・{count} 堂
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
});
