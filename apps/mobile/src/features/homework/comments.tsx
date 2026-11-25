import { useState } from "react";
import { View } from "react-native";
import { api, type HwSubmission } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Field } from "@/ui";
import { hwWhen } from "./format";

const ROLE = { teacher: "老師", leader: "組長", student: "學員" } as const;

/** 一份作業下面的留言（學員本人、組長、老師）。 */
export function HwComments({ sub, onChanged }: { sub: HwSubmission; onChanged: (s: HwSubmission) => void }) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sub.comments.length && !sub.canComment) return null;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api<HwSubmission>("POST", `/homework/s/${sub.id}/comments`, { body: text }));
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="headline">留言</AppText>
      {sub.comments.map((m) => (
        <View key={m.id} style={{ backgroundColor: m.role === "teacher" ? c.accentSoft : c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2 }}>
          <AppText variant="caption" tone={m.role === "teacher" ? "accent" : "muted"}>
            {ROLE[m.role]}・{m.authorName}・{hwWhen(m.createdAt)}
          </AppText>
          <AppText variant="callout">{m.body}</AppText>
        </View>
      ))}
      {sub.canComment ? (
        <>
          <Field label="寫留言" value={text} onChange={setText} placeholder="鼓勵或提醒" multiline />
          {error ? <AppText tone="danger">{error}</AppText> : null}
          <Button variant="secondary" label="送出留言" icon="chatbubble-outline" disabled={busy || !text.trim()} loading={busy} onPress={send} fullWidth />
        </>
      ) : null}
    </View>
  );
}
