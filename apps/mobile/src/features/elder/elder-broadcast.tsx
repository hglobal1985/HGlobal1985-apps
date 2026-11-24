import { useState } from "react";
import { View } from "react-native";
import { ElderBlockHeader } from "./elder-course";
import { BroadcastList } from "@/features/broadcast/broadcast-band";
import { useBroadcastUnread } from "@/features/broadcast/broadcast-read";
import { useBroadcasts } from "@/features/broadcast/use-broadcasts";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";

/** 至尊模式的區塊（中心卡、系列頁、課程頁共用的形狀）。 */
export type ElderBlock = {
  key: string;
  title: string;
  sub?: string;
  body: () => React.ReactNode;
  tone?: "yellow";
  badge?: number;
  subOneLine?: boolean;
  /** 展開時要做的事（公告：全部標為已讀）。 */
  onOpen?: () => void;
};

/**
 * 至尊模式「公告」區塊（業主 2026-11-24）：和其他區塊同一種標題列，但用超派公告的黃色；
 * 標題「公告（N 則）」、下一行是最新一則的預覽（太長用「…」）；有未讀時右邊的箭頭暫時換成紅色數字氣球，展開看過就恢復箭頭。
 * 展開＝每一則公告的完整內容（與超派公告面板同一個 BroadcastList，新的在上、含日期）。
 * 資料與超派同一個來源（useBroadcasts：中心＋所屬系列）。沒有公告就不顯示（回傳 null）。
 */
export function useElderBroadcastBlock(t: { center?: string; series?: string }): ElderBlock | null {
  const { c } = useTheme();
  const bc = useBroadcasts(t);
  const items = bc.data?.items;
  const { unread, markAll } = useBroadcastUnread(items);
  if (!items?.length) return null;
  return {
    key: "announce",
    title: `公告（${items.length} 則）`,
    sub: items[0]!.text.replace(/\s+/g, " "),
    subOneLine: true,
    tone: "yellow",
    badge: unread,
    onOpen: markAll,
    body: () => (
      <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.surface, paddingHorizontal: space.md }}>
        <BroadcastList items={items} onChanged={bc.reload} />
      </View>
    ),
  };
}

/** 單獨一條公告區塊（課程頁用；中心卡、系列頁把 useElderBroadcastBlock 放進自己的區塊清單，才能「同時只展開一個」）。 */
export function ElderBroadcastBox(t: { center?: string; series?: string }) {
  const block = useElderBroadcastBlock(t);
  const [open, setOpen] = useState(false);
  if (!block) return null;
  return (
    <View style={{ gap: space.sm }}>
      <ElderBlockHeader title={block.title} sub={block.sub} subOneLine tone="yellow" badge={block.badge} on={open} onPress={() => (open ? setOpen(false) : (setOpen(true), block.onOpen?.()))} />
      {open ? block.body() : null}
    </View>
  );
}
