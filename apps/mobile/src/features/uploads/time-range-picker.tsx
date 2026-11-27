import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";
import type { MediaType } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";
import { fromHms, toHms, type Hms } from "@/features/uploads/hms";
import { RangePreview } from "./range-preview";

const STRIP_H = 72;
const ZOOM_STEP = 0.12; // 放大鏡 − ＋ 每按一下移動的滑桿比例
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
 * 時間軸拖曳設定（杜杜龍 2026-11-16 選定「影格膠卷＋固定中線」加「預覽＋微調按鈕」）：
 * 畫面中央有一條固定的紅線，左右拖曳下方的膠卷刻度＝移動時間；上方預覽視窗（網頁版）停在紅線那一秒；
 * 按「設為開始」「設為結束」就把紅線的時間填進欄位；−5／−1／+1／+5 秒微調（手機上不必精準拖到秒）。
 * 開始與結束的位置會以綠旗、橘旗標在膠卷上，中間的區段加底色。duration＝影片總長（秒，抓不到就先給 3 小時）。
 * 縮放（杜杜龍 2026-11-17）：獨立的「放大鏡」滑桿專門控制時間軸縮放，預設拉到最左＝整支影片完整顯示在膠卷上（拖一下就能大範圍移動）；
 * 往右拉逐步放大到可以精準到秒。膠卷本身可以左右拖曳，也可以直接點一下膠卷，紅線就跳到那個位置。
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
  const [zoom, setZoom] = useState(0); // 0＝完整顯示（整支影片剛好塞滿膠卷），1＝最大
  const [w, setW] = useState(320);
  const [playing, setPlaying] = useState(false);
  // 使用者正在拖曳、點選、微調時（含放開後約 1.2 秒，等預覽跳到新位置），播放回報的時間不能把紅線拉回去（杜杜龍 2026-11-17）。
  const hold = useRef(0);
  const touch = () => void (hold.current = Date.now() + 1200);
  // 每秒幾個像素：最小＝整支影片剛好塞滿膠卷；最大＝約每秒 60 像素（以對數連續變化，拉起來手感平均）。
  const ppsMin = Math.max(0.0001, w / total);
  const ppsMax = Math.max(60, ppsMin * 4);
  const pps = ppsMin * Math.pow(ppsMax / ppsMin, zoom);
  // 完整顯示（放大鏡在最左）＝總覽模式：整支影片鋪滿膠卷，紅線跟著手指（拖曳或點一下）；放大後＝膠卷捲動、紅線固定在中間。
  const full = zoom < 0.02;
  const geo = useRef({ pos: 0, pps, total, w, left: 0, full });
  geo.current = { pos, pps, total, w, left: geo.current.left, full };
  const base = useRef(0);
  const clamp = (v: number) => Math.min(total, Math.max(0, v));
  const move = (v: number) => setPos(clamp(Math.round(v * 10) / 10));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        touch();
        const gx = geo.current;
        base.current = gx.pos;
        gx.left = e.nativeEvent.pageX - e.nativeEvent.locationX; // 膠卷左緣的位置（算手指點在哪個時間用）
        // 總覽模式：手指按到哪，紅線就跳到哪。
        if (gx.full) setPos(Math.min(gx.total, Math.max(0, Math.round(((e.nativeEvent.pageX - gx.left) / gx.pps) * 10) / 10)));
      },
      onPanResponderMove: (e, g) => {
        touch();
        const gx = geo.current;
        if (gx.full) setPos(Math.min(gx.total, Math.max(0, Math.round(((e.nativeEvent.pageX - gx.left) / gx.pps) * 10) / 10)));
        else setPos(Math.min(gx.total, Math.max(0, Math.round((base.current - g.dx / gx.pps) * 10) / 10)));
      },
      // 放大後點一下（幾乎沒移動）＝紅線直接跳到點的位置。
      onPanResponderRelease: (e, g) => {
        touch();
        const gx = geo.current;
        if (gx.full || Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) return;
        const px = e.nativeEvent.pageX - gx.left;
        setPos(Math.min(gx.total, Math.max(0, Math.round((gx.pos + (px - gx.w / 2) / gx.pps) * 10) / 10)));
      },
    }),
  ).current;
  useEffect(() => {
    if (pos > total) setPos(total);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = Math.floor(pos);
  const x = (t: number) => (full ? t * pps : w / 2 + (t - pos) * pps);
  const redX = full ? pos * pps : w / 2;
  const step = STEPS.find((v) => v * pps >= 52) ?? 3600;
  const ticks = useMemo(() => {
    const lo = full ? 0 : pos - w / 2 / pps;
    const from = Math.max(0, Math.floor(lo / step) * step);
    const to = Math.min(total, full ? total : pos + w / 2 / pps);
    const out: number[] = [];
    for (let t = from; t <= to + step; t += step) if (t <= total) out.push(t);
    return out;
  }, [pos, pps, w, step, total, full]);
  const setStart = () => onChange({ start: toHms(at), ...(eSec != null && eSec <= at ? { end: toHms(null) } : {}) });
  const setEnd = () => onChange({ end: toHms(at), toEnd: false });
  const fine = (d: number) => (touch(), move(pos + d));
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
      <RangePreview
        kind={kind}
        ytId={ytId}
        audioFile={audioFile}
        at={at}
        playing={playing}
        onTime={(sec) => {
          if (Date.now() < hold.current) return; // 使用者正在操作時間軸，不被播放位置蓋掉
          // 試播跨過「結束」位置就自動停在結束點。
          if (eSec != null && sec >= eSec && pos < eSec) {
            setPlaying(false);
            setPos(eSec);
          } else setPos(clamp(Math.round(sec * 10) / 10));
        }}
        onStop={() => setPlaying(false)}
      />
      <View style={styles.readout}>
        {kind === "youtube" || kind === "audio" ? (
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? "暫停試播" : "從紅線位置開始試播"} onPress={() => setPlaying((v) => !v)} style={[styles.play, { backgroundColor: c.accent }]}>
            <Icon name={playing ? "pause" : "play"} size={26} color="#fff" />
          </Pressable>
        ) : null}
        <AppText style={{ fontSize: 28, lineHeight: 34, fontWeight: "800", fontVariant: ["tabular-nums"], color: c.text }}>
          {clock(at)}
          <AppText style={{ fontSize: 16, lineHeight: 34, fontWeight: "600", fontVariant: ["tabular-nums"], color: c.textMuted }}> / {clock(total)}</AppText>
        </AppText>
      </View>
      {/* 膠卷：左右拖曳；固定的紅線＝目前時間 */}
      <View style={[styles.strip, { borderColor: c.border, backgroundColor: c.surface }]} onLayout={(ev) => setW(Math.max(1, ev.nativeEvent.layout.width))} accessibilityRole="adjustable" accessibilityLabel="時間軸，拖曳或點一下" {...pan.panHandlers}>
        {rangeR > rangeL ? <View pointerEvents="none" style={{ position: "absolute", left: rangeL, width: rangeR - rangeL, top: 0, bottom: 0, backgroundColor: c.accentSoft }} /> : null}
        <View pointerEvents="none" style={[styles.holes, { top: 4 }]} />
        <View pointerEvents="none" style={[styles.holes, { bottom: 4 }]} />
        {ticks.map((t) => (
          // 刻度線與時間文字分開：文字放在一條 1px 寬的線裡會被切成看不見（網頁的 numberOfLines 會把寬度限制成父層的 100%）。
          <View key={t} pointerEvents="none" style={{ position: "absolute", left: x(t), top: 14, bottom: 14, width: 64 }}>
            <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1, backgroundColor: c.border }} />
            <AppText variant="caption" tone="muted" numberOfLines={1} style={{ position: "absolute", top: 12, left: 4, width: 58, fontSize: 11 }}>
              {clock(t)}
            </AppText>
          </View>
        ))}
        {sSec != null ? <Flag left={x(sSec)} color={c.accent} label="始" /> : null}
        {eSec != null ? <Flag left={x(eSec)} color={c.warning} label="終" /> : null}
        <View pointerEvents="none" style={[styles.center, { left: redX - 1, backgroundColor: c.danger }]} />
      </View>
      {/* 放大鏡：專門縮放時間軸；預設最左＝完整顯示 */}
      <View style={styles.zoomRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="縮小時間軸" onPress={() => setZoom((z) => Math.max(0, z - ZOOM_STEP))} style={styles.lens}>
          <Icon name="search" size={22} color={c.text} />
          <AppText style={{ fontSize: 20, lineHeight: 22, fontWeight: "800", color: c.text }}>−</AppText>
        </Pressable>
        <ZoomSlider value={zoom} onChange={setZoom} />
        <Pressable accessibilityRole="button" accessibilityLabel="放大時間軸" onPress={() => setZoom((z) => Math.min(1, z + ZOOM_STEP))} style={styles.lens}>
          <Icon name="search" size={22} color={c.text} />
          <AppText style={{ fontSize: 20, lineHeight: 22, fontWeight: "800", color: c.text }}>+</AppText>
        </Pressable>
      </View>
      <View style={styles.row}>
        {btn("−5秒", () => fine(-5))}
        {btn("−1秒", () => fine(-1))}
        {btn("+1秒", () => fine(1))}
        {btn("+5秒", () => fine(5))}
      </View>
      <View style={styles.row}>
        {btn("設為開始", setStart, "start")}
        {btn("設為結束", setEnd, "end")}
      </View>
    </View>
  );
}

/** 放大鏡滑桿：手指按住左右拖曳會即時縮放時間軸（0＝完整顯示、1＝最大）；觸控區高 48、圓點直徑 26。 */
function ZoomSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(1);
  const geo = useRef({ left: 0, width: 1 });
  geo.current.width = width;
  const cb = useRef(onChange);
  cb.current = onChange;
  const frac = (pageX: number) => Math.min(1, Math.max(0, (pageX - geo.current.left) / geo.current.width));
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        geo.current.left = e.nativeEvent.pageX - e.nativeEvent.locationX;
        cb.current(frac(e.nativeEvent.pageX));
      },
      onPanResponderMove: (e) => cb.current(frac(e.nativeEvent.pageX)),
    }),
  ).current;
  return (
    <View style={styles.zoomTouch} onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))} accessibilityRole="adjustable" accessibilityLabel="時間軸放大鏡，往右拉放大、往左拉縮小" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} {...responder.panHandlers}>
      <View pointerEvents="none" style={[styles.zoomTrack, { backgroundColor: c.border }]}>
        <View style={{ height: 6, borderRadius: 3, width: `${value * 100}%`, backgroundColor: c.accent }} />
      </View>
      <View pointerEvents="none" style={[styles.zoomThumb, { left: `${value * 100}%`, backgroundColor: c.accent, borderColor: c.surface }]} />
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
  readout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  play: { width: minTouch, height: minTouch, borderRadius: minTouch / 2, alignItems: "center", justifyContent: "center" },
  strip: { height: STRIP_H, borderWidth: 1, borderRadius: radius.sm, overflow: "hidden" },
  holes: { position: "absolute", left: 0, right: 0, height: 6, borderStyle: "dashed", borderWidth: 1.5, borderColor: "#00000033", borderRadius: 3 },
  center: { position: "absolute", top: 0, bottom: 0, width: 3, zIndex: 5 },
  row: { flexDirection: "row", gap: space.xs },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  lens: { width: 56, height: minTouch, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1 },
  zoomTouch: { flex: 1, height: minTouch, justifyContent: "center", marginHorizontal: 13 },
  zoomTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  zoomThumb: { position: "absolute", width: 26, height: 26, borderRadius: 13, marginLeft: -13, borderWidth: 3 },
  btn: { flex: 1, minHeight: minTouch, borderWidth: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
});
