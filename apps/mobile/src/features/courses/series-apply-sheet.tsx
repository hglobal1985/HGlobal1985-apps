import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, SERIES_APPLY_GROUPS, VIEW_SCOPE_LABEL, VIEW_SCOPES, type CourseSummary, type Rank, type SeriesApplyPlan, type SeriesApplyResult, type SeriesRosterPlan, type ViewScope } from "@/api/client";
import { Check } from "@/features/course-edit/course-sections";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { BrandField, CategoryField } from "@/features/course-edit/field-groups";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, Field, NoticeBox } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";

/**
 * 系列「套用到全系列課程」（業主 2026-11-20）：系列只是「設定範本」，沒有報名鈕。
 * 課程設定的七大項、每個子項、每個欄位都可以勾選要不要套用；勾選才會寫進系列內每一門課，沒勾的完全不動。
 * 危險功能，要兩次確認：先看「預覽」（每門課會改哪些欄位、哪些因為已有人報名被略過），再輸入「套用」才真的執行。
 * 套用成功後，這組值也成為這個系列的範本：之後在系列內新增課程，預設沿用。
 * 要新增可套用的欄位：加進 contract.ts 的 SERIES_APPLY_GROUPS，再在這裡的 LABEL／Control 補上。
 */
const LABEL: Record<string, string> = {
  category: "分類",
  brandId: "品牌",
  isPackage: "套裝課程",
  location: "地點",
  locationNone: "地點待定",
  isOnline: "線上課程",
  priceTwd: "費用（元）",
  priceTba: "費用尚未公布",
  diamondFree: "鑽石免費",
  viewScope: "誰能瀏覽",
  minRankCode: "最低獎銜",
  allowPresident: "會長不受獎銜限制也可報名",
  inviteOnly: "指定邀請制",
  inviteCode: "邀請碼（明碼）",
  hostUnit: "主辦單位",
  chapterCovers: "章節各自有封面",
  status: "上架狀態",
};
const DEFAULT: Record<string, unknown> = { category: "", brandId: "", isPackage: false, location: "", locationNone: false, isOnline: false, priceTwd: "0", priceTba: false, diamondFree: false, viewScope: "all", minRankCode: "none", allowPresident: true, inviteOnly: false, inviteCode: "", hostUnit: "", chapterCovers: false, status: "published" };

export function SeriesApplySheet({ series, title, courses, onClose }: { series: string; title: string; courses: CourseSummary[]; onClose: () => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  const tpl = useApi<{ template: Record<string, unknown> }>(`/admin/series-template?series=${encodeURIComponent(series)}`);
  const ranks = useApi<Rank[]>("/ranks");
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [vals, setVals] = useState<Record<string, unknown>>(DEFAULT);
  const [open, setOpen] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "preview" | "roster">("pick");
  const [plan, setPlan] = useState<SeriesApplyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (tpl.data?.template) setVals((v) => ({ ...v, ...tpl.data!.template, priceTwd: String((tpl.data!.template as Record<string, unknown>).priceTwd ?? v.priceTwd) }));
  }, [tpl.data]);
  const picked = useMemo(() => Object.keys(on).filter((k) => on[k]), [on]);
  const set = (k: string, v: unknown) => setVals((x) => ({ ...x, [k]: v }));
  const payload = () =>
    Object.fromEntries(
      picked.map((k) => [k, k === "priceTwd" ? Math.max(0, Math.round(Number(vals.priceTwd) || 0)) : vals[k]]),
    );

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<SeriesApplyPlan>("POST", "/admin/series-apply", { series, fields: payload(), dry: true }));
      setStep("preview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<SeriesApplyResult>("POST", "/admin/series-apply", { series, fields: payload() });
      invalidate();
      flashText(r.failed.length ? `已套用 ${r.applied} 門，${r.failed.length} 門失敗` : `已套用到 ${r.applied} 門課程`);
      if (r.failed.length) setError(r.failed.map((f) => `${f.title}：${f.error}`).join("\n"));
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTyped(false);
    }
  };

  const control = (k: string) => {
    const v = vals[k];
    if (typeof DEFAULT[k] === "boolean") return <Check label={v === true ? "套用的值：開啟" : "套用的值：關閉"} value={v === true} onChange={(x) => set(k, x)} />;
    if (k === "category") return <CategoryField value={String(v ?? "")} onChange={(x) => set(k, x)} />;
    if (k === "brandId") return <BrandField value={String(v ?? "")} onChange={(x) => set(k, x)} />;
    if (k === "viewScope") return <Chips title="瀏覽範圍" options={VIEW_SCOPES.map((x) => ({ key: x, label: VIEW_SCOPE_LABEL[x] }))} value={String(v)} onChange={(x) => set(k, x as ViewScope)} />;
    if (k === "minRankCode") return <Chips title="最低獎銜" options={(ranks.data ?? []).map((r) => ({ key: r.code, label: r.name }))} value={String(v)} onChange={(x) => set(k, x)} />;
    if (k === "status")
      return (
        <Chips
          title="上架狀態"
          options={[
            { key: "draft", label: "未上架" },
            { key: "published", label: "上架" },
          ]}
          value={String(v)}
          onChange={(x) => set(k, x)}
        />
      );
    return <Field label={LABEL[k]!} value={String(v ?? "")} onChange={(x) => set(k, k === "priceTwd" ? x.replace(/[^0-9]/g, "") : x)} placeholder={k === "inviteCode" ? "例如：8888" : undefined} />;
  };

  const groupState = (keys: readonly string[]) => (keys.every((k) => on[k]) ? "all" : keys.some((k) => on[k]) ? "some" : "none");
  const toggleGroup = (keys: readonly string[]) => {
    const all = groupState(keys) === "all";
    setOn((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, !all])) }));
  };

  if (step === "roster") return <RosterJoinSheet series={series} courses={courses} onBack={() => setStep("pick")} onClose={onClose} />;

  if (step === "preview" && plan)
    return (
      <EditSheet title="確認套用內容" onClose={() => setStep("pick")} onSave={() => setTyped(true)} saveLabel="確定套用" busy={busy} error={error} dirty>
        <AppText variant="headline">將修改 {plan.courses.filter((x) => x.apply.length).length} 門課程、{plan.fields.length} 個欄位</AppText>
        {plan.courses.map((x) => (
          <Card key={x.id} style={{ gap: space.xs }}>
            <AppText variant="callout" style={{ fontWeight: "700" }}>
              {x.title}
            </AppText>
            <AppText variant="caption" tone="muted">
              {x.apply.length ? `修改：${x.apply.map((k) => LABEL[k] ?? k).join("、")}` : "不修改"}
            </AppText>
            {x.skipped.length ? (
              <AppText variant="caption" style={{ color: c.danger }}>
                略過：{[...new Set(x.skipped.map((s) => `${LABEL[s.key] ?? s.key}（${s.reason}）`))].join("、")}
              </AppText>
            ) : null}
          </Card>
        ))}
        {typed ? <TypedConfirm word="套用" busy={busy} text={`會直接修改 ${plan.courses.filter((x) => x.apply.length).length} 門課程的 ${plan.fields.length} 個欄位，無法復原。`} onCancel={() => setTyped(false)} onOk={run} /> : null}
      </EditSheet>
    );

  return (
    <EditSheet title="套用設定到全系列課程" onClose={onClose} onSave={preview} saveLabel="預覽套用" dirty={picked.length > 0} busy={busy} error={error}>
      <NoticeBox tone="warning" text={`系列「${title}」：只會覆蓋你「打勾」的欄位，沒勾的課程資料完全不動。每門課各自的名稱、主講人不在這裡。`} />
      <AppText variant="caption" tone="muted">
        已選 {picked.length} 個欄位，套用到這個系列的 {courses.length} 門課程。已有人報名的課程，費用不會被覆蓋。審核窗口（審核群組、指定會員）請到各課程自己設定。
      </AppText>
      {SERIES_APPLY_GROUPS.map((g, i) => {
        const st = groupState(g.fields);
        const expanded = open === g.key;
        return (
          <View key={g.key} style={[styles.group, { borderColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${g.label}，${expanded ? "收起" : "展開"}`} onPress={() => setOpen(expanded ? null : g.key)} style={[styles.groupHead, { backgroundColor: c.accentSoft }]}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: st === "all" }} hitSlop={8} onPress={() => toggleGroup(g.fields)} style={[styles.box, { borderColor: c.accent, backgroundColor: st === "all" ? c.accent : "transparent" }]}>
                {st === "all" ? <Ionicons name="checkmark" size={16} color="#fff" /> : st === "some" ? <View style={{ width: 10, height: 2, backgroundColor: c.accent }} /> : null}
              </Pressable>
              <AppText variant="callout" style={{ fontWeight: "700", flex: 1 }}>
                {i + 1}　{g.label}
              </AppText>
              <AppText variant="caption" tone="muted">
                {g.fields.filter((k) => on[k]).length}/{g.fields.length}
              </AppText>
              <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
            </Pressable>
            {expanded ? (
              <View style={{ padding: space.md, gap: space.md }}>
                {g.fields.map((k) => (
                  <View key={k} style={{ gap: space.xs }}>
                    <Check label={`套用「${LABEL[k] ?? k}」`} value={on[k] === true} onChange={(v) => setOn((x) => ({ ...x, [k]: v }))} />
                    {on[k] ? <View style={{ paddingLeft: space.lg }}>{control(k)}</View> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => setStep("roster")} style={[styles.group, styles.groupHead, { borderColor: c.border, backgroundColor: c.accentSoft }]}>
        <AppText variant="callout" style={{ fontWeight: "700", flex: 1 }}>
          7　報名名單：把一門課的學員批次加入其他課程
        </AppText>
        <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
      </Pressable>
    </EditSheet>
  );
}

/** 第二次確認：輸入指定文字才能按「確定套用」。 */
function TypedConfirm({ word, text, busy, onCancel, onOk }: { word: string; text: string; busy: boolean; onCancel: () => void; onOk: () => void }) {
  const { c } = useTheme();
  const [v, setV] = useState("");
  return (
    <BottomSheet onClose={onCancel}>
      <View style={{ gap: space.md, padding: space.md }}>
        <AppText variant="title">確定套用到全系列？</AppText>
        <AppText>{text}請輸入「{word}」確認。</AppText>
        <TextInput accessibilityLabel={`輸入${word}`} value={v} onChangeText={setV} autoFocus placeholder={word} placeholderTextColor={c.textMuted} style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Button variant="cancel" label="取消" onPress={onCancel} fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="danger" label="確定套用" loading={busy} disabled={busy || v.trim() !== word} onPress={onOk} fullWidth />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

/** 第 7 項：把「來源課程」的學員批次加入同系列的其他課程（先預覽、再輸入「套用」）。 */
function RosterJoinSheet({ series, courses, onBack, onClose }: { series: string; courses: CourseSummary[]; onBack: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const [source, setSource] = useState(courses[0]?.id ?? "");
  const [plan, setPlan] = useState<SeriesRosterPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api<SeriesRosterPlan>("POST", "/admin/series-apply-roster", { series, sourceCourseId: source, dry: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: number }>("POST", "/admin/series-apply-roster", { series, sourceCourseId: source });
      flashText(`已批次加入 ${r.added} 筆`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTyped(false);
    }
  };
  return (
    <EditSheet title="報名名單：批次加入" onClose={onBack} onSave={plan ? () => setTyped(true) : preview} saveLabel={plan ? "確定批次加入" : "預覽"} dirty busy={busy} error={error}>
      <NoticeBox tone="warning" text="把「來源課程」已開通的學員，加入同系列的其他課程（金額 0、免審核，學員會收到通知）。已經報名的人會略過。" />
      <Chips title="來源課程（學員從這門課來）" options={courses.map((x) => ({ key: x.id, label: x.title }))} value={source} onChange={(v) => (setSource(v), setPlan(null))} />
      {plan ? (
        <>
          <AppText variant="headline">來源課程有 {plan.source.members} 位學員，將新增 {plan.totalAdd} 筆</AppText>
          {plan.targets.map((t) => (
            <Card key={t.id} style={{ gap: 2 }}>
              <AppText variant="callout" style={{ fontWeight: "700" }}>
                {t.title}
              </AppText>
              <AppText variant="caption" style={{ color: t.skipped ? c.danger : c.textMuted }}>
                {t.skipped ? `略過：${t.skipped}` : `新增 ${t.add} 位、已報名略過 ${t.already} 位`}
              </AppText>
            </Card>
          ))}
        </>
      ) : null}
      {typed && plan ? <TypedConfirm word="套用" busy={busy} text={`會替 ${plan.totalAdd} 筆學員直接開通課程，並通知他們。`} onCancel={() => setTyped(false)} onOk={run} /> : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, minHeight: minTouch + 8, paddingVertical: space.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 18, textAlign: "center" },
  row: { flexDirection: "row", gap: space.sm },
});
