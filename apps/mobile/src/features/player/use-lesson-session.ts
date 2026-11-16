import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { api, type CourseDetail, type Playback } from "@/api/client";
import { saveLastLesson } from "@/lib/last-lesson";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { engine } from "./engine";
import { buildTrack } from "./engine.types";
import { usePlayer } from "./use-player";

/**
 * 課程頁「原地播放」的全部邏輯（原本在上課頁，業主 2026-11-16 改成不跳頁、原地播放，整段搬到這裡，行為不變）：
 * - 向伺服器要播放授權、組成播放軌、交給全站單一播放器（同一堂直接接上；別堂正在播放就詢問是否中斷）。
 * - 手機 App 的 YouTube 仍用內嵌播放器（legacyYoutube）。
 * - 學習進度：記住最後學習的章節、播放 1% 回報「開始學習」、每前進 1% 且超過 10 秒回報進度、離開時補送、播到 95%／結尾自動標記完成。
 * lessonId 為 null＝沒有在播放，全部閒置。onSwitch＝被別堂佔用、使用者選「繼續原本的」時，要切到正在播的那一堂。
 */
export function useLessonSession(c: CourseDetail | null | undefined, lessonId: string | null, reload: () => void, onSwitch: (courseId: string, lessonId: string) => void) {
  const { invalidate, ready, member } = useSession();
  // 學習紀錄的三個數字由超級管理員在「設定 > APP 數值設定」調整。
  const { learnStartPct, learnDonePct, watchReportSec } = useUiConfig().config.app;
  const startAt = learnStartPct / 100;
  const doneAt = learnDonePct / 100;
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const player = usePlayer();
  // 手機 App 的 YouTube 仍在課程頁內嵌播放（WebView 無法跨頁保留）；其餘一律交給全站單一播放器。
  const legacyYoutube = !!lessonId && Platform.OS !== "web" && playback?.kind === "youtube";
  const [legacyDone, setLegacyDone] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const courseId = c?.id;

  // 等登入狀態載入完成再要播放授權（直接開啟連結或重新整理時）。
  useEffect(() => {
    setPlayback(null);
    setLegacyDone(false);
    setPlayError(null);
    if (!ready || !courseId || !lessonId) return;
    let alive = true;
    api<Playback>("GET", `/courses/${courseId}/lessons/${lessonId}/playback`)
      .then((p) => alive && setPlayback(p))
      .catch((e: Error) => alive && setPlayError(e.message));
    return () => {
      alive = false;
    };
  }, [courseId, lessonId, ready, member?.sub]);

  const lessonRow = lessonId ? c?.lessons.find((l) => l.id === lessonId) : undefined;
  const track = useMemo(
    () => (playback && c && lessonRow && !legacyYoutube ? buildTrack(playback, { courseId: c.id, lessonId: lessonRow.id, title: lessonRow.title, subtitle: c.title, artwork: lessonRow.posterUrl || lessonRow.coverUrl || c.edmUrl }) : null),
    [playback, c?.id, c?.title, lessonRow?.id, lessonRow?.title, lessonRow?.coverUrl, lessonRow?.posterUrl, legacyYoutube], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (member && c && lessonRow) saveLastLesson(member.sub, { courseId: c.id, lessonId: lessonRow.id, lessonTitle: lessonRow.title, courseTitle: c.title });
  }, [member?.sub, c?.id, lessonRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 要播這一堂：同一堂直接接上；另一堂正在播放就詢問是否中斷，選「繼續原本的」就回到原本那一堂。
  useEffect(() => {
    if (legacyYoutube) engine.close();
    if (!track) return;
    let alive = true;
    engine.request(track).then((ok) => {
      if (!alive) return;
      if (ok) return setClaimed(track.key);
      const cur = engine.getSnapshot().track;
      if (cur) onSwitch(cur.courseId, cur.lessonId);
    });
    return () => {
      alive = false;
    };
  }, [track, legacyYoutube]); // eslint-disable-line react-hooks/exhaustive-deps

  // 沒有「完成」按鈕了：這一堂播放到結尾，自動記錄完成。
  const autoDone = useRef<string | null>(null);
  const curLesson = lessonRow;
  // 播放超過 learnDonePct（預設 95%）就算完成（有設定起訖時間的章節，以那一段為準）；播到結尾也算。
  const here = !!track && player.track?.key === track.key;
  const segStart = curLesson?.start ?? 0;
  const segEnd = curLesson?.end ?? player.duration;
  const segLen = segEnd - segStart;
  const watched = here && segLen > 0 && (player.position - segStart) / segLen >= doneAt;
  const finished = legacyYoutube ? legacyDone : here && (player.segmentEnded || watched);
  // 播放超過 learnStartPct（預設 1%）：通知後端把這門課納入「學習中」（不論免費或付費、有沒有報名紀錄；每一堂每次進入頁面只回報一次）。
  const started = here && segLen > 0 && (player.position - segStart) / segLen >= startAt;
  const startedSent = useRef<string | null>(null);
  useEffect(() => {
    if (!c || !curLesson || !member || !started || startedSent.current === curLesson.id) return;
    startedSent.current = curLesson.id;
    api("POST", `/courses/${c.id}/lessons/${curLesson.id}/started`)
      .then(() => invalidate())
      .catch(() => {
        startedSent.current = null; // 失敗下次再試
      });
  }, [started, member?.sub, curLesson?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 播放進度（0～1）：每前進 1% 且距離上次回報超過 10 秒就回報一次，離開這一堂時再補送最後的位置，讓「學習中」的進度條跟著走。
  const ratio = here && segLen > 0 ? Math.min(1, Math.max(0, (player.position - segStart) / segLen)) : 0;
  const ratioByLesson = useRef<Record<string, number>>({}); // 每一堂目前播放到哪（離開時補送用；換堂時不會被新的一堂蓋掉）
  if (curLesson && ratio > (ratioByLesson.current[curLesson.id] ?? 0)) ratioByLesson.current[curLesson.id] = ratio;
  const watchSent = useRef({ lesson: "", ratio: 0, at: 0 });
  useEffect(() => {
    if (!c || !curLesson || !member || ratio < 0.01) return;
    const w = watchSent.current;
    if (w.lesson !== curLesson.id) Object.assign(w, { lesson: curLesson.id, ratio: 0, at: 0 });
    if (ratio - w.ratio < 0.01 || Date.now() - w.at < watchReportSec * 1000) return;
    Object.assign(w, { ratio, at: Date.now() });
    api("POST", `/courses/${c.id}/lessons/${curLesson.id}/watch`, { ratio }).catch(() => undefined);
  }, [ratio, member?.sub, curLesson?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cid = c?.id;
    const lessonKey = curLesson?.id;
    return () => {
      const w = watchSent.current;
      const last = lessonKey ? (ratioByLesson.current[lessonKey] ?? 0) : 0;
      if (!cid || !lessonKey || !member || last < 0.01 || (w.lesson === lessonKey && last - w.ratio < 0.005)) return;
      w.lesson = lessonKey;
      w.ratio = last;
      api("POST", `/courses/${cid}/lessons/${lessonKey}/watch`, { ratio: last })
        .then(() => invalidate())
        .catch(() => undefined);
    };
  }, [c?.id, curLesson?.id, member?.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c || !curLesson || !member || !finished || curLesson.completed || autoDone.current === curLesson.id) return;
    autoDone.current = curLesson.id;
    api("POST", `/courses/${c.id}/lessons/${curLesson.id}/complete`)
      .then(() => {
        invalidate();
        reload();
      })
      .catch((e: Error) => setPlayError(e.message));
  }, [finished, member?.sub, curLesson?.id, curLesson?.completed]); // eslint-disable-line react-hooks/exhaustive-deps

  const engineError = track && player.track?.key === track.key ? player.error : null;
  const pinned = !!track && claimed === track.key;
  return { playback, track, pinned, playError, engineError, legacyYoutube, onLegacyEnd: () => setLegacyDone(true) };
}
