import { useRef } from "react";
import { Button } from "@/ui";

/** 選一張圖片檔（網頁版）：按鈕開啟檔案選擇，選好後把 File 交給 onPick。 */
export function PickImageButton({ label, onPick, busy, variant = "secondary" }: { label: string; onPick: (file: File) => void; busy?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button label={label} icon="image-outline" variant={variant} loading={busy} disabled={busy} onPress={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </>
  );
}
