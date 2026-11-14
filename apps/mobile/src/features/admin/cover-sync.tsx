import type { CourseSummary } from "@/api/client";

/** iOS／Android：封面同步工具只在網頁版提供。 */
export function CoverSync(_props: { courses: CourseSummary[]; onDone: () => void }) {
  return null;
}
