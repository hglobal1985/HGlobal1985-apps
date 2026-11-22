import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_TYPES, ACH_ICON_POOL, ACH_TIMES, ACH_UNITS, ACH_VERBS, FEATURES, achDefaultIcon, achRecipeOf, achTypeOf, api, type AchTime, type AchievementCategory, type AchievementType, type AdminAchievement } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { BadgeIcon } from "@/features/achievements/badge-icon";
import { achPhrase, conditionText } from "@/features/achievements/text";
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
type IconMode = "default" | "random" | "pick";
/** vi＜0＝沒有對應動詞的舊類型（清單影片徽章、指定課程）：只能改名稱、說明、難易度與啟用。 */
type Form = { id: string | null; difficulty: Diff; name: string; description: string; icon: string; iconMode: IconMode; vi: number; oi: number; time: AchTime; unit: string; threshold: string; feature: string; active: boolean; type: AchievementType; lessonTitle?: string | null; nameTouched: boolean; step: number };
const STEPS = ["① 做什麼", "② 時段", "③ 多少", "④ 外觀"];
const blank = (): Form => ({ id: null, difficulty: 1, name: "", description: "", icon: achDefaultIcon(0), iconMode: "default", vi: 0, oi: 0, time: "any", unit: ACH_VERBS[0]!.objects[0]!.unit, threshold: "5", feature: "", active: true, type: "lessons_completed", nameTouched: false, step: 0 });
const phraseOf = (f: Form) => achPhrase(f.vi, f.oi, f.time, Number(f.threshold) || 1, f.unit, f.feature);
const randomIcon = (not: string) => {
  const pool = ACH_ICON_POOL.filter((i) => i !== not);
  return pool[Math.floor(Math.random() * pool.length)]!;
};

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
  const open = (f: Form) => {
    setForm(f);
    setDirty(false);
    setError(null);
  };
  const edit = (a: AdminAchievement) => {
    const r = achRecipeOf(a.type, a.feature);
    const vi = r?.vi ?? -1;
    const unit = a.unit ?? (r ? ACH_VERBS[r.vi]!.objects[r.oi]!.unit : ACHIEVEMENT_TYPES[a.type].unit);
    open({ id: a.id, difficulty: a.difficulty, name: a.name, description: a.description, icon: a.icon, iconMode: vi >= 0 && a.icon === achDefaultIcon(vi) ? "default" : "pick", vi, oi: r?.oi ?? 0, time: r?.time ?? "any", unit, threshold: String(a.threshold), feature: a.feature ?? "", active: a.active, type: a.type, lessonTitle: a.lessonTitle, nameTouched: true, step: 0 });
  };
  /** 改欄位：動詞或對象換了就帶入預設單位；圖示是「預設」就跟著動詞換；名稱沒被手動改過就跟著句子自動更新。 */
  const patch = (p: Partial<Form>) => {
    setForm((f) => {
      if (!f) return f;
      const n = { ...f, ...p };
      if (p.vi !== undefined && p.vi !== f.vi) {
        n.oi = p.oi ?? 0;
        n.time = "any";
        n.feature = "";
      }
      if ((p.vi !== undefined && p.vi !== f.vi) || (p.oi !== undefined && p.oi !== f.oi)) {
        const o = ACH_VERBS[n.vi]?.objects[n.oi];
        if (o) { n.unit = o.unit; if (!o.times) n.time = "any"; }
      }
      if (n.vi >= 0 && n.iconMode === "default") n.icon = achDefaultIcon(n.vi);
      if (n.vi >= 0 && !n.nameTouched && p.name === undefined) n.name = phraseOf(n);
      return n;
    });
    setDirty(true);
  };
  const obj = form && form.vi >= 0 ? ACH_VERBS[form.vi]!.objects[form.oi]! : null;
  const t = form ? ACHIEVEMENT_TYPES[form.type] : null;
  const auto = !!form && form.vi < 0;
  const autoDesc = form ? (form.vi >= 0 ? `會員${phraseOf(form)}，就會自動拿到這枚徽章。` : conditionText(form.type, Number(form.threshold) || 1, null, form.feature, form.lessonTitle)) : "";
  const save = async () => {
    if (!form) return;
    const n = Number(form.threshold);
    if (!form.name.trim()) return setError("請輸入徽章名稱");
    let body: Record<string, unknown> = { difficulty: form.difficulty, name: form.name.trim(), description: form.description.trim() || (form.vi >= 0 ? autoDesc : ""), active: form.active };
    if (form.vi >= 0 && obj) {
      if (!Number.isInteger(n) || n < 1) return setError("達成數量請輸入 1 以上的整數");
      const type = achTypeOf(form.vi, form.oi, form.time);
      if (!type) return setError("這個組合沒有對應的條件，請換一個時段");
      const feature = obj.feature ?? (obj.pickFeature ? form.feature : "");
      if (obj.pickFeature && !feature) return setError("請選擇要使用的功能");
      body = { ...body, icon: form.icon || "🏅", type, threshold: n, unit: form.unit, feature: feature || null, courseId: null };
    }
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
  const draw = async () => {
    if (!(await confirmAsk("重新抽選清單影片徽章", "會從「安麗官方資源」「安麗品牌館」的每個區塊隨機挑影片（區塊裡影片超過 5 支挑 2 支，否則 1 支），新增尚未有徽章的區塊。已經有的徽章不會被換掉或刪除。", "開始抽選"))) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; total: number }>("POST", "/admin/achievements/draw-videos");
      flashText(r.added ? `新增 ${r.added} 枚清單影片徽章，目前共 ${r.total} 枚` : `沒有需要新增的，目前共 ${r.total} 枚`);
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
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

      <Button label="新增任務" icon="add-circle-outline" onPress={() => open(blank())} fullWidth />

      <Button variant="secondary" label="🎬 重新抽選清單影片徽章" onPress={draw} disabled={busy} fullWidth />

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
                  <BadgeIcon icon={a.icon} size={24} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout" style={{ fontWeight: "800" }} numberOfLines={1}>
                      {a.name}{!a.active ? "（停用）" : ""}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {conditionText(a.type, a.threshold, a.courseTitle, a.feature, a.lessonTitle)} · {a.earnedCount} 人（{pct(a)}%）
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
          {auto ? (
            <>
              <NoticeBox tone="info" text={`清單影片徽章：會員讀完（看完）「${form.lessonTitle ?? "指定影片"}」就解鎖。影片由系統隨機抽選，這裡只能改名稱、說明、難易度與啟用狀態。`} />
              <Field label="徽章名稱（最多 30 字）" value={form.name} onChange={(v) => patch({ name: v })} />
              <Field label="說明" value={form.description} onChange={(v) => patch({ description: v })} placeholder={autoDesc} />
            </>
          ) : (
            <>
              <View style={[styles.live, { backgroundColor: c.accent }]}>
                <BadgeIcon icon={form.icon} size={32} />
                <AppText variant="callout" style={{ flex: 1, color: "#fff", fontWeight: "800" }}>
                  會員{phraseOf(form)}，解鎖這枚成就
                </AppText>
              </View>
              <View style={styles.steps} accessibilityRole="tablist">
                {STEPS.map((label, i) => (
                  <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: form.step === i }} onPress={() => patch({ step: i })} style={[styles.stepTab, { borderColor: form.step === i ? c.accent : c.border, backgroundColor: form.step === i ? c.accentSoft : "transparent" }]}>
                    <AppText variant="caption" style={{ fontWeight: "800", color: form.step === i ? c.accent : c.textMuted }}>
                      {label}
                    </AppText>
                  </Pressable>
                ))}
              </View>

              {form.step === 0 ? (
                <View style={{ gap: space.md }}>
                  <AppText variant="callout" style={{ fontWeight: "700" }}>
                    動詞
                  </AppText>
                  <View style={styles.tiles}>
                    {ACH_VERBS.map((v, i) => (
                      <Pressable key={v.verb} accessibilityRole="radio" accessibilityState={{ selected: form.vi === i }} onPress={() => patch({ vi: i })} style={[styles.tile, { borderColor: form.vi === i ? c.accent : c.border, backgroundColor: form.vi === i ? c.accentSoft : c.surface }]}>
                        <AppText variant="body" style={{ fontWeight: "800" }}>
                          {v.icon} {v.verb}
                        </AppText>
                      </Pressable>
                    ))}
                  </View>
                  <Chips title="對象" label="對象" options={ACH_VERBS[form.vi]!.objects.map((o, i) => ({ key: String(i), label: o.name }))} value={String(form.oi)} onChange={(v) => patch({ oi: Number(v) })} />
                  {obj?.pickFeature ? (
                    <View style={{ gap: 6 }}>
                      <AppText variant="callout" style={{ fontWeight: "700" }}>
                        哪個網站功能
                      </AppText>
                      <View style={styles.icons}>
                        {Object.entries(FEATURES).map(([k, f]) => (
                          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: form.feature === k }} onPress={() => patch({ feature: k })} style={[styles.chip, { borderColor: form.feature === k ? c.accent : c.border, backgroundColor: form.feature === k ? c.accent : c.surface }]}>
                            <AppText variant="callout" style={{ fontWeight: "700", color: form.feature === k ? "#fff" : c.text }}>
                              {f.label}
                            </AppText>
                          </Pressable>
                        ))}
                      </View>
                      {form.feature ? <AppText variant="caption" tone="muted">{FEATURES[form.feature as keyof typeof FEATURES]?.hint}</AppText> : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {form.step === 1 ? (
                obj?.times ? (
                  <View style={{ gap: 6 }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      什麼時候完成才算
                    </AppText>
                    <View style={styles.tiles}>
                      {ACH_TIMES.map((x) => (
                        <Pressable key={x.key} accessibilityRole="radio" accessibilityState={{ selected: form.time === x.key }} onPress={() => patch({ time: x.key })} style={[styles.tile, { borderColor: form.time === x.key ? c.accent : c.border, backgroundColor: form.time === x.key ? c.accentSoft : c.surface }]}>
                          <AppText variant="body" style={{ fontWeight: "800" }}>
                            {x.label}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <AppText variant="body" tone="muted">
                    「{ACH_VERBS[form.vi]!.verb}{obj?.name}」沒有時段可以選，直接按下一步。
                  </AppText>
                )
              ) : null}

              {form.step === 2 ? (
                <View style={{ gap: space.md }}>
                  <AppText variant="callout" style={{ fontWeight: "700", textAlign: "center" }}>
                    要達到多少
                  </AppText>
                  <View style={styles.stepper}>
                    {[-10, -1].map((d) => (
                      <Step key={d} label={`${d}`} disabled={(Number(form.threshold) || 1) + d < 1} onPress={() => patch({ threshold: String(Math.max(1, (Number(form.threshold) || 1) + d)) })} />
                    ))}
                    <TextInput value={form.threshold} onChangeText={(v) => patch({ threshold: v.replace(/\D/g, "").slice(0, 6) })} keyboardType="number-pad" accessibilityLabel="達成數量" style={[styles.numInput, typo.title, { color: c.text, borderColor: c.accent, backgroundColor: c.surface }]} />
                    {[1, 10].map((d) => (
                      <Step key={d} label={`+${d}`} disabled={false} onPress={() => patch({ threshold: String(Math.min(100000, (Number(form.threshold) || 1) + d)) })} />
                    ))}
                  </View>
                  {form.type === "streak_days" && Number(form.threshold) > 7 ? <NoticeBox tone="warning" text="連續學習超過 7 天很難達成，建議不要設更高。" /> : null}
                  <Chips title="單位" label="單位" options={ACH_UNITS.map((u) => ({ key: u, label: u }))} value={form.unit} onChange={(v) => patch({ unit: v })} />
                  <View style={{ gap: 6 }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      難易度：{DIFF_LABEL[form.difficulty]}
                    </AppText>
                    <Stars value={form.difficulty} onChange={(d) => patch({ difficulty: d })} big />
                  </View>
                </View>
              ) : null}

              {form.step === 3 ? (
                <View style={{ gap: space.md }}>
                  <View style={{ gap: 6 }}>
                    <AppText variant="callout" style={{ fontWeight: "700" }}>
                      徽章圖示
                    </AppText>
                    <View style={styles.icons}>
                      {([["default", `${achDefaultIcon(form.vi)} 預設`], ["random", "🎲 隨機"], ["pick", "自選"]] as [IconMode, string][]).map(([m, label]) => {
                        const on = form.iconMode === m;
                        return (
                          <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => patch(m === "random" ? { iconMode: m, icon: randomIcon(form.icon) } : { iconMode: m })} style={[styles.chip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : c.surface }]}>
                            <AppText variant="callout" style={{ fontWeight: "700", color: on ? "#fff" : c.text }}>
                              {label}{m === "random" && on ? "（再按重抽）" : ""}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <AppText variant="caption" tone="muted">
                      {form.iconMode === "default" ? "預設：同一個動詞的成就圖示全站一致，換動詞圖示自動換。" : form.iconMode === "random" ? "隨機：從圖庫抽一個，不喜歡可以再按重抽。" : "自選：從圖庫自己挑。"}
                    </AppText>
                    {form.iconMode === "pick" ? (
                      <View style={styles.icons}>
                        {ACH_ICON_POOL.map((i) => (
                          <Pressable key={i} accessibilityRole="button" accessibilityLabel={`圖示 ${i}`} onPress={() => patch({ icon: i })} style={[styles.iconBtn, { borderColor: form.icon === i ? c.accent : c.border, backgroundColor: form.icon === i ? c.accentSoft : c.surface }]}>
                            <AppText style={{ fontSize: 24, lineHeight: 30 }}>{i}</AppText>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <Field label="徽章名稱（最多 30 字，已自動產生，可修改）" value={form.name} onChange={(v) => patch({ name: v, nameTouched: true })} />
                  <Field label="說明（留空會自動使用條件文字）" value={form.description} onChange={(v) => patch({ description: v })} placeholder={autoDesc} />
                </View>
              ) : null}

              <View style={styles.row}>
                {form.step > 0 ? <Button variant="cancel" label="上一步" onPress={() => patch({ step: form.step - 1 })} /> : null}
                {form.step < 3 ? <Button label="下一步" onPress={() => patch({ step: form.step + 1 })} /> : null}
              </View>
            </>
          )}
          {auto ? (
            <View style={{ gap: 6 }}>
              <AppText variant="callout" style={{ fontWeight: "700" }}>
                難易度：{DIFF_LABEL[form.difficulty]}
              </AppText>
              <Stars value={form.difficulty} onChange={(d) => patch({ difficulty: d })} big />
            </View>
          ) : null}
          <Chips title="狀態" label="狀態" options={[{ key: "on", label: "啟用（會員看得到）" }, { key: "off", label: "停用（暫時隱藏）" }]} value={form.active ? "on" : "off"} onChange={(v) => patch({ active: v === "on" })} />
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
  live: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, padding: space.md },
  steps: { flexDirection: "row", gap: 6 },
  stepTab: { flex: 1, minHeight: minTouch, borderWidth: 2, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "48%", flexGrow: 1, minHeight: 56, borderWidth: 2, borderRadius: radius.md, paddingHorizontal: space.md, justifyContent: "center" },
  chip: { minHeight: minTouch, paddingHorizontal: 16, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  numInput: { flex: 1, minHeight: 56, borderWidth: 2, borderRadius: radius.md, textAlign: "center" },
  kind: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2, minHeight: minTouch },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconBtn: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  iconInput: { width: 72, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, textAlign: "center", fontSize: 24 },
});
