/**
 * 行動大學 API 共用核心的總入口（杜杜龍 2026-11-27）：實際程式依功能放在 core/*.ts，這裡全部轉出。
 * 新增共用函式：放進對應的 core 檔並 export（新功能可以新增一個 core 檔，再加進下面的清單）；不要再把程式寫回這個檔案。
 */
export * from "./core/base.ts";
export * from "./core/courses.ts";
export * from "./core/course-admin.ts";
export * from "./core/orders.ts";
export * from "./core/series.ts";
export * from "./core/media.ts";
export * from "./core/library.ts";
export * from "./core/keywords.ts";
