import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl, type CoverMediaItem } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { useUiConfig } from "@/state/ui-config";
import { buildSlides } from "./cover-media";


/**
 * 封面輪播（業主 2026-11-21，中心、系列、課程封面共用）：照片依「設定 › 儲存空間管理 › 封面輪播」的秒數自動換張，
 * 手指左右滑動快速換張，按住時暫停；短影音播完才換下一張（預設靜音，右下角喇叭鈕可開聲音）。
 * 連續的直式照片三張併成一張橫式畫面（buildSlides）。點一下回報 onOpen(第一張照片的編號) 讓外面開全螢幕看圖。
 * App（iOS／Android）版暫時只顯示影片的預覽圖，影片播放網頁版先做。
 */
export function CoverCarousel({ items, width, height, onOpen, paused = false }: { items: CoverMediaItem[]; width: number; height: number; onOpen?: (id: string) => void; paused?: boolean }) {
  const thumb = useThumb();
  const { config } = useUiConfig();
  const slides = useMemo(() => buildSlides(items), [items]);
  const [idx, setIdx] = useState(0);
  const [touching, setTouching] = useState(false);
  const [sound, setSound] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const n = slides.length;
  const cur = slides[Math.min(idx, n - 1)];
  const video = cur && cur.items.length === 1 && cur.items[0]!.kind === "video" && Platform.OS === "web" ? cur.items[0]! : null;
  const go = (d: number) => setIdx((i) => (n ? (i + d + n) % n : 0));
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => setIdx(0), [items.length]);
  useEffect(() => {
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps
  // 自動換張：照片照設定的秒數；影片播完（onEnded）才換，另外設一個保險時間避免卡住。
  useEffect(() => {
    if (n < 2 || paused || touching) return;
    const ms = video ? Math.max(8, (video.durationSec || 20) + 4) * 1000 : config.app.coverSec * 1000;
    const t = setTimeout(() => goRef.current(1), ms);
    return () => clearTimeout(t);
  }, [idx, n, paused, touching, video?.id, config.app.coverSec]); // eslint-disable-line react-hooks/exhaustive-deps
  // 預先載入下一張。
  useEffect(() => {
    const next = slides[(idx + 1) % Math.max(1, n)];
    for (const x of next?.items ?? []) if (x.kind === "image") Image.prefetch(thumb(resolveUrl(x.url), width)).catch(() => undefined);
  }, [idx, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => setTouching(true),
      onPanResponderRelease: (_e, g) => {
        setTouching(false);
        if (Math.abs(g.dx) > 40) goRef.current(g.dx < 0 ? 1 : -1);
      },
      onPanResponderTerminate: () => setTouching(false),
    }),
  ).current;

  if (!cur) return null;
  const imgOf = (x: CoverMediaItem, w: number) => <Image key={x.id} source={{ uri: thumb(resolveUrl(x.kind === "video" ? x.posterUrl ?? x.url : x.url), Math.max(320, Math.round(w))) }} style={{ flex: 1, height }} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width, height, backgroundColor: "#000", overflow: "hidden" }} {...pan.panHandlers} {...(Platform.OS === "web" ? ({ style: { width, height, backgroundColor: "#000", overflow: "hidden", touchAction: "pan-y" } } as object) : {})}>
      <Animated.View style={{ flex: 1, opacity: fade, flexDirection: "row", gap: cur.items.length > 1 ? 2 : 0 }}>
        {video ? (
          createElement("video", {
            key: video.id,
            src: resolveUrl(video.url),
            poster: video.posterUrl ? resolveUrl(video.posterUrl) : undefined,
            autoPlay: true,
            muted: !sound,
            playsInline: true,
            "data-allow-pull": "", // 封面影片也要能下拉重新整理（web-pull-refresh.ts 對一般 video 不觸發）
            onEnded: () => goRef.current(1),
            style: { width, height, objectFit: video.height > video.width * 1.05 ? "contain" : "cover", background: "#000" },
          })
        ) : (
          cur.items.map((x) => imgOf(x, cur.items.length > 1 ? width / 3 : width))
        )}
      </Animated.View>
      {/* 點一下：開全螢幕看圖（影片不開，影片就在原地播放）。 */}
      {onOpen && !video ? <Pressable accessibilityRole="button" accessibilityLabel="放大看照片" onPress={() => onOpen(cur.items[0]!.id)} style={StyleSheet.absoluteFill} /> : null}
      {video ? (
        <Pressable accessibilityRole="button" accessibilityLabel={sound ? "關閉聲音" : "開啟聲音"} onPress={() => setSound((v) => !v)} style={styles.sound}>
          <Ionicons name={sound ? "volume-high" : "volume-mute"} size={22} color="#fff" />
        </Pressable>
      ) : null}
      {n > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {n <= 8 ? (
            slides.map((s, i) => <View key={s.key} style={[styles.dot, { backgroundColor: i === idx ? "#fff" : "rgba(255,255,255,0.45)" }]} />)
          ) : (
            <View style={styles.bar}>
              <View style={{ width: `${((idx + 1) / n) * 100}%`, height: 3, backgroundColor: "#fff" }} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: "absolute", left: 0, right: 0, bottom: 4, flexDirection: "row", justifyContent: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  bar: { width: 80, height: 3, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 2, overflow: "hidden" },
  sound: { position: "absolute", left: 12, top: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
});
