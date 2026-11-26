import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { type CoverMediaItem, type RecipesResponse } from "@/api/client";
import { EdmLightbox, lightboxItem } from "@/features/courses/edm-viewer";
import { RecipeEditor } from "@/features/recipes/recipe-editor";
import { RecipeDetailView } from "@/features/recipes/recipe-zone";
import { useApi } from "@/state/session";

/**
 * 單道食譜的網址 /recipe/食譜編號（杜杜龍 2026-11-26）：分享連結、「加入我的清單」、投稿通知都連到這裡。
 * 畫面與相簿專區裡的單道食譜是同一個元件（`RecipeDetailView`）；返回＝回上一頁，沒有上一頁就回課程頁。
 */
export default function RecipeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rid = String(id ?? "");
  const list = useApi<RecipesResponse>("/recipes");
  const [photos, setPhotos] = useState<{ title: string; items: CoverMediaItem[]; index: number } | null>(null);
  const [edit, setEdit] = useState(false);
  const [ver, setVer] = useState(0); // 修改完成後重新讀取這道食譜
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/courses"));
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <RecipeDetailView key={ver} id={rid} onClose={leave} onOpenPhotos={(title, items, index) => setPhotos({ title, items, index })} onChanged={list.reload} onEdit={() => setEdit(true)} />
      {edit ? <RecipeEditor id={rid} isNew={false} cats={list.data?.categories ?? []} manager={!!list.data?.manager} onCatsChanged={list.reload} onClose={() => (setEdit(false), setVer((v) => v + 1), list.reload())} /> : null}
      {photos ? <EdmLightbox uri={photos.items[photos.index]?.url ?? ""} title={photos.title} items={photos.items.map((x) => lightboxItem(x, photos.title))} index={photos.index} onClose={() => setPhotos(null)} /> : null}
    </View>
  );
}
