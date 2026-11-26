/**
 * 食譜文字的解析（杜杜龍 2026-11-26）：一道食譜只有一篇純文字，不分欄位。
 * ①獨立一行的 YouTube 網址＝影片卡片（站內播放）；②「材料：」「做法：」這類短標題行自動標成醒目的小標題；③其餘照原文顯示。
 * 伺服器端（`apps/launch/src/recipes.ts`）用同一套規則數影片張數。
 */
const YT_LINE = /^\s*(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/\S+\s*$/i;

/** 這一行如果只有一個 YouTube 網址，回傳影片編號。 */
export function youtubeIdOfLine(line: string): string | null {
  if (!YT_LINE.test(line)) return null;
  const raw = line.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "youtu.be") return /^[\w-]{6,20}$/.test(u.pathname.split("/")[1] ?? "") ? u.pathname.split("/")[1]! : null;
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{6,20}$/.test(v)) return v;
    const m = /\/(?:shorts|embed|live)\/([\w-]{6,20})/.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export type RecipeBlock = { t: "h" | "p" | "yt" | "gap"; text: string };
const HEAD = /^(材料|食材|做法|作法|步驟|調味料?|醬料|醃料|餅皮|麵團|配料|備註|小撇步|重點)\s*[（(]?[^：:]{0,8}[)）]?\s*[：:]\s*(.*)$/;

export function parseRecipe(body: string): RecipeBlock[] {
  const out: RecipeBlock[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (out.length && out[out.length - 1]!.t !== "gap") out.push({ t: "gap", text: "" });
      continue;
    }
    const yt = youtubeIdOfLine(line);
    if (yt) {
      out.push({ t: "yt", text: yt });
      continue;
    }
    const h = HEAD.exec(line.trim());
    if (h) {
      out.push({ t: "h", text: line.trim().slice(0, line.trim().length - h[2]!.length).replace(/[：:]\s*$/, "") });
      if (h[2]!.trim()) out.push({ t: "p", text: h[2]!.trim() });
      continue;
    }
    out.push({ t: "p", text: line });
  }
  while (out.length && out[out.length - 1]!.t === "gap") out.pop();
  return out;
}
