import { cutPercentFor16x9 } from "@/features/admin/image-tools";

export type CoverMode = "crop" | "contain";

/** 照片比 16:9 窄到會切掉 15% 以上時，預設「完整顯示」（杜杜龍 2026-11-15）。 */
export const defaultCoverMode = (img: { naturalWidth: number; naturalHeight: number }): CoverMode => (cutPercentFor16x9(img) >= 15 ? "contain" : "crop");

/**
 * 封面方式切換：「裁切」（拖曳 16:9 裁切框）／「完整顯示」（整張照片縮小放中間，背景用同一張照片輕度模糊補滿）。
 * 照片太窄時顯示一行提示。中心 EDM 與課程 EDM 共用。
 */
export function CoverModePicker({ mode, onChange, img }: { mode: CoverMode; onChange: (m: CoverMode) => void; img: { naturalWidth: number; naturalHeight: number } }) {
  const cut = cutPercentFor16x9(img);
  const opt = (m: CoverMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      onClick={() => onChange(m)}
      style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `2px solid ${mode === m ? "#0F5C3A" : "#D5DBD8"}`, background: mode === m ? "#0F5C3A" : "#fff", color: mode === m ? "#fff" : "#1B2420", fontSize: 16, fontWeight: 700, cursor: "pointer" }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div role="radiogroup" aria-label="封面方式" style={{ display: "flex", gap: 8 }}>
        {opt("crop", "裁切")}
        {opt("contain", "完整顯示")}
      </div>
      {cut >= 15 ? (
        <div style={{ fontSize: 14, color: "#5A4A00", background: "#FFF6D6", borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}>
          這張照片比 16:9 窄，裁成 16:9 會切掉上下約 {cut}%。{mode === "contain" ? "已幫你選「完整顯示」，也可以切回「裁切」。" : "可以改選「完整顯示」，整張照片都會保留。"}
        </div>
      ) : null}
    </div>
  );
}
