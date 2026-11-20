import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Text } from "react-native";

/**
 * 「用到才下載」的元件（2026-11-21 載入速度優化）：只有管理者會打開的編輯面板、上傳工具……
 * 不放進每個人開網站都要下載的主程式，第一次真的顯示時才下載那一小包。
 *
 * 用法：`const EdmManager = lazyPart(() => import("@/features/admin/edm-manager"), "EdmManager");`
 * 之後跟原本的元件一模一樣使用（屬性型別相同）。下載中顯示 fallback（預設什麼都不顯示，面板一下載完就出現）。
 * 下載失敗會自動重試一次；仍失敗（例如網站剛更新、舊檔案已不存在）就顯示「請重新整理」，不會讓整頁壞掉。
 * 注意：要真的省下下載量，這個模組就不能在別的「一開始就載入」的檔案被直接 import。
 */
export function lazyPart<M extends Record<string, unknown>, K extends keyof M>(load: () => Promise<M>, key: K, fallback: ReactNode = null): M[K] {
  const Lazy = lazy(async () => {
    const mod = await load().catch(() => new Promise<M>((ok, bad) => setTimeout(() => load().then(ok, bad), 800)));
    return { default: mod[key] as ComponentType<Record<string, unknown>> };
  });
  function LazyPart(props: Record<string, unknown>) {
    return (
      <LoadGuard>
        <Suspense fallback={fallback}>
          <Lazy {...props} />
        </Suspense>
      </LoadGuard>
    );
  }
  LazyPart.displayName = `lazy(${String(key)})`;
  return LazyPart as unknown as M[K];
}

/** 先在背景下載（例如管理者一進課程頁就預先抓編輯工具，按「編輯」時就不用等）。失敗沒關係，真正顯示時會再試。 */
export function preload(load: () => Promise<unknown>): void {
  load().catch(() => undefined);
}

class LoadGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <Text style={{ color: "#B3261E", padding: 12, fontSize: 15 }}>這個功能載入失敗，請重新整理網頁後再試一次。</Text>;
    return this.props.children;
  }
}
