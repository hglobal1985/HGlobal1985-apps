import type { Member } from "@/api/client";

/** 有任何課程管理權限（總部、該中心的會長與音控、小編）；後端每個請求仍會再檢查。 */
export const canManageCourses = (m?: Member | null): boolean => !!m?.courseRights;
/** 可以新增課程。 */
export const canCreateCourse = (m?: Member | null): boolean => !!m?.courseRights?.create;
/** 可以管理小編（總部、會長、音控）。 */
export const canManageEditors = (m?: Member | null): boolean => !!m?.courseRights?.manageEditors;
/** 超級管理員（短網址等只有超級管理員能改）。 */
export const isSuperAdmin = (m?: Member | null): boolean => !!m?.titles.includes("超級管理員");
