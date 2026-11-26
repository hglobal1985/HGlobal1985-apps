import { Stack } from "expo-router";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";

/**
 * 頁面內「上方工具列右側按鈕」的登記處（杜杜龍 2026-11-26）：相簿頁裡不同層的畫面（類別、資料夾、單道食譜…）各自要放自己的按鈕（編輯、清單、邀請、設定），
 * 但工具列只有一個（`TopBar`，由頁面堆疊畫）。畫面呼叫 `useHeaderSlot(優先序, 按鈕, 標題?)` 登記，頁面放一個 `<HeaderSlotScreen>` 把「優先序最高的」那組交給工具列。
 * 按鈕一律用共用的 `TopBarButton`／`HeaderAddToList`／`HeaderInvite`，不可自己畫。
 */
type Slot = { id: number; p: number; right: ReactNode; title?: string };
let slots: Slot[] = [];
let version = 0;
let nextId = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};

export function useHeaderSlot(priority: number, right: ReactNode, title?: string): void {
  const id = useRef(++nextId).current;
  useEffect(() => {
    const i = slots.findIndex((s) => s.id === id);
    const s = { id, p: priority, right, title };
    if (i >= 0) slots[i] = s;
    else slots.push(s);
    emit();
  });
  useEffect(
    () => () => {
      slots = slots.filter((s) => s.id !== id);
      emit();
    },
    [id],
  );
}

export function HeaderSlotScreen({ title, backTo }: { title: string; backTo?: string }) {
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => version,
    () => version,
  );
  const top = [...slots].sort((a, b) => b.p - a.p || b.id - a.id)[0];
  const right = top?.right;
  return <Stack.Screen options={{ title: top?.title ?? title, ...({ backTo } as object), headerRight: () => (right ? <View style={{ flexDirection: "row", alignItems: "center" }}>{right}</View> : null) }} />;
}
