import { useRef } from "react";
import { Button } from "@/ui";

/**
 * 選圖片檔（網頁版，全站上傳圖片的統一選檔鈕，業主 2026-11-22）：按鈕開啟檔案選擇。
 * 單張欄位（logo、單月課表…）用 `onPick`（一次一張）；可以放很多張的地方（圖庫底圖…）改傳 `onPickMany`，就能一次複選多張。
 * 相簿（`album-upload`）與教材檔案（`file-upload-module`）有各自的複選流程（含影片、其他檔案類型）。
 */
export function PickImageButton({ label, onPick, onPickMany, busy, variant = "secondary" }: { label: string; onPick?: (file: File) => void; onPickMany?: (files: File[]) => void; busy?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button label={label} icon="image-outline" variant={variant} loading={busy} disabled={busy} onPress={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        multiple={!!onPickMany}
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (onPickMany) {
            if (fs.length) onPickMany(fs);
          } else if (fs[0]) onPick?.(fs[0]);
        }}
      />
    </>
  );
}
