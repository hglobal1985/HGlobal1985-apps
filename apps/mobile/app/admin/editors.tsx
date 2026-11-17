import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, resolveUrl, type CourseEditor, type EditorCandidate } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { Check } from "@/features/course-edit/course-sections";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { centerTitle } from "@/features/format";
import { canManageEditors } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Icon, LoadingView, LoadingLadybug, NoticeBox, Screen, Select } from "@/ui";
import { flashText } from "@/ui/flash-notice";

const ALL = "";

/**
 * 小編管理（總部、各中心的會長與音控）：從會員中心的「同中心會員名單」點選會員擔任小編，
 * 每位小編三個權限各自開關：新增課程（自己新增的課程有完整權限）、修改別人的課程、刪除別人的課程。
 * 小編身分只存在行動大學；小編換了中心會自動失效。
 */
export default function EditorsScreen() {
  const { member } = useSession();
  const allowed = canManageEditors(member);
  const isHq = !!member?.courseRights?.all;
  const centers = useApi<string[]>(allowed && isHq ? "/centers" : null);
  const [center, setCenter] = useState(isHq ? ALL : (member?.courseRights?.center ?? ""));
  const q = center ? `?center=${encodeURIComponent(center)}` : "";
  const list = useApi<CourseEditor[]>(allowed ? `/admin/editors${q}` : null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowed)
    return (
      <Screen header={false}>
        <EmptyState icon="lock-closed-outline" title="只有總部、各中心的會長與音控可以管理小編" />
      </Screen>
    );
  const patch = async (e: CourseEditor, body: Record<string, boolean>) => {
    setBusy(e.memberId);
    setError(null);
    try {
      await api("PATCH", `/admin/editors/${e.memberId}`, { ...body, center: e.center });
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (e: CourseEditor) => {
    if (!(await confirmSheet({ title: "移除小編", message: `確定取消「${e.name || "這位會員"}」在${centerTitle(e.center)}的小編身分？會寄通知給對方；他新增過的課程仍會保留。`, confirmLabel: "移除", cancelLabel: "先不要", danger: true }))) return;
    setBusy(e.memberId);
    try {
      await api("DELETE", `/admin/editors/${e.memberId}?center=${encodeURIComponent(e.center)}`);
      list.reload();
      flashText("已移除小編");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        小編可以協助編輯該中心的課程與章節。三種權限各自開關；被指派或取消時，對方會收到通知與 Email。
      </AppText>
      {isHq ? <Select label="中心" value={center} options={[{ key: ALL, label: "全部中心" }, ...(centers.data ?? []).map((x) => ({ key: x, label: x }))]} onChange={setCenter} /> : <NoticeBox text={`你管理的是「${center}」的小編。`} />}
      {center ? <Button label="新增小編" icon="person-add-outline" onPress={() => setAdding(true)} fullWidth /> : <AppText variant="caption" tone="muted">要新增小編，請先選擇中心。</AppText>}
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      {list.error && !list.data ? <ErrorView message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <LoadingView /> : null}
      {list.data && !list.data.length ? <EmptyState icon="people-outline" title="還沒有小編" /> : null}
      {(list.data ?? []).map((e) => (
        <Card key={`${e.center}:${e.memberId}`}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <AppText variant="headline">{e.name || "（對方登入後顯示姓名）"}</AppText>
              <AppText variant="caption" tone="muted">
                {centerTitle(e.center)}
              </AppText>
            </View>
            <Button variant="ghost" label="移除" disabled={busy === e.memberId} onPress={() => remove(e)} />
          </View>
          <Check label="新增課程（自己新增的課程可以完整修改、刪除）" value={e.canCreate} disabled={busy === e.memberId} onChange={(v) => patch(e, { canCreate: v })} />
          <Check label="修改別人的課程（含上下架、價格、資格、審核群組、中心首頁圖）" value={e.canEditOthers} disabled={busy === e.memberId} onChange={(v) => patch(e, { canEditOthers: v })} />
          <Check label="刪除別人的課程（有人報名的改為下架封存）" value={e.canDeleteOthers} disabled={busy === e.memberId} onChange={(v) => patch(e, { canDeleteOthers: v })} />
        </Card>
      ))}
      {adding && center ? <AddEditorSheet center={center} onClose={() => setAdding(false)} onAdded={list.reload} /> : null}
    </Screen>
  );
}

/** 從會員中心的同中心名單挑人（可打字搜尋顯示名稱；名單不保存）。點一下就指派（預設只有「新增課程」，之後可再調整）。 */
function AddEditorSheet({ center, onClose, onAdded }: { center: string; onClose: () => void; onAdded: () => void }) {
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<EditorCandidate[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);
  const load = async (cursor: string | null) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ members: EditorCandidate[]; next: string | null }>("GET", `/admin/editors/candidates?center=${encodeURIComponent(center)}&q=${encodeURIComponent(q.trim())}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (id !== seq.current) return;
      setItems((cur) => (cursor ? [...cur, ...r.members] : r.members));
      setNext(r.next);
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(() => load(null), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (m: EditorCandidate) => {
    if (!(await confirmSheet({ title: "指派小編", message: `指派「${m.name}」為${center}的小編？預設權限是「新增課程」，指派後可以再調整。對方會收到通知與 Email。`, confirmLabel: "指派", cancelLabel: "先不要" }))) return;
    setBusy(m.memberId);
    try {
      await api("POST", "/admin/editors", { memberId: m.memberId, name: m.name, center });
      setItems((cur) => cur.map((x) => (x.memberId === m.memberId ? { ...x, already: true } : x)));
      onAdded();
      flashText(`已指派 ${m.name}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <EditSheet title={`新增${center}的小編`} onClose={onClose} hideSave>
      <View style={[styles.search, { borderColor: c.border, backgroundColor: c.surface }]}>
        <Icon name="search" size={20} color={c.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder="搜尋顯示名稱" placeholderTextColor={c.textMuted} autoCorrect={false} accessibilityLabel="搜尋會員顯示名稱" style={[type.body, { flex: 1, color: c.text, minHeight: minTouch }]} />
      </View>
      <AppText variant="caption" tone="muted">
        名單來自會員中心：只會列出{center}已審核的會員。
      </AppText>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      {items.map((m) => (
        <Pressable key={m.memberId} accessibilityRole="button" accessibilityState={{ disabled: m.already }} disabled={m.already || !!busy} onPress={() => add(m)} style={[styles.person, { borderColor: c.border, opacity: m.already ? 0.5 : 1 }]}>
          {m.avatarUrl ? <Image source={{ uri: resolveUrl(m.avatarUrl) }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: c.surfaceMuted, alignItems: "center", justifyContent: "center" }]}><Icon name="person" size={22} color={c.textMuted} /></View>}
          <View style={{ flex: 1 }}>
            <AppText variant="body">{m.name || "（沒有顯示名稱）"}</AppText>
            <AppText variant="caption" tone="muted">
              {m.already ? "已經是小編" : m.signedIn ? "點一下指派" : "還沒登入過行動大學（仍可指派）"}
            </AppText>
          </View>
          {!m.already ? <Icon name="add-circle-outline" size={26} color={c.accent} /> : null}
        </Pressable>
      ))}
      {loading ? <LoadingLadybug /> : null}
      {!loading && !items.length && !error ? <EmptyState icon="people-outline" title="沒有符合的會員" /> : null}
      {next && !loading ? <Button variant="secondary" label="載入更多" onPress={() => load(next)} fullWidth /> : null}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  person: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, padding: space.sm, borderWidth: 1, borderRadius: radius.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
});
