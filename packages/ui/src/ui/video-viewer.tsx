import { useEffect } from "react";
import * as WebBrowser from "expo-web-browser";

/** 影片檢視（iOS／Android App 版）：目前交給系統瀏覽器播放；網頁版在畫面內播放（video-viewer.web.tsx）。App 上架前改成 App 內播放。 */
export function VideoViewer({ uri, onClose }: { uri: string; title?: string; onClose: () => void }) {
  useEffect(() => {
    void WebBrowser.openBrowserAsync(uri).finally(onClose);
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
