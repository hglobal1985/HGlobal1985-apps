import { useLocalSearchParams } from "expo-router";
import { CoursesView } from "@/features/courses/courses-view";

export default function CoursesScreen() {
  const params = useLocalSearchParams<{ category?: string; center?: string; view?: string; focus?: string }>();
  return <CoursesView initialCategory={typeof params.category === "string" ? params.category : ""} initialCenter={typeof params.center === "string" ? params.center : ""} initialCenters={params.view === "centers"} focusKey={typeof params.focus === "string" ? params.focus : ""} />;
}
