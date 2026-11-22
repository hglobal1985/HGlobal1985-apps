import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import Svg, { Path, Rect, Text as SvgText } from "react-native-svg";
import { BRAND_ICONS, OFFICE_BADGES } from "@/lib/brand-icons";
import { useTheme } from "@/theme/theme";

/**
 * 附件類型的圖示：有官方品牌圖形的（YouTube、Vimeo、Google 簡報／文件／試算表／表單／雲端硬碟、Notion、Canva、PDF、網頁）
 * 用官方圖形與品牌色；Office 用官方色字母方塊；其餘（壓縮檔…）用通用圖示。
 */
export function BrandIcon({ type, fallback, size = 30 }: { type: string; fallback: ComponentProps<typeof Ionicons>["name"]; size?: number }) {
  const { c, scheme } = useTheme();
  const brand = BRAND_ICONS[type];
  const badge = OFFICE_BADGES[type];
  if (badge)
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Rect x={2} y={2} width={20} height={20} rx={4} fill={badge.hex} />
        <SvgText x={12} y={17.5} fontSize={14} fontWeight="700" fill="#FFFFFF" textAnchor="middle">
          {badge.letter}
        </SvgText>
      </Svg>
    );
  // YouTube 一律用標準綠色三角形（業主 2026-11-22：全網不再出現紅色 YouTube 標誌）。
  if (type === "youtube")
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
        <Path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z" fill={c.accent} />
      </Svg>
    );
  if (!brand) return <Ionicons name={fallback} size={size} color={c.accent} />;
  // 黑色的品牌（Notion）在深色模式改用文字色，才看得到。
  const fill = brand.hex.toLowerCase() === "#000000" ? c.text : brand.hex;
  void scheme;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d={brand.path} fill={fill} />
    </Svg>
  );
}
