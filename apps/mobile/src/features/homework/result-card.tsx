import { View } from "react-native";
import type { HwGrading, HwSubmission } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { hwWhen, stars } from "./format";

/** 成績卡：分數大字／星星／通過，下面是老師評語。 */
export function ResultCard({ grading, max, sub }: { grading: HwGrading; max: number; sub: HwSubmission }) {
  const { c } = useTheme();
  const res = sub.result;
  if (!res) return null;
  const returned = sub.status === "returned";
  const big = returned ? "請重交" : grading === "score" ? String(res.score) : grading === "stars" ? stars(res.stars ?? 0) : "通過";
  return (
    <View style={{ backgroundColor: returned ? c.warningSoft : c.accent, borderRadius: radius.lg, padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <AppText style={{ fontSize: grading === "score" && !returned ? 48 : 30, lineHeight: grading === "score" && !returned ? 54 : 38, fontWeight: "900", color: returned ? c.warning : c.textOnAccent }}>{big}</AppText>
        {grading === "score" && !returned ? <AppText style={{ color: c.textOnAccent, fontWeight: "700", paddingBottom: 8 }}>分（滿分 {max}）</AppText> : null}
      </View>
      {res.comment ? <AppText style={{ color: returned ? c.text : c.textOnAccent }}>{res.comment}</AppText> : null}
      <AppText variant="caption" style={{ color: returned ? c.textMuted : c.textOnAccent, opacity: 0.9 }}>
        {res.gradedBy ? `${res.gradedBy}・` : ""}
        {hwWhen(res.gradedAt)}
      </AppText>
    </View>
  );
}
