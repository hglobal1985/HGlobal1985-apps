import Ionicons from "@expo/vector-icons/Ionicons";
import { FLASH_ICON, showFlash } from "@/ui/flash-notice";
import { useApi, useSession } from "@/state/session";
import type { LibraryMine, LibraryView } from "@/api/client";
import { LoadingView } from "@/ui";
import { LibraryScreen, Shelves } from "./library-view";

/**
 * 設定 › 我的圖書館 的主畫面（業主 2026-11-17）：所有登入會員點進來都看到同一套木質書架介面；
 * 有圖書館鑰匙的人＝自己的圖書館（右上角齒輪進入設定）；沒有鑰匙的人＝空書架預覽，操作（齒輪）只提示「尚未解鎖圖書館鑰匙」。
 * 所有設定功能（名稱、密碼、書架與書的管理）都集中在齒輪裡（app/library-settings.tsx）。
 */
export function LibraryHome() {
  const { member } = useSession();
  const { data, loading } = useApi<LibraryMine>("/library/mine");
  if (loading && !data) return <LoadingView />;
  if (data?.library) return <LibraryScreen number={data.library.number} />;
  const view: LibraryView = { number: "", title: "我的圖書館", ownerName: member?.name ?? "", locked: false, lockExpired: false, owner: false, items: [] };
  return <Shelves view={view} number="" tokens={{}} onTokens={() => undefined} onGear={() => showFlash({ icon: <Ionicons name="key" size={FLASH_ICON - 3} color="#B28A3E" />, title: "尚未解鎖圖書館鑰匙", body: "請向超級管理員索取邀請網址" })} emptyText="🔑 你尚未解鎖圖書館鑰匙" />;
}
