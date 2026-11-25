import { useState } from "react";
import { TextInput, View } from "react-native";
import type { CoverMediaItem } from "@/api/client";
import { useModeProfile } from "@/lib/app-mode";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, ELDER_FIELD } from "@/ui";
import { CoverAlbum } from "./album";

/**
 * 相簿搜尋【共用模組】（業主 2026-11-25 永久指示：相簿與中心 EDM 的搜尋一律用這一份，不可另做）：
 * 一個搜尋框，比對照片的「AI 場景標籤」（scene）與「照片裡的文字 OCR」（text），多個詞用空白分開、每個詞都要符合；中心 EDM 另外比對活動日期。
 * 用法：整本相簿＝`<SearchableAlbum {...CoverAlbum 的參數} />`（搜尋框＋照片格）；區塊相簿要自己排版（BlockAlbum）就用 `useAlbumSearch`＋`AlbumSearchBar`＋`matchAlbumItem`。
 * 沒有任何照片有場景或文字（還沒辨識）時不顯示搜尋框。至尊模式用 ELDER_FIELD 同款粗框。
 */
export const albumSearchable = (items: { scene?: string; text?: string }[]) => items.some((p) => p.scene || p.text);

/** 一張照片符不符合搜尋字（key 已轉小寫去頭尾空白；空字串＝全符合）。 */
export function matchAlbumItem(p: Pick<CoverMediaItem, "scene" | "text" | "eventDate">, key: string): boolean {
  if (!key) return true;
  const hay = `${p.scene ?? ""} ${p.text ?? ""} ${p.eventDate ?? ""}`.toLowerCase();
  return key.split(/\s+/).every((t) => hay.includes(t));
}

export function useAlbumSearch() {
  const [q, setQ] = useState("");
  return { q, setQ, key: q.trim().toLowerCase() };
}

export function AlbumSearchBar({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const { c } = useTheme();
  const elder = useModeProfile().coursePage === "twoTabs";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accent }}>
        <AppText variant={elder ? "callout" : "caption"} style={{ color: c.textOnAccent, fontWeight: "800" }}>照片</AppText>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="搜尋照片裡的場景、文字、物品"
        placeholderTextColor={c.textMuted}
        accessibilityLabel="搜尋相簿照片"
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, minHeight: elder ? ELDER_FIELD.height() : 44, borderWidth: elder ? ELDER_FIELD.borderWidth : 1, borderColor: elder ? c.accent : c.border, borderRadius: elder ? ELDER_FIELD.radius : radius.md, paddingHorizontal: space.md, color: c.text, backgroundColor: c.surface, ...type.body }}
      />
    </View>
  );
}

type AlbumProps = Parameters<typeof CoverAlbum>[0];
/** 搜尋框＋相簿照片格：有搜尋字時只列符合的照片，且暫時不能排序／刪除（避免在篩選結果上誤動順序）。 */
export function SearchableAlbum(props: AlbumProps) {
  const { q, setQ, key } = useAlbumSearch();
  const shown = key ? props.items.filter((p) => matchAlbumItem(p, key)) : props.items;
  return (
    <View style={{ gap: space.sm }}>
      {albumSearchable(props.items) ? <AlbumSearchBar q={q} setQ={setQ} /> : null}
      {key && !shown.length ? <AppText tone="muted">沒有符合的照片</AppText> : <CoverAlbum {...props} items={shown} canEdit={props.canEdit && !key} />}
    </View>
  );
}
