import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { space } from "@/theme/tokens";
import { AppText } from "./text";

/**
 * 「沒有權限」的鎖頭遮罩（業主 2026-11-21 要求做成全站唯一的模組元件）：
 * 半透明灰色色塊蓋住整個內容區（章節、教材清單），一個大鎖頭＋文字**靠上對齊**（不置中，因為教材可能很長）。
 * 用法：放在一個 `position: relative`、有最小高度的容器裡當最後一個子元素；`lines` 是文字（一行一個）；
 * 有傳 `onPress` 時整片遮罩可點（例如系列頁展開內容：點了進該課程頁）。要改顏色、鎖頭大小、對齊只改這個檔案。
 */
export function LockMask({ lines, onPress, label }: { lines: string[]; onPress?: () => void; label?: string }) {
  const body = (
    <>
      <Ionicons name="lock-closed" size={48} color="#fff" />
      {lines.map((t, i) => (
        <AppText key={i} variant={i === 0 ? "title" : "headline"} style={{ color: "#fff", textAlign: "center" }}>
          {t}
        </AppText>
      ))}
    </>
  );
  const accessibilityLabel = label ?? lines.join("，");
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.mask, pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  ) : (
    <Pressable accessibilityRole="alert" accessibilityLabel={accessibilityLabel} disabled style={styles.mask}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mask: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, backgroundColor: "rgba(70,76,72,0.72)", alignItems: "center", justifyContent: "flex-start", gap: space.sm, padding: space.md, paddingTop: space.xl },
});
