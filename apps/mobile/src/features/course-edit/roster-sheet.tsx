import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api, download, type CourseDetail, type Roster, type RosterRow } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, Pill } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { LoadingLadybug } from "@/ui/loading-ladybug";
import { EditSheet } from "./edit-sheet";

/**
 * 課程設定第七項「報名名單」（業主 2026-11-20）：誰報名了、用什麼方式（一般／邀請碼／待審核）、狀態、上手白金與上手鑽石；
 * 可搜尋、篩選、匯出 CSV、移除資格。有審核權限的人都能看，也都能移除。
 * 上手白金、上手鑽石是 Amway 資料：由中央即時提供、只讀「這一頁」，行動大學不保存；讀不到顯示「未提供」。
 */
const METHOD: Record<RosterRow["method"], { label: string; tone: "neutral" | "accent" | "warning" }> = {
  free: { label: "免費報名", tone: "neutral" },
  paid: { label: "付費報名", tone: "neutral" },
  invite: { label: "邀請碼", tone: "accent" },
  invite_request: { label: "無邀請碼申請", tone: "warning" },
  batch: { label: "系列批次加入", tone: "accent" },
};
const STATUS: Record<RosterRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  opened: { label: "已開通", tone: "success" },
  pending: { label: "待審核", tone: "warning" },
  rejected: { label: "已退回／移除", tone: "danger" },
};
type Filter = "all" | "pending" | "invite" | "opened";

export function RosterSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const { c } = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const qs = new URLSearchParams({ filter, page: String(page), ...(term ? { q: term } : {}) }).toString();
  const roster = useApi<Roster>(`/admin/courses/${course.id}/roster?${qs}`);
  const d = roster.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  const exportCsv = async () => {
    setBusy(true);
    try {
      await download(`/admin/courses/${course.id}/roster.csv`, `報名名單-${course.title}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: RosterRow) => {
    const paid = r.method === "paid" && r.status === "opened";
    const ok = await confirmSheet({
      title: "移除報名資格",
      message: `要移除「${r.name}」的報名資格嗎？對方會收到通知，課程章節會重新鎖住。${paid ? "這位已繳費，移除後金額不會自動退款，請另外與對方聯絡。" : ""}`,
      confirmLabel: "確定移除",
      cancelLabel: "先不要",
      danger: true,
    });
    if (!ok) return;
    try {
      await api("DELETE", `/admin/courses/${course.id}/roster/${r.orderId}`);
      flashText("已移除");
      roster.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };

  return (
    <EditSheet title="報名名單" onClose={onClose} hideSave>
      <View style={styles.search}>
        <TextInput
          accessibilityLabel="搜尋姓名或中心"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => (setTerm(q.trim()), setPage(1))}
          placeholder="搜尋姓名或中心"
          placeholderTextColor={c.textMuted}
          returnKeyType="search"
          style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
        />
        <Button variant="secondary" label="搜尋" onPress={() => (setTerm(q.trim()), setPage(1))} />
      </View>
      <Chips
        title="篩選"
        options={[
          { key: "all", label: `全部 ${d?.counts.all ?? ""}` },
          { key: "pending", label: `待審核 ${d?.counts.pending ?? ""}` },
          { key: "invite", label: `邀請碼 ${d?.counts.invite ?? ""}` },
          { key: "opened", label: `已開通 ${d?.counts.opened ?? ""}` },
        ]}
        value={filter}
        onChange={(v) => (setFilter(v as Filter), setPage(1))}
      />
      <Button variant="secondary" label="匯出 CSV（全部名單）" icon="download-outline" loading={busy} disabled={busy} onPress={exportCsv} fullWidth />
      {roster.loading && !d ? <LoadingLadybug /> : null}
      {roster.error ? <AppText tone="danger">{roster.error}</AppText> : null}
      {d && !d.uplineAvailable && d.rows.length ? <AppText variant="caption" tone="muted">上手白金、上手鑽石暫時無法取得（中央沒有回應），先顯示「未提供」。</AppText> : null}
      {d && !d.rows.length ? <AppText tone="muted" style={{ textAlign: "center", paddingVertical: space.lg }}>目前沒有符合的報名。</AppText> : null}
      {d?.rows.map((r) => (
        <Card key={r.orderId} style={{ gap: space.xs }}>
          <View style={styles.head}>
            <AppText variant="headline" style={{ flex: 1 }}>
              {r.name}
            </AppText>
            <AppText variant="caption" tone="muted">
              {r.center || "—"}
            </AppText>
          </View>
          <View style={styles.pills}>
            <Pill label={METHOD[r.method].label} tone={METHOD[r.method].tone} />
            <Pill label={STATUS[r.status].label} tone={STATUS[r.status].tone} />
            <AppText variant="caption" tone="muted">
              {r.createdAt.slice(0, 10)}
            </AppText>
          </View>
          <AppText variant="callout" tone="muted">
            上手白金：{d.uplineAvailable ? (r.uplinePlatinum ?? "—") : "未提供"}　上手鑽石：{d.uplineAvailable ? (r.uplineDiamond ?? "—") : "未提供"}
          </AppText>
          {r.status !== "rejected" ? (
            <View style={{ alignSelf: "flex-end" }}>
              <Button variant="cancel" label="移除資格" icon="person-remove-outline" onPress={() => remove(r)} />
            </View>
          ) : null}
        </Card>
      ))}
      {d && pages > 1 ? (
        <View style={styles.pager}>
          <Button variant="secondary" label="上一頁" disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
          <AppText tone="muted">
            {page} / {pages}
          </AppText>
          <Button variant="secondary" label="下一頁" disabled={page >= pages} onPress={() => setPage((p) => p + 1)} />
        </View>
      ) : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  input: { flex: 1, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  pills: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
