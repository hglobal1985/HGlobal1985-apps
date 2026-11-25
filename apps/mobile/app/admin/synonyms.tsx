import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, EmptyState, ErrorView, LoadingView, NoticeBox, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/**
 * 設定 › 搜尋關聯詞（業主 2026-11-25，超級管理員）：一行一組，詞之間用「＝」隔開，例如
 * 「王老師 = 王儷凱」「水課程 = 益之源 = 淨水器」。搜尋時，課程文字裡有其中一個詞，同組的其他詞也算這門課的搜尋文字；
 * 每個詞照樣支援打錯字（模糊比對）與 AI 語意搜尋。超派、至尊兩個模式的搜尋共用。
 */
export default function SynonymsScreen() {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const res = useApi<{ text: string }>(isSuper ? "/admin/search-synonyms" : null);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (res.data && !loaded) {
      setText(res.data.text);
      setLoaded(true);
    }
  }, [res.data, loaded]);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!res.data) return <Screen header={false}>{res.error ? <ErrorView message={res.error} onRetry={res.reload} /> : <LoadingView />}</Screen>;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ groups: number }>("PUT", "/admin/search-synonyms", { text });
      flashText(`已儲存，共 ${r.groups} 組關聯詞`);
      invalidate();
      res.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen header={false}>
      <NoticeBox text="一行一組，詞之間用「＝」隔開，例如：王老師 = 王儷凱。同一組的詞搜尋時視為相同意思，每個詞也照樣支援打錯字與意思相近的搜尋；超派、至尊模式共用。" />
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={"王老師 = 王儷凱\n水課程 = 益之源 = 淨水器"}
        placeholderTextColor={c.textMuted}
        style={[{ minHeight: 260, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top", color: c.text, borderColor: c.border, backgroundColor: c.surface, fontSize: type.body.fontSize }]}
      />
      <View style={{ minHeight: minTouch }}>
        <Button label={busy ? "儲存中…" : "儲存"} onPress={save} disabled={busy} />
      </View>
      <AppText variant="caption" tone="muted">每組至少兩個詞；最多 300 組，每個詞最長 30 字。</AppText>
    </Screen>
  );
}
