import { router } from "expo-router";
import { useEffect, useState } from "react";
import { api, type HwCourseView } from "@/api/client";
import { Card, ListRow, Pill } from "@/ui";

/**
 * 課程頁的「作業」入口（業主 2026-11-25）：只有這門課已開通的學員、組員與老師看得到（作業不公開）；
 * 沒有作業時，只有老師看得到（才能出第一份）。點了進這門課的作業頁。
 */
export function CourseHomeworkEntry({ courseId }: { courseId: string }) {
  const [v, setV] = useState<HwCourseView | null>(null);
  useEffect(() => {
    let alive = true;
    api<HwCourseView>("GET", `/homework/course/${courseId}`)
      .then((x) => alive && setV(x))
      .catch(() => undefined); // 沒有權限（沒報名）就不顯示
    return () => {
      alive = false;
    };
  }, [courseId]);
  if (!v || (!v.assignments.length && !v.role.teacher)) return null;
  const todo = v.assignments.filter((a) => a.open && (a.myStatus === "none" || a.myStatus === "draft" || a.myStatus === "returned")).length;
  const toGrade = v.assignments.reduce((n, a) => n + (a.counts?.toGrade ?? 0), 0);
  const sub = v.role.teacher ? (v.assignments.length ? `${v.assignments.length} 份作業・出作業、批改、分組` : "還沒有作業，點這裡出第一份") : `${v.assignments.length} 份作業・只有你、同組組員和老師看得到`;
  return (
    <Card style={{ paddingVertical: 0 }}>
      <ListRow icon="document-text-outline" title="作業" subtitle={sub} right={toGrade && v.role.teacher ? <Pill label={`待批改 ${toGrade}`} tone="warning" /> : todo && v.role.enrolled ? <Pill label={`待繳 ${todo}`} tone="warning" /> : undefined} onPress={() => router.push(`/homework/${courseId}`)} />
    </Card>
  );
}
