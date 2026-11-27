import { useFocusEffect } from "expo-router";
import { useBorderW } from "@/lib/elder-mode";
import { useCallback, useState } from "react";
import Svg, { Circle, Rect } from "react-native-svg";
import { Pressable, StyleSheet, View } from "react-native";
import { APP_NAME } from "@/lib/app-assets";
import { deviceNoun, installNative, isIos, isIpad, likelyInstalledAndroid, useInstallState } from "@/lib/install-app";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "./text";
import { Icon } from "./icon";
import { Button } from "./button";
import { BottomSheet } from "./bottom-sheet";
import { flashText } from "./flash-notice";

/** 與 App 內建瀏覽器警示條同一組紅色（in-app-banner.tsx）。 */
const RED = "#B3261E";
/**
 * 「加入主畫面」邀請卡（杜杜龍 2026-11-18，全站唯一來源）：只在手機與平板網頁（含 iPad）、還沒安裝時顯示。
                   * 好處：手機推播的來源會顯示「App」、開啟更快。Android 一鍵安裝；iPhone、iPad 顯示「分享 → 加入主畫面」教學。
 * dismissible＝可按 ✕ 先關掉這一次（首頁用）；通知設定頁不可關。
 */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const { c } = useTheme();
  const bw = useBorderW(2);
  const { suggest, native } = useInstallState();
  const [hidden, setHidden] = useState(false);
  const [steps, setSteps] = useState(false);
  // ✕ 只是這一次先關掉：重新進入首頁（回到畫面、重新開啟網站）會再出現，直到安裝為止（杜杜龍 2026-11-18）。
  useFocusEffect(
    useCallback(() => {
      setHidden(false);
    }, []),
  );
  if (!suggest || hidden) return null;
  const go = async () => {
    // 先試一鍵安裝（Android 會等安裝許可最多 3 秒）；真的不行（iPhone、或使用者剛取消）才顯示手動教學。
    if (!native && !isIos()) flashText("準備安裝中…");
    const ok = await installNative();
    if (ok === null) setSteps(true);
    else if (ok) flashText("已加入主畫面");
  };
  const dismiss = () => setHidden(true);
  const ios = isIos();
  return (
    <>
      <View style={[styles.card, { backgroundColor: c.dangerSoft, borderColor: RED, borderWidth: bw }]}>
        <PhoneAppIcon size={34} color={RED} />
        {/* 一行文字，空間不夠時自動換行（杜杜龍 2026-11-18） */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText style={styles.title}>安裝至{deviceNoun()}主畫面變成app</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="安裝" onPress={go} style={styles.btn}>
          <AppText style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>安裝</AppText>
        </Pressable>
        {dismissible ? (
          <Pressable accessibilityRole="button" accessibilityLabel="先關閉這一次" onPress={dismiss} hitSlop={8} style={styles.x}>
            <Icon name="close" size={30} color={RED} />
          </Pressable>
        ) : null}
      </View>
      {steps ? (
        <BottomSheet onClose={() => setSteps(false)}>
          <View style={{ gap: space.sm }}>
            <AppText variant="headline">加入主畫面</AppText>
            {!ios && likelyInstalledAndroid() ? (
              <AppText style={{ fontWeight: "800", color: RED }}>{`這支手機可能已經安裝過了（例如從超派模式裝過）：請直接從手機桌面點「${APP_NAME}」圖示開啟，就是 App 版。若桌面找不到，再照下面步驟安裝。`}</AppText>
            ) : null}
            {ios ? (
              <>
                <AppText>1. 用 Safari 開啟本網站（不是在 LINE 或其他 App 裡）。</AppText>
                <AppText>{isIpad() ? "2. 點網址列右邊的「分享」圖示（方框加向上箭頭）。" : "2. 點下方的「分享」圖示（方框加向上箭頭）。"}</AppText>
                <AppText>3. 往下找到「加入主畫面」，按右上角「加入」。</AppText>
                <AppText variant="caption" tone="muted">
                  {`之後從主畫面的「${APP_NAME}」圖示開啟，才能收到手機推播（iOS 16.4 以上）。`}
                </AppText>
              </>
            ) : (
              <>
                <AppText>1. 點瀏覽器右上角的「⋮」選單。</AppText>
                <AppText>2. 選「加入主畫面」或「安裝應用程式」。</AppText>
                <AppText>{`3. 按「安裝」或「新增」，主畫面就會出現「${APP_NAME}」圖示。`}</AppText>
              </>
            )}
            <Button label="我知道了" onPress={() => setSteps(false)} fullWidth />
          </View>
        </BottomSheet>
      ) : null}
    </>
  );
}

/** 手機輪廓＋桌面上排好的 App 小點點（杜杜龍 2026-11-18）：示意「裝到手機主畫面」。 */
function PhoneAppIcon({ size, color }: { size: number; color: string }) {
  const dots = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ x: 8.5 + c * 5, y: 8.5 + r * 5.5 })));
  return (
    <Svg width={size * 0.7} height={size} viewBox="0 0 24 34" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x="1.5" y="1.5" width="21" height="31" rx="4.5" fill="none" stroke={color} strokeWidth="2.2" />
      <Rect x="9" y="3.6" width="6" height="1.6" rx="0.8" fill={color} />
      {dots.map((d, i) => (
        <Circle key={i} cx={d.x + 1} cy={d.y + 2} r="1.7" fill={color} />
      ))}
      <Rect x="9.5" y="28.4" width="5" height="1.4" rx="0.7" fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 2, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: minTouch },
  title: { color: RED, fontWeight: "800", fontSize: 15, lineHeight: 22 },
  btn: { minHeight: minTouch, paddingHorizontal: 14, borderRadius: 14, backgroundColor: RED, alignItems: "center", justifyContent: "center" },
  // 與首頁公告跑馬燈的 ✕ 同尺寸、同粗細、同位置（ticker.tsx）。
  x: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -space.sm },
});
