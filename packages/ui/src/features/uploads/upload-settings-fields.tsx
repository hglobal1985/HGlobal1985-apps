import { View } from "react-native";
import type { SharedUploadSettings } from "../../../../server-shared/src/upload-settings";
import { space } from "@/theme/tokens";
import { Chips } from "@/ui/chips";
import { Stepper } from "@/ui/stepper";
import { AppText } from "@/ui/text";

/**
 * 上傳壓縮設定的欄位（共用元件；杜杜龍 2026-11-26：行動大學與繳作業系統的照片、影片畫質用同一份設定，任一邊改另一邊自動跟上）。
 * 值的正本在 Cloudflare KV（packages/server-shared/src/upload-settings.ts）。
 */
export function UploadSettingsFields({ value, onChange }: { value: SharedUploadSettings; onChange: (v: SharedUploadSettings) => void }) {
  const set = (p: Partial<SharedUploadSettings>) => onChange({ ...value, ...p });
  return (
    <View style={{ gap: space.lg }}>
      <AppText variant="headline">照片</AppText>
      <Stepper label="照片長邊" hint="上傳的圖片長邊縮到這個像素以內（作業照片、封面、教材圖片；預設 1024）" value={value.imageMaxSide} min={400} max={4096} step={128} unit="px" onChange={(n) => set({ imageMaxSide: n })} />
      <Stepper label="照片畫質" hint="數字越大畫質越好、檔案越大（預設 88）" value={value.imageQuality} min={30} max={100} step={1} unit="%" onChange={(n) => set({ imageQuality: n })} />
      <Stepper label="中心首頁圖長邊" hint="中心封面要特別清楚，建議比一般高（預設 2048）" value={value.centerMaxSide} min={800} max={4096} step={128} unit="px" onChange={(n) => set({ centerMaxSide: n })} />
      <Stepper label="中心首頁圖畫質" hint="數字越大畫質越好、檔案越大（預設 95）" value={value.centerQuality} min={30} max={100} step={1} unit="%" onChange={(n) => set({ centerQuality: n })} />
      <Stepper label="EDM 海報長邊" hint="海報上有小字與 QR code，建議維持高一點（預設 2048）" value={value.edmMaxSide} min={800} max={4096} step={128} unit="px" onChange={(n) => set({ edmMaxSide: n })} />
      <Stepper label="EDM 海報畫質" hint="數字越大畫質越好、檔案越大（預設 90）" value={value.edmQuality} min={30} max={100} step={1} unit="%" onChange={(n) => set({ edmQuality: n })} />
      <AppText variant="headline">影片（在上傳者的瀏覽器裡壓縮）</AppText>
      <Chips title="影片畫面高度" options={[{ key: "480", label: "480p" }, { key: "720", label: "720p" }, { key: "1080", label: "1080p" }]} value={String(value.videoMaxHeight)} onChange={(k) => set({ videoMaxHeight: Number(k) as SharedUploadSettings["videoMaxHeight"] })} />
      <Stepper label="影片位元率" hint="數字越大畫質越好、檔案越大（預設 2500）" value={value.videoKbps} min={500} max={8000} step={100} unit="kbps" onChange={(n) => set({ videoKbps: n })} />
      <Stepper label="影片每秒格數" hint="30 最順，24 較省空間（預設 30）" value={value.videoFps} min={15} max={60} step={5} unit="fps" onChange={(n) => set({ videoFps: n })} />
    </View>
  );
}
