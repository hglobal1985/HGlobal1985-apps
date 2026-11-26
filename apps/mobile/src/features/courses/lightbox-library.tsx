import { lightboxItem } from "./edm-viewer";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { api, resolveUrl, type AlbumFolder, type AlbumsResponse, type CoverMediaItem, type RecipesResponse } from "@/api/client";
import { centerTitle } from "@/features/format";
import { AlbumUploadButton } from "@/features/uploads/album-upload";
import { RecipeZone } from "@/features/recipes/recipe-zone";
import { LightboxGrid } from "./lightbox-grid";
import { AlbumInfoPanel, AlbumPermissionsPanel } from "./album-admin";
import { AlbumBackHeader } from "./album-header";
import { SubfolderHome, SubfolderSheet, useSubfolders, type FolderSheetState } from "./album-subfolders";
import { AlbumSearchBar, matchAlbumItem, useAlbumSemantic } from "./album-search";
import { trackUsage } from "@/lib/usage";
import { saveAlbumPos } from "@/lib/album-memory";
import { useInsets } from "@/lib/inline-page";
import { usePageBack } from "@/lib/page-back";
import { isSuperAdmin } from "@/lib/roles";
import { useThumb } from "@/lib/thumb";
import { useApi, useSession } from "@/state/session";
import { AppText, TopBarButton } from "@/ui";
import { useHeaderSlot } from "@/ui/header-slot";
import { FLASH_ICON, flashText, showFlash } from "@/ui/flash-notice";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

/** 在資料夾裡選了什麼：folder＝null 代表「搜尋結果」；index＝從哪一張開始看。 */
export type LibraryPick = { folder: AlbumFolder | null; title: string; items: CoverMediaItem[]; index?: number };
type Found = CoverMediaItem & { folderId: string; folderTitle: string };

const folderName = (f: AlbumFolder) => (f.kind === "center" ? centerTitle(f.title) : f.title);

/**
 * 全螢幕看圖裡的「相簿」資料夾檢視（杜杜龍 2026-11-25，款式 C 為主架構＋B 的搜尋＋A 的側邊欄；與全螢幕看圖 `EdmLightbox`／「檢視全部」`LightboxGrid` 是同一套模組，不另做）：
 * ①上方一排「大類別」標籤（中心 EDM、中心封面、系列、課程封面、區塊相簿），下面一律兩欄資料夾卡（4 格預覽、名稱、張數），資料夾自動按張數多到少排；
 * ②搜尋框可選「此頁」（預設，只搜目前類別的資料夾）或「全部」（搜全部相簿照片的場景標籤、照片文字 OCR）；
 * ③左上角選單鈕開側邊欄：列出大類別與目前類別的資料夾，超級管理員可在這裡用 ▲▼ 移動大類別的順序（存在 UiConfig.albumOrder；子項目不能移動）；
 * ④沒有權限的資料夾（鎖定的課程、區塊相簿）禁止進入，點了只顯示原因（伺服器也會擋）。
 * 點資料夾 → onPick（交給全螢幕看圖換成這個資料夾的照片並進入「檢視全部」格狀畫面）。
 */
export function LightboxLibrary({ onPick, initial, restore }: { onPick: (p: LibraryPick) => void; /** 回到上次位置（相簿專區入口）：類別與資料夾；沒有 initial 才套用。 */ restore?: { group: string | null; folder: string | null } | null; /** 回到相簿時停在哪個資料夾（從單張看圖按「相簿」回來）。 */ initial?: { folder: AlbumFolder; items: CoverMediaItem[]; focusId?: string } | null }) {
  const thumb = useThumb();
  const insets = useInsets();
  const win = useWindowDimensions();
  const { member } = useSession();
  const admin = isSuperAdmin(member);
  const { data, loading, error, reload } = useApi<AlbumsResponse>("/albums");
  const [group, setGroup] = useState<string | null>(null);
  const recipes = useApi<RecipesResponse>("/recipes"); // 食譜專區（杜杜龍 2026-11-26）：相簿首頁的「食譜」類別卡與數量
  // 目前打開的資料夾（null＝資料夾總覽）：搜尋列、類別標籤、側邊欄在資料夾裡一樣永遠顯示（杜杜龍 2026-11-25）。
  const [view, setView] = useState<{ folder: AlbumFolder; items: CoverMediaItem[] } | null>(initial ?? null);
  const inRecipe = group === "recipe" && !view;
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"page" | "all">("page");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"perms" | "info" | null>(null); // 超級管理員的相簿管理面板
  const [sortBy, setSortBy] = useState<{ key: "date" | "upload"; dir: "asc" | "desc" } | null>(null); // 資料夾照片排序
  // 區塊相簿的子資料夾（杜杜龍 2026-11-26）：sub＝null 是區塊總覽（資料夾卡）；""＝未分類；其他＝資料夾編號。
  const [sub, setSub] = useState<string | null>(null);
  const [fsheet, setFsheet] = useState<FolderSheetState>(null);
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const isBlock = view?.folder.kind === "block";
  const sf = useSubfolders(isBlock ? view!.folder.key : null);
  const hasSubs = isBlock && (sf.subs?.folders.length ?? 0) > 0;
  const subName = sub === null ? "" : sub === "" ? "未分類" : (sf.subs?.folders.find((x) => x.id === sub)?.name ?? "");
  useEffect(() => (setSub(null), setSortBy(null)), [view?.folder.id]); // 換資料夾：子資料夾與排序都重來
  const groups = data?.groups ?? [];
  const [recipeCat, setRecipeCat] = useState<string>("all"); // 從側邊欄點食譜的某個分類進來
  const order = data?.order ?? [...groups.map((g) => g.id), "recipe"]; // 類別順序（含食譜專區，超級管理員可調）
  const viewGroup = view ? groups.find((g) => g.folders.some((f) => f.id === view.folder.id)) : undefined;
  const cur = groups.find((g) => g.id === (viewGroup?.id ?? group)); // 沒有＝相簿首頁（類別資料夾）
  const key = q.trim().toLowerCase();
  const sem = useAlbumSemantic(key, scope === "page"); // 此頁搜尋的語意比對；「全部」由伺服器的 /albums/search 自己加語意結果

  // 使用統計（相簿操作習慣）：打開相簿一次；搜尋停手 1 秒記一次（只記搜尋範圍，不記搜尋內容）。
  useEffect(() => {
    trackUsage("album_open", initial ? "從單張回來" : restore ? "回到上次位置" : "從頭進入");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (key.length < 2) return;
    const t = setTimeout(() => trackUsage("album_search", scope === "all" ? "搜尋全部相簿" : "搜尋此頁"), 1000);
    return () => clearTimeout(t);
  }, [scope, key]);

  // 搜尋「全部」：停手 0.4 秒後才問伺服器。
  useEffect(() => {
    if ((scope !== "all" && view) || key.length < 2) return void setFound(null); // 「全部」，或在類別／首頁（還沒進資料夾）搜尋：也找照片（杜杜龍 2026-11-26）
    let alive = true;
    const t = setTimeout(() => {
      api<{ items: Found[] }>("GET", `/albums/search?q=${encodeURIComponent(key)}`)
        .then((r) => alive && setFound(r.items))
        .catch(() => alive && setFound([]));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [scope, key, !!view]);

  const openFolder = async (f: AlbumFolder) => {
    if (f.locked) return void flashText(f.lockReason || "沒有權限進入這個相簿");
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ items: CoverMediaItem[] }>("GET", `/albums/folder?id=${encodeURIComponent(f.id)}`);
      const items = r.items.filter((x) => x.kind === "image");
      if (!items.length) return void flashText("這個相簿還沒有照片");
      setView({ folder: f, items });
      trackUsage("album_folder", groups.find((g) => g.id === f.groupId)?.label ?? f.groupId);
      setFocusId(undefined);
      setQ("");
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const gap = 10;
  // 大螢幕開側邊欄時，主畫面變窄（相簿往右推）：資料夾卡片的欄數與寬度隨主畫面寬度算（杜杜龍 2026-11-25）。
  const mainW = win.width - insets.left - insets.right - 16 * 2;
  const cols = mainW >= 900 ? 5 : mainW >= 640 ? 4 : mainW >= 420 ? 3 : 2;
  const cardW = Math.floor((mainW - gap * (cols - 1)) / cols);
  const thirdW = Math.floor((mainW - 4 * (cols * 2 - 1)) / (cols * 2));
  const folders = (cur?.folders ?? []).filter((f) => !key || `${folderName(f)} ${f.subtitle ?? ""}`.toLowerCase().includes(key));
  const allFolderHits = scope === "all" && key ? groups.flatMap((g) => g.folders).filter((f) => `${folderName(f)} ${f.subtitle ?? ""}`.toLowerCase().includes(key)) : [];

  const card = (f: AlbumFolder) => {
    const half = Math.floor((cardW - 6) / 2);
    return (
      <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`${folderName(f)}，${f.count} 張${f.locked ? "，沒有權限" : ""}`} onPress={() => void openFolder(f)} style={({ pressed }) => [{ width: cardW, borderRadius: 12, backgroundColor: "#262629", padding: 3, opacity: pressed ? 0.75 : 1 }]}>
        <View style={{ width: cardW - 6, height: cardW - 6, borderRadius: 9, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2, backgroundColor: "#1a1a1c" }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: half - 1, height: half - 1, backgroundColor: "#2e2e31" }}>
              {f.thumbs[i] ? <Image source={{ uri: thumb(resolveUrl(f.thumbs[i]!), 200) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            </View>
          ))}
          {f.locked ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", gap: 4, padding: 8 }]}>
              <Ionicons name="lock-closed" size={30} color="#fff" {...UI_ONLY} />
              <AppText variant="caption" numberOfLines={2} {...UI_ONLY_TEXT} style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>{f.lockReason || "沒有權限"}</AppText>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 }}>
          <AppText variant="callout" numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>{folderName(f)}</AppText>
          <AppText variant="caption" {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>{f.count}</AppText>
        </View>
        {f.subtitle ? <AppText variant="caption" numberOfLines={1} {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", paddingHorizontal: 6, paddingBottom: 6 }}>{f.subtitle}</AppText> : null}
      </Pressable>
    );
  };
  // 相簿首頁的「類別資料夾」（款式 C 的大類別標籤改成這個）：4 格預覽取自該類別資料夾的封面；此頁搜尋會過濾類別名稱。
  const homeCats = groups.filter((g) => !key || g.label.toLowerCase().includes(key));
  const pageFound = scope === "all" || !cur ? found : found && found.filter((p) => cur.folders.some((f) => f.id === p.folderId)); // 此頁＝目前這個類別裡的照片
  /** 搜尋到的照片格（「全部」搜尋，以及在類別／首頁搜尋時），點開用看圖畫面；文字比對與 AI 語意比對的結果都在裡面。 */
  const photosBlock = () => (
    <>
      <AppText variant="callout" {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontWeight: "700" }}>{pageFound === null ? (key.length < 2 ? "請輸入至少 2 個字" : "搜尋中…") : `照片 ${pageFound.length} 張`}</AppText>
      {pageFound?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {pageFound.map((p, i) => (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.folderTitle} 的照片`} onPress={() => onPick({ folder: null, title: `搜尋「${q.trim()}」`, items: pageFound, index: i })} style={{ width: thirdW, height: thirdW, backgroundColor: "#262629" }}>
              <Image source={{ uri: thumb(resolveUrl(p.url), 240) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
  const homeFolderHits = key ? groups.flatMap((g) => g.folders).filter((f) => `${folderName(f)} ${f.subtitle ?? ""}`.toLowerCase().includes(key)) : [];
  const catCard = (g: (typeof groups)[number]) => {
    const half = Math.floor((cardW - 6) / 2);
    const photos = g.folders.reduce((n, f) => n + f.count, 0);
    return (
      <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`${g.label}，${g.folders.length} 個資料夾，${photos} 張`} onPress={() => (setGroup(g.id), setQ(""))} style={({ pressed }) => [{ width: cardW, borderRadius: 12, backgroundColor: "#262629", padding: 3, opacity: pressed ? 0.75 : 1 }]}>
        <View style={{ width: cardW - 6, height: cardW - 6, borderRadius: 9, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2, backgroundColor: "#1a1a1c" }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: half - 1, height: half - 1, backgroundColor: "#2e2e31" }}>
              {g.folders[i]?.thumbs[0] ? <Image source={{ uri: thumb(resolveUrl(g.folders[i]!.thumbs[0]!), 200) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 }}>
          <Ionicons name="folder" size={16} color="#cfcfd4" {...UI_ONLY} />
          <AppText variant="callout" numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>{g.label}</AppText>
          <AppText variant="caption" {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>{g.folders.length}</AppText>
        </View>
      </Pressable>
    );
  };
  // 食譜專區的類別卡（杜杜龍 2026-11-26）：不是照片資料夾，點進去是食譜列表；永遠顯示（沒有食譜時也要有入口讓會員投稿）。
  const recipeList = recipes.data?.recipes ?? [];
  const recipeCard = () => {
    const half = Math.floor((cardW - 6) / 2);
    const withThumb = recipeList.filter((r) => r.thumb);
    return (
      <Pressable key="recipe" accessibilityRole="button" accessibilityLabel={`食譜，${recipeList.length} 道`} onPress={() => (setRecipeCat("all"), setGroup("recipe"), setQ(""))} style={({ pressed }) => [{ width: cardW, borderRadius: 12, backgroundColor: "#262629", padding: 3, opacity: pressed ? 0.75 : 1 }]}>
        <View style={{ width: cardW - 6, height: cardW - 6, borderRadius: 9, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2, backgroundColor: "#1a1a1c" }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: half - 1, height: half - 1, backgroundColor: "#2e2e31", alignItems: "center", justifyContent: "center" }}>
              {withThumb[i]?.thumb ? <Image source={{ uri: thumb(resolveUrl(withThumb[i]!.thumb!), 200) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : i === 0 && !withThumb.length ? <Ionicons name="restaurant-outline" size={28} color="#6f6f75" {...UI_ONLY} /> : null}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 }}>
          <Ionicons name="folder" size={16} color="#cfcfd4" {...UI_ONLY} />
          <AppText variant="callout" numberOfLines={1} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "800" }}>食譜</AppText>
          <AppText variant="caption" {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>{recipeList.length}</AppText>
        </View>
      </Pressable>
    );
  };
  const btn = (label: string, onPress: () => void, icon: string, on = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.tool, on && { backgroundColor: "#2e7d32" }]}>
      <Ionicons name={icon as never} size={24} color="#fff" {...UI_ONLY} />
    </Pressable>
  );


  // 資料夾裡的照片（此頁搜尋會過濾）
  const inSub = hasSubs && sub !== null ? view!.items.filter((p) => (p.folderId ?? "") === sub) : view?.items ?? [];
  const filtered = view ? (scope === "page" && key ? inSub.filter((p) => matchAlbumItem(p, key, sem)) : inSub) : [];
  // 排序（杜杜龍 2026-11-25）：活動日期、上傳時間；點一下遞減，再點遞增。沒有排序＝相簿原本的順序。沒有日期的照片永遠排最後。
  const shown = sortBy
    ? [...filtered].sort((a, b) => {
        const va = sortBy.key === "date" ? (a.eventDate ?? "") : (a.createdAt ?? "");
        const vb = sortBy.key === "date" ? (b.eventDate ?? "") : (b.createdAt ?? "");
        if (!va || !vb) return va ? -1 : vb ? 1 : 0;
        return sortBy.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      })
    : filtered;
  const sortBtn = (k: "date" | "upload", icon: string, label: string) => {
    const on = sortBy?.key === k;
    return (
      <Pressable key={k} accessibilityRole="button" accessibilityLabel={`${label}${on ? (sortBy!.dir === "desc" ? "，目前新到舊" : "，目前舊到新") : ""}`} onPress={() => {
        const dir = on ? (sortBy!.dir === "desc" ? "asc" : "desc") : "desc";
        setSortBy({ key: k, dir });
        trackUsage("album_sort", k === "date" ? "活動日期" : "上傳時間");
        // 點了跳出該功能的文字提示（與課程頁切換檢視模式同款的全螢幕提醒視窗 showFlash）
        showFlash({ icon: <Ionicons name={icon as never} size={FLASH_ICON - 3} color="#2E7D32" />, title: label, body: dir === "desc" ? "新到舊" : "舊到新" });
      }} style={[styles.tool, on && { backgroundColor: "#2e7d32" }]}>
        <Ionicons name={icon as never} size={22} color="#fff" {...UI_ONLY} />
        {on ? <Ionicons name={sortBy!.dir === "desc" ? "arrow-down" : "arrow-up"} size={12} color="#fff" style={{ position: "absolute", right: 7, bottom: 7 }} {...UI_ONLY} /> : null}
      </Pressable>
    );
  };
  const reloadView = async () => {
    if (!view) return;
    try {
      const r = await api<{ items: CoverMediaItem[] }>("GET", `/albums/folder?id=${encodeURIComponent(view.folder.id)}`);
      setView({ folder: view.folder, items: r.items.filter((x) => x.kind === "image") });
      reload();
      sf.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };

  // 上方工具列（TopBar）：右側「設定」鈕（超級管理員）——相簿首頁／類別＝全部相簿的上傳權限；打開資料夾＝這個資料夾的資訊與權限。返回鍵＝退一層（資料夾 → 類別 → 首頁；已在首頁回傳 false，交給相簿看圖離開頁面）。
  useHeaderSlot(1, admin ? <TopBarButton label="設定" accessibilityLabel={view ? "相簿資訊與權限" : "相簿權限設定"} iconName="settings-outline" onPress={() => setPanel(view ? "info" : "perms")} /> : null);
  usePageBack(() => {
    if (view) {
      if (hasSubs && sub !== null) setSub(null);
      else (setGroup(cur?.id ?? null), setView(null), setSortBy(null));
      return true;
    }
    if (group) return (setGroup(null), setQ(""), true);
    return false;
  }, 2);
  useEffect(() => {
    if (view && !view.items.length) void reloadView(); // 從單張看圖回到資料夾：重新讀這個資料夾的照片
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 回到上次位置（杜杜龍 2026-11-25）：資料讀回來後，開到上次的類別／資料夾；沒權限或不存在了就停在相簿首頁／該類別。
  const [ready, setReady] = useState(!restore || !!initial);
  const [focusId, setFocusId] = useState<string | undefined>(initial?.focusId); // 回到資料夾時要停在哪張照片
  useEffect(() => {
    if (ready || !data) return;
    setReady(true);
    if (!restore) return;
    const g = data.groups.find((x) => x.id === restore.group);
    if (g) setGroup(g.id);
    const f = restore.folder ? data.groups.flatMap((x) => x.folders).find((x) => x.id === restore.folder) : undefined;
    if (f && !f.locked) void openFolder(f);
  }, [ready, data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 位置有變就記下來（還原完成前不記，免得把上次的位置蓋掉）。
  useEffect(() => {
    if (ready && data && !busy) saveAlbumPos({ group: cur?.id ?? null, folder: view?.folder.id ?? null, photo: null, mode: "library" });
  }, [ready, busy, cur?.id, view?.folder.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="auto">
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* 搜尋列：與頁面相簿共用 AlbumSearchBar（深色款＋「此頁／全部」切換），永遠顯示 */}
        <View style={{ paddingHorizontal: 16 }}>
          <AlbumSearchBar dark q={q} setQ={setQ} scope={scope} onScope={setScope} placeholder={scope === "page" ? (inRecipe ? "搜尋食譜的名稱、食材" : view ? "搜尋這個資料夾的照片" : cur ? `搜尋「${cur.label}」裡的資料夾與照片` : "搜尋相簿類別與資料夾") : "搜尋全部相簿的場景、照片文字"} />
        </View>
        {/* 類別返回列：在某個類別裡時，回到相簿首頁（類別資料夾） */}
        {cur && !view ? <AlbumBackHeader title={cur.label} meta={`${cur.folders.length} 個資料夾`} /> : null}
        {inRecipe && !(scope === "all" && key) ? (
          <RecipeZone key={recipeCat} initialCat={recipeCat} q={q} onOpenPhotos={(title, items, index) => onPick({ folder: null, title, items, index })} />
        ) : view && hasSubs && sub === null && !key && sf.subs ? (
          <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 16, paddingTop: 6, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AppText numberOfLines={2} {...UI_ONLY_TEXT} style={{ flex: 1, color: "#fff", fontWeight: "900", fontSize: 18 }}>{folderName(view.folder)}</AppText>
              {sf.subs.canManage ? btn("管理資料夾", () => setFsheet({ t: "manage" }), "folder-open-outline") : null}
            </View>
            <SubfolderHome subs={sf.subs} bottomPad={insets.bottom + 32} onOpen={(id) => setSub(id)} onNew={() => setFsheet({ t: "new", move: false })} onMenu={(id) => setFsheet({ t: "menu", id })} />
          </View>
        ) : view && !(scope === "all" && key) ? (
          <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 16, paddingTop: 6 }}>
            <LightboxGrid
              embedded
              list={shown.map((x) => lightboxItem(x, folderName(view.folder)))}
              current={focusId ? shown.findIndex((x) => x.id === focusId) : -1}
              heading={hasSubs && sub !== null ? subName : folderName(view.folder)}
              parent={hasSubs && sub !== null ? folderName(view.folder) : undefined}
              onMove={isBlock && sf.subs?.canManage ? (ids) => (setMoveIds(ids), setFsheet({ t: "move" })) : undefined}
              extra={(view.folder.canEdit || admin) && !key ? (<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ flex: 1, minWidth: 0 }}>{view.folder.canEdit ? <AlbumUploadButton kind={view.folder.kind === "block" ? "course" : view.folder.kind} ownerKey={view.folder.key} folder={sub || undefined} count={view.items.length} onDone={() => void reloadView()} scope={view.folder.scope} label={view.folder.scope === "edm" ? "上傳EDM" : "上傳照片或影片"} /> : <View style={{ flex: 1 }} />}</View>{isBlock && !hasSubs && sf.subs?.canManage ? btn("新增資料夾", () => setFsheet({ t: "new", move: false }), "folder-open-outline") : null}</View>) : undefined}
              onPick={(i) => onPick({ folder: view.folder, title: folderName(view.folder), items: shown, index: i })}
              actions={<View style={{ flexDirection: "row", gap: 8 }}>{view.folder.kind === "center" && view.folder.scope === "edm" ? sortBtn("date", "calendar-outline", "活動日期排序") : null}{sortBtn("upload", "time-outline", "上傳時間排序")}</View>}
              onClose={() => (hasSubs && sub !== null ? setSub(null) : (setGroup(cur?.id ?? null), setView(null), setSortBy(null)))}
            />
          </View>
        ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}>
          {error && !data ? <AppText {...UI_ONLY_TEXT} style={{ color: "#fff" }}>讀取失敗，請稍後再試</AppText> : null}
          {loading && !data ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>讀取中…</AppText> : null}
          {scope === "all" && key ? (
            <>
              {allFolderHits.length ? <AppText variant="callout" {...UI_ONLY_TEXT} style={{ color: "#9a9aa0", fontWeight: "700" }}>資料夾</AppText> : null}
              {allFolderHits.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{allFolderHits.map(card)}</View> : null}
              {photosBlock()}
            </>
          ) : (
            <>
              {/* 相簿首頁：每個「類別」就是一個資料夾（有新類別會自動出現）；進去才是該類別的資料夾 */}
              {!cur ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{order.map((oid) => (oid === "recipe" ? (!key || "食譜".includes(key) ? recipeCard() : null) : homeCats.filter((g) => g.id === oid).map(catCard)))}</View> : null}
              {!cur && key ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{homeFolderHits.map(card)}</View> : null}
              {cur ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{folders.map(card)}</View> : null}
              {data && ((cur && !folders.length) || (!cur && !homeCats.length && !homeFolderHits.length && !(!key || "食譜".includes(key)))) && !(key && pageFound?.length) ? <AppText {...UI_ONLY_TEXT} style={{ color: "#9a9aa0" }}>{key ? (pageFound === null && key.length >= 2 ? "搜尋中…" : "沒有符合的資料夾或照片") : "還沒有相簿照片"}</AppText> : null}
              {key ? photosBlock() : null}
            </>
          )}
        </ScrollView>
        )}
      </View>
      </View>
      {panel === "perms" ? <AlbumPermissionsPanel onClose={() => setPanel(null)} onChanged={() => (reload(), void reloadView())} /> : null}
      {isBlock && view ? <SubfolderSheet dark sheet={fsheet} setSheet={setFsheet} blockKey={view.folder.key} subs={sf.subs} selIds={moveIds} onChanged={() => (sf.reload(), void reloadView())} onMoved={() => (trackUsage("album_move", "相簿瀏覽器"), setMoveIds([]))} /> : null}
      {panel === "info" && view ? <AlbumInfoPanel folderId={view.folder.id} title={folderName(view.folder)} onClose={() => setPanel(null)} onChanged={() => (reload(), void reloadView())} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tool: { width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  exit: { height: 50, minWidth: 104, paddingHorizontal: 16, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
});
