import { FEATURES, type AchievementType } from "@/api/client";

/** 徽章條件的白話說明。 */
export function conditionText(type: AchievementType, threshold: number, courseTitle: string | null, feature?: string | null, lessonTitle?: string | null): string {
  switch (type) {
    case "lessons_completed":
      return `累計完成 ${threshold} 堂課`;
    case "courses_completed":
      return `累計學完 ${threshold} 堂課程`;
    case "courses_enrolled":
      return `累計報名 ${threshold} 堂課程`;
    case "learning_days":
      return `累計 ${threshold} 個不同的日子有學習紀錄`;
    case "comments_posted":
      return `在課程留言板留言 ${threshold} 次`;
    case "course_completed":
      return `學完「${courseTitle ?? "指定課程"}」`;
    case "feature_used": {
      const f = feature ? FEATURES[feature as keyof typeof FEATURES] : undefined;
      return f ? `${f.label}：${f.hint}` : "使用指定的網站功能";
    }
    case "lists_created":
      return `累計建立 ${threshold} 份自己的清單`;
    case "list_people":
      return `你的清單被 ${threshold} 位不同的人點開過`;
    case "material_video":
      return lessonTitle ? `讀完清單影片「${lessonTitle}」` : "讀完指定的清單影片";
    case "streak_days":
      return `連續 ${threshold} 天都有完成章節`;
    case "watch_minutes":
      return `累計完成章節的學習時間 ${threshold} 分鐘`;
    case "centers_subscribed":
      return `訂閱 ${threshold} 個中心`;
    case "subscriptions_total":
      return `訂閱中心與系列共 ${threshold} 個`;
    case "series_subscribed":
      return `訂閱 ${threshold} 個系列`;
    case "categories_explored":
      return `學習過 ${threshold} 種不同分類的課程`;
    case "early_lessons":
      return `早晨（04:00～08:00）完成 ${threshold} 堂章節`;
    case "night_lessons":
      return `夜間（22:00～04:00）完成 ${threshold} 堂章節`;
    case "weekend_lessons":
      return `週末完成 ${threshold} 堂章節`;
    case "lessons_in_a_day":
      return `單日完成 ${threshold} 堂章節`;
  }
}

/** 徽章圖示可選的表情符號。 */
export const BADGE_ICONS = ["🌱", "🌿", "🌳", "⭐", "🌟", "🏆", "🥇", "🥈", "🥉", "🎓", "📚", "📖", "📗", "🔥", "⚡", "🎯", "💬", "🗣️", "🤝", "💡", "🔔", "📺", "🏙️", "🌅", "🌙", "🏖️", "🧭", "🔍", "🚀", "💎", "👑", "🏅", "🎖️", "🎁", "🍀", "🧩"];
