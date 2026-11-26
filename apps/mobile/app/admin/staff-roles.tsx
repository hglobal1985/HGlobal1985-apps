import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, type StaffMember, type StaffRole, type StaffSearch } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { centerTitle } from "@/features/format";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, Icon, LoadingView, LoadingLadybug, NoticeBox, Screen, Select } from "@/ui";
import { Check } from "@/ui/check";
import { SegmentTabs } from "@/ui/segment-tabs";
import { flashText } from "@/ui/flash-notice";

type Person = { memberId: string; name: string; center: string };
type Access = { available: boolean; assignable: StaffRole[] };
type CenterPage = { center: string; members: { memberId: string; name: string; signedIn: boolean }[]; next: string | null };
type Tab = "has" | "center" | "search";

/**
 * 會員職務指派（杜杜龍 2026-11-21；中央串接指令 2026-11-21.1，第三章 17、檢查清單 31）：
 * 直接修改「中央會員」的職務。只有中央判斷有權限的人才看得到入口；職務選項用中央回傳的 assignable_roles；
 * 指派＝送出「事後完整清單」，成功後用中央回應的 roles 更新畫面；名單與搜尋字只存在這個畫面的記憶體，不保存、不寫日誌。
 * 三種找人方式：有職務的人（可依中心篩選）／依中心列出所有會員／搜尋姓名（2～30 字）。
 */
export default function StaffRolesScreen() {
  const { c } = useTheme();
  const access = useApi<Access>("/staff-roles/access");
  const centers = useApi<string[]>(access.data?.available ? "/centers" : null);
  const [tab, setTab] = useState<Tab>("has");
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string[]>>({}); // 目前已知的職務（成功指派後用中央回應更新）
  const [editing, setEditing] = useState<Person | null>(null);
  const [staff, setStaff] = useState<StaffMember[] | null>(null); // 有職務的人（不帶 q 的查詢）
  const [staffCenter, setStaffCenter] = useState("");
  const [center, setCenter] = useState("");
  const [cq, setCq] = useState("");
  const [cItems, setCItems] = useState<CenterPage["members"]>([]);
  const [cNext, setCNext] = useState<string | null>(null);
  const [cLoading, setCLoading] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StaffMember[] | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const assignable = access.data?.assignable ?? [];
  const labelOf = (v: string) => assignable.find((r) => r.value === v)?.label ?? v;
  const learn = (list: StaffMember[]) => setRoles((cur) => ({ ...cur, ...Object.fromEntries(list.map((m) => [m.memberId, m.roles])) }));

  const loadStaff = async () => {
    setError(null);
    try {
      const r = await api<StaffSearch>("GET", "/staff-roles");
      setStaff(r.members);
      learn(r.members);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (access.data?.available) loadStaff();
  }, [access.data?.available]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCenter = async (cursor: string | null) => {
    if (!center) return;
    const id = ++seq.current;
    setCLoading(true);
    setError(null);
    try {
      const r = await api<CenterPage>("GET", `/staff-roles/center-members?center=${encodeURIComponent(center)}&q=${encodeURIComponent(cq.trim())}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (id !== seq.current) return;
      setCItems((cur) => (cursor ? [...cur, ...r.members] : r.members));
      setCNext(r.next);
    } catch (e) {
      if (id === seq.current) setError((e as Error).message);
    } finally {
      if (id === seq.current) setCLoading(false);
    }
  };
  useEffect(() => {
    if (!center) {
      setCItems([]);
      setCNext(null);
      return;
    }
    const t = setTimeout(() => loadCenter(null), 300);
    return () => clearTimeout(t);
  }, [center, cq]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    const t = q.trim();
    if (t.length < 2 || t.length > 30) {
      flashText("搜尋字請輸入 2 到 30 個字");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const r = await api<StaffSearch>("GET", `/staff-roles?q=${encodeURIComponent(t)}`);
      setFound(r.members);
      learn(r.members);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  if (access.loading && !access.data) return <LoadingView />;
  if (!access.data?.available)
    return (
      <Screen header={false}>
        <EmptyState icon="lock-closed-outline" title="你沒有指派職務的權限" body="只有會員中心授權的人可以使用" />
      </Screen>
    );

  const rolesOf = (id: string, fallback: string[] = []) => roles[id] ?? fallback;
  const row = (p: Person, key: string, note?: string) => {
    const mine = rolesOf(p.memberId);
    return (
      <Pressable key={key} accessibilityRole="button" accessibilityLabel={`設定${p.name || "這位會員"}的職務`} onPress={() => setEditing(p)} style={[styles.person, { borderColor: c.border, backgroundColor: c.surface }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body">{p.name || "（沒有顯示名稱）"}</AppText>
          {p.center ? (
            <AppText variant="caption" tone="muted">
              {centerTitle(p.center)}
            </AppText>
          ) : null}
          <AppText variant="caption" style={{ color: mine.length ? c.accentText : c.textMuted, fontWeight: "700" }}>
            {mine.length ? mine.map(labelOf).join("、") : note ?? "沒有職務"}
          </AppText>
        </View>
        <Icon name="chevron-forward" size={22} color={c.textMuted} />
      </Pressable>
    );
  };
  const staffCenters = [...new Set((staff ?? []).map((m) => m.center).filter(Boolean))];
  const staffShown = (staff ?? []).filter((m) => !staffCenter || m.center === staffCenter);

  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        直接修改會員中心的會員職務。點選會員、勾選職務，確認後立刻生效；名單只在這個畫面顯示，不會保存。
      </AppText>
      <SegmentTabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { key: "has", label: "有職務的人" },
          { key: "center", label: "依中心" },
          { key: "search", label: "搜尋姓名" },
        ]}
      />
      {error ? <NoticeBox tone="danger" text={error} /> : null}

      {tab === "has" ? (
        <>
          {staffCenters.length ? <Select label="中心" value={staffCenter} options={[{ key: "", label: "全部中心" }, ...staffCenters.map((x) => ({ key: x, label: centerTitle(x) }))]} onChange={setStaffCenter} /> : null}
          {staff === null && !error ? <LoadingView /> : null}
          {staff && !staffShown.length ? <EmptyState icon="people-outline" title="沒有符合的人" /> : null}
          {staffShown.map((m) => row(m, `s:${m.memberId}`))}
          {staff ? <Button variant="secondary" label="重新整理" onPress={loadStaff} fullWidth /> : null}
        </>
      ) : null}

      {tab === "center" ? (
        <>
          <Select label="中心" value={center} options={[{ key: "", label: "請選擇中心" }, ...(centers.data ?? []).map((x) => ({ key: x, label: centerTitle(x) }))]} onChange={setCenter} />
          {center ? (
            <View style={[styles.search, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Icon name="search" size={20} color={c.textMuted} />
              <TextInput value={cq} onChangeText={setCq} placeholder="在這個中心裡找姓名" placeholderTextColor={c.textMuted} autoCorrect={false} maxLength={30} accessibilityLabel="在這個中心裡搜尋姓名" style={[type.body, { flex: 1, color: c.text, minHeight: minTouch }]} />
            </View>
          ) : (
            <AppText variant="caption" tone="muted">
              先選擇中心，會列出該中心的所有會員。
            </AppText>
          )}
          {cItems.map((m) => row({ memberId: m.memberId, name: m.name, center }, `c:${m.memberId}`, "還沒有職務（或職務尚未載入）"))}
          {cLoading ? <LoadingLadybug /> : null}
          {center && !cLoading && !cItems.length && !error ? <EmptyState icon="people-outline" title="沒有符合的會員" /> : null}
          {cNext && !cLoading ? <Button variant="secondary" label="載入更多" onPress={() => loadCenter(cNext)} fullWidth /> : null}
        </>
      ) : null}

      {tab === "search" ? (
        <>
          <View style={[styles.search, { borderColor: c.border, backgroundColor: c.surface }]}>
            <Icon name="search" size={20} color={c.textMuted} />
            <TextInput value={q} onChangeText={setQ} onSubmitEditing={search} returnKeyType="search" placeholder="輸入 2 到 30 個字" placeholderTextColor={c.textMuted} autoCorrect={false} maxLength={30} accessibilityLabel="搜尋會員姓名" style={[type.body, { flex: 1, color: c.text, minHeight: minTouch }]} />
          </View>
          <Button label="搜尋" icon="search" onPress={search} loading={searching} disabled={q.trim().length < 2} fullWidth />
          {found && !found.length ? <EmptyState icon="people-outline" title="找不到符合的會員" /> : null}
          {(found ?? []).map((m) => row(m, `f:${m.memberId}`))}
        </>
      ) : null}

      {editing ? (
        <RoleSheet
          person={editing}
          assignable={assignable}
          current={rolesOf(editing.memberId)}
          known={editing.memberId in roles}
          onClose={() => setEditing(null)}
          onSaved={(id, next) => {
            setRoles((cur) => ({ ...cur, [id]: next }));
            setStaff((cur) => (cur ? (next.length ? (cur.some((m) => m.memberId === id) ? cur.map((m) => (m.memberId === id ? { ...m, roles: next } : m)) : [...cur, { memberId: id, name: editing.name, center: editing.center, roles: next }]) : cur.filter((m) => m.memberId !== id)) : cur));
            setEditing(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** 勾選職務（選項＝中央的 assignable_roles）→ 確認 → 送出事後完整清單；成功後用中央回應的 roles 更新。 */
function RoleSheet({ person, assignable, current, known, onClose, onSaved }: { person: Person; assignable: StaffRole[]; current: string[]; known: boolean; onClose: () => void; onSaved: (id: string, roles: string[]) => void }) {
  const [base, setBase] = useState<string[]>(current);
  const [loadingBase, setLoadingBase] = useState(!known);
  const [pick, setPick] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (v: string) => assignable.find((r) => r.value === v)?.label ?? v;
  // 這位會員目前的職務還沒載入過（例如從「依中心」點進來）：先用姓名向中央查一次，避免把原有的職務蓋掉。
  useEffect(() => {
    if (known) return;
    let alive = true;
    (async () => {
      try {
        if (person.name.trim().length >= 2) {
          const r = await api<StaffSearch>("GET", `/staff-roles?q=${encodeURIComponent(person.name.trim().slice(0, 30))}`);
          const mine = r.members.find((m) => m.memberId === person.memberId)?.roles;
          if (alive && mine) {
            setBase(mine);
            setPick(mine);
          }
        }
      } catch {
        /* 查不到就當作目前沒有職務 */
      } finally {
        if (alive) setLoadingBase(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const same = pick.length === base.length && pick.every((r) => base.includes(r));
  const save = async () => {
    const added = pick.filter((r) => !base.includes(r));
    const removed = base.filter((r) => !pick.includes(r));
    const lines = [added.length ? `新增：${added.map(label).join("、")}` : "", removed.length ? `移除：${removed.map(label).join("、")}` : ""].filter(Boolean).join("\n");
    if (!(await confirmSheet({ title: "確認修改職務", message: `將「${person.name || "這位會員"}」的職務改為${pick.length ? `「${pick.map(label).join("、")}」` : "「沒有職務」"}？\n${lines}`, confirmLabel: "確定修改", cancelLabel: "先不要", danger: removed.length > 0 }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ roles: string[] }>("PUT", `/staff-roles/${encodeURIComponent(person.memberId)}`, { roles: pick });
      flashText("職務已更新");
      onSaved(person.memberId, r.roles);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title={`${person.name || "會員"}的職務`} onClose={onClose} onSave={save} dirty={!same} busy={busy || loadingBase} error={error} saveLabel="修改職務">
      {person.center ? (
        <AppText variant="caption" tone="muted">
          {centerTitle(person.center)}
        </AppText>
      ) : null}
      {loadingBase ? <LoadingLadybug /> : null}
      {!assignable.length ? <NoticeBox text="中央沒有開放可指派的職務。" /> : null}
      {assignable.map((r) => (
        <Check key={r.value} label={r.label} value={pick.includes(r.value)} disabled={busy || loadingBase} onChange={(v) => setPick((cur) => (v ? [...new Set([...cur, r.value])] : cur.filter((x) => x !== r.value)))} />
      ))}
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, padding: space.md, borderWidth: 1, borderRadius: radius.md },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
});
