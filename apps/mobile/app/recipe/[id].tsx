import { useLocalSearchParams } from "expo-router";
import { RecipePage } from "@/features/recipes/recipe-page";

/** /recipe/食譜編號：通知、「加入我的清單」連到這裡（對外分享用 /icook/流水號 短網址，見 `[slug]/[name].tsx`）。 */
export default function RecipeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecipePage id={String(id ?? "")} />;
}
