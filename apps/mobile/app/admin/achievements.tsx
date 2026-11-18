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
import { AppText, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Pill, Screen, Section } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Form = { id: string | null; name: string; description: string; icon: string; type: AchievementType; threshold: string; feature: string; active: boolean };
const blank = (category: AchievementCategory): Form => {
  const type = (Object.keys(ACHIEVEMENT_TYPES) as AchievementType[]).find((t) => ACHIEVEMENT_TYPES[t].category === category && !ACHIEVEMENT_TYPES[t].retired)!;
  return { id: null, name: "", description: "", icon: "🏅", type, threshold: "1", feature: "", active: true };
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
  const [form, setForm] = useState<Form | null>(null);
  const [formCat, setFormCat] = useState<AchievementCategory>("progress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const rows = list.data ?? [];
  const grouped = useMemo(
    () =>
      ACHIEVEMENT_CATEGORIES.map((cat) => ({
        cat,
        items: rows.filter((a) => ACHIEVEMENT_TYPES[a.type].category === cat.key).sort((x, y) => x.type.localeCompare(y.type) || x.threshold - y.threshold),
      })).filter((g) => g.items.length && (filter === "all" || filter === g.cat.key)),
    [rows, filter],
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
  const edit = (a: AdminAchievement) => open({ id: a.id, name: a.name, description: a.description, icon: a.icon, type: a.type, threshold: String(a.threshold), feature: a.feature ?? "", active: a.active }, ACHIEVEMENT_TYPES[a.type].category);
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
    const body = { name: form.name.trim(), description: form.description.trim(), icon: form.icon || "🏅", type: form.type, threshold: t?.needsFeature ? 1 : n, feature: t?.needsFeature ? form.feature : null, courseId: null, active: form.active };
    if (await run(() => (form.id ? api("PATCH", `/admin/achievements/${form.id}`, body) : api("POST", "/admin/achievements", body)), form.id ? "已儲存" : "已新增徽章")) setForm(null);
  };
  const remove = async (a: AdminAchievement) => {
    if (await confirmAsk("刪除徽章", `確定刪除「${a.name}」？已取得這枚徽章的 ${a.earnedCount} 位會員紀錄也會一併刪除，無法復原。`, "刪除")) {
      if (await run(() => api("DELETE", `/admin/achievements/${a.id}`), "已刪除")) setForm(null);
    }
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

      <Chips label="任務分類" options={[{ key: "all", label: `全部（${rows.length}）` }, ...ACHIEVEMENT_CATEGORIES.map((k) => ({ key: k.key, label: `${k.icon} ${k.label}（${rows.filter((a) => ACHIEVEMENT_TYPES[a.type].category === k.key).length}）` }))]} value={filter} onChange={(v) => setFilter(v as "all" | AchievementCategory)} />

      {grouped.map(({ cat, items }) => (
        <Section key={cat.key} title={`${cat.icon} ${cat.label}（${items.length}）`}>
          <AppText variant="caption" tone="muted">
            {cat.desc}
          </AppText>
          <Card style={{ paddingVertical: 0 }}>
            {items.map((a) => (
              <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`修改 ${a.name}`} onPress={() => edit(a)} style={[styles.item, { borderBottomColor: c.border, opacity: a.active ? 1 : 0.55 }]}>
                <AppText style={{ fontSize: 30, lineHeight: 38 }}>{a.icon}</AppText>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="headline" numberOfLines={1}>
                    {a.name}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={2}>
                    {ACHIEVEMENT_TYPES[a.type].label}：{conditionText(a.type, a.threshold, a.courseTitle, a.feature)}　· {a.earnedCount} 人取得
                  </AppText>
                </View>
                {!a.active ? <Pill label="停用" tone="neutral" /> : null}
              </Pressable>
            ))}
          </Card>
        </Section>
      ))}
      {!grouped.length ? <EmptyState icon="trophy-outline" title="這個分類還沒有任務" body="按上方「新增任務」建立第一個。" /> : null}

      {form ? (
        <EditSheet title={form.id ? "修改徽章任務" : "新增徽章任務"} onClose={() => setForm(null)} onSave={save} dirty={dirty} busy={busy} error={error}>
          <Chips label="① 任務分類" options={ACHIEVEMENT_CATEGORIES.map((k) => ({ key: k.key, label: `${k.icon} ${k.label}` }))} value={formCat} onChange={(v) => { setFormCat(v as AchievementCategory); const first = typesOf(v as AchievementCategory)[0]; if (first && ACHIEVEMENT_TYPES[form.type].category !== v) patch({ type: first, feature: "" }); }} />
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
          <Chips label="⑥ 狀態" options={[{ key: "on", label: "啟用（會員看得到）" }, { key: "off", label: "停用（暫時隱藏）" }]} value={form.active ? "on" : "off"} onChange={(v) => patch({ active: v === "on" })} />
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
  item: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: minTouch + 12, paddingVertical: space.sm, paddingHorizontal: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  kind: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2, minHeight: minTouch },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconBtn: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  iconInput: { width: 72, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, textAlign: "center", fontSize: 24 },
});
