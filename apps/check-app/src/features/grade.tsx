/** 評分工具：依項目的計分方式自動換成對應的控制（核定件數、分數、星等、通過）。 */
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MODES, pointsFor, type ItemCard, type SubmissionView } from "@check/contract";
import { useColors } from "@/kit";
import { Card, Chip, Field, Stepper, T } from "@/kit";

export type GradeInput = { approved: number; score: string; stars: number; comment: string };
export const initialGrade = (s: SubmissionView): GradeInput => ({ approved: s.approved ?? s.declared ?? 0, score: s.score != null ? String(s.score) : "", stars: s.stars ?? 0, comment: s.comment ?? "" });
export const gradeReady = (i: ItemCard, g: GradeInput) => (i.mode === "stars" ? g.stars > 0 : i.mode === "score" || i.mode === "onsite" ? g.score !== "" && Number(g.score) <= (i.fullScore ?? 100) : true);
export const gradeBody = (i: ItemCard, g: GradeInput) => ({ approved: i.mode === "count" ? g.approved : undefined, score: i.mode === "score" || i.mode === "onsite" ? Number(g.score) : undefined, stars: i.mode === "stars" ? g.stars : undefined, comment: g.comment });

export function GradePanel({ item, sub, value, onChange }: { item: ItemCard; sub: SubmissionView; value: GradeInput; onChange: (g: GradeInput) => void }) {
  const c = useColors();
  const set = (p: Partial<GradeInput>) => onChange({ ...value, ...p });
  const pts = pointsFor(item, { approved: value.approved, score: value.score === "" ? 0 : Number(value.score), stars: value.stars });
  return (
    <View style={{ gap: 10 }}>
      {item.mode === "count" ? (
        <Card>
          <Stepper label={`核定${item.unit}數`} hint={`學員申報 ${sub.declared ?? 0} ${item.unit}`} unit={item.unit} value={value.approved} onChange={(n) => set({ approved: n })} />
        </Card>
      ) : null}
      {item.mode === "stars" ? (
        <Card>
          <T bold>給幾顆星</T>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} 顆星`} onPress={() => set({ stars: n })} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 34, color: value.stars >= n ? "#E0A100" : c.line }}>★</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
      {item.mode === "score" || item.mode === "onsite" ? (
        <Card>
          <T bold>分數（滿分 {item.fullScore ?? 100}）</T>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Field value={value.score} onChangeText={(t) => set({ score: t.replace(/[^\d.]/g, "") })} keyboardType="numeric" placeholder="0" style={{ width: 90, fontSize: 20, fontWeight: "700", textAlign: "center" }} />
            {[1, 0.9, 0.8, 0.7].map((k) => {
              const v = Math.round((item.fullScore ?? 100) * k);
              return <Chip key={k} tone={Number(value.score) === v ? "ok" : "plain"} label={String(v)} onPress={() => set({ score: String(v) })} />;
            })}
          </View>
        </Card>
      ) : null}
      {item.mode === "fixed" || item.mode === "pass" ? <Card><T bold>{MODES[item.mode]}</T><T small muted>按「通過」就得 {item.points ?? 0} 分</T></Card> : null}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T small muted style={{ flex: 1 }}>本項得分</T>
        <Text style={{ fontSize: 20, fontWeight: "800", color: c.green }}>{pts} 分{item.mode === "count" && item.maxPoints != null && value.approved * (item.per ?? 1) > item.maxPoints ? "（已達上限）" : ""}</Text>
      </View>
      <Field value={value.comment} onChangeText={(t) => set({ comment: t })} placeholder="評語（退回重交時必填）" multiline />
    </View>
  );
}
