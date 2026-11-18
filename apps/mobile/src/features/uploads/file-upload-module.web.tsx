import { useRef, useState } from "react";
import { api, type CourseDetail } from "@/api/client";
import { COVER_MAX_SIDE, cropCompress, loadImage } from "@/features/admin/image-tools";
import { AppText, Button, NoticeBox } from "@/ui";
import { COMPRESSIBLE, FILE_ACCEPT, FILE_MAX_BYTES, FILE_TOO_BIG, fileProblem } from "./file-rules";

/**
 * 「上傳檔案」模組（業主 2026-11-18，教材新增／清單新增教材／區塊新增教材共用，要改只改這一個檔案）：
 * 選圖片、照片、文件（不可影片，單檔 30MB 內）；圖片自動壓縮（長邊與畫質同封面：COVER_MAX_SIDE），選好立刻上傳並建立教材。
 * 一次可選多個檔案；任何一個有問題就顯示原因並略過，其他照常上傳。超過 30MB 提示改貼雲端連結。
 */
export function FileUploadModule({ courseId, onUploaded, onBusyChange }: { courseId: string; onUploaded: (detail: CourseDetail, hadErrors: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const run = async (files: File[]) => {
    setBusy(true);
    onBusyChange?.(true);
    setErrors([]);
    const bad: string[] = [];
    let last: CourseDetail | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const problem = fileProblem(f.name, f.type, f.size);
        if (problem) {
          bad.push(`「${f.name}」：${problem}`);
          continue;
        }
        setMsg(`上傳中（${i + 1}／${files.length}）：${f.name}`);
        try {
          let blob: Blob = f;
          let name = f.name;
          if (COMPRESSIBLE.test(f.name)) {
            // 圖片自動壓縮：畫素與畫質和封面相同（長邊 COVER_MAX_SIDE，JPEG 0.88）
            blob = await cropCompress(await loadImage(f), null, COVER_MAX_SIDE, 0.88);
            name = f.name.replace(/\.[^.]+$/, "") + ".jpg";
          }
          if (blob.size > FILE_MAX_BYTES) {
            bad.push(`「${f.name}」：${FILE_TOO_BIG}`);
            continue;
          }
          last = await api<CourseDetail>("POST", `/admin/courses/${courseId}/material-file?name=${encodeURIComponent(name)}`, blob);
        } catch (e) {
          bad.push(`「${f.name}」：${(e as Error).message}`);
        }
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      setMsg(null);
      setErrors(bad);
    }
    if (last) onUploaded(last, bad.length > 0);
  };

  return (
    <>
      <Button label="選擇檔案上傳" icon="cloud-upload-outline" variant="secondary" loading={busy} disabled={busy} onPress={() => input.current?.click()} fullWidth />
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
      {msg ? (
        <AppText variant="caption" tone="muted">
          {msg}
        </AppText>
      ) : null}
      {errors.map((t) => (
        <NoticeBox key={t} tone="danger" text={t} />
      ))}
    </>
  );
}
