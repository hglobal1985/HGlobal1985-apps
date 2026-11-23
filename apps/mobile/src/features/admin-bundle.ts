/**
 * 管理者專用編輯工具的「整包」：features/admin-parts.tsx 一律從這裡下載（2026-11-21）。
 * 為什麼要整包：打包工具會把「被兩個以上的按需下載包共用」的檔案搬回主程式（每個人都要下載），
 * 全部經由同一個入口就只有一包，學員完全不必下載。要讓新的管理者元件用到才下載：在這裡加一行 export，再到 admin-parts.tsx 加一行。
 */
export { EdmManager } from "@/features/admin/edm-manager";
export { SectionList, SectionSheet } from "@/features/course-edit/course-sections";
export { NewMaterialSheet } from "@/features/course-edit/material-sheet";
export { BlockEditList, EditLessonRows, LessonSheet, MoveToBlockSheet, NewLessonSheet, PickMaterialsSheet, SectionTitleSheet, YoutubeLengthFix } from "@/features/course-edit/lessons";
export { NewCourseSheet } from "@/features/course-edit/new-course";
export { CenterEditSheet, CenterScheduleSheet } from "@/features/admin/center-edit-sheet";
export { TimeRangePicker } from "@/features/uploads/time-range-picker";
export { ThumbBadgeEditor } from "@/features/admin/thumb-badge-editor";
export { SeriesEdm } from "@/features/admin/series-edm";
export { SeriesCoverSheet } from "@/features/admin/series-cover-sheet";
export { SeriesApplySheet } from "@/features/courses/series-apply-sheet";
