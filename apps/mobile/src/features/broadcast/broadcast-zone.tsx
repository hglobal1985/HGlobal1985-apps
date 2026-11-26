import { useEffect, useRef, useState } from "react";
import { centerShort } from "@/features/format";
import { useSeriesSettings } from "@/features/courses/series-settings";
import { BroadcastBand, BroadcastSheet } from "./broadcast-band";
import { useBroadcasts } from "./use-broadcasts";

/**
 * 「公告區」一整塊（黃色橫條＋點開的完整公告清單，有權限的人可在清單裡修改、刪除）：放在任何頁面封面正下方、頁面內容的第一個元素即可。
 * 中心頁：傳 center；該中心的課程頁、系列頁：傳 center 與／或 series（兩邊的公告一起輪播）。沒有公告就什麼都不顯示。
 * 杜杜龍 2026-11-21：公告模組化，之後新增任何頁面要放公告，只放這一個元件。
 */
export function BroadcastZone({ center, series, title, gutter, reloadKey, flush }: { /** 釘在封面下方（heroFooter）時傳 true。 */ flush?: boolean; center?: string; series?: string; title: string; gutter?: number; /** 頁面別處新增、修改公告後把這個數字加一，這裡就重新讀取。 */ reloadKey?: number }) {
  const bc = useBroadcasts({ center, series });
  const seriesSettings = useSeriesSettings();
  const [open, setOpen] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else bc.reload();
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bc.data?.items.length) return null;
  return (
    <>
      <BroadcastBand flush={flush} items={bc.data.items} seconds={bc.data.seconds} onOpen={() => setOpen(true)} gutter={gutter} labelOf={(s) => (s === "center" && center ? centerShort(center) : s === "series" && series ? seriesSettings.titleOf(series) : "")} />
      {open ? <BroadcastSheet title={title} items={bc.data.items} onClose={() => setOpen(false)} onChanged={bc.reload} /> : null}
    </>
  );
}

/** 首頁公告（跑馬燈）點開後的完整清單：自己讀資料；有權限的人（超級管理員）可在裡面修改、刪除。 */
export function HomeBroadcastSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const bc = useBroadcasts({ home: true });
  if (!bc.data) return null;
  return <BroadcastSheet title="首頁公告" items={bc.data.items} onClose={onClose} onChanged={() => (bc.reload(), onChanged())} />;
}
