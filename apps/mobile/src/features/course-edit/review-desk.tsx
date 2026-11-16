import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, DUTY_LABELS, HQ_UNIT, REVIEW_ROLE_LABEL, REVIEW_ROLES, type CourseDetail, type ReviewDesk, type ReviewGroup, type ReviewRole } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { shareReviewerInvite } from "@/lib/share";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Chips, NoticeBox } from "@/ui";
import { showToast } from "@/ui/toast";
import { Check } from "./course-sections";

/**
 * 「費用與審核」面板裡的「審核窗口」（業主 2026-11-16）：誰可以審核這門課的付費報名。每一項按下就立刻儲存（不必按面板的「儲存」）。
 * ① 審核群組（設定 > 審核群組 建好的名單）② 指定身份（主辦中心的會長／音控／小編）③ 指定會員：產生 24 小時有效、只能一人使用的邀請網址，
 * 用系統分享選單傳給對方（文字範本在「設定 > 分享預設值」），對方登入後打開、按「接受」就有審核權；下方列出已加入的人，可刪除。
 */
export function ReviewDeskBlock({ course }: { course: CourseDetail }) {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const isHq = member?.role === "admin";
  const desk = useApi<ReviewDesk>(`/admin/courses/${course.id}/review-desk`);
  const groups = useApi<ReviewGroup[]>("/admin/review-groups");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = desk.data;

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      desk.reload();
      if (done) showToast(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const setGroup = (id: string) =>
    run("group", async () => {
      await api("PATCH", `/admin/courses/${course.id}`, { reviewGroupId: id || null });
      invalidate();
    }, "已更新審核群組");
  const toggleRole = (r: ReviewRole, on: boolean) => {
    const next = REVIEW_ROLES.filter((x) => (x === r ? on : d?.roles.includes(x)));
    return run(`role:${r}`, () => api("PUT", `/admin/courses/${course.id}/review-roles`, { roles: next }), "已更新");
  };
  const invite = () =>
    run("invite", async () => {
      const r = await api<{ path: string }>("POST", `/admin/courses/${course.id}/review-invites`);
      const out = await shareReviewerInvite(course.title, r.path);
      if (out === "copied") showToast("已複製邀請文字與網址");
    });
  const remove = async (sub: string, name: string) => {
    if (!(await confirmAsk("刪除審核人員", `確定刪除「${name || "這位會員"}」的審核權限？刪除後他就不能審核這門課的報名。`, "刪除"))) return;
    await run(`del:${sub}`, () => api("DELETE", `/admin/courses/${course.id}/reviewers/${encodeURIComponent(sub)}`), "已刪除");
  };

  const groupOptions = (groups.data ?? []).filter((g) => (isHq ? course.guidanceUnit !== HQ_UNIT || g.ownerCenter === null : g.ownerCenter !== null)).map((g) => ({ key: g.id, label: g.name }));
  const box = [styles.box, { borderColor: c.border, backgroundColor: c.surface }];
  return (
    <View style={styles.wrap} accessibilityLabel="審核窗口">
      <View style={[styles.rule, { backgroundColor: c.border }]} />
      <AppText variant="title">審核窗口</AppText>
      <AppText variant="caption" tone="muted">
        誰可以審核這門課的付費報名。下面每一項按下就立刻儲存。總部（超級管理員、秘書）一律可以審核；學員所屬中心的會長也可以審核自己中心學員的報名。
      </AppText>
      {error ? <NoticeBox tone="danger" text={error} /> : null}

      <AppText variant="headline">① 審核群組</AppText>
      <AppText variant="caption" tone="muted">
        {"從「設定 > 審核群組」已建立的名單選一個。"}
      </AppText>
      <Chips options={[{ key: "", label: "不使用審核群組" }, ...groupOptions]} value={d?.groupId ?? ""} onChange={setGroup} label="審核群組" />
      {d?.groupId && d.groupMembers.length ? (
        <View style={box}>
          {d.groupMembers.map((m, i) => (
            <AppText key={i} variant="callout">
              {m.name || "（未命名）"}・{m.center || "全部中心"}・{DUTY_LABELS[m.duty as keyof typeof DUTY_LABELS] ?? m.duty}
            </AppText>
          ))}
        </View>
      ) : d?.groupId ? (
        <AppText variant="caption" tone="muted">
          {"這個群組目前沒有成員，請到「設定 > 審核群組」加入。"}
        </AppText>
      ) : null}

      <AppText variant="headline">② 指定身份</AppText>
      <AppText variant="caption" tone="muted">
        勾選後，主辦中心的這些身份也能審核這門課的所有報名；總部主辦的課，各中心的這些身份審核自己中心學員的報名。
      </AppText>
      {REVIEW_ROLES.map((r) => (
        <Check key={r} label={`主辦中心的${REVIEW_ROLE_LABEL[r]}`} value={!!d?.roles.includes(r)} onChange={(v) => void toggleRole(r, v)} disabled={!d || !!busy} />
      ))}

      <AppText variant="headline">③ 指定會員</AppText>
      <AppText variant="caption" tone="muted">
        按下面的按鈕會產生一個邀請網址，並叫出手機的分享選單傳給對方。網址 24 小時內有效、只能一個人使用；對方登入後打開、按「接受」就有審核權。
      </AppText>
      <Button variant="secondary" icon="person-add-outline" label="產生邀請網址並分享" loading={busy === "invite"} disabled={!!busy} onPress={invite} fullWidth />
      {d?.members.length ? (
        <View style={box}>
          {d.members.map((m) => (
            <View key={m.sub} style={styles.member}>
              <Ionicons name="person-circle-outline" size={28} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <AppText variant="body">{m.name || "（未命名會員）"}</AppText>
                <AppText variant="caption" tone="muted">
                  {m.addedAt.slice(0, 10)} 加入
                </AppText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`刪除審核人員 ${m.name}`} onPress={() => void remove(m.sub, m.name)} disabled={!!busy} style={({ pressed }) => [styles.del, { borderColor: c.border }, pressed && { opacity: 0.7 }]}>
                <Ionicons name="trash-outline" size={20} color={c.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : d ? (
        <AppText variant="caption" tone="muted">
          還沒有指定的會員。
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  rule: { height: 1, marginVertical: space.sm },
  box: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  member: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  del: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
