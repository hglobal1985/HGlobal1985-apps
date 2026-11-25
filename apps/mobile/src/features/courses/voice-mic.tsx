import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet } from "react-native";
import { useVoice } from "@/features/elder/use-voice";
import { useTheme } from "@/theme/theme";
import { minTouch } from "@/theme/tokens";
import { flashText } from "@/ui/flash-notice";

/**
 * 超派模式搜尋框的麥克風鈕（業主 2026-11-25）：按一下用說的找課程，與至尊模式同一個語音辨識模組（`useVoice`，中文台灣、連續聽、停頓 4 秒自動送出）。
 * 聽到的字即時填進搜尋框；聽的時候鈕變紅色（再按一次＝停止）。瀏覽器不支援語音辨識時，提示用鍵盤上的麥克風。
 */
export function VoiceMic({ onText, onUnsupported }: { onText: (t: string) => void; onUnsupported?: () => void }) {
  const { c } = useTheme();
  const voice = useVoice((text) => text && onText(text));
  const press = () => {
    if (voice.listening) return voice.stop();
    if (!voice.start()) {
      onUnsupported?.();
      flashText("請按鍵盤上的麥克風說話");
    }
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={voice.listening ? "停止語音搜尋" : "用說的搜尋"} onPress={press} hitSlop={6} style={[styles.btn, voice.listening && { backgroundColor: c.danger }]}>
      <Ionicons name={voice.listening ? "stop" : "mic"} size={22} color={voice.listening ? "#fff" : c.accentText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: minTouch - 2, height: minTouch - 2, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
