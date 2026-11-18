import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_TYPES, FEATURES, api, type AchievementCategory, type AchievementType, type AdminAchievement } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { BADGE_ICONS, conditionText } from "@/features/achievements/text";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type as typo } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Screen, Section } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Diff = 1 | 2 | 3;
const DIFF_LABEL: Record<Diff, string> = { 1: "簡單", 2: "普通", 3: "困難" };
/** 會員完成度＝取得人數 ÷ 會員總數：沒人／少數（<10%）／中等（10～40%）／多數（≥40%）。 */
type Done = "all" | "none" | "low" | "mid" | "high";
const doneOf = (a: AdminAchievement): Exclude<Done, "all"> => {
  if (!a.earnedCount) return "none";
  const r = a.memberTotal ? a.earnedCount / a.memberTotal : 0;
  return r < 0.1 ? "low" : r < 0.4 ? "mid" : "high";
};
const pct = (a: AdminAchievement) => (a.memberTotal ? Math.round((a.earnedCount / a.memberTotal) * 100) : 0);
type Form = { id: string | null; difficulty: Diff; name: string; description: string; icon: string; type: AchievementType; threshold: string; feature: string; active: boolean };
const blank = (category: AchievementCategory): Form => {
  const type = (Object.keys(ACHIEVEMENT_TYPES) as AchievementType[]).find((t) => ACHIEVEMENT_TYPES[t].category === category && !ACHIEVEMENT_TYPES[t].retired)!;
  return { id: null, difficulty: 1, name: "", description: "", icon: "🏅", type, threshold: "1", feature: "", active: true };
};
const typesOf = (category: AchievementCategory) => (Object.keys(ACHIEVEMENT_TYPES) as AchievementType[]).filter((t) => ACHIEVEMENT_TYPES[t].category === category && !ACHIEVEMENT_TYPES[t].retired);

/**
 * 設定 › 徽章任務設定（業主 2026-11-18）：超級管理員自由調整所有徽章任務。
 * ① 上方總覽＋書櫃鑰匙門檻 ② 依「任務分類」篩選／分組列出所有任務（點一下修改）③ 新增任務：先選分類、再選任務種類（每種都有白話說明）、設定達成數量與名稱、圖示。
 */
export default function AdminAchievementsScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const { config, reload: reloadConfig } = useUiConfig();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<AdminAchievement[]>(isSuper ? "/admin/achievements" : null);
  const [filter, setFilter] = useState<"all" | AchievementCategory>("all");
  const [diffF, setDiffF] = useState<"all" | "1" | "2" | "3">("all");
  const [doneF, setDoneF] = useState<Done>("all");
  const [over, setOver] = useState<Record<string, Diff>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [formCat, setFormCat] = useState<AchievementCategory>("progress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const rows = (list.data ?? []).map((a) => (over[a.id] ? { ...a, difficulty: over[a.id]! } : a));
  const shown = rows.filter((a) => (diffF === "all" || String(a.difficulty) === diffF) && (doneF === "all" || doneOf(a) === doneF));
  const grouped = useMemo(
    () =>
      ACHIEVEMENT_CATEGORIES.map((cat) => ({
        cat,
        items: shown.filter((a) => ACHIEVEMENT_TYPES[a.type].category === cat.key).sort((x, y) => x.type.localeCompare(y.type) || x.threshold - y.threshold),
      })).filter((g) => g.items.length && (filter === "all" || filter === g.cat.key)),
    [shown, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;

  const active = rows.filter((a) => a.active).length;
  const need = config.app.libraryKeyBadges ?? 100;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      flashText(done);
      list.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const open = (f: Form, cat: AchievementCategory) => {
    setForm(f);
    setFormCat(cat);
    setDirty(false);
    setError(null);
  };
  const edit = (a: AdminAchievement) => open({ id: a.id, difficulty: a.difficulty, name: a.name, description: a.description, icon: a.icon, type: a.type, threshold: String(a.threshold), feature: a.feature ?? "", active: a.active }, ACHIEVEMENT_TYPES[a.type].category);
  const patch = (p: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setDirty(true);
  };
  const t = form ? ACHIEVEMENT_TYPES[form.type] : null;
  const autoDesc = form ? conditionText(form.type, Number(form.threshold) || 1, null, form.feature) : "";
  const save = async () => {
    if (!form) return;
    const n = Number(form.threshold);
    if (!form.name.trim()) return setError("請輸入徽章名稱");
    if (!t?.needsFeature && (!Number.isInteger(n) || n < 1)) return setError("達成數量請輸入 1 以上的整數");
    if (t?.needsFeature && !form.feature) return setError("請選擇要使用的功能");
    const body = { difficulty: form.difficulty, name: form.name.trim(), description: form.description.trim(), icon: form.icon || "🏅", type: form.type, threshold: t?.needsFeature ? 1 : n, feature: t?.needsFeature ? form.feature : null, courseId: null, active: form.active };
    if (await run(() => (form.id ? api("PATCH", `/admin/achievements/${form.id}`, body) : api("POST", "/admin/achievements", body)), form.id ? "已儲存" : "已新增徽章")) setForm(null);
  };
  const remove = async (a: AdminAchievement) => {
    if (await confirmAsk("刪除徽章", `確定刪除「${a.name}」？已取得這枚徽章的 ${a.earnedCount} 位會員紀錄也會一併刪除，無法復原。`, "刪除")) {
      if (await run(() => api("DELETE", `/admin/achievements/${a.id}`), "已刪除")) setForm(null);
    }
  };
  const setDiff = (a: AdminAchievement, d: Diff) => {
    if (a.difficulty === d) return;
    setOver((o) => ({ ...o, [a.id]: d })); // 先直接換星星，背景再存
    api("PATCH", `/admin/achievements/${a.id}`, { difficulty: d }).then(() => list.reload()).catch((e: Error) => { setOver((o) => { const n = { ...o }; delete n[a.id]; return n; }); flashText(e.message); });
  };
  const saveNeed = (v: number) => run(() => api("PUT", "/admin/ui-config", { app: { ...config.app, libraryKeyBadges: v } }).then(() => reloadConfig()), "已更新書櫃鑰匙門檻");

  return (
    <Screen header={false}>
      <Card>
        <View style={styles.stats}>
          <Stat n={rows.length} label="全部任務" />
          <Stat n={active} label="啟用中" />
          <Stat n={rows.reduce((s, a) => s + a.earnedCount, 0)} label="已取得人次" />
        </View>
        <View style={{ gap: 6 }}>
          <AppText variant="headline">🔑 書櫃鑰匙門檻</AppText>
          <AppText variant="caption" tone="muted">
            會員集滿這麼多枚徽章，就自動解鎖「我的書櫃」。
          </AppText>
          <View style={styles.stepper}>
            {[-10, -1].map((d) => (
              <Step key={d} label={`${d}`} disabled={busy || need + d < 1} onPress={() => saveNeed(Math.max(1, need + d))} />
            ))}
            <AppText variant="title" style={{ flex: 1, textAlign: "center" }}>
              {need}
            </AppText>
            {[1, 10].map((d) => (
              <Step key={d} label={`+${d}`} disabled={busy || need + d > 1000} onPress={() => saveNeed(Math.min(1000, need + d))} />
            ))}
          </View>
          {active < need ? <NoticeBox tone="warning" text={`啟用中的徽章只有 ${active} 枚，少於門檻 ${need}，沒有人能解鎖書櫃。請新增任務或調低門檻。`} /> : null}
        </View>
      </Card>

      <Button label="新增任務" icon="add-circle-outline" onPress={() => open(blank(filter === "all" ? "progress" : filter), filter === "all" ? "progress" : filter)} fullWidth />

      <Chips title="任務分類" label="任務分類" options={[{ key: "all", label: `全部（${rows.length}）` }, ...ACHIEVEMENT_CATEGORIES.map((k) => ({ key: k.key, label: `${k.icon} ${k.label}（${rows.filter((a) => ACHIEVEMENT_TYPES[a.type].category === k.key).length}）` }))]} value={filter} onChange={(v) => setFilter(v as "all" | AchievementCategory)} />
      <Chips title="難易度" label="難易度" options={[{ key: "all", label: "全部" }, ...([1, 2, 3] as Diff[]).map((d) => ({ key: String(d), label: `${"★".repeat(d)} ${DIFF_LABEL[d]}（${rows.filter((a) => a.difficulty === d).length}）` }))]} value={diffF} onChange={(v) => setDiffF(v as typeof diffF)} />
      <Chips title="會員完成度（取得人數 ÷ 會員總數）" label="會員完成度" options={[{ key: "all", label: "全部" }, { key: "none", label: `沒人取得（${rows.filter((a) => doneOf(a) === "none").length}）` }, { key: "low", label: `少數 <10%（${rows.filter((a) => doneOf(a) === "low").length}）` }, { key: "mid", label: `中等（${rows.filter((a) => doneOf(a) === "mid").length}）` }, { key: "high", label: `多數 ≥40%（${rows.filter((a) => doneOf(a) === "high").length}）` }]} value={doneF} onChange={(v) => setDoneF(v as Done)} />
      {shown.length !== rows.length ? <AppText variant="caption" tone="muted">符合條件 {shown.length} 個任務</AppText> : null}

      {grouped.map(({ cat, items }) => (
        <Section key={cat.key} title={`${cat.icon} ${cat.label}（${items.length}）`}>
          <AppText variant="caption" tone="muted">
            {cat.desc}
          </AppText>
          <Card style={{ paddingVertical: 0 }}>
            {items.map((a) => (
              <View key={a.id} style={[styles.item, { borderBottomColor: c.border, opacity: a.active ? 1 : 0.55 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`修改 ${a.name}`} onPress={() => edit(a)} style={styles.itemMain}>
                  <AppText style={{ fontSize: 24, lineHeight: 30 }}>{a.icon}</AppText>
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={1}>
                      {a.name}{!a.active ? "（停用）" : ""}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {conditionText(a.type, a.threshold, a.courseTitle, a.feature)} · {a.earnedCount} 人（{pct(a)}%）
                    </AppText>
                  </View>
                </Pressable>
                <Stars value={a.difficulty} onChange={(d) => setDiff(a, d)} />
              </View>
            ))}
          </Card>
        </Section>
      ))}
      {!grouped.length ? <EmptyState icon="trophy-outline" title="這個分類還沒有任務" body="按上方「新增任務」建立第一個。" /> : null}

      {form ? (
        <EditSheet title={form.id ? "修改徽章任務" : "新增徽章任務"} onClose={() => setForm(null)} onSave={save} dirty={dirty} busy={busy} error={error}>
          <Chips title="① 任務分類" label="① 任務分類" options={ACHIEVEMENT_CATEGORIES.map((k) => ({ key: k.key, label: `${k.icon} ${k.label}` }))} value={formCat} onChange={(v) => { setFormCat(v as AchievementCategory); const first = typesOf(v as AchievementCategory)[0]; if (first && ACHIEVEMENT_TYPES[form.type].category !== v) patch({ type: first, feature: "" }); }} />
          <View style={{ gap: 6 }}>
            <AppText variant="callout" style={{ fontWeight: "700" }}>
              ② 任務種類
            </AppText>
            {typesOf(formCat).map((k) => {
              const on = form.type === k;
              return (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => patch({ type: k })} style={[styles.kind, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface }]}>
                  <AppText variant="body" style={{ fontWeight: "700" }}>
                    {ACHIEVEMENT_TYPES[k].label}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {ACHIEVEMENT_TYPES[k].hint}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {t?.needsFeature ? (
            <View style={{ gap: 6 }}>
              <AppText variant="callout" style={{ fontWeight: "700" }}>
                ③ 要使用的功能
              </AppText>
              {Object.entries(FEATURES).map(([k, f]) => {
                const on = form.feature === k;
                return (
                  <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => patch({ feature: k })} style={[styles.kind, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface }]}>
                    <AppText variant="body" style={{ fontWeight: "700" }}>
                      {f.label}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {f.hint}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={{ gap: 4 }}>
              <Field label={`③ 達成數量（${t?.unit}）`} value={form.threshold} onChange={(v) => patch({ threshold: v.replace(/\D/g, "") })} numeric />
              {form.type === "streak_days" && Number(form.threshold) > 7 ? <NoticeBox tone="warning" text="連續學習超過 7 天很難達成，建議不要設更高。" /> : null}
            </View>
          )}
          <Field label="④ 徽章名稱（最多 30 字）" value={form.name} onChange={(v) => patch({ name: v })} placeholder="例如：學習新星" />
          <Field label="說明（會員在成就頁看到；留空會自動用條件文字）" value={form.description} onChange={(v) => patch({ description: v })} placeholder={autoDesc} />
          <Button variant="ghost" label={`自動填入說明：${autoDesc}`} onPress={() => patch({ description: autoDesc })} />
          <View style={{ gap: 6 }}>
            <AppText variant="callout" style={{ fontWeight: "700" }}>
              ⑤ 徽章圖示
            </AppText>
            <View style={styles.icons}>
              {BADGE_ICONS.map((i) => (
                <Pressable key={i} accessibilityRole="button" accessibilityLabel={`圖示 ${i}`} onPress={() => patch({ icon: i })} style={[styles.iconBtn, { borderColor: form.icon === i ? c.accent : c.border, backgroundColor: form.icon === i ? c.accentSoft : c.surface }]}>
                  <AppText style={{ fontSize: 24, lineHeight: 30 }}>{i}</AppText>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <AppText variant="caption" tone="muted">
                也可以自己輸入表情符號：
              </AppText>
              <TextInput value={form.icon} onChangeText={(v) => patch({ icon: [...v].slice(-2).join("") })} accessibilityLabel="自訂圖示" style={[styles.iconInput, typo.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <AppText variant="callout" style={{ fontWeight: "700" }}>
              ⑥ 難易度：{DIFF_LABEL[form.difficulty]}
            </AppText>
            <Stars value={form.difficulty} onChange={(d) => patch({ difficulty: d })} big />
          </View>
          <Chips title="⑦ 狀態" label="⑦ 狀態" options={[{ key: "on", label: "啟用（會員看得到）" }, { key: "off", label: "停用（暫時隱藏）" }]} value={form.active ? "on" : "off"} onChange={(v) => patch({ active: v === "on" })} />
          {form.id ? (
            <View style={styles.row}>
              <Button variant="danger" label="刪除這個任務" icon="trash-outline" disabled={busy} onPress={() => remove(rows.find((x) => x.id === form.id)!)} />
            </View>
          ) : null}
        </EditSheet>
      ) : null}
    </Screen>
  );
}

/** 三顆星難易度：直接點第幾顆就設定成幾星（簡單／普通／困難）。 */
function Stars({ value, onChange, big }: { value: Diff; onChange: (d: Diff) => void; big?: boolean }) {
  return (
    <View style={{ flexDirection: "row" }} accessibilityRole="radiogroup">
      {([1, 2, 3] as Diff[]).map((d) => (
        <Pressable key={d} accessibilityRole="radio" accessibilityState={{ selected: value === d }} accessibilityLabel={`難易度 ${d} 顆星（${DIFF_LABEL[d]}）`} onPress={() => onChange(d)} hitSlop={{ top: 6, bottom: 6 }} style={{ width: big ? 56 : 30, height: big ? 52 : 44, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={d <= value ? "star" : "star-outline"} size={big ? 32 : 20} color={d <= value ? "#E0A800" : "#B8B2A0"} />
        </Pressable>
      ))}
    </View>
  );
}

function Step({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`門檻 ${label}`} disabled={disabled} onPress={onPress} style={{ width: 56, height: minTouch, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>
      <AppText variant="headline">{label}</AppText>
    </Pressable>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <AppText variant="title">{n}</AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stats: { flexDirection: "row", gap: space.sm },
  item: { flexDirection: "row", alignItems: "center", paddingLeft: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  itemMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 50, paddingVertical: 2 },
  kind: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2, minHeight: minTouch },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconBtn: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  iconInput: { width: 72, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, textAlign: "center", fontSize: 24 },
});
