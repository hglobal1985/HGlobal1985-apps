import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import type { Member } from "@/api/client";
import { ProfilePrompt } from "./profile-prompt";

/**
 * 「完善個人資料」上拉選單的共用開關（業主 2026-11-19）：首頁與設定頁都用它。
 * 系統、中心、獎銜有缺時，每次切換進到首頁或設定頁都會自動彈出（關掉後再切換分頁會再彈出，直到填完）；
 * 點上方的個人名片也能手動開啟。要改規則只改這個檔案。
 */
export function useProfileGate(member: Member | null | undefined) {
  const [open, setOpen] = useState(false);
  const memberRef = useRef(member);
  memberRef.current = member;
  // 「這次進入畫面還沒判斷過」：App 剛開啟時，進首頁那一刻會員資料常常還沒載入（member 是空的），
  // 以前就直接略過、要切到別的分頁再回來才會彈（業主 2026-11-23）；現在資料一到就補判斷一次，之後不再因資料重新整理而彈出。
  const pending = useRef(false);
  const check = useCallback(() => {
    const m = memberRef.current;
    if (!pending.current || !m) return;
    pending.current = false;
    if (!m.demo && m.profileMissing?.length) setOpen(true);
  }, []);
  useFocusEffect(
    useCallback(() => {
      pending.current = true;
      check();
      return () => {
        pending.current = false;
      };
    }, [check]),
  );
  const memberSub = member?.sub;
  useEffect(check, [memberSub, check]);
  const element = open && member ? <ProfilePrompt onClose={() => setOpen(false)} initial={member.profileForm ?? null} /> : null;
  return { open: () => setOpen(true), element };
}

/** 這次開啟 App 已經帶去填過資料的會員（登出再登入、重新開啟 App 會再帶一次）。 */
const redirected = new Set<string>();

/**
 * 至尊模式（業主 2026-11-24）：會員資料有沒填的欄位時，每次登入後（每次開啟 App）自動跳到至尊模式頁（/mode?fill=1），
 * 頁面會標出沒填的欄位並捲到第一個（ProfilePrompt 的 focusMissing）。至尊模式不用上拉面板，所以不走 useProfileGate。
 * 判斷「缺哪些欄位」跟超派模式同一個來源（member.profileMissing）。
 */
export function useProfileRedirect(member: Member | null | undefined) {
  const sub = member && !member.demo && member.profileMissing?.length ? member.sub : null;
  useEffect(() => {
    if (!sub || redirected.has(sub)) return;
    redirected.add(sub);
    router.navigate("/mode?fill=1");
  }, [sub]);
}
