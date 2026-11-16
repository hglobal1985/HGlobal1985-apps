import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

export type AddKind = "course" | "list";

const OPTIONS: { key: AddKind; label: string; sub?: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  // 業主 2026-11-16：「新增清單」一行，「(影片/檔案)」換行、字小一點。
  { key: "list", label: "新增清單", sub: "(影片/檔案)", icon: "list-outline" },
  { key: "course", label: "新增課程", icon: "school-outline" },
];

/**
 * 全部課程右下角的「＋新增教材」（業主 2026-11-16）：按一下往上展開兩個選項——「新增課程」與「新增清單（影片／檔案）」；
 * 點選項、點背景或再按一次按鈕都會收起。選項是大膠囊（高 52），單手拇指就按得到。
 */
export function AddMaterialFab({ onPick }: { onPick: (k: AddKind) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: 160, useNativeDriver: Platform.OS !== "web" }).start();
  }, [open, anim]);
  const pick = (k: AddKind) => {
    setOpen(false);
    onPick(k);
  };
  return (
    <>
      {open ? <Pressable accessibilityRole="button" accessibilityLabel="收起新增選單" onPress={() => setOpen(false)} style={[StyleSheet.absoluteFill, styles.scrim]} /> : null}
      <View pointerEvents="box-none" style={styles.wrap}>
        {open ? (
          <Animated.View style={[styles.menu, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
            {OPTIONS.map((o) => (
              <Pressable key={o.key} accessibilityRole="button" accessibilityLabel={`${o.label}${o.sub ?? ""}`} onPress={() => pick(o.key)} style={({ pressed }) => [styles.option, { backgroundColor: c.surface, borderColor: c.border }, pressed && { opacity: 0.8 }]}>
                <Ionicons name={o.icon} size={24} color={c.accent} />
                <View>
                  <AppText variant="headline">{o.label}</AppText>
                  {o.sub ? (
                    <AppText variant="caption" tone="muted">
                      {o.sub}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </Animated.View>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={open ? "收起新增選單" : "新增教材"} accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={[styles.fab, { backgroundColor: c.accent }]}>
          <Ionicons name={open ? "close" : "add"} size={26} color={c.textOnAccent} />
          <AppText variant="headline" style={{ color: c.textOnAccent }}>
            新增教材
          </AppText>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.45)", zIndex: 20 },
  wrap: { position: "absolute", right: space.lg, bottom: space.lg, alignItems: "flex-end", gap: space.sm, zIndex: 21 },
  menu: { alignItems: "flex-end", gap: space.sm },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  fab: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
});
