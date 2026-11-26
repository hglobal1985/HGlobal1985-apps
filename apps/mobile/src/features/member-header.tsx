import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { Member } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { BADGE_SIZE, BADGE_W, RankBadge } from "./rank-badge";

const AVATAR = 48; // 大頭照尺寸；徽章在版面上只佔這個高度（上下間距維持原樣）

/**
 * 會員抬頭：大頭照＋姓名＋獎銜標籤。首頁與設定頁最上方共用，格式一致；要改外觀只改這個檔案。
 * 有傳 onPress 才可點（首頁：開啟資料編輯）。
 */
export function MemberHeader({ member, onPress, scale = 1, stacked = false }: { member: Member; onPress?: () => void; scale?: number; /** 姓名一列、獎銜＋獎章一列（至尊模式頁，杜杜龍 2026-11-24）。 */ stacked?: boolean }) {
  const { c, scheme } = useTheme();
  const [failed, setFailed] = useState(false);
  const av = Math.round(AVATAR * scale * (stacked ? 1.5 : 1)); // 至尊模式頁的頭像與獎章放大 1.5 倍（杜杜龍 2026-11-24）
  const fs = (n: number) => Math.round(n * scale);
  const avatar =
    member.avatarUrl && !failed ? (
      <Image source={{ uri: member.avatarUrl }} onError={() => setFailed(true)} style={[styles.avatar, { width: av, height: av, borderRadius: av / 2, backgroundColor: c.surfaceMuted }]} accessibilityIgnoresInvertColors />
    ) : (
      <View style={[styles.avatar, { width: av, height: av, borderRadius: av / 2, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }]}>
        <AppText variant="title" style={{ color: c.accentText, fontSize: fs(20), lineHeight: fs(28) }}>
          {member.name.trim().slice(0, 1) || "?"}
        </AppText>
      </View>
    );
  const rankTag = member.rankLabel ? (
    <View style={[styles.rank, { paddingHorizontal: fs(8), paddingVertical: fs(2) }, scheme === "dark" && { borderColor: "#6b5424", backgroundColor: "#3a2e17" }]}>
      <AppText variant="callout" style={{ color: scheme === "dark" ? "#f0a050" : "#cc6c0c", fontWeight: "700", fontSize: fs(14), lineHeight: fs(20) }}>
        {member.rankLabel}
      </AppText>
    </View>
  ) : null;
  if (stacked) {
    // 有獎章時（杜杜龍 2026-11-24）：姓名字體縮小一點，獎章放在右邊、高度與頭像一樣大。
    const hasBadge = !!member.rankBadge;
    return (
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${member.name}${member.rankLabel ? `，${member.rankLabel}` : ""}`} style={styles.stack}>
        {avatar}
        <View style={styles.stackText}>
          <AppText variant="title" numberOfLines={2} style={{ fontSize: fs(hasBadge ? 17 : 20), lineHeight: fs(hasBadge ? 24 : 28), textAlign: "center" }}>
            {member.name}
          </AppText>
          {rankTag ? <View style={styles.stackRank}>{rankTag}</View> : null}
        </View>
        {hasBadge ? (
          // 獎章放大用 transform（不佔版面），列高只等於頭像高度，上下不留大片空白（杜杜龍 2026-11-24）。
          <View style={{ width: Math.round(BADGE_W * 1.4), height: av, alignItems: "center", justifyContent: "center" }}>
            <View style={{ transform: [{ scale: 1.4 }] }}>
              <RankBadge url={member.rankBadge!} label={member.rankLabel} art={member.rankBadgeArt} layoutHeight={BADGE_SIZE} />
            </View>
          </View>
        ) : null}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `${member.name}，完善與編輯會員基本資料` : member.name}
      style={styles.who}
    >
      <View style={styles.left}>
        {member.avatarUrl && !failed ? (
          <Image source={{ uri: member.avatarUrl }} onError={() => setFailed(true)} style={[styles.avatar, { width: av, height: av, borderRadius: av / 2, backgroundColor: c.surfaceMuted }]} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.avatar, { width: av, height: av, borderRadius: av / 2, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <AppText variant="title" style={{ color: c.accentText, fontSize: fs(20), lineHeight: fs(28) }}>
              {member.name.trim().slice(0, 1) || "?"}
            </AppText>
          </View>
        )}
        <AppText variant="title" numberOfLines={1} style={{ flexShrink: 1, fontWeight: "400", fontSize: fs(20), lineHeight: fs(28) }}>
          {member.name}
        </AppText>
        {member.rankLabel ? (
          <View style={[styles.rank, { paddingHorizontal: fs(8), paddingVertical: fs(2) }, scheme === "dark" && { borderColor: "#6b5424", backgroundColor: "#3a2e17" }]}>
            <AppText variant="callout" style={{ color: scheme === "dark" ? "#f0a050" : "#cc6c0c", fontWeight: "700", fontSize: fs(14), lineHeight: fs(20) }}>
              {member.rankLabel}
            </AppText>
          </View>
        ) : null}
        {/* 徽章緊貼在獎銜標籤右邊 */}
        {member.rankBadge ? (
          <View style={{ marginLeft: -space.xs + (scale - 1) * 24, transform: [{ scale }] }}>
            <RankBadge url={member.rankBadge} label={member.rankLabel} art={member.rankBadgeArt} layoutHeight={AVATAR} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 56, maxWidth: "100%" },
  left: { flexShrink: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md, minWidth: 0 },
  rank: { borderWidth: 1, borderColor: "#e6c48c", backgroundColor: "#fdf0e3", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  stack: { flexDirection: "row", alignItems: "center", gap: space.md },
  stackText: { flex: 1, minWidth: 0, gap: space.xs, alignItems: "center" },
  stackRank: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, flexWrap: "wrap" },
});
