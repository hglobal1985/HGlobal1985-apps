import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, type CentralReview, type CentralReviews, type Rank } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { dateTime } from "@/features/format";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Icon } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { TextInput } from "react-native";
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

type HistoryRow = { id: string; field_label: string; applicant_name: string; from_text: string; to_text: string; final_text: string; status: string; decided_by_name: string; decided_at: string };

export function CentralReviewList({ data, onChanged }: { data: CentralReviews; onChanged: () => void }) {
  const { c } = useTheme();
  const ranks = useApi<Rank[]>("/ranks");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<CentralReview | null>(null);
  const history = useApi<HistoryRow[]>(data.available ? "/central-reviews/history" : null);
  if (!data.available) return null;
  const rankName = (code: unknown) => ranks.data?.find((r) => r.code === code)?.name ?? text(code);
  const show = (r: CentralReview, v: unknown) => (r.field_key === "rank" ? rankName(v) : text(v));
  const decide = async (r: CentralReview, decision: "approve" | "reject", value?: unknown, valueLabel?: string) => {
    const who = r.display_name || "這位會員";
    const ok = await confirmAsk(value !== undefined ? "修改後通過" : decision === "approve" ? "通過申請" : "不通過申請", value !== undefined ? `${who}申請「${r.field_label}」：${show(r, r.requested_value)}。\n你要改成「${valueLabel}」後通過，系統會通知申請人「經審核者修改後通過」。確定嗎？` : `${who}申請「${r.field_label}」：${show(r, r.current_value)} → ${show(r, r.requested_value)}。${decision === "approve" ? "通過後會員中心會立刻更新並通知對方。" : "不通過會通知對方，原本的資料不變。"}`, decision === "approve" ? "通過" : "不通過");
    if (!ok) return;
    setBusy(r.id);
    try {
      await api("POST", `/central-reviews/${r.id}/decision`, { decision, ...(value !== undefined ? { value } : {}), item: { display_name: r.display_name, field_key: r.field_key, field_label: r.field_label, current_value: r.current_value, requested_value: r.requested_value } });
      history.reload();
      flashText(value !== undefined ? "已修改後通過" : decision === "approve" ? "已通過" : "已不通過");
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
              {r.field_key === "rank" || r.field_key === "education_center" || r.field_key === "education_system" ? (
                <Pressable accessibilityRole="button" accessibilityLabel="修改後通過" disabled={busy === r.id} onPress={() => setEditing(r)} style={({ pressed }) => [styles.btn, { borderColor: c.accent, backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
                  <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
                    修改後通過
                  </AppText>
                </Pressable>
              ) : null}
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
      {editing ? <EditApproveSheet review={editing} onClose={() => setEditing(null)} onPick={(v, label) => (setEditing(null), void decide(editing, "approve", v, label))} /> : null}
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
                {[h.final_text ? `申請：${h.to_text} → 核准：${h.final_text}（審核者修改）` : h.to_text ? `申請內容：${h.to_text}` : "", h.decided_by_name ? `審核：${h.decided_by_name}` : "", dateTime(h.decided_at)].filter(Boolean).join("　")}
              </AppText>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 審核者修改後通過（業主 2026-11-20）：獎銜、中心用清單選，系統用輸入；選好後回到確認面板讓審核者看到改了什麼。 */
function EditApproveSheet({ review, onClose, onPick }: { review: CentralReview; onClose: () => void; onPick: (value: unknown, label: string) => void }) {
  const { c } = useTheme();
  const ranks = useApi<Rank[]>(review.field_key === "rank" ? "/ranks" : null);
  const centers = useApi<string[]>(review.field_key === "education_center" ? "/centers" : null);
  const [text, setText] = useState("");
  const objectForm = typeof review.requested_value === "object" && review.requested_value !== null; // 中央用 {option, custom_text} 時照同格式送
  const wrap = (v: string): unknown => (objectForm ? { option: v, custom_text: null } : v);
  const rows: { value: string; label: string }[] = review.field_key === "rank" ? (ranks.data ?? []).filter((r) => r.code !== "none").map((r) => ({ value: r.code, label: r.name })) : review.field_key === "education_center" ? (centers.data ?? []).map((x) => ({ value: x, label: x })) : [];
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">{`修改「${review.field_label}」後通過`}</AppText>
      <AppText variant="caption" tone="muted">
        選好新的內容，系統會再請你確認；申請人會收到「經審核者修改後通過」的通知。
      </AppText>
      {review.field_key === "education_system" ? (
        <>
          <TextInput value={text} onChangeText={setText} placeholder="輸入系統名稱" placeholderTextColor={c.textMuted} style={{ minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, color: c.text, borderColor: c.border, backgroundColor: c.surface, fontSize: 16 }} />
          <Button label="下一步" onPress={() => text.trim() && onPick(wrap(text.trim()), text.trim())} disabled={!text.trim()} fullWidth />
        </>
      ) : (
        <SheetScroll>
          {rows.map((o) => (
            <Pressable key={o.value} accessibilityRole="button" onPress={() => onPick(wrap(o.value), o.label)} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
              <AppText variant="body">{o.label}</AppText>
            </Pressable>
          ))}
          {!rows.length ? <AppText tone="muted">讀取中…</AppText> : null}
        </SheetScroll>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  btn: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
