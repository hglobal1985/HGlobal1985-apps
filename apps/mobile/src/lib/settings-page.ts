import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { markOverlayPop } from "./back-close";
import { choiceSheet } from "@/features/confirm";
import { setUnsavedGuard } from "./unsaved-guard";

/**
 * 設定頁「有改動沒存檔就要離開」的攔截（杜杜龍 2026-11-26 永久指示）：
 * 有未存的修改時，按返回、底部主選單、頁面上的跳轉（走 `runGuarded` 的都算）、或關閉／重新整理網頁，都會先跳出
 * 「儲存／放棄修改／繼續編輯」讓杜杜龍決定；沒有改動就直接離開。
 * save 要回傳是否成功（失敗就留在原頁）；discard 把畫面改回已儲存的內容（放棄時呼叫）。
 */
export function useUnsavedPrompt({ dirty, save, discard }: { dirty: boolean; save: () => Promise<boolean> | boolean; discard: () => void }): void {
  const nav = useNavigation();
  const live = useRef({ dirty, save, discard });
  live.current = { dirty, save, discard };
  const bypass = useRef(false);

  const ask = async (proceed: () => void, onStay?: () => void) => {
    const pick = await choiceSheet({
      title: "有修改還沒儲存",
      message: "這一頁的修改還沒有存檔。要儲存、放棄修改，還是繼續編輯？",
      options: [
        { key: "save", label: "儲存後離開", variant: "primary" },
        { key: "discard", label: "放棄修改並離開", variant: "dangerSolid" },
        { key: "stay", label: "繼續編輯", variant: "cancel" },
      ],
    });
    if (pick === "save") {
      if (await live.current.save()) {
        bypass.current = true;
        proceed();
        setTimeout(() => (bypass.current = false), 1000);
      }
    } else if (pick === "discard") {
      live.current.discard();
      bypass.current = true;
      proceed();
      setTimeout(() => (bypass.current = false), 1000);
    } else onStay?.();
  };

  // 底部主選單與頁面上的跳轉按鈕（走 runGuarded）
  useEffect(() => {
    if (!dirty) return;
    setUnsavedGuard((proceed) => {
      void ask(proceed);
      return false;
    });
    return () => setUnsavedGuard(null);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // 返回鍵／手勢／瀏覽器上一頁
  useEffect(
    () =>
      (nav as unknown as { addListener: (n: string, f: (e: { preventDefault: () => void; data: { action: never } }) => void) => () => void }).addListener("beforeRemove", (e) => {
        if (bypass.current || !live.current.dirty) return;
        e.preventDefault();
        void ask(() => nav.dispatch(e.data.action));
      }),
    [nav], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 網頁：瀏覽器「上一頁」、安卓手機的返回手勢（業主回報：只靠導覽套件的 beforeRemove 攔不住，2026-11-26 修）。
  // 有修改時多記一筆瀏覽紀錄（同網址）；按「上一頁」只會退掉這一筆、畫面不動，這時跳出確認：
  // 繼續編輯＝把那一筆補回去；儲存／放棄＝再退一頁真的離開。沒有修改了（存好或還原）就把多記的那一筆退掉。
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !dirty) return;
    let popped = false;
    let active = true;
    const push = () => window.history.pushState({ ...(window.history.state ?? {}), hgDirty: 1 }, "", window.location.href);
    push();
    const onPop = () => {
      if (!active || popped) return;
      popped = true;
      void ask(
        () => window.history.back(),
        () => {
          popped = false;
          push();
        },
      );
    };
    window.addEventListener("popstate", onPop);
    return () => {
      active = false;
      window.removeEventListener("popstate", onPop);
      if (!popped) {
        markOverlayPop();
        window.history.back();
      }
    };
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // 安卓 App 的實體返回鍵／手勢
  useEffect(() => {
    if (Platform.OS !== "android" || !dirty) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void ask(() => nav.goBack());
      return true;
    });
    return () => sub.remove();
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // 網頁：關閉分頁、重新整理
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const f = (e: BeforeUnloadEvent) => {
      if (!live.current.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);
}
