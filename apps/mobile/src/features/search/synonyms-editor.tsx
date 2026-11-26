import { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, EmptyState, ErrorView, LoadingView, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";

/**
 * 設定 › 搜尋關聯詞（杜杜龍 2026-11-25，超級管理員）：一行一組，詞之間用「＝」隔開，例如
 * 「王老師 = 王儷凱」「水課程 = 益之源 = 淨水器」。搜尋時，課程文字裡有其中一個詞，同組的其他詞也算這門課的搜尋文字；
 * 每個詞照樣支援打錯字（模糊比對）與 AI 語意搜尋。超派、至尊兩個模式的搜尋共用。
 * 杜杜龍 2026-11-26：不再自動儲存。草稿由 `useSynonymsDraft` 持有，跟著所在頁面唯一的「儲存」一起存。
 */
export type SynonymsDraft = { loaded: boolean; text: string; setText: (v: string) => void; dirty: boolean; save: () => Promise<void>; discard: () => void; error: string | null; reload: () => void };

export function useSynonymsDraft(): SynonymsDraft {
  const { member, invalidate } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const res = useApi<{ text: string }>(isSuper ? "/admin/search-synonyms" : null);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const saved = useRef<string>("");
  useEffect(() => {
    if (res.data && !loaded) {
      setText(res.data.text);
      saved.current = res.data.text;
      setLoaded(true);
    }
  }, [res.data, loaded]);
  return {
    loaded,
    text,
    setText,
    dirty: loaded && text !== saved.current,
    save: async () => {
      await api<{ groups: number }>("PUT", "/admin/search-synonyms", { text });
      saved.current = text;
      invalidate();
    },
    discard: () => setText(saved.current),
    error: res.error,
    reload: res.reload,
  };
}

export function SynonymsEditor({ draft }: { draft: SynonymsDraft }) {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  if (!isSuper) return <EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" />;
  if (!draft.loaded) return draft.error ? <ErrorView message={draft.error} onRetry={draft.reload} /> : <LoadingView />;
  return (
    <View style={{ gap: space.md }}>
      <NoticeBox text="一行一組，詞之間用「＝」隔開，例如：王老師 = 王儷凱。同一組的詞搜尋時視為相同意思，每個詞也照樣支援打錯字與意思相近搜尋。改完請按下方「儲存」。" />
      <TextInput
        value={draft.text}
        onChangeText={draft.setText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={"王老師 = 王儷凱\n水課程 = 益之源 = 淨水器"}
        placeholderTextColor={c.textMuted}
        style={[{ minHeight: 260, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top", color: c.text, borderColor: c.border, backgroundColor: c.surface, ...type.body }]}
      />
      <AppText variant="callout" style={{ color: draft.dirty ? c.warning : c.accentText, fontWeight: "700" }}>
        {draft.dirty ? "有修改還沒儲存" : "已儲存"}
      </AppText>
      <AppText variant="caption" tone="muted">每組至少兩個詞；最多 300 組，每個詞最長 30 字。</AppText>
    </View>
  );
}
