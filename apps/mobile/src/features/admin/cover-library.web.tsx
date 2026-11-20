import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, apiBlob, resolveUrl } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { isSuperAdmin } from "@/lib/roles";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, LoadingLadybug } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import { loadImageUrl } from "./image-tools";

/**
 * 封面庫（業主 2026-11-19 永久指示：所有「上傳／編輯封面」的介面一律用這一個元件，要改只改這個檔案）：
 * 在封面上傳模組（ArtUploader＝中心與系列、EdmManager＝課程卡與清單卡、LessonArt＝章節與區塊封面）旁邊多一顆「從現有封面選取」，
 * 彈出上拉選單，分區列出：① 未使用的封面檔（可以直接「永久刪除」，真的把雲端儲存 R2 上的檔案刪掉）
 * ② 正在使用中的系列卡 ③ 課程卡 ④ 清單卡的封面（三種卡分開顯示，好挑選）。只有超級管理員看得到（刪除與跨卡挑選都是高權限）。
 * 挑選＝把那張圖載入成跟「剛選了檔案」一樣的工作，接著照原本的流程裁切、壓縮、儲存（會存成新檔，原本的卡片不受影響）；
 * 挑的是「未使用的封面檔」時，儲存成功後會自動把那個舊檔刪掉（避免留下重複的檔案）。
 */
export type PickedCover = { img: HTMLImageElement; /** 挑的是未使用的檔案：儲存成功後呼叫 deleteUnusedCover 刪掉它。 */ consumeKey?: string };

type Card = { kind: "series" | "course" | "list"; id: string; title: string; edmUrl: string | null; coverUrl: string | null };
type Unused = { key: string; label: string; size: number; uploadedAt: string | null };
type Library = { unused: Unused[]; unusedTotal: number; series: Card[]; courses: Card[]; lists: Card[] };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-TW", { year: "numeric", month: "numeric", day: "numeric" }) : "");

/** 儲存成功後，把「挑來用的未使用檔」刪掉（失敗不影響封面已儲存）。 */
export async function deleteUnusedCover(key: string | undefined): Promise<void> {
  if (key) await api("DELETE", `/admin/cover-library?k=${encodeURIComponent(key)}`).catch(() => undefined);
}

/** 需要登入才能看的預覽圖（未使用的檔案）：進入畫面才讀取，離開時釋放。 */
function AdminThumb({ fileKey }: { fileKey: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let url: string | null = null;
    let dead = false;
    const load = () => {
      apiBlob(`/admin/cover-library/file?k=${encodeURIComponent(fileKey)}`)
        .then((b) => {
          if (dead) return;
          url = URL.createObjectURL(b);
          setSrc(url);
        })
        .catch(() => undefined);
    };
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (io?.disconnect(), load()), { rootMargin: "200px" });
    if (io) io.observe(el);
    else load();
    return () => {
      dead = true;
      io?.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileKey]);
  return (
    <div ref={ref} style={{ width: "100%", aspectRatio: "16 / 9", background: "#fff", borderRadius: 8, overflow: "hidden" }}>
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} /> : null}
    </div>
  );
}

function CardThumb({ url }: { url: string | null }) {
  return (
    <div style={{ width: "100%", aspectRatio: "16 / 9", background: "#fff", borderRadius: 8, overflow: "hidden" }}>
      {url ? <img src={resolveUrl(url)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} /> : null}
    </div>
  );
}

function CoverLibrarySheet({ onClose, onPick }: { onClose: () => void; onPick: (p: PickedCover) => void }) {
  const { c } = useTheme();
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<Library>("GET", "/admin/cover-library")
      .then(setLib)
      .catch((e: Error) => setError(e.message));
  }, []);
  const choose = async (loadUrl: () => Promise<string>, consumeKey?: string, id = "x") => {
    setBusy(id);
    try {
      const img = await loadImageUrl(await loadUrl());
      onPick({ img, consumeKey });
      onClose();
    } catch (e) {
      flashText((e as Error).message || "圖片載入失敗");
    } finally {
      setBusy(null);
    }
  };
  const chooseUnused = (u: Unused) => choose(async () => URL.createObjectURL(await apiBlob(`/admin/cover-library/file?k=${encodeURIComponent(u.key)}`)), u.key, u.key);
  const chooseCard = (x: Card) => choose(async () => resolveUrl((x.edmUrl ?? x.coverUrl)!), undefined, `${x.kind}:${x.id}`);
  const remove = async (u: Unused) => {
    const ok = await confirmSheet({ title: "永久刪除這個封面檔？", message: `「${u.label}」（${kb(u.size)}）會從伺服器 R2 真實刪除，無法復原。`, confirmLabel: "永久刪除", cancelLabel: "先不要", danger: true });
    if (!ok) return;
    setBusy(u.key);
    try {
      await api("DELETE", `/admin/cover-library?k=${encodeURIComponent(u.key)}`);
      setLib((l) => (l ? { ...l, unused: l.unused.filter((x) => x.key !== u.key), unusedTotal: Math.max(0, l.unusedTotal - 1) } : l));
      flashText("已永久刪除");
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const heading = (text: string, n: number, note?: string) => (
    <View style={{ gap: 2, marginTop: space.md }}>
      <AppText variant="headline">{`${text}（${n}）`}</AppText>
      {note ? (
        <AppText variant="caption" tone="muted">
          {note}
        </AppText>
      ) : null}
    </View>
  );
  const cards = (title: string, list: Card[]) => (
    <>
      {heading(title, list.length)}
      {list.length ? (
        <View style={styles.grid}>
          {list.map((x) => (
            <Pressable key={`${x.kind}:${x.id}`} accessibilityRole="button" accessibilityLabel={`用「${x.title}」的封面`} disabled={!!busy} onPress={() => chooseCard(x)} style={[styles.tile, { borderColor: c.border, backgroundColor: c.surface, opacity: busy && busy !== `${x.kind}:${x.id}` ? 0.5 : 1 }]}>
              <CardThumb url={x.coverUrl ?? x.edmUrl} />
              <AppText variant="caption" numberOfLines={2} style={{ fontWeight: "700" }}>
                {x.title}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : (
        <AppText variant="caption" tone="muted">
          目前沒有。
        </AppText>
      )}
    </>
  );
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">從現有封面選取</AppText>
      <AppText variant="caption" tone="muted">
        點一張圖就拿來裁切使用（會另存成新檔，原本的卡片不受影響）。
      </AppText>
      <SheetScroll>
        {error ? <AppText style={{ color: c.danger }}>{error}</AppText> : null}
        {!lib && !error ? (
          <View style={{ alignItems: "center", padding: space.lg }}>
            <LoadingLadybug />
          </View>
        ) : null}
        {lib ? (
          <>
            {heading("未使用的封面檔", lib.unusedTotal, "沒有任何卡片在用的檔案。可以挑來用，或直接永久刪除（真的刪除伺服器上的檔案）。")}
            {lib.unused.length ? (
              <View style={styles.grid}>
                {lib.unused.map((u) => (
                  <View key={u.key} style={[styles.tile, { borderColor: c.border, backgroundColor: c.surface, opacity: busy && busy !== u.key ? 0.5 : 1 }]}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`用這個未使用的${u.label}`} disabled={!!busy} onPress={() => chooseUnused(u)} style={{ gap: 4 }}>
                      <AdminThumb fileKey={u.key} />
                      <AppText variant="caption" style={{ fontWeight: "700" }}>
                        {u.label}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {[kb(u.size), day(u.uploadedAt)].filter(Boolean).join(" · ")}
                      </AppText>
                    </Pressable>
                    <Button variant="danger" label="永久刪除" icon="trash-outline" disabled={!!busy} onPress={() => remove(u)} fullWidth />
                  </View>
                ))}
              </View>
            ) : (
              <AppText variant="caption" tone="muted">
                沒有未使用的封面檔。
              </AppText>
            )}
            {lib.unusedTotal > lib.unused.length ? (
              <AppText variant="caption" tone="muted">
                只列出最新的 {lib.unused.length} 個；刪除一些之後，其餘的會陸續出現。
              </AppText>
            ) : null}
            {cards("系列卡的封面", lib.series)}
            {cards("教材卡的封面（課程型）", lib.courses)}
            {cards("教材卡的封面（清單型）", lib.lists)}
          </>
        ) : null}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

/**
 * 「從現有封面選取」鈕＋選單。放在每個封面上傳介面的「上傳」鈕旁邊；onPick 拿到載入好的圖片後，
 * 就當成使用者剛選了一個檔案，走原本的裁切、儲存流程。只有超級管理員看得到。
 */
export function CoverLibraryPicker({ onPick, disabled, label = "從現有封面選取" }: { onPick: (p: PickedCover) => void; disabled?: boolean; label?: string }) {
  const { member } = useSession();
  const [open, setOpen] = useState(false);
  if (!isSuperAdmin(member)) return null;
  return (
    <>
      <Button variant="secondary" label={label} icon="images-outline" disabled={disabled} onPress={() => setOpen(true)} />
      {open ? <CoverLibrarySheet onClose={() => setOpen(false)} onPick={onPick} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: { width: "48.5%", borderWidth: 1, borderRadius: radius.md, padding: space.xs, gap: 6 },
});
