import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl, type HwFile } from "@/api/client";
import { EdmLightbox } from "@/features/courses/edm-viewer";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { HwVideo } from "./hw-video";

const ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = { file: "document-text-outline", link: "link-outline" };
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/** 一份作業裡的檔案：照片三張一列（點了放大、左右滑）、短影片直接播放、檔案與連結點了打開；可以刪的時候右邊有 ×。 */
export function HwFiles({ files, onRemove, title }: { files: HwFile[]; onRemove?: (f: HwFile) => void; title: string }) {
  const { c } = useTheme();
  const [zoom, setZoom] = useState<number | null>(null);
  const imgs = files.filter((f) => f.kind === "image");
  const others = files.filter((f) => f.kind !== "image");
  const x = (f: HwFile) =>
    onRemove ? (
      <Pressable accessibilityRole="button" accessibilityLabel={`移除 ${f.name}`} onPress={() => onRemove(f)} hitSlop={8} style={[styles.remove, { backgroundColor: c.dangerSoft }]}>
        <Ionicons name="close" size={20} color={c.danger} />
      </Pressable>
    ) : null;
  return (
    <View style={{ gap: space.sm }}>
      {imgs.length ? (
        <View style={styles.grid}>
          {imgs.map((f, i) => (
            <View key={f.id} style={styles.cell}>
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={`放大看 ${f.name}`} onPress={() => setZoom(i)} style={[styles.thumb, { backgroundColor: c.surfaceMuted }]}>
                <Image source={{ uri: resolveUrl(f.url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
              {onRemove ? <View style={styles.cornerX}>{x(f)}</View> : null}
            </View>
          ))}
        </View>
      ) : null}
      {others.map((f) =>
        f.kind === "video" ? (
          <View key={f.id} style={{ gap: space.xs }}>
            <HwVideo url={f.url} poster={f.posterUrl} />
            <View style={styles.row}>
              <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
                {f.name}・{Math.floor(f.durationSec / 60)} 分 {f.durationSec % 60} 秒・{mb(f.size)}
              </AppText>
              {x(f)}
            </View>
          </View>
        ) : (
          <View key={f.id} style={[styles.fileRow, { borderColor: c.border, backgroundColor: c.surface }]}>
            <Pressable accessibilityRole="link" accessibilityLabel={`打開 ${f.name}`} onPress={() => void Linking.openURL(resolveUrl(f.url))} style={styles.fileMain}>
              <Ionicons name={ICON[f.kind] ?? "document-outline"} size={26} color={c.accentText} />
              <View style={{ flex: 1 }}>
                <AppText variant="callout" numberOfLines={2} style={{ fontWeight: "700" }}>
                  {f.name}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {f.kind === "link" ? f.url : `${mb(f.size)}・點一下打開`}
                </AppText>
              </View>
            </Pressable>
            {x(f)}
          </View>
        ),
      )}
      {zoom != null && imgs[zoom] ? <EdmLightbox uri={imgs[zoom]!.url} title={title} items={imgs.map((f) => ({ uri: f.url, title: f.name, id: f.id }))} index={zoom} onClose={() => setZoom(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cell: { width: "31.5%" },
  thumb: { aspectRatio: 3 / 4, borderRadius: radius.sm, overflow: "hidden" },
  cornerX: { position: "absolute", top: 4, right: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  fileRow: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingRight: space.sm },
  fileMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: minTouch },
  remove: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
