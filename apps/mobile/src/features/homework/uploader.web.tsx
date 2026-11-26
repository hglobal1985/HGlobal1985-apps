import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, apiUpload, HW_LIMITS, HW_VIDEO, type HwAssignment, type HwSubmission } from "@/api/client";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { compressVideo, probeVideo, videoCompressSupported } from "@/features/uploads/video-compress";
import { UploadProgress } from "@/features/uploads/upload-progress";
import { holdFullscreenClose, releaseFullscreenClose } from "@/lib/back-close";
import { space } from "@/theme/tokens";
import { Button, Field, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Pick = "image" | "video" | "file";
const ACCEPT: Record<Pick, string> = {
  image: "image/png,image/jpeg,image/webp,image/heic,image/heif",
  video: "video/*",
  file: ".pdf,.doc,.docx,.ppt,.pptx,.key,.xls,.xlsx,.csv,.txt,.md,.rtf,.odt,.odp,.ods,image/*",
};

/**
 * 學員繳交作業的上傳區（網頁版，杜杜龍 2026-11-25）：照片（自動壓縮）、短影片（3 分鐘內，在自己的瀏覽器壓縮後上傳）、檔案、連結。
 * 只顯示這份作業有開放的種類；按鈕大、一列兩顆，手機單手好按。
 */
export function HomeworkUploader({ assignment, mine, onChanged }: { assignment: HwAssignment; mine: HwSubmission | null; onChanged: (m: HwSubmission) => void }) {
  const inputs = { image: useRef<HTMLInputElement>(null), video: useRef<HTMLInputElement>(null), file: useRef<HTMLInputElement>(null) };
  const [step, setStep] = useState<{ label: string; pct: number | null; detail?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const busy = !!step;
  const used = mine?.files.length ?? 0;
  const room = HW_LIMITS.files - used;
  useEffect(() => {
    const els = Object.values(inputs).map((r) => r.current);
    els.forEach((el) => el?.addEventListener("cancel", releaseFullscreenClose));
    return () => els.forEach((el) => el?.removeEventListener("cancel", releaseFullscreenClose));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const base = `/homework/a/${assignment.id}/files`;
  const run = async (kind: Pick, files: File[]) => {
    setError(null);
    if (files.length > room) {
      setError(`每份作業最多 ${HW_LIMITS.files} 個檔案或連結，現在還能放 ${room} 個`);
      files = files.slice(0, Math.max(0, room));
    }
    let last: HwSubmission | null = null;
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const tag = files.length > 1 ? `（${i + 1}/${files.length}）` : "";
        const name = encodeURIComponent(f.name.slice(0, 100));
        if (kind === "video") {
          const info = await probeVideo(f);
          if (info.durationSec > HW_VIDEO.maxSec + 1) throw Error(`影片 ${Math.floor(info.durationSec / 60)} 分 ${Math.round(info.durationSec % 60)} 秒，超過 3 分鐘，請剪短一點再上傳`);
          if (!videoCompressSupported()) throw Error("這個瀏覽器不支援影片壓縮，請改用手機或電腦的 Chrome 瀏覽器上傳影片");
          const wait = `壓縮影片（約需 ${Math.max(5, Math.round(info.durationSec))} 秒，請不要離開這頁）`;
          setStep({ label: wait, pct: 0 });
          const r = await compressVideo(f, { ...HW_VIDEO }, (p) => setStep({ label: wait, pct: p }));
          const mb = `${(r.blob.size / 1048576).toFixed(1)}MB`;
          setStep({ label: "上傳影片", pct: 0, detail: mb });
          const up = await apiUpload<{ id: string; mine: HwSubmission }>("POST", `${base}?kind=video&name=${name}&w=${r.width}&h=${r.height}&dur=${Math.round(r.durationSec)}`, r.blob, (p) => setStep({ label: "上傳影片", pct: p, detail: mb }));
          last = up.mine;
          if (r.poster) await api("PUT", `/homework/files/${up.id}/poster`, r.poster).catch(() => undefined);
        } else if (kind === "image" || f.type.startsWith("image/")) {
          setStep({ label: `處理照片${tag}`, pct: null });
          const img = await loadImage(f);
          const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
          const blob = await cropCompress(img, null, 2000, 0.85);
          const up = await apiUpload<{ mine: HwSubmission }>("POST", `${base}?kind=image&name=${name}&w=${Math.round(img.naturalWidth * s)}&h=${Math.round(img.naturalHeight * s)}`, blob, (p) => setStep({ label: `上傳照片${tag}`, pct: p }));
          last = up.mine;
        } else {
          if (f.type.startsWith("video/")) throw Error("影片請按「短影片」上傳（會自動壓縮）");
          if (f.size > HW_LIMITS.fileMb * 1048576) throw Error(`「${f.name}」超過 ${HW_LIMITS.fileMb}MB`);
          setStep({ label: `上傳檔案${tag}`, pct: 0 });
          const up = await apiUpload<{ mine: HwSubmission }>("POST", `${base}?kind=file&name=${name}`, f, (p) => setStep({ label: `上傳檔案${tag}`, pct: p }));
          last = up.mine;
        }
        ok++;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(null);
      if (last) onChanged(last);
      if (ok) flashText(`已放上 ${ok} 個`);
    }
  };
  const addLink = async () => {
    setError(null);
    setStep({ label: "加入連結", pct: null });
    try {
      const r = await api<{ mine: HwSubmission }>("POST", `/homework/a/${assignment.id}/link`, { url: link });
      onChanged(r.mine);
      setLink("");
      setLinkOpen(false);
      flashText("已加入連結");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep(null);
    }
  };
  const open = (k: Pick) => {
    holdFullscreenClose();
    inputs[k].current?.click();
  };
  const has = (k: string) => assignment.kinds.includes(k as never);
  const buttons: { key: Pick | "link"; label: string; icon: "camera-outline" | "videocam-outline" | "document-outline" | "link-outline" }[] = [
    ...(has("image") ? [{ key: "image" as const, label: "照片", icon: "camera-outline" as const }] : []),
    ...(has("video") ? [{ key: "video" as const, label: "短影片", icon: "videocam-outline" as const }] : []),
    ...(has("file") ? [{ key: "file" as const, label: "檔案", icon: "document-outline" as const }] : []),
    ...(has("link") ? [{ key: "link" as const, label: "連結", icon: "link-outline" as const }] : []),
  ];
  if (!buttons.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.grid}>
        {buttons.map((b) => (
          <View key={b.key} style={styles.cell}>
            <Button variant="secondary" label={b.label} icon={b.icon} disabled={busy || room <= 0} onPress={() => (b.key === "link" ? setLinkOpen((v) => !v) : open(b.key))} fullWidth />
          </View>
        ))}
      </View>
      {has("video") ? <NoticeBox text={`短影片最長 3 分鐘，會先在你的手機裡自動壓縮再上傳（壓縮時間約等於影片長度）。`} /> : null}
      {linkOpen ? (
        <View style={{ gap: space.sm }}>
          <Field label="貼上網址" value={link} onChange={setLink} placeholder="https://youtu.be/…（例如 YouTube 不公開影片）" />
          <Button label="加入連結" icon="add" disabled={busy || !link.trim()} onPress={addLink} fullWidth />
        </View>
      ) : null}
      {(Object.keys(inputs) as Pick[]).map((k) => (
        <input
          key={k}
          ref={inputs[k]}
          type="file"
          multiple={k !== "video"}
          accept={ACCEPT[k]}
          style={{ display: "none" }}
          onChange={(e) => {
            releaseFullscreenClose();
            const fs = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (fs.length) void run(k, fs);
          }}
        />
      ))}
      {step ? <UploadProgress label={step.label} pct={step.pct} detail={step.detail} /> : null}
      {error ? <NoticeBox tone="danger" text={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  cell: { flexBasis: "47%", flexGrow: 1 },
});
