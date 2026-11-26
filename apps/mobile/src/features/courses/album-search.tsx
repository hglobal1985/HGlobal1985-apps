import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { api, type CoverMediaItem } from "@/api/client";
import { useModeProfile } from "@/lib/app-mode";
import { useTheme } from "@/theme/theme";
import { radius, space, type } from "@/theme/tokens";
import { AppText, ELDER_FIELD } from "@/ui";
import { CoverAlbum } from "./album";
import { useSearchSettings } from "./use-search-settings";

/**
 * 相簿搜尋【共用模組】（杜杜龍 2026-11-25 永久指示：相簿與中心 EDM 的搜尋一律用這一份，不可另做）：
 * 一個搜尋框，比對照片的「AI 場景標籤」（scene）與「照片裡的文字 OCR」（text），多個詞用空白分開、每個詞都要符合；中心 EDM 另外比對活動日期。
 * 用法：整本相簿＝`<SearchableAlbum {...CoverAlbum 的參數} />`（搜尋框＋照片格）；區塊相簿要自己排版（BlockAlbum）就用 `useAlbumSearch`＋`AlbumSearchBar`＋`matchAlbumItem`。
 * 沒有任何照片有場景或文字（還沒辨識）時不顯示搜尋框。至尊模式用 ELDER_FIELD 同款粗框。
 */
export const albumSearchable = (items: { scene?: string; text?: string }[]) => items.some((p) => p.scene || p.text);

/**
 * 一張照片符不符合搜尋字（key 已轉小寫去頭尾空白；空字串＝全符合）。
 * sem＝語意搜尋找到的「意思相近」照片編號（杜杜龍 2026-11-26：搜「下午茶」要找到寫「午茶交流會」的 EDM）；字面符合或語意符合都算。
 */
export function matchAlbumItem(p: Pick<CoverMediaItem, "id" | "scene" | "text" | "eventDate">, key: string, sem?: Set<string>): boolean {
  if (!key) return true;
  if (sem?.has(p.id)) return true;
  const hay = `${p.scene ?? ""} ${p.text ?? ""} ${p.eventDate ?? ""}`.toLowerCase();
  return key.split(/\s+/).every((t) => hay.includes(t));
}

const semMemo = new Map<string, string[]>();
/**
 * 相簿的語意搜尋（杜杜龍 2026-11-26）：跟全站同一套 AI 語意搜尋（`/albums/semantic`，用「搜尋與 AI 設定」的門檻與來源），
 * 停止打字 0.5 秒才問伺服器；回意思相近的照片編號。語意搜尋關閉、沒登入、AI 沒回應時回空集合（字面比對照常）。所有相簿搜尋都用它，不可另做。
 */
export function useAlbumSemantic(key: string, enabled = true): Set<string> {
  const on = useSearchSettings().semanticEnabled && enabled;
  const [res, setRes] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  useEffect(() => {
    if (!on || key.length < 2) return;
    const hit = semMemo.get(key);
    if (hit) return void setRes({ key, ids: hit });
    let alive = true;
    const t = setTimeout(() => {
      api<{ ids: string[] }>("GET", `/albums/semantic?q=${encodeURIComponent(key)}`)
        .then((r) => {
          semMemo.set(key, r.ids);
          if (alive) setRes({ key, ids: r.ids });
        })
        .catch(() => alive && setRes({ key, ids: [] }));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, on]);
  return new Set(on && res.key === key ? res.ids : []);
}

export function useAlbumSearch() {
  const [q, setQ] = useState("");
  const key = q.trim().toLowerCase();
  return { q, setQ, key, sem: useAlbumSemantic(key) };
}

export function AlbumSearchBar({ q, setQ, dark = false, scope, onScope, placeholder }: { q: string; setQ: (v: string) => void; /** 全黑看圖畫面（相簿資料夾檢視）用深色款式。 */ dark?: boolean; /** 有給 onScope 才顯示「此頁／全部」切換（相簿資料夾檢視：預設只搜此頁，可切成全部相簿）。 */ scope?: "page" | "all"; onScope?: (s: "page" | "all") => void; placeholder?: string }) {
  const { c } = useTheme();
  const elder = useModeProfile().coursePage === "twoTabs";
  const text = dark ? "#fff" : c.text;
  const muted = dark ? "#9a9aa0" : c.textMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      {dark ? null : (
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.accent }}>
          <AppText variant={elder ? "callout" : "caption"} style={{ color: c.textOnAccent, fontWeight: "800" }}>照片</AppText>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, minHeight: dark ? 48 : elder ? ELDER_FIELD.height() : 44, borderWidth: dark ? 0 : elder ? ELDER_FIELD.borderWidth : 1, borderColor: elder ? c.accent : c.border, borderRadius: dark ? 24 : elder ? ELDER_FIELD.radius : radius.md, paddingLeft: space.md, paddingRight: dark ? 6 : space.md, backgroundColor: dark ? "#262629" : c.surface }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={placeholder ?? "搜尋照片裡的場景、文字、物品"}
          placeholderTextColor={muted}
          accessibilityLabel="搜尋相簿照片"
          returnKeyType="search"
          style={{ flex: 1, minWidth: 0, color: text, ...type.body }}
        />
        {dark && q ? (
          <Pressable accessibilityLabel="清除搜尋" onPress={() => setQ("")} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={muted} />
          </Pressable>
        ) : null}
        {onScope
          ? (["page", "all"] as const).map((x) => (
              <Pressable key={x} accessibilityRole="button" accessibilityState={{ selected: scope === x }} onPress={() => onScope(x)} style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: scope === x ? "#2e7d32" : "transparent" }}>
                <AppText variant="caption" style={{ color: "#fff", fontWeight: "800" }}>{x === "page" ? "此頁" : "全部"}</AppText>
              </Pressable>
            ))
          : null}
      </View>
    </View>
  );
}

type AlbumProps = Parameters<typeof CoverAlbum>[0];
/** 搜尋框＋相簿照片格：有搜尋字時只列符合的照片，且暫時不能排序／刪除（避免在篩選結果上誤動順序）。 */
export function SearchableAlbum(props: AlbumProps) {
  const { q, setQ, key, sem } = useAlbumSearch();
  const shown = key ? props.items.filter((p) => matchAlbumItem(p, key, sem)) : props.items;
  return (
    <View style={{ gap: space.sm }}>
      {albumSearchable(props.items) ? <AlbumSearchBar q={q} setQ={setQ} /> : null}
      {key && !shown.length ? <AppText tone="muted">沒有符合的照片</AppText> : <CoverAlbum {...props} items={shown} canEdit={props.canEdit && !key} />}
    </View>
  );
}
