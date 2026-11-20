import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button } from "@/ui";

/**
 * 指定邀請制課程的報名鈕（業主 2026-11-20）：先是「報名課程」；按下後按鈕原地變成「輸入邀請碼」，
 * 旁邊有「無邀請碼」（改走一般的人工審核）與「確定」（邀請碼正確就免審核直接開通）。
 * 課程沒有設邀請碼時，直接送出申請（一律人工審核）。
 */
export function InviteJoin({ hasCode, busy, error, onSubmit }: { hasCode: boolean; busy: boolean; error?: string | null; onSubmit: (code?: string) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  if (!open)
    return hasCode ? (
      <Button label="報名課程" icon="key-outline" disabled={busy} onPress={() => setOpen(true)} fullWidth />
    ) : (
      <Button label="申請報名・等候人工審核" icon="create-outline" loading={busy} disabled={busy} onPress={() => onSubmit()} fullWidth />
    );
  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        accessibilityLabel="邀請碼"
        value={code}
        onChangeText={(v) => setCode(v.slice(0, 40))}
        placeholder="請輸入邀請碼"
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onSubmitEditing={() => code.trim() && onSubmit(code.trim())}
        style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
      />
      {error ? (
        <AppText variant="caption" style={{ color: c.danger }}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="無邀請碼" disabled={busy} onPress={() => onSubmit()} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="確定" loading={busy} disabled={busy || !code.trim()} onPress={() => onSubmit(code.trim())} fullWidth />
        </View>
      </View>
      <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
        沒有邀請碼？按「無邀請碼」，由人工審核後開通。
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 18, textAlign: "center", letterSpacing: 2 },
  row: { flexDirection: "row", gap: space.sm },
});
