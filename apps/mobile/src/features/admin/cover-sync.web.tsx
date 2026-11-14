import { useState } from "react";
import { api, resolveUrl, type CourseSummary } from "@/api/client";
import { AppText, Button, Card, NoticeBox, Section } from "@/ui";
import { locateCover } from "./cover-match.web";
import { loadImageUrl } from "./image-tools";

/**
 * 一次性維護工具（網頁版）：舊課程當初沒有存「封面是從 EDM 哪裡裁的」，所以課程介紹頁的預設停留位置可能跟封面不一致。
 * 這裡逐一把每個有 EDM 與封面、但沒存封面框的課程，用圖片比對找出封面框，寫回後預設停留位置就自動等於封面上緣。
 * 比對不出來的（封面被大幅修改過等）會列出名稱，請到該課程「調整封面與預設位置」手動重設一次。
 */
export function CoverSync({ courses, onDone }: { courses: CourseSummary[]; onDone: () => void }) {
  const todo = courses.filter((c) => c.edmUrl && c.coverUrl && !c.coverRect);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  if (!todo.length && !failed.length && !msg) return null;
  const run = async () => {
    setBusy(true);
    setFailed([]);
    let ok = 0;
    const bad: string[] = [];
    for (const [i, c] of todo.entries()) {
      setMsg(`同步中… ${i + 1}／${todo.length}：${c.title}`);
      try {
        const [edm, cover] = [await loadImageUrl(resolveUrl(c.edmUrl!)), await loadImageUrl(resolveUrl(c.coverUrl!))];
        const r = locateCover(edm, cover);
        if (!r) {
          bad.push(c.title);
          continue;
        }
        await api("PATCH", `/admin/courses/${c.id}`, { coverRect: r });
        ok++;
      } catch {
        bad.push(c.title);
      }
    }
    setFailed(bad);
    setMsg(`完成：已同步 ${ok} 門課程${bad.length ? `，${bad.length} 門無法自動判斷（見下方）` : ""}。`);
    setBusy(false);
    onDone();
  };
  return (
    <Section title="封面與預設位置同步（一次性）">
      <Card>
        <AppText variant="callout" tone="muted">
          有部分課程的封面還沒記錄「從 EDM 哪裡裁出來」，課程介紹頁一進來看到的位置可能和封面不同。按下按鈕，會自動比對圖片找出封面位置並同步（不會改動任何圖片）。
        </AppText>
        {todo.length ? <Button label={busy ? "同步中…" : `同步 ${todo.length} 門課程`} icon="sync-outline" loading={busy} disabled={busy} onPress={run} /> : null}
        {msg ? <NoticeBox tone={failed.length ? "info" : "success"} text={msg} /> : null}
        {failed.length ? (
          <AppText variant="callout">
            無法自動判斷，請到該課程「調整封面與預設位置」手動重設一次：{"\n"}
            {failed.join("、")}
          </AppText>
        ) : null}
      </Card>
    </Section>
  );
}
