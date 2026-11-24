import type { Member } from "@/api/client";

/**
 * 能不能管理某個中心的首頁圖／EDM／課表（看的人的「權限」，跟哪個模式無關）。
 * 超派模式中心頁與至尊模式中心卡共用這一份判斷（業主 2026-11-24：兩邊模式功能要自動同步），不可在畫面裡另寫或寫死 false。
 */
export function canEditCenterArt(member: Member | null | undefined, center: string | null | undefined): boolean {
  const rights = member?.courseRights;
  if (!center || !rights) return false;
  return rights.all || (rights.center === center && (rights.manageEditors || !!rights.editor?.editOthers));
}
