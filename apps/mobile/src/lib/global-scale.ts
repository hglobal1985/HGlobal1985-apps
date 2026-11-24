import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, TextInput } from "react-native";
import { UI_SCALE } from "@/theme/ui-scale";

/**
 * 全站字體與圖示統一放大（倍數見 theme/ui-scale.ts）：在 Text、TextInput、Ionicons 這三個最底層元件上，
 * 把 fontSize、lineHeight、圖示 size 乘上倍數。這樣不論畫面是用 AppText 還是直接寫 Text，都一起放大，不會漏掉。
 * 圖片上的文字（例如緞帶）加 dataSet={{ noScale: "" }} 就不放大。手機倍數是 1，什麼都不做。要在根版面最早 import。
 */
type AnyFn = (...a: never[]) => unknown;
// 不跟著手機系統的「字體放大／輔助使用」變大（業主 2026-11-24 永久指示）：App 版面一律照 App 自己的尺寸，系統設定不可影響。
for (const C of [Text, TextInput] as unknown as { defaultProps?: Record<string, unknown> }[]) C.defaultProps = { ...C.defaultProps, allowFontScaling: false, maxFontSizeMultiplier: 1 };
if (UI_SCALE !== 1) {
  const scaled = (style: unknown) => {
    const f = StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;
    if (!f || (f.fontSize == null && f.lineHeight == null)) return style;
    const o = { ...f };
    if (typeof o.fontSize === "number") o.fontSize = Math.round(o.fontSize * UI_SCALE);
    if (typeof o.lineHeight === "number") o.lineHeight = Math.round(o.lineHeight * UI_SCALE);
    return o;
  };
  for (const C of [Text, TextInput] as unknown as { render?: AnyFn }[]) {
    const orig = C.render as unknown as (p: { style?: unknown; dataSet?: { noScale?: unknown } }, r: unknown) => unknown;
    if (typeof orig === "function") C.render = ((p: { style?: unknown; dataSet?: { noScale?: unknown } }, r: unknown) => orig(p.dataSet && p.dataSet.noScale !== undefined ? p : { ...p, style: scaled(p.style) }, r)) as unknown as AnyFn;
  }
  const proto = (Ionicons as unknown as { prototype: { render: () => unknown; props: { size?: number } } }).prototype;
  const origIcon = proto.render;
  proto.render = function (this: { props: { size?: number } }) {
    const self = Object.create(this);
    Object.defineProperty(self, "props", { value: { ...this.props, size: Math.round((this.props.size ?? 12) * UI_SCALE) } });
    return origIcon.call(self);
  };
}
