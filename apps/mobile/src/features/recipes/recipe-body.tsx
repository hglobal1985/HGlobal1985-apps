import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { YouTubePlayer } from "@/features/player/youtube-player";
import { parseRecipe } from "@/lib/recipe-text";
import { AppText } from "@/ui";

const UI_ONLY = { uiOnly: true } as object;
const UI_ONLY_TEXT = { dataSet: { uiOnly: "" } } as object;

/** 影片卡片（杜杜龍 2026-11-26）：先顯示縮圖，點了就在這張卡片裡直接播放（站內播放，不跳去 YouTube）。 */
export function RecipeVideo({ videoId }: { videoId: string }) {
  const [on, setOn] = useState(false);
  if (on) return <YouTubePlayer videoId={videoId} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="播放食譜影片" onPress={() => setOn(true)} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 12, overflow: "hidden", backgroundColor: "#1a1a1c", alignItems: "center", justifyContent: "center" }}>
      <Image source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` }} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors />
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="play" size={34} color="#fff" {...UI_ONLY} />
      </View>
    </Pressable>
  );
}

/** 食譜文字：小標題（材料、做法…）標黃色，獨立一行的 YouTube 網址變影片卡片，其餘照原文顯示（可選取複製）。 */
export function RecipeBody({ text }: { text: string }) {
  const blocks = parseRecipe(text);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((b, i) =>
        b.t === "gap" ? (
          <View key={i} style={{ height: 6 }} />
        ) : b.t === "yt" ? (
          <View key={i} style={{ marginVertical: 6 }}>
            <RecipeVideo videoId={b.text} />
          </View>
        ) : b.t === "h" ? (
          <AppText key={i} {...UI_ONLY_TEXT} style={{ color: "#F5C842", fontWeight: "800", fontSize: 17, lineHeight: 26, marginTop: 8 }}>{b.text}</AppText>
        ) : (
          <AppText key={i} selectable {...UI_ONLY_TEXT} style={{ color: "#e8e8ea", fontSize: 16, lineHeight: 27 }}>{b.text}</AppText>
        ),
      )}
    </View>
  );
}
