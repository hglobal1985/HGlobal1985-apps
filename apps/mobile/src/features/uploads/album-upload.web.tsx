import { useRef, useState } from "react";
import { View } from "react-native";
import { api, apiUpload, COVER_MEDIA_MAX, type CoverMediaKind } from "@/api/client";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { useUiConfig } from "@/state/ui-config";
import { space } from "@/theme/tokens";
import { Button, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { compressVideo, probeVideo, videoCompressSupported } from "./video-compress";
import { UploadProgress } from "./upload-progress";

/**
 * 相簿／封面照片上傳（網頁版，業主 2026-11-21）：一次可選多張照片與短影音。
 * 照片先在瀏覽器壓縮（中心封面的畫質設定）；影片依「設定 › 儲存空間管理 › 封面輪播與短影音」的規範在瀏覽器內壓縮後再上傳，並擷取第一格當預覽圖。
 * 中心「相簿」、系列封面、課程封面都用這一個元件。
 */
export function AlbumUploadButton({ kind, ownerKey, count, onDone }: { kind: CoverMediaKind; ownerKey: string; count: number; onDone: () => void }) {
  const { config } = useUiConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ label: string; pct: number | null; detail?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = `kind=${kind}&key=${encodeURIComponent(ownerKey)}`;
  const spec = { maxHeight: config.app.videoMaxHeight, kbps: config.app.videoKbps, fps: config.app.videoFps, maxMb: config.app.videoMaxMb, maxSec: config.app.videoMaxSec };

  const run = async (files: File[]) => {
    setBusy(true);
    setError(null);
    let ok = 0;
    try {
      if (count + files.length > COVER_MEDIA_MAX) throw Error(`最多放 ${COVER_MEDIA_MAX} 張，目前已有 ${count} 張，這次最多還能放 ${Math.max(0, COVER_MEDIA_MAX - count)} 張`);
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
          await apiUpload("PUT", `/admin/cover-media?${q}&w=${Math.round(img.naturalWidth * s)}&h=${Math.round(img.naturalHeight * s)}`, blob, (p) => setStep({ label: `上傳照片${tag}`, pct: p }));
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
      <Button label={`上傳照片或影片（${count}/${COVER_MEDIA_MAX}）`} icon="images-outline" loading={busy} disabled={busy || count >= COVER_MEDIA_MAX} onPress={() => input.current?.click()} fullWidth />
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/heic,video/*"
        style={{ display: "none" }}
        onChange={(e) => {
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
