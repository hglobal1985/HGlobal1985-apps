// react-native-web 沒有附型別：只宣告共用元件用到的部分（video-viewer.web.tsx）。
declare module "react-native-web" {
  export function unstable_createElement(type: string, props?: Record<string, unknown>): import("react").ReactElement;
}
