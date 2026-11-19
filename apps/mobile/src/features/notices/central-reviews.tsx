import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, type CentralReview, type CentralReviews, type Rank } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { dateTime } from "@/features/format";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Card, Icon } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/**
 * 通知頁「審核」分類：中央的「獎銜、教育中心」新申請（業主 2026-11-17）。
 * 即時向中央讀取、不保存；誰能看、誰能審核（審核員只能處理自己中心的、超級管理員與秘書全部）完全由中央判斷，
 * 這裡沒有權限就不會顯示整個區塊。通過／不通過前先彈出確認面板。
 */
export function useCentralReviews() {
  return useApi<CentralReviews>("/central-reviews");
}

const text = (v: unknown): string => {
  if (v == null || v === "") return "（無）";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "option" in (v as object)) return String((v as { option: unknown }).option);
  return JSON.stringify(v);
};

type HistoryRow = { id: string; field_label: string; applicant_name: string; from_text: string; to_text: string; status: string; decided_by_name: string; decided_at: string };

export function CentralReviewList({ data, onChanged }: { data: CentralReviews; onChanged: () => void }) {
  const { c } = useTheme();
  const ranks = useApi<Rank[]>("/ranks");
  const [busy, setBusy] = useState<string | null>(null);
  const history = useApi<HistoryRow[]>(data.available ? "/central-reviews/history" : null);
  if (!data.available) return null;
  const rankName = (code: unknown) => ranks.data?.find((r) => r.code === code)?.name ?? text(code);
  const show = (r: CentralReview, v: unknown) => (r.field_key === "rank" ? rankName(v) : text(v));
  const decide = async (r: CentralReview, decision: "approve" | "reject") => {
    const who = r.display_name || "這位會員";
    const ok = await confirmAsk(decision === "approve" ? "通過申請" : "不通過申請", `${who}申請「${r.field_label}」：${show(r, r.current_value)} → ${show(r, r.requested_value)}。${decision === "approve" ? "通過後會員中心會立刻更新並通知對方。" : "不通過會通知對方，原本的資料不變。"}`, decision === "approve" ? "通過" : "不通過");
    if (!ok) return;
    setBusy(r.id);
    try {
      await api("POST", `/central-reviews/${r.id}/decision`, { decision, item: { display_name: r.display_name, field_key: r.field_key, field_label: r.field_label, current_value: r.current_value, requested_value: r.requested_value } });
      history.reload();
      flashText(decision === "approve" ? "已通過" : "已不通過");
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(null);
      onChanged();
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Icon name="ribbon-outline" size={18} color={c.accentText} />
        <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
          會員中心的新申請（獎銜、教育中心）
        </AppText>
        <AppText variant="caption" tone="muted">
          {data.scope === "all" ? "全部中心" : "你的中心"}
        </AppText>
      </View>
      {data.reviews.length ? (
        data.reviews.map((r) => (
          <Card key={r.id} style={{ gap: space.xs }}>
            <AppText variant="headline">
              {r.display_name || "會員"}　申請{r.field_label}
            </AppText>
            <AppText variant="body">
              {show(r, r.current_value)} → <AppText variant="body" style={{ fontWeight: "800" }}>{show(r, r.requested_value)}</AppText>
            </AppText>
            <AppText variant="caption" tone="muted">
              {[r.center ? `中心：${r.center}` : "", dateTime(r.created_at)].filter(Boolean).join("　")}
            </AppText>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="不通過" disabled={busy === r.id} onPress={() => void decide(r, "reject")} style={({ pressed }) => [styles.btn, { borderColor: c.border, backgroundColor: c.surface }, pressed && { opacity: 0.7 }]}>
                <AppText variant="callout" style={{ fontWeight: "800" }}>
                  不通過
                </AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="通過" disabled={busy === r.id} onPress={() => void decide(r, "approve")} style={({ pressed }) => [styles.btn, { backgroundColor: c.accent, borderColor: c.accent }, pressed && { opacity: 0.85 }]}>
                <AppText variant="callout" style={{ fontWeight: "800", color: c.textOnAccent }}>
                  通過
                </AppText>
              </Pressable>
            </View>
          </Card>
        ))
      ) : (
        <AppText variant="callout" tone="muted">
          目前沒有等待審核的申請。
        </AppText>
      )}
      {/* 已處理的申請紀錄（業主 2026-11-19）：審核完成後保留在這裡，不會消失。 */}
      {history.data?.length ? (
        <View style={{ gap: space.xs, marginTop: space.sm }}>
          <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
            已處理的申請
          </AppText>
          {history.data.map((h) => (
            <Card key={h.id} style={{ gap: 2 }}>
              <AppText variant="body" style={{ fontWeight: "700" }}>
                {h.applicant_name || "會員"}　{h.field_label}　{h.status === "approved" ? "✅ 已通過" : "❌ 不通過"}
              </AppText>
              <AppText variant="caption" tone="muted">
                {[h.to_text ? `申請內容：${h.to_text}` : "", h.decided_by_name ? `審核：${h.decided_by_name}` : "", dateTime(h.decided_at)].filter(Boolean).join("　")}
              </AppText>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  btn: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
