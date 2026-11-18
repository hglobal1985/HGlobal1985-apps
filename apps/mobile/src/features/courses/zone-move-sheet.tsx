import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api, ZONES, type Zone } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, space } from "@/theme/tokens";
import { AppText, Button, Icon } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { flashText } from "@/ui/flash-notice";
import type { SeriesGroup } from "./sort";

/** 專區的正式名稱（業主 2026-11-18）。 */
export const zoneLabel = (z: Zone) => ZONES.find((x) => x.id === z)?.label ?? z;

/**
 * 跨專區移動（業主 2026-11-18）：標題列右邊的「移動」鈕開啟；列出其他專區的課程／清單（依專區分組），
 * 勾選後按「移入」，同系列的一起搬。只有超級管理員看得到。
 */
export function ZoneMoveSheet({ target, groups, onMoved, onClose }: { target: Zone; groups: SeriesGroup[]; onMoved: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const others = useMemo(() => ZONES.filter((z) => z.id !== target).map((z) => ({ zone: z, items: groups.filter((g) => g.nearest.zone === z.id) })), [groups, target]);
  const nameOf = (g: SeriesGroup) => (g.key.startsWith("s:") ? g.key.slice(2) : g.nearest.title);
  const toggle = (key: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const move = async () => {
    const ids = groups.filter((g) => sel.has(g.key)).flatMap((g) => g.sessions.map((x) => x.id));
    if (!ids.length) return;
    setBusy(true);
    try {
      await api("POST", "/admin/zone-move", { zone: target, ids });
      flashText(`已移入「${zoneLabel(target)}」`);
      onMoved();
      onClose();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline" numberOfLines={2}>
        勾選要移入「{zoneLabel(target)}」的課程或清單
      </AppText>
      <SheetScroll>
        {others.map(({ zone, items }) => (
          <View key={zone.id}>
            <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText, paddingTop: space.sm }}>
              {zone.label}（{items.length}）
            </AppText>
            {items.length ? (
              items.map((g) => (
                <Pressable key={g.key} accessibilityRole="checkbox" accessibilityState={{ checked: sel.has(g.key) }} onPress={() => toggle(g.key)} style={[styles.row, { borderTopColor: c.border }]}>
                  <Icon name={sel.has(g.key) ? "checkbox" : "square-outline"} size={26} color={sel.has(g.key) ? c.accent : c.textMuted} />
                  <AppText variant="body" numberOfLines={2} style={{ flex: 1 }}>
                    {nameOf(g)}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {g.nearest.isList ? "清單" : "課程"}
                  </AppText>
                </Pressable>
              ))
            ) : (
              <AppText variant="caption" tone="muted" style={{ paddingVertical: space.sm }}>
                目前沒有
              </AppText>
            )}
          </View>
        ))}
      </SheetScroll>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="cancel" label="取消" onPress={onClose} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={sel.size ? `移入（${sel.size}）` : "移入"} disabled={!sel.size} loading={busy} onPress={move} fullWidth />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: minTouch, flexDirection: "row", alignItems: "center", gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
