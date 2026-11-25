import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, EmptyState, ErrorView, LoadingView, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/**
 * 設定 › 搜尋關聯詞（業主 2026-11-25，超級管理員）：一行一組，詞之間用「＝」隔開，例如
 * 「王老師 = 王儷凱」「水課程 = 益之源 = 淨水器」。搜尋時，課程文字裡有其中一個詞，同組的其他詞也算這門課的搜尋文字；
 * 每個詞照樣支援打錯字（模糊比對）與 AI 語意搜尋。超派、至尊兩個模式的搜尋共用。
 */
export function SynonymsEditor() {
  const { c } = useTheme();
  const { member, invalidate } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const res = useApi<{ text: string }>(isSuper ? "/admin/search-synonyms" : null);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (res.data && !loaded) {
      setText(res.data.text);
      lastSaved.current = res.data.text;
      setLoaded(true);
    }
  }, [res.data, loaded]);
  // 不需要按儲存（業主 2026-11-25）：打字停 0.8 秒、或離開輸入框就自動儲存，立即生效。
  const save = async (value: string) => {
    if (value === lastSaved.current) return;
    setStatus("saving");
    try {
      await api<{ groups: number }>("PUT", "/admin/search-synonyms", { text: value });
      lastSaved.current = value;
      setStatus("saved");
      invalidate();
    } catch (e) {
      setStatus("error");
      flashText((e as Error).message);
    }
  };
  useEffect(() => {
    if (!loaded || text === lastSaved.current) return;
    const t = setTimeout(() => void save(text), 800);
    return () => clearTimeout(t);
  }, [text, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isSuper) return <EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" />;
  if (!res.data) return res.error ? <ErrorView message={res.error} onRetry={res.reload} /> : <LoadingView />;
  return (
    <View style={{ gap: space.md }}>
      <NoticeBox text="一行一組，詞之間用「＝」隔開，例如：王老師 = 王儷凱。同一組的詞搜尋時視為相同意思，每個詞也照樣支援打錯字與意思相近的搜尋；超派、至尊模式共用。" />
      <TextInput
        value={text}
        onChangeText={(v) => (setStatus("idle"), setText(v))}
        onBlur={() => void save(text)}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={"王老師 = 王儷凱\n水課程 = 益之源 = 淨水器"}
        placeholderTextColor={c.textMuted}
        style={[{ minHeight: 260, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top", color: c.text, borderColor: c.border, backgroundColor: c.surface, fontSize: type.body.fontSize }]}
      />
      <AppText variant="callout" style={{ color: status === "error" ? c.danger : c.accentText, fontWeight: "700" }}>
        {status === "saving" ? "自動儲存中…" : status === "saved" ? "已自動儲存，立即生效" : status === "error" ? "儲存失敗，請再改一下內容重試" : "打完字會自動儲存，不用按儲存"}
      </AppText>
      <AppText variant="caption" tone="muted">每組至少兩個詞；最多 300 組，每個詞最長 30 字。</AppText>
    </View>
  );
}
