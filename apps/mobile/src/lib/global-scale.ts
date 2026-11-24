import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, TextInput } from "react-native";
import { UI_SCALE } from "@/theme/ui-scale";
import { elderTextScale, getElder } from "./elder-mode";

/**
 * 全站字體與圖示統一放大（倍數見 theme/ui-scale.ts）：在 Text、TextInput、Ionicons 這三個最底層元件上，
 * 把 fontSize、lineHeight、圖示 size 乘上倍數。這樣不論畫面是用 AppText 還是直接寫 Text，都一起放大，不會漏掉。
 * 圖片上的文字（例如緞帶）加 dataSet={{ noScale: "" }} 就不放大。手機倍數是 1，什麼都不做。要在根版面最早 import。
 * 至尊模式（業主 2026-11-24，lib/elder-mode.ts）：再乘上至尊模式的字體倍數（可自訂、可跟著手機系統字體）；
 * 底部主選單這類固定版面的文字加 dataSet={{ uiOnly: "" }}、圖示加 uiOnly 屬性，只吃平板／電腦倍數、不吃至尊倍數。
 */
type AnyFn = (...a: never[]) => unknown;
// 不跟著手機系統的「字體放大／輔助使用」變大（業主 2026-11-24 永久指示）：App 版面一律照 App 自己的尺寸，系統設定不可影響。
for (const C of [Text, TextInput] as unknown as { defaultProps?: Record<string, unknown> }[]) C.defaultProps = { ...C.defaultProps, allowFontScaling: false, maxFontSizeMultiplier: 1 };
{
  /** 全部倍數＝平板／電腦倍數 × 至尊模式倍數（每次畫字時讀，切換模式後重建畫面就會用新倍數）。 */
  const full = () => UI_SCALE * elderTextScale();
  const scaled = (style: unknown, k: number, bold = false) => {
    if (k === 1 && !bold) return style;
    const f = StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;
    if (!f || (f.fontSize == null && f.lineHeight == null)) return style;
    const o = { ...f };
    // 至尊模式「文字加粗」：一般（400～500）的字一律加到 700，原本就粗的不動。
    if (bold && (o.fontWeight == null || o.fontWeight === "normal" || o.fontWeight === "400" || o.fontWeight === "500" || o.fontWeight === 400 || o.fontWeight === 500)) o.fontWeight = "700";
    if (typeof o.fontSize === "number") o.fontSize = Math.round(o.fontSize * k);
    if (typeof o.lineHeight === "number") o.lineHeight = Math.round(o.lineHeight * k);
    return o;
  };
  type P = { style?: unknown; dataSet?: { noScale?: unknown; uiOnly?: unknown } };
  for (const C of [Text, TextInput] as unknown as { render?: AnyFn }[]) {
    const orig = C.render as unknown as (p: P, r: unknown) => unknown;
    if (typeof orig === "function")
      C.render = ((p: P, r: unknown) => {
        if (p.dataSet && p.dataSet.noScale !== undefined) return orig(p, r);
        const ui = p.dataSet && p.dataSet.uiOnly !== undefined;
        const k = ui ? UI_SCALE : full();
        const bold = !ui && getElder().on && getElder().bold;
        return orig(k === 1 && !bold ? p : { ...p, style: scaled(p.style, k, bold) }, r);
      }) as unknown as AnyFn;
  }
  // 圖示：外層把 size 乘平板／電腦倍數，裡面的字型圖示（Text）再由上面的 Text 規則放大一次（平板原本就是這樣，維持不變）。
  // 至尊模式倍數只在裡面的 Text 乘一次；uiOnly 的圖示把標記傳給裡面的 Text，就不吃至尊倍數。
  const proto = (Ionicons as unknown as { prototype: { render: () => unknown; props: { size?: number; uiOnly?: boolean } } }).prototype;
  const origIcon = proto.render;
  proto.render = function (this: { props: { size?: number; uiOnly?: boolean } }) {
    if (UI_SCALE === 1 && !this.props.uiOnly) return origIcon.call(this);
    const self = Object.create(this);
    const { uiOnly, ...rest } = this.props;
    Object.defineProperty(self, "props", { value: { ...rest, size: Math.round((this.props.size ?? 12) * UI_SCALE), ...(uiOnly ? { dataSet: { uiOnly: "" } } : null) } });
    return origIcon.call(self);
  };
}
