import { useState } from "react";
import { Pressable, View } from "react-native";
import { api, type CourseDetail } from "@/api/client";
import { shareLink } from "@/lib/share";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, ErrorView, Field, LoadingLadybug, ShareIcon } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import { ShortLinkRow, type ShortLinkItem } from "./short-link-row";

const host = () => (typeof location !== "undefined" ? location.host : "learn.hglobal1985.com");
const clean = (v: string) => v.replace(/[^A-Za-z0-9-]/g, "");

/**
 * 課程編輯模式「短網址」（杜杜龍 2026-11-26，只有超級管理員看得到；設定頁「短網址」照舊保留，兩邊是同一份資料）。
 * 清單卡的短網址只有一個格式：`網域 / 系列縮寫 / 卡片名稱`（例：learn.hglobal1985.com/amway/dd）——
 * 系列縮寫＝整個系列共用的前段（改它會影響同系列所有卡），卡片名稱＝只屬於這張卡的後段（同系列內不能重複）。
 * 這裡把兩段放在同一列、即時預覽完整網址、一個「儲存網址」鈕一起存；分類、中心的短網址放在最下面「其他網址（進階）」。
 * 舊網址（/course/…、改掉的舊縮寫）永遠有效。
 */
export function ShortLinkSheet({ course, onClose, onSaved }: { course: CourseDetail; onClose: () => void; onSaved: (d: CourseDetail) => void }) {
  const { c } = useTheme();
  const { invalidate } = useSession();
  const links = useApi<ShortLinkItem[]>("/admin/short-links");
  const changed = () => (links.reload(), invalidate()); // 改完連同課程資料一起重讀，邀請、分享、網址列馬上換新
  const cats = (course.category ?? "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  const find = (kind: ShortLinkItem["kind"], value: string, alt?: string): ShortLinkItem => links.data?.find((i) => i.kind === kind && (i.value === value || (alt && i.value === alt))) ?? { kind, value, slug: null };
  const centerItem = course.hostCenter ? find("center", course.hostCenter, course.hostUnit) : null;
  const seriesItem = course.series ? find("series", course.series) : null;

  const [seriesSlug, setSeriesSlug] = useState<string | null>(null); // null＝還沒動過，顯示目前存的
  const [matUrl, setMatUrl] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const curSeries = seriesItem?.slug ?? "";
  const curMat = course.matUrl ?? "";
  const s = seriesSlug ?? curSeries;
  const m = matUrl ?? curMat;
  const dirty = s !== curSeries || m !== curMat;
  const full = s && m ? `https://${host()}/${s}/${m}` : "";
  const nowUrl = course.shortPath ? `https://${host()}/${course.shortPath}` : `https://${host()}/course/${course.id}`;

  const save = async () => {
    if (!s) return setError("請先填「系列縮寫」");
    if (!m) return setError("請填「卡片名稱」");
    setBusy(true);
    setError(null);
    try {
      if (s !== curSeries) await api("PUT", "/admin/short-links", { kind: "series", value: course.series, slug: s });
      if (m.toLowerCase() !== curMat.toLowerCase()) {
        const d = await api<CourseDetail>("PATCH", `/admin/courses/${course.id}`, { matUrl: m, ifUpdatedAt: course.admin?.updatedAt });
        onSaved(d);
      }
      flashText("已儲存網址");
      setSeriesSlug(null);
      setMatUrl(null);
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const boxStyle = { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space.md, gap: space.sm } as const;
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">短網址</AppText>
      <AppText variant="caption" tone="muted">只有超級管理員看得到。和「設定 › 短網址」是同一份資料，改了兩邊同步。</AppText>
      <SheetScroll>
        {links.loading && !links.data ? <LoadingLadybug /> : null}
        {links.error && !links.data ? <ErrorView message={links.error} onRetry={links.reload} /> : null}
        {links.data ? (
          <View style={{ gap: space.lg }}>
            {/* 目前這張卡的網址 */}
            <View style={{ gap: 2 }}>
              <AppText variant="caption" tone="muted">這張卡現在的網址</AppText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <AppText variant="callout" style={{ flex: 1, fontWeight: "700" }}>{nowUrl}</AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="分享這個網址" onPress={() => void shareLink(course.title, course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`).then((r) => r === "copied" && flashText("已複製網址"))} hitSlop={8}>
                  <ShareIcon size={22} color={c.text} />
                </Pressable>
              </View>
            </View>

            {course.isList && course.series ? (
              <View style={boxStyle}>
                <AppText variant="callout" style={{ fontWeight: "800" }}>設定這張卡的短網址</AppText>
                <AppText variant="caption" tone="muted">網址由兩段組成：</AppText>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                  <AppText variant="callout" tone="muted">{`${host()}/`}</AppText>
                  <AppText variant="callout" style={{ fontWeight: "800" }}>① 系列縮寫</AppText>
                  <AppText variant="callout" tone="muted">/</AppText>
                  <AppText variant="callout" style={{ fontWeight: "800" }}>② 卡片名稱</AppText>
                </View>
                <Field label={`① 系列縮寫（整個「${course.series}」系列共用的前段）`} value={s} onChange={(v) => setSeriesSlug(clean(v))} placeholder="例如：amway" />
                <AppText variant="caption" tone="muted">改這一段，同系列所有卡的網址前段都會一起換；舊的縮寫仍然有效。</AppText>
                <Field label="② 卡片名稱（只屬於這張卡，同系列內不能重複）" value={m} onChange={(v) => setMatUrl(clean(v).toLowerCase())} placeholder="例如：dd" />
                <View style={{ gap: 2 }}>
                  <AppText variant="caption" tone="muted">儲存後的完整網址</AppText>
                  <AppText variant="callout" style={{ fontWeight: "800", color: full ? c.accentText : c.textMuted }}>{full || "兩段都填好之後，這裡會顯示完整網址"}</AppText>
                </View>
                {error ? <AppText variant="caption" tone="danger">{error}</AppText> : null}
                <Button label="儲存網址" icon="checkmark-outline" loading={busy} disabled={busy || !dirty} onPress={() => void save()} fullWidth />
                <AppText variant="caption" tone="muted">原本的網址（/course/…）和你改掉的舊縮寫都會繼續有效，已經分享出去的連結不會失效。</AppText>
              </View>
            ) : course.isList ? (
              <View style={boxStyle}>
                <AppText variant="callout" style={{ fontWeight: "800" }}>這張卡還沒有放進系列</AppText>
                <AppText variant="caption" tone="muted">清單卡的短網址是「系列縮寫／卡片名稱」，所以要先到「基本資料」把這張卡放進一個系列，才能在這裡設定。</AppText>
              </View>
            ) : (
              <View style={boxStyle}>
                <AppText variant="callout" style={{ fontWeight: "800" }}>這種卡的網址由系統自動產生</AppText>
                <AppText variant="caption" tone="muted">課程卡的短網址＝「主辦中心縮寫／主講人英文名-編號」（例：nj/wang-xiaoming-1），主辦中心或主講人改了會自動更新、舊網址仍有效，不用手動設定。要設定的是「中心縮寫」，在下方「其他網址」。</AppText>
              </View>
            )}

            {/* 進階：整個系列、中心、分類頁面本身的網址 */}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: adv }} onPress={() => setAdv((v) => !v)} style={{ minHeight: 44, justifyContent: "center" }}>
              <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>{adv ? "▼ 其他網址（進階）" : "▶ 其他網址（進階）：中心頁、分類頁"}</AppText>
            </Pressable>
            {adv ? (
              <View style={{ gap: space.lg }}>
                <AppText variant="caption" tone="muted">下面是「整頁」的網址（不是這張卡）：打開的是中心專屬頁、分類清單頁，同中心／同分類的所有卡共用。</AppText>
                {centerItem ? (
                  <View style={{ gap: space.xs }}>
                    <AppText variant="caption" tone="muted">主辦中心的專屬頁</AppText>
                    <ShortLinkRow item={centerItem} onChanged={changed} />
                  </View>
                ) : null}
                {cats.map((cat) => (
                  <View key={cat} style={{ gap: space.xs }}>
                    <AppText variant="caption" tone="muted">分類清單頁</AppText>
                    <ShortLinkRow item={find("category", cat)} onChanged={changed} />
                  </View>
                ))}
                {!centerItem && !cats.length ? <AppText tone="muted">這張卡沒有主辦中心或分類。</AppText> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}
