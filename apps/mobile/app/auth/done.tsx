import { router, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { finishWebReturn, hasSavedWebLogin, webSsoAdopt } from "@/api/central";
import { useSession } from "@/state/session";
import { Button, LoadingView, NoticeBox, Screen } from "@/ui";

/** Web 登入中繼回傳頁：讀取 fragment 中的 id_token 完成登入（之後立即清掉網址中的資料）。 */
export default function AuthDone() {
  const { reloadMember } = useSession();
  const [error, setError] = useState<string | null>(null);
  // 只執行一次：登入完成後 reloadMember 會換成新的函式，原本會讓這個 effect 再跑第二次，
  // 第二次找不到「登入進行中」的暫存（第一次已經用掉），就跳出「登入狀態已失效」（業主 2026-11-21 回報）。
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    finishWebReturn()
      .then(async (to) => {
        await reloadMember();
        // 讓會員中心記住這個瀏覽器，其他網頁版 App 也能自動登入；失敗時直接回原頁。
        if (!(await webSsoAdopt(to))) router.replace(to as Href);
      })
      .catch(async (e: Error) => {
        // 其實已經登入成功（例如另一個分頁剛完成登入，或重複開啟這個回傳頁）就不要嚇人，直接回首頁。
        if (hasSavedWebLogin()) {
          await reloadMember();
          router.replace("/" as Href);
          return;
        }
        setError(e.message);
      });
  }, [reloadMember]);
  return (
    <Screen title="登入">
      {error ? (
        <>
          <NoticeBox tone="danger" text={error} />
          <Button label="回到登入頁" onPress={() => router.replace("/me")} />
        </>
      ) : (
        <LoadingView />
      )}
    </Screen>
  );
}
