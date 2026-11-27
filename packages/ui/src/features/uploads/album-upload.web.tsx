import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { api, apiUpload, type CoverMediaKind, type CoverScope } from "@/api/client";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { useUiConfig } from "@/state/ui-config";
import { space } from "@/theme/tokens";
import { Button, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { holdFullscreenClose, releaseFullscreenClose } from "@/lib/back-close";
import { readPhotoMeta } from "@/features/uploads/exif-meta";
import { compressVideo, probeVideo, videoCompressSupported } from "@/features/uploads/video-compress";
import { UploadProgress } from "@/features/uploads/upload-progress";

/**
 * 相簿／封面照片上傳（網頁版，杜杜龍 2026-11-21）：一次可選多張照片與短影音。
 * 照片先在瀏覽器壓縮（中心封面的畫質設定）；影片依「設定 › 儲存空間管理 › 封面輪播與短影音」的規範在瀏覽器內壓縮後再上傳，並擷取第一格當預覽圖。
 * 中心「相簿」、系列封面、課程封面都用這一個元件。
 */
export function AlbumUploadButton({ kind, ownerKey, count, onDone, scope, label = "上傳照片或影片", folder }: { kind: CoverMediaKind; ownerKey: string; count: number; onDone: () => void; /** 按鈕文字（中心 EDM 分頁用「上傳EDM」）。 */ label?: string; /** 中心的儲存區：cover＝封面輪播照片（封面編輯）；edm＝EDM 分頁。系列、課程不用給。 */ scope?: CoverScope; /** 區塊相簿的子資料夾編號：上傳的照片直接放進這個資料夾。 */ folder?: string }) {
  const { config } = useUiConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ label: string; pct: number | null; detail?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const el = input.current;
    el?.addEventListener("cancel", releaseFullscreenClose); // 檔案選擇視窗按取消
    return () => el?.removeEventListener("cancel", releaseFullscreenClose);
  }, []);
  const q = `kind=${kind}&key=${encodeURIComponent(ownerKey)}${scope ? `&scope=${scope}` : ""}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`;
  const spec = { maxHeight: config.app.videoMaxHeight, kbps: config.app.videoKbps, fps: config.app.videoFps, maxMb: config.app.videoMaxMb, maxSec: config.app.videoMaxSec };

  const run = async (files: File[]) => {
    setBusy(true);
    setError(null);
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const tag = files.length > 1 ? `（${i + 1}/${files.length}）` : "";
        if (f.type.startsWith("video/")) {
          const info = await probeVideo(f);
          if (info.durationSec > spec.maxSec + 0.5) throw Error(`影片太長（${Math.round(info.durationSec)} 秒），上限 ${spec.maxSec} 秒`);
          if (!videoCompressSupported()) throw Error("這個瀏覽器不支援影片壓縮，請改用電腦版或手機的 Chrome 瀏覽器上傳影片");
          setStep({ label: `壓縮影片${tag}（約需 ${Math.max(5, Math.round(info.durationSec))} 秒，請不要離開）`, pct: 0 });
          const r = await compressVideo(f, spec, (p) => setStep({ label: `壓縮影片${tag}（約需 ${Math.max(5, Math.round(info.durationSec))} 秒，請不要離開）`, pct: p }));
          setStep({ label: `上傳影片${tag}`, pct: 0, detail: `${(r.blob.size / 1048576).toFixed(1)}MB` });
          const up = await apiUpload<{ id: string }>("PUT", `/admin/cover-media/video?${q}&w=${r.width}&h=${r.height}&dur=${r.durationSec}`, r.blob, (p) => setStep({ label: `上傳影片${tag}`, pct: p, detail: `${(r.blob.size / 1048576).toFixed(1)}MB` }));
          if (r.poster) await api("PUT", `/admin/cover-media/${up.id}/poster`, r.poster).catch(() => undefined);
        } else {
          setStep({ label: `處理照片${tag}`, pct: null });
          const img = await loadImage(f);
          const s = Math.min(1, config.app.centerMaxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const blob = await cropCompress(img, null, config.app.centerMaxSide, config.app.centerQuality / 100);
          const up = await apiUpload<{ id: string }>("PUT", `/admin/cover-media?${q}&w=${Math.round(img.naturalWidth * s)}&h=${Math.round(img.naturalHeight * s)}`, blob, (p) => setStep({ label: `上傳照片${tag}`, pct: p }));
          // 原始檔的 EXIF 與檔案資訊（圖片「資訊」面板用）；失敗不影響上傳。
          await api("PUT", `/admin/cover-media/${up.id}/meta`, await readPhotoMeta(f, img.naturalWidth, img.naturalHeight)).catch(() => undefined);
        }
        ok++;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStep(null);
      if (ok) {
        onDone();
        flashText(`已上傳 ${ok} 個`);
      }
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Button label={`${label}（${count}）`} icon="images-outline" loading={busy} disabled={busy} onPress={() => (holdFullscreenClose(), input.current?.click())} fullWidth />
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/heic,video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          releaseFullscreenClose();
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (fs.length) void run(fs);
        }}
      />
      {step ? <UploadProgress label={step.label} pct={step.pct} detail={step.detail} /> : null}
      {error ? <NoticeBox tone="danger" text={error} /> : null}
    </View>
  );
}
