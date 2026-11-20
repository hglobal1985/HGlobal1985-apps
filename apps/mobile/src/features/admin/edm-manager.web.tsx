import { useEffect, useRef, useState } from "react";
import { api, resolveUrl, type CourseDetail } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { AppText, Button, Card, NoticeBox, Section } from "@/ui";
import { useSheetSave } from "@/features/course-edit/edit-sheet";
import { EdmCropper } from "./edm-cropper.web";
import { CoverLibraryPicker, deleteUnusedCover, type PickedCover } from "./cover-library.web";
import { CoverModePicker, defaultCoverMode, type CoverMode } from "./cover-mode.web";
import { useUiConfig } from "@/state/ui-config";
import { composeContain, cropCompress, loadImage, loadImageUrl, type Rect } from "./image-tools";
import { locateCover } from "./cover-match.web";

type Job = { img: HTMLImageElement; src: string; isNew: boolean; cover: Rect; mode: CoverMode; /** 從封面庫挑了「未使用的封面檔」：儲存成功後把它刪掉。 */ consumeKey?: string };
const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

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

/**
 * 管理員（網頁版）：上傳課程海報 EDM，並只設定「一個」東西——裁切封面（橫式 16:9、比例固定）。
 * 這個框同時決定兩處：課程清單的縮圖，以及學員進入課程介紹頁時一開始看到的位置（＝框的上緣）。
 * 兩者由程式保證永遠同步（後端用封面框算出預設位置），不再有兩個各自設定、互相不一致的地方。
 * 圖片在瀏覽器內壓縮，不保留原始檔案。
 */
export function EdmManager({ course, onChanged }: { course: CourseDetail; onChanged: () => void }) {
  const { config } = useUiConfig();
  const [job, setJob] = useState<Job | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  // 在編輯面板裡：儲存登記到面板下方與「取消」同一列（業主 2026-11-17）。
  const inSheet = useSheetSave(job ? { label: "儲存", onPress: () => void save(), busy, dirty: true } : null);

  // 封面預覽（裁切後 0.2 秒更新）。
  useEffect(() => {
    if (!job) return setPreview(null);
    let url: string | null = null;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const blob = job.mode === "contain" ? await composeContain(job.img, 640, 0.75) : await cropCompress(job.img, job.cover, 640, 0.75);
        if (dead) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      } catch {
        /* 預覽失敗不影響儲存時的錯誤訊息 */
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
    setMsg({ tone: "info", text: "讀取圖片中…" });
    try {
      const img = await loadImage(file);
      setJob({ img, src: img.src, isNew: true, cover: defaultCover(img), mode: defaultCoverMode(img) });
      setMsg(null);
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** 不換圖，只重新調整目前 EDM 的預設位置與封面。 */
  const adjust = async () => {
    if (!course.edmUrl) return;
    setBusy(true);
    setMsg({ tone: "info", text: "讀取 EDM 中…" });
    try {
      const img = await loadImageUrl(resolveUrl(course.edmUrl));
      // 起始的封面框：①有記錄就用記錄；②舊課程沒記錄就用圖片比對找出現有封面的位置；③都找不到才用預設停留位置當上緣。
      let cover: Rect | null = course.coverRect ? rectFrom(img, course.coverRect) : null;
      if (!cover && course.coverUrl) {
        const found = locateCover(img, await loadImageUrl(resolveUrl(course.coverUrl)));
        if (found) cover = rectFrom(img, found);
      }
      if (!cover) {
        const d = defaultCover(img);
        cover = { ...d, y: Math.min(Math.round(course.edmViewY * img.naturalHeight), Math.max(0, img.naturalHeight - d.h)) };
      }
      setJob({ img, src: img.src, isNew: false, cover, mode: "crop" });
      setMsg(null);
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** 從封面庫挑一張現有的圖：等同剛選了檔案，走同樣的裁切與儲存流程。 */
  const fromLibrary = ({ img, consumeKey }: PickedCover) => setJob({ img, src: img.src, isNew: true, cover: defaultCover(img), mode: defaultCoverMode(img), consumeKey });

  const save = async () => {
    if (!job) return;
    setBusy(true);
    setMsg({ tone: "info", text: "處理並上傳中…" });
    try {
      if (job.isNew) await api("PUT", `/admin/courses/${course.id}/edm`, await cropCompress(job.img, null, config.app.edmMaxSide, config.app.edmQuality / 100));
      const contain = job.mode === "contain"; // 完整顯示：整張照片＋淡模糊背景的合成圖，預設位置固定在最上緣
      await api("PUT", `/admin/courses/${course.id}/cover`, contain ? await composeContain(job.img, config.app.imageMaxSide, config.app.imageQuality / 100) : await cropCompress(job.img, job.cover, config.app.imageMaxSide, config.app.imageQuality / 100));
      // 封面框（占圖片寬高的比例）一併存起來；後端用它算出「預設停留位置＝封面框上緣」，兩者永遠同步。
      await api("PATCH", `/admin/courses/${course.id}`, { coverRect: contain ? { x: 0, y: 0, w: 1 } : { x: job.cover.x / job.img.naturalWidth, y: job.cover.y / job.img.naturalHeight, w: job.cover.w / job.img.naturalWidth } });
      await deleteUnusedCover(job.consumeKey);
      setJob(null);
      setMsg({ tone: "success", text: "已儲存" });
      onChanged();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (part: "edm" | "cover") => {
    if (!(await confirmAsk(part === "edm" ? "移除 EDM" : "移除封面", part === "edm" ? "移除後，課程介紹頁上方會改回色塊。" : "移除後，課程清單會改回色塊縮圖。", "確定移除"))) return;
    setBusy(true);
    try {
      await api("DELETE", `/admin/courses/${course.id}/${part}`);
      setMsg({ tone: "success", text: "已移除" });
      onChanged();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="課程海報（EDM）與封面">
      <Card>
        <AppText tone="muted" variant="callout">
          上傳課程海報（EDM）後，從 EDM 裁切一張橫式 16:9「封面」：框內就是課程清單的縮圖，也是學員進入課程介紹頁時一開始看到的位置（學員仍可上下拖曳看全部）。可選 JPG、PNG、WebP、HEIC（單張 20MB 內），上傳時自動壓縮，不保留原始檔案。
        </AppText>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <AppText variant="callout" tone="muted">
              目前 EDM
            </AppText>
            {course.edmUrl ? <img src={resolveUrl(course.edmUrl)} alt="目前 EDM" style={{ width: 140, borderRadius: 6, display: "block" }} /> : <AppText>（尚未上傳）</AppText>}
          </div>
          <div>
            <AppText variant="callout" tone="muted">
              目前封面（課程清單縮圖）
            </AppText>
            {course.coverUrl ? <img src={resolveUrl(course.coverUrl)} alt="目前封面" style={{ width: 240, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 6, display: "block" }} /> : <AppText>（尚未設定，清單用色塊）</AppText>}
          </div>
        </div>
        <input ref={input} type="file" accept={FILE_ACCEPT} onChange={pick} style={{ display: "none" }} />
        {!job ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button label={course.edmUrl ? "更換 EDM" : "上傳 EDM"} icon="image-outline" disabled={busy} onPress={() => input.current?.click()} />
            <CoverLibraryPicker disabled={busy} onPick={fromLibrary} />
            {course.edmUrl ? <Button variant="secondary" label="調整封面與預設位置" icon="crop-outline" disabled={busy} onPress={adjust} /> : null}
            {course.edmUrl ? <Button variant="ghost" label="移除 EDM" disabled={busy} onPress={() => remove("edm")} /> : null}
            {course.coverUrl ? <Button variant="ghost" label="移除封面" disabled={busy} onPress={() => remove("cover")} /> : null}
          </div>
        ) : null}
      </Card>

      {job ? (
        <>
          <Card>
            <AppText variant="headline">封面與預設停留位置（橫式 16:9，比例固定）</AppText>
            <AppText variant="callout" tone="muted">
              拖曳框內移動位置，拖四個角調整大小。框的上緣就是課程介紹頁一進來停留的位置。
            </AppText>
            <CoverModePicker mode={job.mode} img={job.img} onChange={(mode) => setJob({ ...job, mode })} />
            {job.mode === "crop" ? <EdmCropper src={job.src} imgW={job.img.naturalWidth} imgH={job.img.naturalHeight} aspect={16 / 9} value={job.cover} onChange={(cover) => setJob({ ...job, cover })} /> : null}
            <AppText variant="callout" tone="muted">
              封面預覽
            </AppText>
            {preview ? <img src={preview} alt="封面預覽" style={{ width: "100%", maxWidth: 320, aspectRatio: "16 / 9", borderRadius: 8, display: "block" }} /> : <AppText>產生預覽中…</AppText>}
          </Card>
          {inSheet ? null : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="cancel" label="取消" disabled={busy} onPress={() => (setJob(null), setMsg(null))} />
              <Button label="儲存" icon="save-outline" loading={busy} disabled={busy} onPress={save} />
            </div>
          )}
        </>
      ) : null}
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
    </Section>
  );
}
