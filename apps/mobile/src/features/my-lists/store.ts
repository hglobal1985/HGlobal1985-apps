import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/api/client";
import { useSession } from "@/state/session";

/**
 * 「加入我的清單」的標記（杜杜龍 2026-11-21）：每個內容在我的幾份清單裡。全站所有按鈕共用同一份、只查一次；
 * 加入或移除後用 bumpMark 立刻更新畫面，不必重新查。換帳號、登出時清空。
 */
export type ListKind = "course" | "lesson" | "series" | "center";
export type ListRef = { kind: ListKind; ref: string; ref2?: string };
export const markKey = (r: { kind: ListKind; ref: string }) => `${r.kind}:${r.ref}`;

let marks: Record<string, number> = {};
let loaded = false;
let loading = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function resetMarks() {
  marks = {};
  loaded = false;
  loading = false;
  emit();
}
async function load() {
  if (loaded || loading) return;
  loading = true;
  try {
    marks = (await api<{ marks: Record<string, number> }>("GET", "/my-lists/marks")).marks;
    loaded = true;
  } catch {
    /* 查不到就當沒有，下次再試 */
  } finally {
    loading = false;
    emit();
  }
}
export function bumpMark(r: ListRef, delta: number) {
  const k = markKey(r);
  marks = { ...marks, [k]: Math.max(0, (marks[k] ?? 0) + delta) };
  emit();
}
/** 這個內容目前在我的幾份清單裡（沒登入＝0）。 */
export function useMark(r: ListRef): number {
  const { member } = useSession();
  useEffect(() => {
    if (member) void load();
    else if (loaded) resetMarks();
  }, [member]);
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => (member ? marks[markKey(r)] ?? 0 : 0),
    () => 0,
  );
}
