import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, resolveUrl } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { space } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { useSheetSave } from "@/features/course-edit/edit-sheet";
import { EdmCropper } from "./edm-cropper.web";
import { CoverModePicker, defaultCoverMode, type CoverMode } from "./cover-mode.web";
import { useUiConfig } from "@/state/ui-config";
import { EDM_MAX_SIDE, composeContain, cropCompress, loadImage, loadImageUrl, type Rect } from "./image-tools";

const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
type Job = { img: HTMLImageElement; src: string; isNew: boolean; cover: Rect; mode: CoverMode };

/** 預設的 16:9 封面裁切框：水平垂直置中、盡量大。 */
function defaultCover(img: HTMLImageElement): Rect {
  const w = Math.min(img.naturalWidth, (img.naturalHeight * 16) / 9);
  const h = (w * 9) / 16;
  // 垂直置中：一般照片與海報的主角多半在中間（業主 2026-11-15）。
  return { x: Math.round((img.naturalWidth - w) / 2), y: Math.max(0, Math.round((img.naturalHeight - h) / 2)), w: Math.round(w), h: Math.round(h) };
}
/** 以封面框（占 EDM 寬高的比例）還原成像素。 */
function rectFrom(img: HTMLImageElement, r: { x: number; y: number; w: number }): Rect {
  const w = Math.round(r.w * img.naturalWidth);
  const h = Math.round((w * 9) / 16);
  return { x: Math.round(r.x * img.naturalWidth), y: Math.min(Math.round(r.y * img.naturalHeight), Math.max(0, img.naturalHeight - h)), w, h };
}

/** 封面與 EDM 的目前狀態（中心與系列共用同一個形狀）。 */
export type ArtInfo = { edmUrl: string; coverUrl?: string | null; coverRect?: { x: number; y: number; w: number } | null; edmViewY: number };

/**
 * 封面上傳模組（網頁版；業主 2026-11-16：中心、系列……所有「上傳 EDM 並裁切 16:9 封面」一律用這一個）：
 * 上傳整張海報後，自己拖曳裁切一個 16:9 的「封面」（或選「完整顯示」）。這個框同時決定兩處：清單卡片縮圖，以及進入頁面時 EDM 一開始停留的位置（＝框的上緣）；
 * 做法與課程 EDM 相同。圖片在瀏覽器內壓縮，不保留原始檔案。
 * endpoints.edm＝上傳 EDM（PUT）／調整框（PATCH）／移除（DELETE）共用的網址；endpoints.cover＝上傳封面（PUT）的網址。想改裁切流程或加功能，只改這個檔案。
 */
export function ArtUploader({ label, art, endpoints, onChanged, noun = "EDM", center = false }: { /** 中心封面照片：壓縮用「中心封面照片」設定（比一般高畫質；設定 › 儲存空間管理）。 */ center?: boolean; /** 這張圖的名稱：中心叫「首頁圖」、系列叫「EDM」（業主 2026-11-17）。 */ noun?: string; label: string; art?: ArtInfo | null; endpoints: { edm: string; cover: string }; onChanged: () => void }) {
  const { config } = useUiConfig();
  // 壓縮規格兩類（業主 2026-11-18）：中心封面照片＝高畫質；其餘＝一般。
  const coverSide = center ? config.app.centerMaxSide : config.app.imageMaxSide;
  const quality = (center ? config.app.centerQuality : config.app.imageQuality) / 100;
  const input = useRef<HTMLInputElement | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 在編輯面板裡：「儲存封面」登記到面板下方與「取消」同一列（業主 2026-11-17），不再在內文裡另放按鈕。
  const inSheet = useSheetSave(job ? { label: "儲存封面", onPress: () => void save(), busy, dirty: true } : null);

  useEffect(() => {
    if (!job) return setPreview(null);
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const blob = job.mode === "contain" ? await composeContain(job.img, 640, 0.75) : await cropCompress(job.img, job.cover, 640, 0.75);
        if (!dead) setPreview(URL.createObjectURL(blob));
      } catch {
        /* 預覽失敗不影響儲存 */
      }
    }, 200);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [job?.img, job?.cover, job?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg("讀取圖片中…");
    try {
      const img = await loadImage(file);
      setJob({ img, src: img.src, isNew: true, cover: defaultCover(img), mode: defaultCoverMode(img) });
      setMsg(null);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  /** 不換圖，只重新調整目前 EDM 的封面與預設位置。 */
  const adjust = async () => {
    if (!art) return;
    setBusy(true);
    setMsg(`讀取${noun}中…`);
    try {
      const img = await loadImageUrl(resolveUrl(art.edmUrl));
      const cover = art.coverRect ? rectFrom(img, art.coverRect) : { ...defaultCover(img), y: Math.min(Math.round(art.edmViewY * img.naturalHeight), Math.max(0, img.naturalHeight - defaultCover(img).h)) };
      setJob({ img, src: img.src, isNew: false, cover, mode: "crop" });
      setMsg(null);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!job) return;
    setBusy(true);
    setMsg("處理並上傳中…");
    try {
      if (job.isNew) await api("PUT", endpoints.edm, await cropCompress(job.img, null, center ? Math.max(EDM_MAX_SIDE, coverSide) : EDM_MAX_SIDE, center ? quality : 0.9));
      // 完整顯示：封面是「整張照片＋淡模糊背景」合成圖，預設停留位置固定在最上緣。
      const contain = job.mode === "contain";
      await api("PUT", endpoints.cover, contain ? await composeContain(job.img, coverSide, quality) : await cropCompress(job.img, job.cover, coverSide, quality));
      await api("PATCH", endpoints.edm, { coverRect: contain ? { x: 0, y: 0, w: 1 } : { x: job.cover.x / job.img.naturalWidth, y: job.cover.y / job.img.naturalHeight, w: job.cover.w / job.img.naturalWidth } });
      setJob(null);
      setMsg(null);
      flashText(`已更新${label}${noun}`);
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: `移除${label}${noun}`, message: `移除後，這個${label}就不顯示${noun}。`, confirmLabel: "移除", cancelLabel: "先不要", danger: true }))) return;
    setBusy(true);
    try {
      await api("DELETE", endpoints.edm);
      onChanged();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.wrap}>
      {!job ? (
        <>
          {art ? (
            <img src={resolveUrl(art.coverUrl ?? art.edmUrl)} alt={`${label}${noun}`} style={{ width: "100%", maxWidth: 320, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, display: "block" }} />
          ) : null}
          <AppText variant="caption" tone="muted">
            上傳後可以自己拖曳裁切 16:9 的封面：框內就是清單卡片的縮圖，也是進入頁面時一開始看到的位置。可選 JPG、PNG、WebP、HEIC，上傳時自動壓縮。
          </AppText>
          <View style={styles.buttons}>
            <Button label={art ? `更換${noun}` : `上傳${noun}`} icon="image-outline" loading={busy} disabled={busy} onPress={() => input.current?.click()} />
            {art ? <Button variant="secondary" label="調整裁切位置" icon="crop-outline" disabled={busy} onPress={adjust} /> : null}
            {art ? <Button variant="ghost" label={`移除${noun}`} disabled={busy} onPress={remove} /> : null}
          </View>
        </>
      ) : (
        <>
          <AppText variant="headline">指定封面</AppText>
          <CoverModePicker mode={job.mode} img={job.img} onChange={(mode) => setJob({ ...job, mode })} />
          <AppText variant="callout" tone="muted">
            {job.mode === "contain" ? "整張照片都會保留，放在中間，背景用同一張照片模糊補滿。確認預覽後請按「儲存封面」。" : "拖曳框內移動位置，拖四個角調整大小（橫式 16:9，比例固定）。框內就是中心卡片的縮圖，框的上緣就是進入中心頁時一開始停留的位置。調整好請按「儲存封面」。"}
          </AppText>
          {inSheet ? null : (
            <View style={styles.buttons}>
              <Button variant="cancel" label="取消" disabled={busy} onPress={() => (setJob(null), setMsg(null))} />
              <Button label="儲存封面" icon="save-outline" loading={busy} disabled={busy} onPress={save} />
            </View>
          )}
          {job.mode === "crop" ? <EdmCropper src={job.src} imgW={job.img.naturalWidth} imgH={job.img.naturalHeight} aspect={16 / 9} value={job.cover} onChange={(cover) => setJob({ ...job, cover })} /> : null}
          <AppText variant="callout" tone="muted">
            封面預覽
          </AppText>
          {preview ? <img src={preview} alt="封面預覽" style={{ width: "100%", maxWidth: 320, aspectRatio: "16 / 9", borderRadius: 8, display: "block" }} /> : <AppText>產生預覽中…</AppText>}
        </>
      )}
      {msg ? <AppText variant="caption">{msg}</AppText> : null}
      <input ref={input} type="file" accept={FILE_ACCEPT} onChange={pick} style={{ display: "none" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, alignItems: "stretch" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
