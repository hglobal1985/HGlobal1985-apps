import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

/**
 * 縮圖中央的鎖頭標記（杜杜龍 2026-11-25）：搜尋結果裡「沒有權限」的課程、教材、照片也要找得到，
 * 縮圖上蓋半透明灰色＋置中鎖頭；原因文字寫在列上、點擊時再用 flashText 顯示。要放在縮圖容器最後一個子元素。
 */
export function ThumbLock({ size = 32 }: { size?: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(70,76,72,0.62)", alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="lock-closed" size={size} color="#fff" {...({ uiOnly: true } as object)} />
    </View>
  );
}
