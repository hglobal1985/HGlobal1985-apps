import { router, Stack } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";
import { type CoverMediaItem, type RecipesResponse } from "@/api/client";
import { EdmLightbox, lightboxItem } from "@/features/courses/edm-viewer";
import { RecipeEditor } from "@/features/recipes/recipe-editor";
import { RecipeDetailView } from "@/features/recipes/recipe-zone";
import { useApi } from "@/state/session";

/**
 * 單道食譜的獨立頁面（杜杜龍 2026-11-26）：網址 /前綴/流水號（例 /icook/001，前綴在「設定 › 分享預設值」）與 /recipe/食譜編號（通知、清單用）都顯示這一頁。
 * 畫面與相簿專區裡的單道食譜是同一個元件（`RecipeDetailView`）；返回＝回上一頁，沒有上一頁就回課程頁。
 */
export function RecipePage({ id: rid }: { id: string }) {
  const list = useApi<RecipesResponse>("/recipes");
  const [photos, setPhotos] = useState<{ title: string; items: CoverMediaItem[]; index: number } | null>(null);
  const [edit, setEdit] = useState(false);
  const [ver, setVer] = useState(0); // 修改完成後重新讀取這道食譜
  // 沒有上一頁（從 LINE 連結直接開啟）時前往課程頁：網頁用「整頁換成課程頁」，不靠導覽套件的 replace——
  // 杜杜龍 2026-11-26 手機實測 replace 後會立刻又退回食譜頁（有東西在背景呼叫 history.back()），整頁重新載入就不受影響。
  const leave = () => {
    if (router.canGoBack()) return router.back();
    if (Platform.OS === "web" && typeof window !== "undefined") return window.location.replace("/courses");
    router.replace("/courses");
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <RecipeDetailView key={ver} standalone id={rid} onClose={leave} onOpenPhotos={(title, items, index) => setPhotos({ title, items, index })} onChanged={list.reload} onEdit={() => setEdit(true)} />
      {edit ? <RecipeEditor id={rid} isNew={false} cats={list.data?.categories ?? []} manager={!!list.data?.manager} onCatsChanged={list.reload} onClose={() => (setEdit(false), setVer((v) => v + 1), list.reload())} /> : null}
      {photos ? <EdmLightbox uri={photos.items[photos.index]?.url ?? ""} title={photos.title} items={photos.items.map((x) => lightboxItem(x, photos.title))} index={photos.index} onClose={() => setPhotos(null)} /> : null}
    </View>
  );
}
