import { useState, type ReactNode } from "react";
import { View } from "react-native";
import type { CourseSummary } from "@/api/client";
import { CoverAlbum } from "@/features/courses/album";
import { CenterMaterialsCard } from "@/features/courses/center-list";
import { ScheduleCard, useCenterSchedules } from "@/features/courses/center-schedule";
import { useCoverMedia } from "@/features/courses/cover-media";
import { centerKeyOf, centerTitle } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui";
import { ElderBlockHeader } from "./elder-course";

/**
 * 至尊模式進入「中心卡」之後（業主 2026-11-24）：超派模式中心頁的四個分頁「EDM／課表／重播／列表」，
 * 比照課程頁區塊的做法，改成四條大列（標題＋展開箭頭），**預設全部收起、同一時間只展開一個**；展開後顯示該分頁的內容：
 * EDM＝中心 EDM 相簿（`CoverAlbum`）、課表＝本月課表（`ScheduleCard`）、重播＝這個中心的課程列（呼叫端傳入 `renderCourses`）、列表＝所有課程裡的每個教材（`CenterMaterialsCard`）。
 * 內容與超派模式的中心頁是同一批元件，只是排版不同。
 */
export function ElderCenterPage({ center, courses, renderCourses }: { center: string; courses: CourseSummary[]; renderCourses: () => ReactNode }) {
  const { member } = useSession();
  const [open, setOpen] = useState<"album" | "schedule" | "course" | "list" | null>(null);
  const cm = useCoverMedia("center", center);
  const sch = useCenterSchedules(center);
  const info = useApi<Record<string, string>>(member ? "/center-info" : null);
  const address = info.data?.[centerKeyOf(center)];
  const blocks: { key: "album" | "schedule" | "course" | "list"; title: string; sub?: string; body: () => ReactNode }[] = [
    { key: "album", title: "EDM", sub: cm.edm.length ? `${cm.edm.length} 張` : undefined, body: () => <CoverAlbum kind="center" scope="edm" ownerKey={center} title={centerTitle(center)} items={cm.edm} canEdit={false} onChanged={cm.reload} /> },
    {
      key: "schedule",
      title: "課表",
      body: () =>
        sch.data?.items.length ? <ScheduleCard items={sch.data.items} title={centerTitle(center)} address={address} /> : <AppText tone="muted">還沒有課表。中心上傳課表後會顯示在這裡。</AppText>,
    },
    { key: "course", title: "重播", sub: `${courses.length} 堂課`, body: renderCourses },
    { key: "list", title: "列表", body: () => (courses.length ? <CenterMaterialsCard courseIds={courses.map((x) => x.id)} /> : <AppText tone="muted">還沒有教材。</AppText>) },
  ];
  return (
    <View style={{ gap: space.md }}>
      {blocks.map((b) => {
        const on = open === b.key;
        return (
          <View key={b.key} style={{ gap: space.sm }}>
            <ElderBlockHeader title={b.title} sub={b.sub} on={on} onPress={() => setOpen(on ? null : b.key)} />
            {on ? b.body() : null}
          </View>
        );
      })}
    </View>
  );
}
