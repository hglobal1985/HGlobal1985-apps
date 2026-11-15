import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/** 「中心」模式的小卡片：中心 EDM（沒上傳就用中心名稱當大標題），下方寫中心名稱與課程數；整張可點。 */
export function CenterTile({ name, edmUrl, count, width, onPress }: { name: string; edmUrl?: string | null; count: number; width: number; onPress: () => void }) {
  const { c } = useTheme();
  const height = Math.round((width * 9) / 16);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}，${count} 門課`} onPress={onPress} style={{ width }}>
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
        {name}・{count} 門課
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
});
