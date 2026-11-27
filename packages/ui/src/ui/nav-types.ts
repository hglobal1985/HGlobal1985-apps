import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";

export type NavIconName = ComponentProps<typeof Ionicons>["name"];

/**
 * 底部主選單的一個分頁（共用 BottomBar 用；每個 App 在自己的 src/lib/nav-tabs.tsx 列出分頁）。
 * key 要和該 App 模式設定檔（lib/app-mode.tsx）的 tabs 一樣，BottomBar 才會依至尊／超派模式顯示對的分頁。
 */
export type NavTab = {
  key: string;
  href: string;
  title: string;
  /** 讀屏用的名稱（沒給就用 title）。 */
  a11y?: string;
  icon: NavIconName;
  active: NavIconName;
  /** 自訂圖示（例如行動大學的建築物圖示）。 */
  renderIcon?: (size: number, color: string, on: boolean) => ReactNode;
  /** 目前網址是不是屬於這個分頁（決定黃色膠囊亮在哪）。 */
  match: (path: string) => boolean;
  /** 自訂點擊行為（沒給就是直接前往 href）。on＝目前已經在這個分頁。 */
  onPress?: (on: boolean) => void;
};
