import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { centerTitle } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/** 「寰宇教育中心」清單的小卡片：中心 EDM 的 16:9 封面（沒上傳就用淡色底加中心名稱當封面），卡片正下方是放大的中心名稱（統一格式「XX教育中心」，不顯示編號與堂數）；整張可點。 */
export function CenterTile({ name, edmUrl, width, onPress }: { name: string; edmUrl?: string | null; width: number; onPress: () => void }) {
  const { c } = useTheme();
  useCenterNames();
  const title = centerTitle(name);
  const height = Math.round((width * 9) / 16);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ width }}>
      <View style={[styles.art, { width, height, backgroundColor: c.accentSoft }]}>
        {edmUrl ? (
          <Image source={{ uri: resolveUrl(edmUrl) }} style={{ width, height }} resizeMode="cover" />
        ) : (
          <AppText variant="headline" style={{ color: c.accentText, textAlign: "center", paddingHorizontal: space.sm }}>
            {title}
          </AppText>
        )}
      </View>
      <AppText variant="headline" numberOfLines={2} style={{ marginTop: 6, fontSize: 18, lineHeight: 24 }}>
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
});
