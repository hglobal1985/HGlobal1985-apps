import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { absoluteUrl, shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, ShareIcon, TopBarButton } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";

/**
 * 上方工具列「＋邀請」（業主 2026-11-20；在分享鈕的左邊，全站可分享的內容頁都放）：
 * 按下去從下方彈出面板：這一頁的 QR Code、網址文字、複製、分享（系統分享選單）。
 * QR Code 在手機上自己產生（不連外部服務、不洩漏網址）。要改外觀只改這個檔案；新增可分享的頁面，在它的上方工具列放 HeaderInvite。
 */
export function HeaderInvite({ title, path }: { title: string; path: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TopBarButton label="＋邀請" accessibilityLabel="邀請：顯示這一頁的 QR Code 與網址" tone="accent" onPress={() => setOpen(true)} />
      {open ? <InviteSheet title={title} path={path} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InviteSheet({ title, path, onClose }: { title: string; path: string; onClose: () => void }) {
  const { c } = useTheme();
  const url = absoluteUrl(path);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(url);
      flashText("已複製連結");
    } catch {
      flashText("無法複製，請長按網址自行複製");
    }
  };
  const share = async () => {
    const r = await shareLink(title, path);
    if (r === "copied") flashText("已複製連結");
  };
  return (
    <BottomSheet onClose={onClose}>
      <View style={styles.body}>
        <AppText variant="headline" style={{ textAlign: "center" }} numberOfLines={2}>
          邀請朋友：{title}
        </AppText>
        <QrCode value={url} size={220} />
        <AppText variant="callout" selectable style={{ textAlign: "center", paddingHorizontal: space.md }}>
          {url}
        </AppText>
        <View style={styles.row}>
          {Platform.OS === "web" ? (
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="複製網址" icon="copy-outline" onPress={copy} fullWidth />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="分享" onPress={share} style={[styles.shareBtn, { backgroundColor: c.accent }]}>
              <ShareIcon size={20} color="#fff" />
              <AppText variant="headline" style={{ color: "#fff" }}>
                分享
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

/** QR Code（白底黑點，四周留白；用 SVG 畫，手機與網頁都一樣清楚）。 */
export function QrCode({ value, size }: { value: string; size: number }) {
  // QR 產生器（約 20KB）只有打開邀請面板才下載（2026-11-21 載入速度優化）；下載完之前先顯示白色方塊。
  const [cells, setCells] = useState<{ n: number; d: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      if (alive) setCells({ n, d });
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [value]);
  if (!cells) return <View style={{ width: size, height: size, backgroundColor: "#fff", borderRadius: 12 }} accessibilityLabel="QR Code 產生中" />;
  const quiet = 2;
  const box = cells.n + quiet * 2;
  return (
    <View style={{ width: size, height: size, backgroundColor: "#fff", borderRadius: 12 }} accessibilityLabel="QR Code">
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`}>
        <Rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
        <Path d={cells.d} fill="#000" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: "center", gap: space.md, paddingVertical: space.md },
  shareBtn: { minHeight: minTouch, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  row: { flexDirection: "row", gap: space.sm, alignSelf: "stretch", paddingHorizontal: space.md },
});
