import { lazyPart, preload } from "@/lib/lazy-part";

/**
 * 只有管理者（編輯課程、中心、系列）才會用到的畫面，集中在這裡「用到才下載」（2026-11-21 載入速度優化）。
 * 一般學員開網站時不用下載這些編輯工具（約 200KB 程式），網站開得比較快。
 *
 * 規則：頁面要用下面任何一個編輯元件，一律從這個檔案 import，不要直接 import 原本的檔案，
 * 否則它又會被打包回每個人都要下載的主程式。新增管理者專用的大型面板時，在 admin-bundle.ts 與這裡各加一行。
 */
const bundle = () => import("./admin-bundle"); // 全部經由同一包（原因見 admin-bundle.ts）

// 課程／清單頁的編輯模式（app/course/[id].tsx）
export const EdmManager = lazyPart(bundle, "EdmManager");
export const SectionList = lazyPart(bundle, "SectionList");
export const SectionSheet = lazyPart(bundle, "SectionSheet");
export const NewMaterialSheet = lazyPart(bundle, "NewMaterialSheet");
export const BlockEditList = lazyPart(bundle, "BlockEditList");
export const EditLessonRows = lazyPart(bundle, "EditLessonRows");
export const LessonSheet = lazyPart(bundle, "LessonSheet");
export const MoveToBlockSheet = lazyPart(bundle, "MoveToBlockSheet");
export const PickMaterialsSheet = lazyPart(bundle, "PickMaterialsSheet");
export const NewLessonSheet = lazyPart(bundle, "NewLessonSheet");
export const SectionTitleSheet = lazyPart(bundle, "SectionTitleSheet");
export const YoutubeLengthFix = lazyPart(bundle, "YoutubeLengthFix");

// 寰宇大學／中心頁（features/courses/courses-view.tsx）
export const NewCourseSheet = lazyPart(bundle, "NewCourseSheet");
export const CenterEditSheet = lazyPart(bundle, "CenterEditSheet");

// 書櫃（features/library/library-manage.tsx）、關鍵字管理（app/admin/keywords.tsx）
export const TimeRangePicker = lazyPart(bundle, "TimeRangePicker");
export const SeriesEdm = lazyPart(bundle, "SeriesEdm");

// 系列頁（features/courses/series-page.tsx）
export const SeriesCoverSheet = lazyPart(bundle, "SeriesCoverSheet");
export const SeriesApplySheet = lazyPart(bundle, "SeriesApplySheet");

/** 有管理權限的人進入課程頁時，先在背景下載課程編輯工具（按「編輯」時立刻出現）。 */
export const preloadCourseEditor = () => preload(bundle);
