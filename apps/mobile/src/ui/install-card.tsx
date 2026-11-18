import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { installNative, isIos, useInstallState } from "@/lib/install-app";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "./text";
import { Button } from "./button";
import { BottomSheet } from "./bottom-sheet";
import { flashText } from "./flash-notice";

const KEY = "hglobal:learn:install-dismissed";
const readDismissed = () => {
  try {
    const t = Number(globalThis.localStorage?.getItem(KEY) ?? 0);
    return Date.now() - t < 7 * 24 * 3600_000; // 按「之後再說」後 7 天不再顯示
  } catch {
    return false;
  }
};

/**
 * 「加入主畫面」邀請卡（業主 2026-11-18，全站唯一來源）：只在手機網頁、還沒安裝時顯示。
 * 好處：手機推播的來源會顯示「寰宇行動大學」、開啟更快。Android 一鍵安裝；iPhone 顯示「分享 → 加入主畫面」教學。
 * dismissible＝可按 ✕ 之後再說（首頁用）；通知設定頁不可關。
 */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const { c } = useTheme();
  const { suggest, native } = useInstallState();
  const [hidden, setHidden] = useState(false);
  const [steps, setSteps] = useState(false);
  useEffect(() => setHidden(dismissible && readDismissed()), [dismissible]);
  if (!suggest || hidden) return null;
  const go = async () => {
    if (native) {
      const ok = await installNative();
      if (ok) flashText("已加入主畫面");
      return;
    }
    setSteps(true);
  };
  const dismiss = () => {
    try {
      globalThis.localStorage?.setItem(KEY, String(Date.now()));
    } catch {
      /* 沒有儲存空間就只在這次隱藏 */
    }
    setHidden(true);
  };
  const ios = isIos();
  return (
    <>
      <View style={[styles.card, { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
        <Ionicons name="phone-portrait-outline" size={28} color={c.accentText} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="callout" style={{ fontWeight: "800" }}>
            加入主畫面當 App 用
          </AppText>
          <AppText variant="caption" tone="muted">
            通知會顯示「寰宇行動大學」，開啟更快。
          </AppText>
        </View>
        <Button label="加入" onPress={go} />
        {dismissible ? (
          <Pressable accessibilityRole="button" accessibilityLabel="之後再說" onPress={dismiss} hitSlop={8} style={styles.x}>
            <Ionicons name="close" size={20} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {steps ? (
        <BottomSheet onClose={() => setSteps(false)}>
          <View style={{ gap: space.sm }}>
            <AppText variant="headline">加入主畫面</AppText>
            {ios ? (
              <>
                <AppText>1. 用 Safari 開啟本網站（不是在 LINE 或其他 App 裡）。</AppText>
                <AppText>2. 點下方的「分享」圖示（方框加向上箭頭）。</AppText>
                <AppText>3. 往下找到「加入主畫面」，按右上角「加入」。</AppText>
                <AppText variant="caption" tone="muted">
                  之後從主畫面的「寰宇行動大學」圖示開啟，才能收到手機推播（iOS 16.4 以上）。
                </AppText>
              </>
            ) : (
              <>
                <AppText>1. 點瀏覽器右上角的「⋮」選單。</AppText>
                <AppText>2. 選「加入主畫面」或「安裝應用程式」。</AppText>
                <AppText>3. 按「安裝」或「新增」，主畫面就會出現「寰宇行動大學」圖示。</AppText>
              </>
            )}
            <Button label="我知道了" onPress={() => setSteps(false)} fullWidth />
          </View>
        </BottomSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: minTouch },
  x: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
