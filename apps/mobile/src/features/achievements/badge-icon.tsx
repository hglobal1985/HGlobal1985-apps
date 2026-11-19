import { Image } from "react-native";
import { isImageIcon } from "@/api/client";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText } from "@/ui";

/** 徽章圖：一般是表情符號；圖示代碼是圖片（目前只有 "@amway"＝安麗 A 圖示，素材影片徽章專用）就畫圖片。size 與表情符號的字級相同。 */
const IMAGES: Record<string, number> = {
  "@amway": require("../../../assets/badge-amway.png"),
};

export function BadgeIcon({
  icon,
  size,
  dim,
}: {
  icon: string;
  size: number;
  dim?: boolean;
}) {
  if (isImageIcon(icon) && IMAGES[icon]) {
    const px = Math.round(size * 1.05 * UI_SCALE);
    return (
      <Image
        source={IMAGES[icon]}
        accessibilityIgnoresInvertColors
        style={{
          width: px,
          height: px,
          borderRadius: Math.round(px * 0.18),
          opacity: dim ? 0.35 : 1,
        }}
        resizeMode="contain"
      />
    );
  }
  return (
    <AppText
      style={[
        { fontSize: size, lineHeight: Math.round(size * 1.2) },
        dim ? { opacity: 0.35 } : null,
      ]}
    >
      {icon}
    </AppText>
  );
}
