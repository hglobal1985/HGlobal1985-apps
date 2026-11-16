import { Redirect, useLocalSearchParams } from "expo-router";
import { lessonHref } from "@/lib/lesson-href";

/** 舊的「上課頁」網址（LINE 分享、書籤、通知）：章節現在在課程介紹頁原地播放（業主 2026-11-16），自動轉過去並播放該堂。 */
export default function LessonRedirect() {
  const { courseId, lessonId } = useLocalSearchParams<{ courseId: string; lessonId: string }>();
  return <Redirect href={lessonHref(courseId, lessonId) as never} />;
}
