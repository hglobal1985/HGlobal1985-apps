import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { elderTextScale } from "@/lib/elder-mode";
import { UI_SCALE } from "@/theme/ui-scale";
import type { CourseSummary } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui";

/**
 * 至尊模式「課程」頁的四大分類（業主 2026-11-24，選定 D 款：一欄四張大卡）。
 * 分類與超派模式課程頁的四個區塊一致、順序一致：寰宇課程活動、寰宇教育中心、安麗官方資源、安麗品牌館。
 * 歸類：教育中心＝centerCourse；其餘看課程的 zone（hglobal／amway_material／amway_brand）。
 * 顏色與 courses-view.tsx 的 ZONE_PALETTE 相同（綠、紅、黃、藍）；改那邊的顏色這裡要一起改。
 */
export type ElderZone = "hglobal" | "centers" | "amway_material" | "amway_brand";

export const ELDER_ZONES: { id: ElderZone; label: string; icon: "library" | "business" | "folder-open" | "pricetag"; unit: string }[] = [
  { id: "hglobal", label: "寰宇課程活動", icon: "library", unit: "項教材" },
  { id: "centers", label: "寰宇教育中心", icon: "business", unit: "項教材" },
  { id: "amway_material", label: "安麗官方資源", icon: "folder-open", unit: "項教材" },
  { id: "amway_brand", label: "安麗品牌館", icon: "pricetag", unit: "項教材" },
];

export const elderZoneOf = (x: CourseSummary): ElderZone => (x.centerCourse ? "centers" : x.zone);

const PALETTE: Record<ElderZone, Record<"light" | "dark", { bg: string; fg: string } | null>> = {
  hglobal: { light: null, dark: null }, // 用主題的淡綠
  centers: { light: { bg: "#FCE1DE", fg: "#8F1D18" }, dark: { bg: "#3B1B19", fg: "#F0A8A2" } },
  amway_material: { light: { bg: "#FFF3C4", fg: "#5A4300" }, dark: { bg: "#3A3112", fg: "#F2D675" } },
  amway_brand: { light: { bg: "#DCEBFA", fg: "#0F3D6E" }, dark: { bg: "#15283D", fg: "#8EC1F0" } },
};

export function useZoneLook(zone: ElderZone) {
  const { c, scheme } = useTheme();
  const p = PALETTE[zone][scheme];
  return { bg: p?.bg ?? c.accentSoft, fg: p?.fg ?? c.accentText };
}

/** 標題強制單行、依容器寬度與字數自動縮字（業主 2026-11-24）：畫字時會再乘「平板倍數 × 至尊倍數」，所以在放大前的尺寸上算。 */
function FitTitle({ text, color }: { text: string; color: string }) {
  const [w, setW] = useState(0);
  const k = UI_SCALE * elderTextScale();
  const size = w ? Math.max(10, Math.min(24, Math.floor(w / k / ([...text].length * 1.05)))) : 20;
  return (
    <View style={{ flex: 1, minWidth: 0 }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      <AppText numberOfLines={1} style={{ color, fontWeight: "900", fontSize: size, lineHeight: Math.round(size * 1.3) }}>
        {text}
      </AppText>
    </View>
  );
}

/** 一欄四張大卡之一：圖示、名稱、數量、箭頭；整張可點。 */
export function ElderZoneCard({ zone, count, onPress }: { zone: (typeof ELDER_ZONES)[number]; count: number; onPress: () => void }) {
  const look = useZoneLook(zone.id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${zone.label}，${count} ${zone.unit}`} onPress={onPress} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: 20, padding: space.lg, backgroundColor: look.bg, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={zone.icon} size={36} color={look.fg} {...({ uiOnly: true } as object)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <FitTitle text={zone.label} color={look.fg} />
        <AppText variant="callout" style={{ color: look.fg, fontWeight: "700" }}>
          {`${count} ${zone.unit}`}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={30} color={look.fg} {...({ uiOnly: true } as object)} />
    </Pressable>
  );
}

/** 進入某一區之後的標題列：返回鍵＋分類名稱（同色帶）。 */
export function ElderZoneHeader({ zone, onBack }: { zone: (typeof ELDER_ZONES)[number]; onBack: () => void }) {
  const look = useZoneLook(zone.id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`返回，${zone.label}`} onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: 20, padding: space.md, backgroundColor: look.bg }}>
      <Ionicons name="chevron-back" size={30} color={look.fg} {...({ uiOnly: true } as object)} />
      <FitTitle text={zone.label} color={look.fg} />
    </Pressable>
  );
}
