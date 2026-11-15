import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { api, resolveUrl, type Attachment } from "@/api/client";
import { AppText, type IconName } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 依附件類型顯示圖示與說明文字（類型由伺服器依網域／副檔名判斷）。 */
export const TYPE_INFO: Record<Attachment["type"], { icon: IconName; label: string }> = {
  youtube: { icon: "logo-youtube", label: "YouTube 影片" },
  vimeo: { icon: "logo-vimeo", label: "Vimeo 影片" },
  canva: { icon: "color-palette-outline", label: "Canva 簡報" },
  google_slides: { icon: "easel-outline", label: "Google 簡報" },
  google_docs: { icon: "document-text-outline", label: "Google 文件" },
  google_sheets: { icon: "grid-outline", label: "Google 試算表" },
  google_forms: { icon: "clipboard-outline", label: "Google 表單" },
  google_drive: { icon: "logo-google", label: "Google 雲端硬碟" },
  notion: { icon: "book-outline", label: "Notion 頁面" },
  web: { icon: "globe-outline", label: "網頁連結" },
  pdf: { icon: "document-text", label: "PDF" },
  word: { icon: "document-outline", label: "Word" },
  ppt: { icon: "easel-outline", label: "PowerPoint" },
  excel: { icon: "grid-outline", label: "Excel／CSV" },
  zip: { icon: "archive-outline", label: "壓縮檔" },
  image: { icon: "image-outline", label: "圖片" },
  text: { icon: "reader-outline", label: "文字檔" },
  file: { icon: "document-attach-outline", label: "檔案" },
};
export const subtitleOf = (a: Attachment) => `${TYPE_INFO[a.type].label}${a.kind === "file" ? `・${sizeText(a.size)}` : ""}`;

/** 學員：上課頁的附件教材（只有已開通學員拿得到連結）。沒有附件時不顯示。 */
export function AttachmentList({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { c } = useTheme();
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems([]);
    setError(null);
    api<Attachment[]>("GET", `/courses/${courseId}/lessons/${lessonId}/attachments`)
      .then(setItems)
      .catch(() => undefined);
  }, [courseId, lessonId]);
  if (!items.length) return null;
  // 只顯示圖示＋下方的標題（自訂標題，沒自訂就是類型名稱），靠右對齊，與章節標題同一列。
  return (
    <View style={styles.wrap}>
      {items.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="link"
          accessibilityLabel={a.name}
          disabled={!a.url}
          onPress={() => Linking.openURL(a.kind === "link" ? a.url! : resolveUrl(a.url!)).catch(() => setError("無法開啟連結"))}
          style={styles.item}
        >
          <BrandIcon type={a.type} fallback={TYPE_INFO[a.type].icon as never} />
          <AppText variant="caption" numberOfLines={1} style={{ color: c.text, fontSize: 11, lineHeight: 14, textAlign: "center" }}>
            {a.name}
          </AppText>
        </Pressable>
      ))}
      {error ? <AppText variant="caption" style={{ color: c.danger }}>{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "flex-end", gap: space.sm, flexShrink: 0, maxWidth: "55%" },
  item: { width: 64, alignItems: "center", justifyContent: "flex-end", gap: 2 },
});
