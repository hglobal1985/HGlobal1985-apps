import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, ShareIcon } from "@/ui";
import { showToast } from "@/ui/toast";

export type ShortLinkItem = { kind: "category" | "series" | "center"; value: string; slug: string | null };
const KIND = { category: "分類", series: "系列", center: "中心" } as const;
const host = () => (typeof location !== "undefined" ? location.host : "learn.hglobal1985.com");

/**
 * 一個分類／系列／中心的短網址（只有超級管理員）：輸入英文縮寫、儲存、分享、清除。
 * 課程頁「進階設定」與全部課程頁的中心 EDM 編輯都用這一列，網址是「網域/縮寫」（全站共用，不能重複）。
 */
export function ShortLinkRow({ item, onChanged, readOnly = false }: { item: ShortLinkItem; onChanged: () => void; /** 只能看、不能改（只有最高權限管理員能修改縮寫網址）。 */ readOnly?: boolean }) {
  const { c } = useTheme();
  const [draft, setDraft] = useState(item.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const value = draft.trim().toLowerCase();
  const dirty = value !== (item.slug ?? "");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
      showToast(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const r = await shareLink(item.value, `/${item.slug}`);
    if (r === "copied") showToast("已複製短網址");
  };
  const clear = async () => {
    if (!(await confirmSheet({ title: "清除短網址", message: `清除後，${host()}/${item.slug} 就打不開了。`, confirmLabel: "清除", cancelLabel: "先不要", danger: true }))) return;
    await run(() => api("POST", "/admin/short-links/remove", { kind: item.kind, value: item.value }), "已清除短網址");
    setDraft("");
  };
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="callout">
        {KIND[item.kind]}：{item.value}
      </AppText>
      <View style={styles.inputRow}>
        <AppText variant="callout" tone="muted">
          {host()}/
        </AppText>
        <TextInput
          value={draft}
          onChangeText={(v) => setDraft(v.replace(/[^A-Za-z0-9-]/g, ""))}
          placeholder="英文縮寫"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!readOnly}
          maxLength={30}
          accessibilityLabel={`${item.value} 的短網址縮寫`}
          style={[styles.input, type.body, { color: readOnly ? c.textMuted : c.text, borderColor: c.border, backgroundColor: readOnly ? c.surfaceMuted : c.surface }]}
        />
      </View>
      {readOnly ? (
        <AppText variant="caption" tone="muted">
          只有最高權限管理員可以修改英文縮寫網址。
        </AppText>
      ) : null}
      <View style={styles.btnRow}>
        {readOnly ? null : <Button label="儲存縮寫" icon="checkmark-outline" disabled={busy || !dirty || !value} loading={busy} onPress={() => run(() => api("PUT", "/admin/short-links", { kind: item.kind, value: item.value, slug: value }), `已儲存：${host()}/${value}`)} />}
        {item.slug && !dirty ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={`分享 ${item.value} 的短網址`} onPress={share} style={[styles.shareBtn, { borderColor: c.border }]}>
              <ShareIcon size={22} color={c.text} />
            </Pressable>
            {readOnly ? null : <Button variant="ghost" label="清除" disabled={busy} onPress={clear} />}
          </>
        ) : null}
      </View>
      {msg ? (
        <AppText variant="caption" tone="danger">
          {msg}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  input: { flex: 1, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  btnRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  shareBtn: { width: minTouch, height: minTouch, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
});
