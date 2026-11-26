import { useEffect } from "react";
import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FLASH_ICON, showFlash } from "@/ui/flash-notice";
import { useApi, useSession } from "@/state/session";
import type { LibraryMine, LibraryView } from "@/api/client";
import { LoadingView } from "@/ui";
import { useLibraryChrome } from "@/lib/library-mode";
import { lazyPart } from "@/lib/lazy-part";

// 書櫃畫面用到才下載（與短網址的書櫃頁共用同一包，2026-11-21）。
const view = () => import("./library-view");
const LibraryScreen = lazyPart(view, "LibraryScreen", <LoadingView />);
const Shelves = lazyPart(view, "Shelves", <LoadingView />);

/**
 * 設定 › 我的書櫃 的主畫面（杜杜龍 2026-11-17）：所有登入會員點進來都看到同一套木質書架介面；
 * 有書櫃鑰匙的人＝自己的書櫃（右上角齒輪進入設定）；沒有鑰匙的人＝空書架預覽，操作（齒輪）只提示「尚未解鎖書櫃鑰匙」。
 * 所有設定功能（名稱、密碼、書架與書的管理）都集中在齒輪裡（app/library-settings.tsx）。
 */
export function LibraryHome() {
  useLibraryChrome();
  useEffect(() => trackFeature("bookshelf_view"), []);
  const { member } = useSession();
  const { data, loading } = useApi<LibraryMine>("/library/mine");
  if (loading && !data) return <LoadingView />;
  if (data?.library) return <LibraryScreen number={data.library.number} />;
  const k = data?.keys;
  const how = k ? `獲得任意 ${k.need} 枚徽章就能解鎖（你目前 ${k.have} 枚）` : "獲得任意 100 枚徽章就能解鎖";
  const view: LibraryView = { number: "", title: "我的書櫃", ownerName: member?.name ?? "", locked: false, lockExpired: false, owner: false, items: [] };
  return <Shelves view={view} number="" tokens={{}} onTokens={() => undefined} onGear={() => showFlash({ icon: <Ionicons name="key" size={FLASH_ICON - 3} color="#B28A3E" />, title: "尚未解鎖書櫃鑰匙", body: k?.blocked ?? how })} emptyText={`🔑 你尚未解鎖書櫃鑰匙\n${k?.blocked ?? how}`} />;
}
