import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";
import type { MediaType } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { fromHms, toHms, type Hms } from "./hms";
import { RangePreview } from "./range-preview";

const STRIP_H = 72;
const PPS_LEVELS = [2, 6, 16, 40]; // 每秒幾個像素（越大越細）
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * 時間軸拖曳設定（業主 2026-11-16 選定「影格膠卷＋固定中線」加「預覽＋微調按鈕」）：
 * 畫面中央有一條固定的紅線，左右拖曳下方的膠卷刻度＝移動時間；上方預覽視窗（網頁版）停在紅線那一秒；
 * 按「設為開始」「設為結束」就把紅線的時間填進欄位；−5／−1／+1／+5 秒微調（手機上不必精準拖到秒）。
 * 開始與結束的位置會以綠旗、橘旗標在膠卷上，中間的區段加底色。duration＝影片總長（秒，抓不到就先給 3 小時）。
 */
export function TimeRangePicker({
  kind,
  ytId,
  audioFile,
  duration,
  start,
  end,
  onChange,
}: {
  kind: MediaType;
  ytId: string | null;
  audioFile: Blob | null;
  duration: number | null;
  start: Hms;
  end: Hms;
  onChange: (patch: { start?: Hms; end?: Hms; toEnd?: boolean }) => void;
}) {
  const { c } = useTheme();
  const total = duration && duration > 0 ? Math.floor(duration) : 3 * 3600;
  const s = fromHms(start);
  const e = fromHms(end);
  const sSec = typeof s === "number" ? s : null;
  const eSec = typeof e === "number" ? e : null;
  const [pos, setPos] = useState(sSec ?? 0);
  const [level, setLevel] = useState(1);
  const [w, setW] = useState(320);
  const pps = PPS_LEVELS[level]!;
  const geo = useRef({ pos: 0, pps, total });
  geo.current = { pos, pps, total };
  const base = useRef(0);
  const clamp = (v: number) => Math.min(total, Math.max(0, v));
  const move = (v: number) => setPos(clamp(Math.round(v * 10) / 10));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => (base.current = geo.current.pos),
      onPanResponderMove: (_, g) => setPos(Math.min(geo.current.total, Math.max(0, Math.round((base.current - g.dx / geo.current.pps) * 10) / 10))),
    }),
  ).current;
  useEffect(() => {
    if (pos > total) setPos(total);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = Math.floor(pos);
  const x = (t: number) => w / 2 + (t - pos) * pps;
  const step = STEPS.find((v) => v * pps >= 52) ?? 3600;
  const ticks = useMemo(() => {
    const from = Math.max(0, Math.floor((pos - w / 2 / pps) / step) * step);
    const to = Math.min(total, pos + w / 2 / pps);
    const out: number[] = [];
    for (let t = from; t <= to + step; t += step) if (t <= total) out.push(t);
    return out;
  }, [pos, pps, w, step, total]);
  const setStart = () => onChange({ start: toHms(at), ...(eSec != null && eSec <= at ? { end: toHms(null) } : {}) });
  const setEnd = () => onChange({ end: toHms(at), toEnd: false });
  const fine = (d: number) => move(pos + d);
  const btn = (label: string, onPress: () => void, tone: "plain" | "start" | "end" = "plain") => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.btn, { borderColor: c.border, backgroundColor: tone === "start" ? c.accent : tone === "end" ? c.warning : c.surface }, tone !== "plain" && { flex: 1.4 }]}
    >
      <AppText variant="callout" style={{ fontWeight: "700", color: tone === "plain" ? c.text : "#fff" }}>
        {label}
      </AppText>
    </Pressable>
  );
  const rangeL = sSec != null ? Math.max(0, x(sSec)) : 0;
  const rangeR = eSec != null ? Math.min(w, x(eSec)) : sSec != null ? w : 0;
  return (
    <View style={[styles.box, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
      <RangePreview kind={kind} ytId={ytId} audioFile={audioFile} at={at} />
      <View style={styles.readout}>
        <AppText style={{ fontSize: 30, lineHeight: 36, fontWeight: "800", fontVariant: ["tabular-nums"], color: c.text }}>{clock(at)}</AppText>
        <AppText variant="caption" tone="muted">
          / {clock(total)}
          {duration ? "" : "（抓不到影片長度，先以 3 小時為範圍）"}
        </AppText>
      </View>
      {/* 膠卷：左右拖曳；固定的紅線＝目前時間 */}
      <View style={[styles.strip, { borderColor: c.border, backgroundColor: c.surface }]} onLayout={(ev) => setW(Math.max(1, ev.nativeEvent.layout.width))} accessibilityRole="adjustable" accessibilityLabel="時間軸，左右拖曳" {...pan.panHandlers}>
        {rangeR > rangeL ? <View pointerEvents="none" style={{ position: "absolute", left: rangeL, width: rangeR - rangeL, top: 0, bottom: 0, backgroundColor: c.accentSoft }} /> : null}
        <View pointerEvents="none" style={[styles.holes, { top: 4 }]} />
        <View pointerEvents="none" style={[styles.holes, { bottom: 4 }]} />
        {ticks.map((t) => (
          <View key={t} pointerEvents="none" style={{ position: "absolute", left: x(t), top: 14, bottom: 14, width: 1, backgroundColor: c.border }}>
            <AppText variant="caption" tone="muted" numberOfLines={1} style={{ position: "absolute", top: 12, left: 4, width: 64, fontSize: 11 }}>
              {clock(t)}
            </AppText>
          </View>
        ))}
        {sSec != null ? <Flag left={x(sSec)} color={c.accent} label="始" /> : null}
        {eSec != null ? <Flag left={x(eSec)} color={c.warning} label="終" /> : null}
        <View pointerEvents="none" style={[styles.center, { left: w / 2 - 1, backgroundColor: c.danger }]} />
      </View>
      <View style={styles.row}>
        {btn("−5秒", () => fine(-5))}
        {btn("−1秒", () => fine(-1))}
        {btn("+1秒", () => fine(1))}
        {btn("+5秒", () => fine(5))}
        {btn(level === PPS_LEVELS.length - 1 ? "縮小" : "放大", () => setLevel((l) => (l === PPS_LEVELS.length - 1 ? 0 : l + 1)))}
      </View>
      <View style={styles.row}>
        {btn("設為開始", setStart, "start")}
        {btn("設為結束", setEnd, "end")}
      </View>
      <AppText variant="caption" tone="muted">
        左右拖曳膠卷到想要的位置（紅線＝目前時間），再按「設為開始」或「設為結束」；綠旗是開始、橘旗是結束。
      </AppText>
    </View>
  );
}

function Flag({ left, color, label }: { left: number; color: string; label: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: left - 1, top: 0, bottom: 0, width: 2, backgroundColor: color }}>
      <View style={{ position: "absolute", top: 0, left: 0, backgroundColor: color, paddingHorizontal: 4, borderBottomRightRadius: 6 }}>
        <AppText variant="caption" style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: space.sm },
  readout: { alignItems: "center" },
  strip: { height: STRIP_H, borderWidth: 1, borderRadius: radius.sm, overflow: "hidden" },
  holes: { position: "absolute", left: 0, right: 0, height: 6, borderStyle: "dashed", borderWidth: 1.5, borderColor: "#00000033", borderRadius: 3 },
  center: { position: "absolute", top: 0, bottom: 0, width: 3, zIndex: 5 },
  row: { flexDirection: "row", gap: space.xs },
  btn: { flex: 1, minHeight: minTouch, borderWidth: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
});
