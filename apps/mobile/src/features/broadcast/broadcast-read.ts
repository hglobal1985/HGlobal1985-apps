import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/state/session";
import type { BroadcastItem } from "./use-broadcasts";

/**
 * 公告「已讀」紀錄（杜杜龍 2026-11-24：公告未讀要顯示紅色數字氣球，看過就消失）。
 * 記在這支手機／瀏覽器（AsyncStorage，網頁＝localStorage），依帳號分開（沒登入＝訪客）；不上傳伺服器。
 * 只記最近 500 則，避免越存越大。展開公告區塊＝裡面每一則都算看過。
 */
const MAX = 500;
let owner: string | null = null;
let read = new Set<string>();
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
const keyOf = (who: string) => `broadcast-read:v1:${who}`;

async function loadFor(who: string) {
  if (owner === who) return;
  owner = who;
  read = new Set();
  emit();
  try {
    const raw = await AsyncStorage.getItem(keyOf(who));
    if (owner !== who) return;
    read = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    emit();
  } catch {
    /* 讀不到就當全部未讀 */
  }
}

function markRead(ids: string[]) {
  if (!owner) return;
  const fresh = ids.filter((id) => !read.has(id));
  if (!fresh.length) return;
  fresh.forEach((id) => read.add(id));
  const keep = [...read].slice(-MAX);
  read = new Set(keep);
  emit();
  AsyncStorage.setItem(keyOf(owner), JSON.stringify(keep)).catch(() => undefined);
}

/** 這批公告裡還沒看過幾則；markAll()＝全部標為已讀。 */
export function useBroadcastUnread(items: BroadcastItem[] | undefined) {
  const { member, ready } = useSession();
  const who = ready ? member?.sub ?? "guest" : null;
  useEffect(() => {
    if (who) void loadFor(who);
  }, [who]);
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => version,
    () => version,
  );
  const list = items ?? [];
  const unread = who && owner === who ? list.filter((x) => !read.has(x.id)).length : 0;
  const ids = list.map((x) => x.id).join(",");
  const markAll = useCallback(() => markRead(ids ? ids.split(",") : []), [ids]);
  return { unread, markAll };
}
