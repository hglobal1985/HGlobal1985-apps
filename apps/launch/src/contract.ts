/**
 * 前後端共用的資料格式總入口（杜杜龍 2026-11-27 拆檔）：實際內容依功能放在 contract/*.ts，這裡全部轉出。
 * 新增型別或常數：放進對應的 contract 檔並 export；不要再寫回這個檔案。
 */
export * from "./contract/members-courses.ts";
export * from "./contract/orders-central.ts";
export * from "./contract/media-misc.ts";
export * from "./contract/achievements.ts";
export * from "./contract/ui-config.ts";
export * from "./contract/admin.ts";
