import type { CourseSummary } from "@/api/client";

/** 沒有權限時要顯示的原因（與伺服器 lockStateOf 的文字一致）：沒登入／獎銜不符／要先報名。 */
export function lockReason(course: CourseSummary, loggedIn: boolean): string {
  if (!loggedIn) return "登入並符合獎銜才能使用";
  if (!course.eligible && course.minRank && course.minRank.code !== "none") return `獎銜不符，目前無法使用（限${course.minRank.name}獎銜以上${course.allowPresident ? "，會長也可" : ""}）`;
  return "報名後才能使用";
}
