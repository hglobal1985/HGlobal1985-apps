import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/web-push";
import { Check } from "@/ui/check";
import { flashText } from "@/ui/flash-notice";
import { NoticeBox } from "@/ui/notice-box";
import { Card } from "@/kit";

const NOTE: Partial<Record<PushState, { tone: "info" | "warning"; text: string }>> = {
  unsupported: { tone: "info", text: "這個瀏覽器不支援推播通知。請用手機的 Chrome，或在 iPhone 把網站「加入主畫面」後再開。" },
  "ios-needs-install": { tone: "info", text: "iPhone／iPad：請先按分享鈕 →「加入主畫面」，再從主畫面打開繳作業系統，才能開啟推播。" },
  "not-ready": { tone: "warning", text: "推播功能還在設定中，暫時不能開啟。" },
  denied: { tone: "warning", text: "你之前拒絕了通知權限，請到手機設定 › 網站通知 把「check.hglobal1985.com」改成允許。" },
};

/** 手機推播開關（開關模組是共用元件 lib/web-push.ts，與行動大學同一個；每支裝置各自開啟）。 */
export function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  const note = state ? NOTE[state] : undefined;
  return (
    <Card>
      <Check
        label="手機推播（出新作業、評分、退回、留言、截止提醒）"
        value={state === "on"}
        disabled={busy || !state || !!note}
        onChange={async (on) => {
          setBusy(true);
          try {
            const s = on ? await enablePush() : await disablePush();
            setState(s);
            flashText(s === "on" ? "已開啟推播" : "已關閉推播");
          } catch {
            flashText("推播設定失敗，請稍後再試");
          } finally {
            setBusy(false);
          }
        }}
      />
      {note ? <NoticeBox tone={note.tone} text={note.text} /> : null}
    </Card>
  );
}
