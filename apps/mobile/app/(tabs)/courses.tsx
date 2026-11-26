import { useLocalSearchParams } from "expo-router";
import { CoursesView } from "@/features/courses/courses-view";
import { ElderSearch } from "@/features/elder/elder-search";
import { useModeProfile } from "@/lib/app-mode";

export default function CoursesScreen() {
  const params = useLocalSearchParams<{ category?: string; center?: string; view?: string; focus?: string }>();
  // 至尊模式（杜杜龍 2026-11-24）：課程分頁＝大搜尋框＋全部課程大字清單。
  if (useModeProfile().courses === "bigList") return <ElderSearch mode="browse" />;
  return <CoursesView initialCategory={typeof params.category === "string" ? params.category : ""} initialCenter={typeof params.center === "string" ? params.center : ""} initialCenters={params.view === "centers"} focusKey={typeof params.focus === "string" ? params.focus : ""} />;
}
