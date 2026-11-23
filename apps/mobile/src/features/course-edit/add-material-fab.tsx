import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, dimStyle } from "@/ui";

export type AddKind = "course" | "list" | "schedule" | "announce" | "photos";

const OPTIONS: { key: AddKind; label: string; sub?: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  // 業主 2026-11-20：只剩一種「教材卡」（不再分清單卡／課程卡）。
  { key: "course", label: "新增教材卡", icon: "school-outline" },
  // 中心頁才有（業主 2026-11-21）：有權限的人在相簿、課程、清單任何一個分頁都能直接上傳照片與短影音（成為封面輪播與相簿）。
  { key: "photos", label: "上傳EDM", icon: "images-outline" },
  // 中心頁才有（業主 2026-11-21）：有權限的人直接上傳這個中心的月課表。
  { key: "schedule", label: "上傳課表", icon: "calendar-outline" },
  // 新增公告（業主 2026-11-21）：中心頁＝該中心；其他頁面由超級管理員選「目前的系列／中心」或「首頁公告」。
  { key: "announce", label: "新增公告", icon: "megaphone-outline" },
];

/**
 * 全部課程右下角的「＋新增教材」（業主 2026-11-16）：按一下往上展開兩個選項——「新增課程」與「新增清單（影片／檔案）」；
 * 點選項、點背景或再按一次按鈕都會收起。選項是大膠囊（高 52），單手拇指就按得到。
 */
export function AddMaterialFab({ onPick, kinds = ["course"] }: { onPick: (k: AddKind) => void; /** 要顯示哪些選項（預設只有新增教材卡；中心頁有權限時加上 schedule）。 */ kinds?: AddKind[] }) {
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
            {OPTIONS.filter((o) => kinds.includes(o.key)).map((o) => (
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
            {kinds.includes("course") ? "新增教材" : kinds.length === 1 ? OPTIONS.find((o) => o.key === kinds[0])!.label : "新增"}
          </AppText>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { ...dimStyle, zIndex: 20 },
  wrap: { position: "absolute", right: space.lg, bottom: space.lg, alignItems: "flex-end", gap: space.sm, zIndex: 21 },
  menu: { alignItems: "flex-end", gap: space.sm },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  fab: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.pill, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
});
