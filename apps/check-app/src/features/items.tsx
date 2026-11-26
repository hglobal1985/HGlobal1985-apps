/** 作業項目的狀態標籤與說明（全 App 共用）。 */
import { MODES, ruleText, STATUS_LABEL, type ItemCard, type SubStatus } from "../../../api/src/contract";
import { Chip, type ChipTone } from "../ui";

export const TONE: Record<SubStatus | "none", ChipTone> = { none: "plain", draft: "wait", submitted: "wait", leader_ok: "wait", returned: "bad", graded: "ok" };
export function StatusChip({ status, points, late }: { status: SubStatus | "none"; points?: number | null; late?: boolean }) {
  const label = status === "graded" && points != null ? `${points} 分` : STATUS_LABEL[status];
  return <Chip tone={TONE[status]} label={late && status !== "graded" ? `${label}・逾期` : label} />;
}
export const itemRule = (i: ItemCard) => `${ruleText(i)}${i.note ? `・${i.note}` : ""}`;
export const modeName = (i: ItemCard) => MODES[i.mode];
