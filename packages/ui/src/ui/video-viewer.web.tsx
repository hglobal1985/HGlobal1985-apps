import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, View } from "react-native";
import { unstable_createElement } from "react-native-web";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBackToClose } from "@/lib/back-close";
import { useDimLayer } from "@/ui/dim-backdrop";
import { AppText } from "@/ui/text";

/**
 * 影片檢視（共用元件；杜杜龍 2026-11-27）：全黑全螢幕播放一支影片（例如老師看學員交的短影片），下方用瀏覽器內建的播放控制，右上 ✕ 關閉。
 * 瀏覽器／手機「上一頁」＝關閉（useBackToClose）。iOS／Android App 版見 video-viewer.tsx（目前用系統瀏覽器開）。
 */
export function VideoViewer({ uri, title, onClose }: { uri: string; title?: string; onClose: () => void }) {
  useDimLayer();
  useBackToClose(onClose);
  const ins = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }} {...({ dataSet: { noPullRefresh: "" } } as object)}>
        {unstable_createElement("video", { src: uri, controls: true, autoPlay: true, playsInline: true, style: { width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" } })}
        <View style={{ position: "absolute", top: ins.top + 12, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 }} pointerEvents="box-none">
          {title ? (
            <AppText numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>
              {title}
            </AppText>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Pressable accessibilityRole="button" accessibilityLabel="關閉" onPress={onClose} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
