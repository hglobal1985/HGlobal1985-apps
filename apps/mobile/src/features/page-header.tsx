import { Stack } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { HeaderInvite } from "./invite-button";
import { HeaderAddToList } from "./my-lists/add-to-list";
import type { ListRef } from "./my-lists/store";

/**
 * 有「分享」的頁面共用的上方工具列：標題＋靠右按鈕；分享功能收在「邀請」面板裡（業主 2026-11-21：上方工具列不再有獨立的分享鈕）。
 * 課程詳細頁、短網址頁（分類／系列）、系列頁都用這一個；要改工具列的按鈕，只改這個檔案，
 * 返回鍵、高度、陰影等整體樣式則在 app/_layout.tsx 的 screenOptions，全站一起連動。
 * path＝要分享的網址路徑（有短網址就傳 /縮寫）。extra＝放在分享左邊的按鈕（例如管理者的「編輯」）。
 */
/** course＝單堂課程的分享（主講人與課程名稱會帶進分享文字範本）；list＝清單卡的分享（清單範本）；其他頁面不傳。 */
/** backTo＝直接從分享網址進來（沒有上一頁）時，返回鍵要去的上一層頁面（例如課程 → 主辦中心專屬頁）。 */
/** addToList＝這一頁可以「加入我的清單」的內容（課程卡、教材卡、系列卡…），工具列會多一顆清單圖示（業主 2026-11-21）。 */
export function PageHeader({ title, path, shareTitle, extra, course, list, backTo, backAlways, addToList }: { addToList?: ListRef; backAlways?: boolean; title: string; path: string; shareTitle?: string; extra?: ReactNode; course?: { teacher: string; teacherTitle?: string; title: string }; list?: { title: string }; backTo?: string }) {
  return (
    <Stack.Screen
      options={{
        title,
        ...({ backTo, backAlways } as object),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {extra}
            {addToList ? <HeaderAddToList target={addToList} title={shareTitle ?? title} /> : null}
            <HeaderInvite title={shareTitle ?? title} path={path} course={course} list={list} />
          </View>
        ),
      }}
    />
  );
}
