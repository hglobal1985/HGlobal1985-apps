import type { CenterArt } from "@/api/client";
import { ArtUploader } from "./art-uploader.web";

/** 中心首頁圖（舊稱 EDM；業主 2026-11-17 改名）：只是共用「封面上傳模組」（art-uploader）的設定，流程與畫面都在那一個檔案。 */
export function CenterEdm({ center, art, onChanged }: { center: string; art?: CenterArt | null; onChanged: () => void }) {
  const q = `?center=${encodeURIComponent(center)}`;
  return <ArtUploader label="中心" noun="首頁圖" art={art} endpoints={{ edm: `/admin/center-art${q}`, cover: `/admin/center-art/cover${q}` }} onChanged={onChanged} />;
}
