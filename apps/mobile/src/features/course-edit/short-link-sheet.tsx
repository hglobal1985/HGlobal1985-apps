import { useState } from "react";
import { View } from "react-native";
import { api, type CourseDetail } from "@/api/client";
import { useApi } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, ErrorView, Field, LoadingLadybug } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import { ShortLinkRow, type ShortLinkItem } from "./short-link-row";

/**
 * 課程編輯模式「短網址」（杜杜龍 2026-11-26，只有超級管理員看得到；設定頁「短網址」照舊保留，兩邊是同一份資料）：
 * 在這張卡上直接設定它的系列、中心、分類短網址（`ShortLinkRow`，與設定頁共用），清單卡另有「清單網址」（`matUrl`，系列短網址底下的第二層）。
 */
export function ShortLinkSheet({ course, onClose, onSaved }: { course: CourseDetail; onClose: () => void; onSaved: (d: CourseDetail) => void }) {
  const links = useApi<ShortLinkItem[]>("/admin/short-links");
  const cats = (course.category ?? "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  const find = (kind: ShortLinkItem["kind"], value: string, alt?: string): ShortLinkItem => links.data?.find((i) => i.kind === kind && (i.value === value || (alt && i.value === alt))) ?? { kind, value, slug: null };
  const seriesItem = course.series ? find("series", course.series) : null;
  const centerItem = course.hostCenter ? find("center", course.hostCenter, course.hostUnit) : null; // 總部主辦（沒有中心）就不顯示中心這一列
  const [matUrl, setMatUrl] = useState(course.matUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveMat = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api<CourseDetail>("PATCH", `/admin/courses/${course.id}`, { matUrl: matUrl.trim(), ifUpdatedAt: course.admin?.updatedAt });
      flashText("已儲存清單網址");
      onSaved(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline">短網址</AppText>
      <AppText variant="caption" tone="muted">只有超級管理員看得到；和「設定 › 短網址」是同一份資料，改了兩邊同步。</AppText>
      <SheetScroll>
        {links.loading && !links.data ? <LoadingLadybug /> : null}
        {links.error && !links.data ? <ErrorView message={links.error} onRetry={links.reload} /> : null}
        {links.data ? (
          <View style={{ gap: space.lg }}>
            {course.shortPath ? <AppText variant="callout" style={{ fontWeight: "700" }}>{`這張卡的網址：${typeof location !== "undefined" ? location.host : "learn.hglobal1985.com"}/${course.shortPath}`}</AppText> : null}
            {seriesItem ? (
              <View style={{ gap: space.xs }}>
                <AppText variant="caption" tone="muted">系列頁的短網址（打開這個系列的頁面，同系列所有卡共用）</AppText>
                <ShortLinkRow item={seriesItem} onChanged={links.reload} />
              </View>
            ) : null}
            {course.isList && course.series && seriesItem?.slug ? (
              <View style={{ gap: space.xs }}>
                <AppText variant="callout">{`清單網址：${seriesItem.slug}/`}</AppText>
                <Field label="" value={matUrl} onChange={(v) => setMatUrl(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="例如：2027-final（英文、數字、短橫線）" />
                <Button label="儲存清單網址" icon="checkmark-outline" loading={busy} disabled={busy || matUrl.trim().toLowerCase() === (course.matUrl ?? "")} onPress={() => void saveMat()} />
                {error ? <AppText variant="caption" tone="danger">{error}</AppText> : null}
              </View>
            ) : null}
            {centerItem ? (
              <View style={{ gap: space.xs }}>
                <AppText variant="caption" tone="muted">主辦中心的專屬頁短網址（這個中心所有課程共用，不是只有這張卡）</AppText>
                <ShortLinkRow item={centerItem} onChanged={links.reload} />
              </View>
            ) : null}
            {cats.map((cat) => (
              <View key={cat} style={{ gap: space.xs }}>
                <AppText variant="caption" tone="muted">分類清單頁的短網址（打開這個分類底下所有課程，同分類共用）</AppText>
                <ShortLinkRow item={find("category", cat)} onChanged={links.reload} />
              </View>
            ))}
            {!seriesItem && !centerItem && !cats.length ? <AppText tone="muted">這張卡還沒有系列、中心或分類，沒有可設定的短網址。</AppText> : null}
          </View>
        ) : null}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}
