import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
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
  // 只在「進入畫面」那一刻判斷（不依賴 member 變動，才不會在使用者關掉之後因為資料重新整理又彈出）。
  useFocusEffect(
    useCallback(() => {
      const m = memberRef.current;
      if (m && !m.demo && m.profileMissing?.length) setOpen(true);
    }, []),
  );
  const element = open && member ? <ProfilePrompt onClose={() => setOpen(false)} initial={member.profileForm ?? null} /> : null;
  return { open: () => setOpen(true), element };
}
