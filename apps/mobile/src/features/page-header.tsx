import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { HeaderInvite } from "./invite-button";
import { HeaderShare } from "./share-button";

/**
 * 有「分享」的頁面共用的上方工具列：標題＋靠右「分享圖示＋分享」文字按鈕。
 * 課程詳細頁、短網址頁（分類／系列）、系列頁都用這一個；要改工具列的分享區，只改這個檔案與 share-button.tsx，
 * 返回鍵、高度、陰影等整體樣式則在 app/_layout.tsx 的 screenOptions，全站一起連動。
 * path＝要分享的網址路徑（有短網址就傳 /縮寫）。extra＝放在分享左邊的按鈕（例如管理者的「編輯」）。
 */
/** course＝單堂課程的分享（主講人與課程名稱會帶進分享文字範本）；list＝清單卡的分享（清單範本）；其他頁面不傳。 */
/** backTo＝直接從分享網址進來（沒有上一頁）時，返回鍵要去的上一層頁面（例如課程 → 主辦中心專屬頁）。 */
export function PageHeader({ title, path, shareTitle, extra, course, list, backTo, backAlways }: { backAlways?: boolean; title: string; path: string; shareTitle?: string; extra?: ReactNode; course?: { teacher: string; teacherTitle?: string; title: string }; list?: { title: string }; backTo?: string }) {
  return (
    <Stack.Screen
      options={{
        title,
        ...({ backTo, backAlways } as object),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {extra}
            <HeaderInvite title={shareTitle ?? title} path={path} />
            <HeaderShare title={shareTitle ?? title} path={path} course={course} list={list} />
          </View>
        ),
      }}
    />
  );
}
