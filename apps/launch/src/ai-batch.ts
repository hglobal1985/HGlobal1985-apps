/**
 * AI 辨識批次排程（業主 2026-11-25：原本每 10 分鐘只辨識 3 張太慢，要批次處理、把每天免費額度盡量用完）。
 * 每次排程在「處理時間」（aiBudgetSec）內，一輪一輪地取待辨識的照片、同時處理多張（aiConcurrency），直到：沒有待辨識的、今天的 AI 額度用完（AiStopped）、或時間到。
 * 順序：中心 EDM 文字辨識 ＞ 相簿照片文字 OCR ＞ 相簿場景辨識（額度不夠時前面的優先）。參數都在「設定 › 搜尋與 AI 設定 › AI 辨識排程」。
 */
import type { D1Database, Env } from "./d1.ts";
import { AiStopped } from "./ai-models.ts";
import { edmOcrIds, ocrEdmImage } from "./edm-vision.ts";
import { structurePending } from "./edm-structure.ts";
import { photoOcrIds, ocrPhoto } from "./photo-ocr.ts";
import { sceneIds, sceneImage } from "./scene-vision.ts";
import { loadSearchSettings } from "./search-settings.ts";

type Job = { name: string; on: string; prio: string; ids: (db: D1Database, n: number) => Promise<string[]>; run: (env: Env, db: D1Database, id: string) => Promise<void> };
const JOBS: Job[] = [
  { name: "edm ocr", on: "aiOnEdm", prio: "aiPrioEdm", ids: edmOcrIds, run: ocrEdmImage },
  { name: "photo ocr", on: "photoOcrEnabled", prio: "aiPrioPhotoOcr", ids: photoOcrIds, run: ocrPhoto },
  { name: "photo scene", on: "aiOnScene", prio: "aiPrioScene", ids: sceneIds, run: sceneImage },
];

export async function runAiBatch(env: Env, db: D1Database, opts: { budgetSec?: number } = {}): Promise<{ done: number; stopped: boolean }> {
  if (!env.AI) return { done: 0, stopped: false };
  const st = await loadSearchSettings(db);
  const size = Math.max(1, Number(st.aiBatchSize ?? 12));
  const conc = Math.max(1, Number(st.aiConcurrency ?? 4));
  const until = Date.now() + Math.max(30, opts.budgetSec ?? Number(st.aiBudgetSec ?? 240)) * 1000;
  let done = 0;
  let stopped = false;
  // 依「設定 › AI 文字辨識」的優先順序（數字小的先）與開關（業主 2026-11-26）。
  const order = JOBS.filter((j) => st[j.on] !== false).sort((a, b) => Number(st[a.prio] ?? 9) - Number(st[b.prio] ?? 9));
  for (const job of order) {
    while (!stopped && Date.now() < until) {
      const ids = await job.ids(db, size);
      if (!ids.length) break;
      const queue = [...ids];
      let failedAll = true;
      await Promise.all(
        Array.from({ length: Math.min(conc, queue.length) }, async () => {
          while (queue.length && !stopped && Date.now() < until) {
            const id = queue.shift()!;
            try {
              await job.run(env, db, id);
              done++;
              failedAll = false;
            } catch (e) {
              if (e instanceof AiStopped) stopped = true; // 今天的額度用完：全部停，隔天續辨
            }
          }
        }),
      );
      // 這一輪一張都沒處理成功（例如模型一直失敗、授權未同意）：換下一種，避免空轉到時間用完。
      if (failedAll) break;
    }
    if (stopped) break;
  }
  if (!stopped && Date.now() < until) await structurePending(env, db, 10).catch(() => undefined); // EDM 欄位整理
  return { done, stopped };
}
