import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { eventDays, hostLine, placeText } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { BrandCover, AppText, CourseCover, Icon, type IconName } from "@/ui";
import { CoursePriceTag } from "./course-card";
import { CourseLessonsSheet } from "./course-lessons-sheet";
import { displayName } from "./sort";

/** EDM 填滿整個框（不留空白）、靠上對齊：先依寬度放大，不夠高再依高度放大；只會裁到下方與左右，不會裁到上方文字。 */
function TopFillImage({ uri, w, h }: { uri: string; w: number; h: number }) {
  const [ratio, setRatio] = useState<number | null>(null); // 寬 / 高
  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (iw, ih) => alive && ih && setRatio(iw / ih), () => undefined);
    return () => {
      alive = false;
    };
  }, [uri]);
  const r = ratio ?? 0.7;
  const iw = Math.max(w, h * r);
  const ih = iw / r;
  return (
    <View style={{ width: w, height: h, overflow: "hidden", borderRadius: radius.md, backgroundColor: "#fff" }}>
      <Image source={{ uri }} resizeMode="stretch" style={{ position: "absolute", top: 0, left: (w - iw) / 2, width: iw, height: ih }} accessibilityLabel="課程海報" />
    </View>
  );
}

function Slide({ course, w, h }: { course: CourseSummary; w: number; h: number }) {
  const thumb = useThumb();
  if (course.brand) return <BrandCover brand={course.brand} fill />;
  return course.edmUrl ? (
    <TopFillImage uri={thumb(resolveUrl(course.edmUrl), w)} w={w} h={h} />
  ) : (
    <View style={{ width: w, height: h, borderRadius: radius.md, overflow: "hidden" }}>
      <CourseCover theme={course.theme} label={course.category} title={displayName(course)} fill />
    </View>
  );
}

/**
 * 首頁的一個區塊（左或右）：標題與備註置中；海報（EDM）區塊填滿剩下的高度，手指在區塊內左右滑動切換；
 * 下方顯示目前這門課的名稱、主辦單位、日期、金額，點圖或名稱進入課程。
 */
export function HomeRail({ title, icon, tone, note, courses, empty, progress, autoSec = 0, pauseSec = 8, scale = 1, compact = false, hideInfo = false, onStageHeight }: { title: string; icon: IconName; tone: "green" | "orange"; note?: string; courses: CourseSummary[]; empty: React.ReactNode; progress?: boolean; /** 自動輪播間隔（秒；0＝不自動輪播）。 */ autoSec?: number; /** 手指滑過後暫停自動輪播的秒數。 */ pauseSec?: number; /** 首頁大螢幕放大倍數（標題、備註、資訊文字）。 */ scale?: number; /** 手機橫放等矮視窗：隱藏備註、資訊壓縮，海報才有空間。 */ compact?: boolean; /** 版面太擠時由首頁通知：先隱藏海報下方的資訊（主辦、日期、地點、金額、進度），空間夠了再恢復（業主 2026-11-19）。 */ hideInfo?: boolean; /** 回報海報區目前的高度（首頁用來判斷擠不擠）。 */ onStageHeight?: (h: number) => void }) {
  useCenterNames();
  const { c } = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
    const [page, setPage] = useState(0);
  // 點圖或名稱：先彈出這門課的章節摘要（右上角「完整介紹」，往上拉到最高處也會進入課程介紹頁），不直接跳頁。
  const [preview, setPreview] = useState<CourseSummary | null>(null);
  const cur = courses[Math.min(page, Math.max(0, courses.length - 1))];
  const x = useRef(new Animated.Value(0)).current;
  const live = useRef({ page: 0, w: 0, n: 0 });
  const pausedUntil = useRef(0);
  const livePause = useRef(pauseSec);
  livePause.current = pauseSec;
  live.current = { page, w: box.w, n: courses.length };
  const slideTo = (i: number) => {
    const { w } = live.current;
    setPage(i);
    Animated.timing(x, { toValue: -i * w, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  };
  // 資料或寬度變動時，回到合法的頁面。
  useEffect(() => {
    const i = Math.min(page, Math.max(0, courses.length - 1));
    if (i !== page) setPage(i);
    x.setValue(-i * box.w);
  }, [box.w, courses.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // 手指左右滑：不管拖多大力、多快，放手後最多只翻一張（往左滑＝下一張、往右滑＝上一張）。
  const pan = useMemo(() => {
    let start = 0;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderGrant: () => {
        pausedUntil.current = Date.now() + 60 * 60 * 1000; // 手指按著時不自動換
        x.stopAnimation((v) => (start = v));
      },
      onPanResponderMove: (_e, g) => {
        const { w, n } = live.current;
        const min = -(n - 1) * w;
        let v = start + g.dx;
        if (v > 0) v *= 0.3;
        if (v < min) v = min + (v - min) * 0.3;
        // 一次最多拖一張的距離
        const base = -live.current.page * w;
        v = Math.max(base - w, Math.min(base + w, v));
        x.setValue(v);
      },
      onPanResponderRelease: (_e, g) => {
        const { w, n, page: p } = live.current;
        let next = p;
        if (g.dx < -w * 0.18 || g.vx < -0.4) next = p + 1;
        else if (g.dx > w * 0.18 || g.vx > 0.4) next = p - 1;
        pausedUntil.current = Date.now() + livePause.current * 1000;
        slideTo(Math.max(0, Math.min(n - 1, next)));
      },
      onPanResponderTerminate: () => {
        pausedUntil.current = Date.now() + livePause.current * 1000;
        slideTo(live.current.page);
      },
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 自動輪播（秒數由「設定 > APP 數值設定」控制；0＝關閉；手指滑過後暫停一段時間）。
  useEffect(() => {
    if (!autoSec || courses.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      const { page: p, n } = live.current;
      slideTo((p + 1) % n);
    }, autoSec * 1000);
    return () => clearInterval(t);
  }, [autoSec, courses.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (i: number) => {
    pausedUntil.current = Date.now() + livePause.current * 1000;
    slideTo(i);
  };
  const info = { fontSize: Math.round(12 * scale), lineHeight: Math.round(16 * scale) };
  const [bg, fg] = tone === "green" ? [c.accentSoft, c.accentText] : [c.warningSoft, c.warning];
  return (
    <View style={styles.col}>
      <View style={[styles.pill, { backgroundColor: bg, minHeight: Math.round(36 * scale) }]}>
        <Icon name={icon} size={Math.round(18 * scale)} color={fg} />
        <AppText variant="headline" numberOfLines={1} style={{ color: fg, fontWeight: "800", fontSize: Math.round(17 * scale), lineHeight: Math.round(24 * scale) }}>
          {title}
        </AppText>
      </View>
      {compact ? null : <AppText variant="caption" tone="muted" numberOfLines={3} style={[styles.note, { fontSize: Math.round(12 * scale), lineHeight: Math.round(16 * scale), minHeight: Math.round(32 * scale) }]}>
        {note ?? " "}
      </AppText>}
      <View
        style={styles.stage}
        onLayout={(e) => {
          const h = Math.floor(e.nativeEvent.layout.height);
          setBox({ w: Math.floor(e.nativeEvent.layout.width), h });
          onStageHeight?.(h);
        }}
      >
        {box.w > 0 && box.h > 0 ? (
          courses.length ? (
            <View style={{ width: box.w, height: box.h, overflow: "hidden", ...(Platform.OS === "web" ? ({ touchAction: "pan-y", userSelect: "none" } as object) : {}) }} {...pan.panHandlers}>
              <Animated.View style={{ flexDirection: "row", width: box.w * courses.length, height: box.h, transform: [{ translateX: x }] }}>
                {courses.map((course) => (
                  <Pressable key={course.id} onPress={() => setPreview(course)} accessibilityRole="button" accessibilityLabel={displayName(course)} style={{ width: box.w, height: box.h }}>
                    <Slide course={course} w={box.w} h={box.h} />
                  </Pressable>
                ))}
              </Animated.View>
            </View>
          ) : (
            <View style={{ width: box.w, height: box.h, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderStyle: "dashed", padding: space.sm, justifyContent: "center", alignItems: "center", gap: space.sm }}>
              <Icon name={icon} size={34} color={c.textMuted} />
              {empty}
            </View>
          )
        ) : null}
      </View>
      <View style={[styles.dots, compact && { height: 16 }]}>
        {/* 課程很多時，圓點只顯示放得下的數量（以目前這張為中心的一段），不會超出欄寬。 */}
        {courses.length > 1
          ? dotWindow(courses.length, page, Math.max(5, Math.floor((box.w || 160) / 16))).map((i) => [courses[i], i] as const).map(([course, i]) => (
              <Pressable key={course.id} onPress={() => goTo(i)} accessibilityRole="button" accessibilityLabel={`第 ${i + 1} 張，共 ${courses.length} 張`} accessibilityState={{ selected: i === page }} hitSlop={4} style={styles.dotHit}>
                <View style={[styles.dot, { backgroundColor: i === page ? c.accent : c.border }]} />
              </Pressable>
            ))
          : null}
      </View>
      {!cur && !hideInfo ? <View style={[styles.info, compact && { minHeight: 0 }]} /> : null}
      {cur && !hideInfo ? (
        <Pressable onPress={() => setPreview(cur)} accessibilityRole="link" style={[styles.info, compact && { minHeight: 0 }]}>
          {hostLine(cur) ? (
            <AppText variant="caption" tone="muted" numberOfLines={2} style={info}>
              {hostLine(cur)}
            </AppText>
          ) : null}
          {cur.eventStart ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={info}>
              {eventDays(cur.eventStart, cur.eventEnd)}
            </AppText>
          ) : null}
          {placeText(cur) ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={info}>
              {placeText(cur)}
            </AppText>
          ) : null}
          {progress ? null : (
            <View style={{ alignSelf: "center" }}>
              <CoursePriceTag course={cur} />
            </View>
          )}
          {progress && cur.lessonCount ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={info}>
              學習進度 {cur.progressPercent}%
            </AppText>
          ) : null}
        </Pressable>
      ) : null}
      {preview ? <CourseLessonsSheet course={preview} onClose={() => setPreview(null)} /> : null}
    </View>
  );
}

/** 圓點顯示範圍：最多 max 顆，以目前這張為中心。 */
function dotWindow(n: number, page: number, max: number): number[] {
  const len = Math.min(n, max);
  const start = Math.max(0, Math.min(n - len, page - Math.floor(len / 2)));
  return Array.from({ length: len }, (_, k) => start + k);
}

/** 海報下方資訊區佔的高度（minHeight 100＋欄位間距 4）：首頁用它推算「顯示資訊時海報還剩多高」。 */
export const HOME_INFO_SPACE = 100 + space.xs;

const styles = StyleSheet.create({
  col: { flex: 1, minWidth: 0, gap: space.xs, alignItems: "stretch" },
  pill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, minHeight: 36, paddingHorizontal: space.sm, borderRadius: radius.pill },
  note: { textAlign: "center", minHeight: 32 },
  stage: { flex: 1, minHeight: 60 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", height: 26, overflow: "hidden" },
  dotHit: { width: 16, height: 26, alignItems: "center", justifyContent: "center", ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : {}) },
  dot: { width: 11, height: 11, borderRadius: 6 },
  info: { gap: 2, alignItems: "center", minHeight: 100 },
});
