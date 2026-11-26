import { StyleSheet, Text, View } from "react-native";

/**
 * 卡片右下角的「教材數量」小膠囊（杜杜龍 2026-11-20：寰宇大學四大區塊、系列頁的所有卡片統一這個格式，包含日後新增的卡片）。
 * 淡灰底、只顯示數字（0 也顯示）。要改外觀只改這個檔案；新增任何卡片（中心卡、系列卡、清單卡、課程卡）都要放它。
 * 放在卡片（有 position: relative 的容器）裡面，自己定位在右下角。
 */
export function CardCount({ count, label }: { count: number; label?: string }) {
  return (
    <View style={styles.count} pointerEvents="none" accessibilityLabel={label ?? `${count}個教材`}>
      <Text style={styles.countText} {...({ dataSet: { noScale: "" } } as object)}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  count: { position: "absolute", right: 6, bottom: 6, minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(232,232,230,0.96)" },
  countText: { color: "#5A5A57", fontSize: 12, fontWeight: "700" },
});
