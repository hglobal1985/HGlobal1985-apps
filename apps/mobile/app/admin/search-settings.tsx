import { useState, useRef } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useUnsavedPrompt } from "@/lib/settings-page";
import { api } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Icon, LoadingView, NoticeBox, Screen, Section, SegmentTabs, Fold, SettingsFooter } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { clearSemanticMemo } from "@/features/courses/use-semantic";
import { clearPhoneticMemo } from "@/features/courses/use-phonetic";
import { SynonymsEditor, useSynonymsDraft } from "@/features/search/synonyms-editor";

type Def = { key: string; group: string; label: string; desc: string; advice: string; type: "bool" | "number" | "choice"; default: boolean | number | string; min?: number; max?: number; step?: number; unit?: string; choices?: { value: string; label: string }[] };
type Data = { values: Record<string, boolean | number | string>; params: Def[]; groups: { key: string; title: string; intro: string }[] };
type Test = { min: number; rows: { kind: string; title: string; score: number; boost?: number }[]; note?: string };

const fmt = (v: number, step = 1) => (step < 1 ? v.toFixed(step < 0.1 ? 2 : 2).replace(/0+$/, "").replace(/\.$/, "") || "0" : String(v));

/**
 * 設定 › 搜尋與 AI 設定（杜杜龍 2026-11-25，超級管理員）：語意搜尋（AI 嵌入）、同音、模糊、排序、EDM 辨識的參數，
 * 每項附白話功能與建議值，改完按下方「儲存」；下方有「試搜尋」顯示相似度分數方便調門檻；最後是原本的「搜尋關聯詞」。
 */
export default function SearchSettingsScreen() {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<Data>(isSuper ? "/admin/search-settings" : null);
  const [vals, setVals] = useState<Data["values"] | null>(null);
  const [q, setQ] = useState("");
  const [test, setTest] = useState<Test | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  // 整頁只有一個「儲存」（杜杜龍 2026-11-26）：各參數先改草稿，統一按儲存才寫入；離開前有未存的修改會主動詢問。
  const syn = useSynonymsDraft();
  const valsDirty = !!vals && !!data && JSON.stringify(vals) !== JSON.stringify(data.values);
  const dirty = valsDirty || syn.dirty;
  const commitRef = useRef<() => Promise<boolean>>(async () => true);
  useUnsavedPrompt({ dirty, save: () => commitRef.current(), discard: () => (setVals(null), syn.discard()) });
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!data) return <Screen header={false}>{error ? <ErrorView message={error} onRetry={reload} /> : <LoadingView />}</Screen>;
  const cur = vals ?? data.values;
  /** 控制項的修改（只改草稿；reset＝全部換成建議值，也是草稿）。 */
  const save = (patch: Record<string, boolean | number | string>, reset = false) => {
    setVals(reset ? Object.fromEntries(data.params.map((p) => [p.key, p.default])) : { ...cur, ...patch });
  };
  const commit = async (): Promise<boolean> => {
    setSaving(true);
    try {
      if (valsDirty) await api<{ values: Data["values"] }>("PUT", "/admin/search-settings", { values: cur });
      if (syn.dirty) await syn.save();
      setVals(null);
      reload();
      clearSemanticMemo();
      clearPhoneticMemo();
      invalidate();
      flashText("已儲存");
      return true;
    } catch (e) {
      flashText((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  commitRef.current = commit;
  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api<Test>("GET", `/admin/search-settings/test?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      setTest({ min: Number(cur.semanticMin), rows: [], note: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  const control = (p: Def) => {
    const v = cur[p.key];
    if (p.type === "bool")
      return <SegmentTabs options={[{ key: "on", label: "開" }, { key: "off", label: "關" }]} value={v ? "on" : "off"} onChange={(k) => save({ [p.key]: k === "on" })} />;
    if (p.type === "choice")
      return <SegmentTabs options={(p.choices ?? []).map((x) => ({ key: x.value, label: x.label }))} value={String(v)} onChange={(k) => save({ [p.key]: k })} />;
    const n = Number(v);
    const step = p.step ?? 1;
    const bump = (d: number) => save({ [p.key]: Math.round(Math.min(p.max!, Math.max(p.min!, n + d * step)) * 1000) / 1000 });
    return (
      <View style={styles.numRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${p.label}減少`} disabled={n <= p.min!} onPress={() => bump(-1)} style={[styles.step, { borderColor: c.border, opacity: n <= p.min! ? 0.35 : 1 }]}>
          <Icon name="remove" size={26} color={c.text} />
        </Pressable>
        <AppText variant="title" style={{ minWidth: 110, textAlign: "center" }}>
          {fmt(n, step)}
          {p.unit ?? ""}
        </AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={`${p.label}增加`} disabled={n >= p.max!} onPress={() => bump(1)} style={[styles.step, { borderColor: c.border, opacity: n >= p.max! ? 0.35 : 1 }]}>
          <Icon name="add" size={26} color={c.text} />
        </Pressable>
      </View>
    );
  };
  const same = (p: Def) => cur[p.key] === p.default;
  return (
    <Screen header={false} footer={<SettingsFooter dirty={dirty} saving={saving} onSave={() => void commit()} onDiscard={() => (setVals(null), syn.discard())} />}>
      <NoticeBox text="這一頁所有設定（含下方搜尋關聯詞）改完後，統一按下方「儲存」才會生效，超派、至尊模式同時套用；有沒存的修改要離開時，系統會問你要儲存還是放棄。不確定就維持建議值；要全部還原按最下方「全部恢復建議值」。" />
      <Section fold title="搜尋關聯詞（打字自動儲存）">
        <SynonymsEditor draft={syn} />
      </Section>
      {data.groups.map((g) => (
        <Section fold key={g.key} title={g.title}>
          <AppText variant="caption" tone="muted">{g.intro}</AppText>
          {data.params.filter((p) => p.group === g.key).map((p) => (
            <Card key={p.key} style={{ gap: space.sm }}>
              <AppText variant="headline">{p.label}</AppText>
              <AppText variant="callout">{p.desc}</AppText>
              <AppText variant="callout" style={{ color: c.accentText, fontWeight: "700" }}>{p.advice}</AppText>
              {control(p)}
              {same(p) ? null : (
                <Pressable accessibilityRole="button" onPress={() => save({ [p.key]: p.default })} style={{ minHeight: 44, justifyContent: "center" }}>
                  <AppText variant="callout" style={{ color: c.accent, fontWeight: "700" }}>恢復建議值（{typeof p.default === "boolean" ? (p.default ? "開" : "關") : p.choices?.find((x) => x.value === p.default)?.label ?? fmt(Number(p.default), p.step)}{p.unit ?? ""}）</AppText>
                </Pressable>
              )}
            </Card>
          ))}
          {g.key === "semantic" ? (
            <Fold title="試搜尋（看相似度分數）">
              <AppText variant="callout">輸入一個詞（例如「水機」），列出 AI 認為最接近的前 20 筆。這裡的結果就是 App 實際搜尋的結果：只列已開啟的資料類別、分數含加分、依「顯示順序」排列，標「會顯示」的才會出現在搜尋結果。目前門檻 {fmt(Number(cur.semanticMin), 0.01)}。</AppText>
              <TextInput value={q} onChangeText={setQ} placeholder="輸入要測試的搜尋詞" placeholderTextColor={c.textMuted} onSubmitEditing={runTest} returnKeyType="search" style={[styles.input, { borderColor: c.border, backgroundColor: c.surface, color: c.text }]} />
              <Button label={testing ? "搜尋中…" : "試搜尋"} onPress={runTest} disabled={testing || q.trim().length < 2} />
              {test?.note ? <AppText variant="callout" tone="muted">{test.note}</AppText> : null}
              {test?.rows.map((r, i) => {
                const pass = r.score >= Number(cur.semanticMin);
                return (
                  <View key={i} style={[styles.hit, { borderColor: c.border }]}>
                    <AppText variant="headline" style={{ minWidth: 62, color: pass ? c.accentText : c.textMuted }}>{r.score.toFixed(2)}</AppText>
                    <View style={{ flex: 1 }}>
                      <AppText variant="callout" tone={pass ? undefined : "muted"} numberOfLines={2}>{r.title}</AppText>
                      <AppText variant="caption" tone="muted">{`${r.kind}　${pass ? "會顯示" : "低於門檻，不顯示"}${r.boost ? `　（已含加分 +${r.boost}）` : ""}`}</AppText>
                    </View>
                  </View>
                );
              })}
            </Fold>
          ) : null}
        </Section>
      ))}
      <Button label="全部恢復建議值" variant="cancel" onPress={() => save({}, true)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  numRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md },
  step: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: type.body.fontSize },
  hit: { flexDirection: "row", gap: space.sm, alignItems: "center", paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
