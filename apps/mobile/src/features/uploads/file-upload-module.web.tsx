import { useEffect, useRef, useState } from "react";
import { api, apiUpload, type CourseDetail } from "@/api/client";
import { useApi } from "@/state/session";
import { cropCompress, loadImage } from "@/features/admin/image-tools";
import { AppText, Button, NoticeBox } from "@/ui";
import { useUiConfig } from "@/state/ui-config";
import { COMPRESSIBLE, FILE_ACCEPT, FILE_TOO_BIG, fileProblem } from "@/features/uploads/file-rules";
import { pickFromMyDrive, preloadGooglePicker } from "./google-picker.web";
import { UploadProgress } from "@/features/uploads/upload-progress";

type DriveCfg = { ready: boolean; clientId: string; apiKey: string; appId: string; maxBytes: number };

/**
 * 「上傳檔案」模組（杜杜龍 2026-11-18，教材新增／清單新增教材／區塊新增教材共用，要改只改這一個檔案）：
 * 檔案一律存在行動大學的儲存空間（R2），下載一律經過權限檢查與一次性連結。兩種資料來源：
 * ① 從這支裝置（手機、平板、電腦）選圖片、照片、文件（不可影片，單檔大小有上限）；圖片自動壓縮（長邊與畫質同封面），選好立刻上傳並建立教材。
 * ② 從使用者「自己的」Google 雲端硬碟選擇（Google Picker；使用者授權一次性權杖，伺服器讀取後轉存到 R2，權杖不保存；Google 文件、試算表、簡報自動轉成 PDF、Excel、PowerPoint）。
 * 一次可選多個檔案；任何一個有問題就顯示原因並略過，其他照常處理。超過上限提示改貼雲端連結。
 */
export function FileUploadModule({ courseId, onUploaded, onBusyChange }: { courseId: string; onUploaded: (detail: CourseDetail, hadErrors: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const { config } = useUiConfig();
  const { fileMaxMb, imageMaxSide, imageQuality } = config.app;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [prog, setProg] = useState<{ label: string; pct: number | null; detail?: string } | null>(null); // 進度條
  const [errors, setErrors] = useState<string[]>([]);
  const cfgQ = useApi<DriveCfg>("/admin/drive-import/config");
  const gcfg = cfgQ.data;
  const driveLoading = !gcfg && !cfgQ.error; // 設定還在讀：按鈕先顯示（暫時不能按），避免晚兩秒才跳出來
  // 只先載入 Google 的程式（不索取任何權限），讓使用者按按鈕時授權視窗能立刻跳出、不被手機瀏覽器擋掉。
  useEffect(() => {
    if (gcfg?.ready) void preloadGooglePicker().catch(() => undefined);
  }, [gcfg?.ready]);

  const run = async (files: File[]) => {
    setBusy(true);
    onBusyChange?.(true);
    setErrors([]);
    const bad: string[] = [];
    let last: CourseDetail | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const problem = fileProblem(f.name, f.type, f.size, fileMaxMb);
        if (problem) {
          bad.push(`「${f.name}」：${problem}`);
          continue;
        }
        const label = `上傳中（${i + 1}／${files.length}）：${f.name}`;
        setProg({ label, pct: 0 });
        try {
          let blob: Blob = f;
          let name = f.name;
          if (COMPRESSIBLE.test(f.name)) {
            // 圖片自動壓縮：長邊與畫質用「儲存空間管理」的設定（預設同封面：1024 像素、88%）
            blob = await cropCompress(await loadImage(f), null, imageMaxSide, imageQuality / 100);
            name = f.name.replace(/\.[^.]+$/, "") + ".jpg";
          }
          if (blob.size > fileMaxMb * 1024 * 1024) {
            bad.push(`「${f.name}」：${FILE_TOO_BIG(fileMaxMb)}`);
            continue;
          }
          last = await apiUpload<CourseDetail>("POST", `/admin/courses/${courseId}/material-file?name=${encodeURIComponent(name)}`, blob, (pct) => setProg({ label, pct, detail: `${(blob.size / 1024 ** 2).toFixed(1)} MB` }));
        } catch (e) {
          bad.push(`「${f.name}」：${(e as Error).message}`);
        }
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      setMsg(null);
      setProg(null);
      setErrors(bad);
    }
    if (last) onUploaded(last, bad.length > 0);
  };

  /** 資料來源：從使用者自己的 Google 雲端硬碟選擇 → 伺服器讀取並轉存到行動大學的儲存空間 → 建立教材。 */
  const runDrive = async () => {
    if (!gcfg?.ready) return;
    setBusy(true);
    onBusyChange?.(true);
    setErrors([]);
    const bad: string[] = [];
    let okCount = 0;
    try {
      setMsg("請在 Google 的選檔視窗挑選檔案（沒看到視窗請檢查瀏覽器是否擋住彈出視窗）");
      const picked = await pickFromMyDrive(gcfg);
      if (picked) {
        for (let i = 0; i < picked.files.length; i++) {
          const f = picked.files[i]!;
          const label = `從 Google 雲端硬碟轉存中（${i + 1}／${picked.files.length}）：${f.name}（檔案大時需要一些時間，請不要離開這個畫面）`;
          setProg({ label, pct: 0 });
          // 轉存在伺服器進行，每秒查一次進度：大小已知顯示百分比，未知（Google 文件轉檔）顯示來回跑的進度條。
          const progressId = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
          const timer = setInterval(() => {
            void api<{ written: number; total: number }>("GET", `/admin/drive-import/progress?id=${progressId}`)
              .then((r) => setProg({ label, pct: r.total > 0 ? Math.min(99, Math.round((r.written / r.total) * 100)) : null, detail: `已轉存 ${(r.written / 1024 ** 2).toFixed(1)} MB` }))
              .catch(() => undefined);
          }, 1000);
          try {
            await api("POST", `/admin/courses/${courseId}/drive-import`, { fileId: f.id, token: picked.token, progressId });
            okCount += 1;
          } catch (e) {
            bad.push(`「${f.name}」：${(e as Error).message}`);
          } finally {
            clearInterval(timer);
          }
        }
      }
    } catch (e) {
      bad.push((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      setMsg(null);
      setProg(null);
      setErrors(bad);
    }
    if (okCount) onUploaded(await api<CourseDetail>("GET", `/courses/${courseId}`), bad.length > 0);
  };

  return (
    <>
      <Button label="從這支裝置選擇檔案" icon="cloud-upload-outline" variant="secondary" loading={busy} disabled={busy} onPress={() => input.current?.click()} fullWidth />
      {driveLoading || gcfg?.ready ? <Button label="從我的 Google 雲端硬碟選擇" icon="logo-google" variant="secondary" loading={busy} disabled={busy || driveLoading} onPress={() => void runDrive()} fullWidth /> : null}
      <input
        ref={input}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void run(files);
        }}
      />
      {msg && !prog ? (
        <AppText variant="caption" tone="muted">
          {msg}
        </AppText>
      ) : null}
      {prog ? <UploadProgress label={prog.label} pct={prog.pct} detail={prog.detail} /> : null}
      {errors.map((t) => (
        <NoticeBox key={t} tone="danger" text={t} />
      ))}
    </>
  );
}
