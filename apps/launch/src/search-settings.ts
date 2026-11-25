/**
 * 搜尋與 AI 參數設定（業主 2026-11-25，超級管理員在「設定 → 搜尋與 AI 設定」自訂）。
 * 存在 ui_settings 的 search_settings 一筆 JSON；每個參數有預設值（＝建議值）、範圍與白話說明。
 * 伺服器（語意搜尋、同音搜尋、EDM 辨識）與前端（模糊、字元、排序）都讀這一份；讀不到或亂填一律退回預設。
 */
import type { D1Database } from "./d1.ts";

const KEY = "search_settings";

export type ParamDef = {
  key: string;
  group: "semantic" | "phonetic" | "fuzzy" | "rank" | "edm";
  label: string;
  /** 這個參數做什麼（白話）。 */
  desc: string;
  /** 建議值與理由（白話）。 */
  advice: string;
  type: "bool" | "number" | "choice";
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: { value: string; label: string }[];
};

export const GROUPS: { key: ParamDef["group"]; title: string; intro: string }[] = [
  { key: "semantic", title: "意思相近搜尋（AI 語意搜尋）", intro: "正式名稱：語意搜尋（Semantic Search）。AI 嵌入模型（Embedding，目前是 BGE-M3）把課程名稱、章節標題轉成一串數字（向量），搜尋時把你輸入的字也轉成向量，找出「意思最接近」的課程；所以搜「疼痛」也找得到「不舒服」。換用哪個模型請到「AI 模型」頁。" },
  { key: "phonetic", title: "同音搜尋（語音辨識錯字）", intro: "不用 AI、不花額度。把文字轉成拼音比對，語音把「益之源」聽成「一支援」也找得到。" },
  { key: "fuzzy", title: "模糊比對（打錯字）", intro: "不用 AI、不花額度。容許漏字、多字、錯字（例如「益支源」找得到「益之源」）；字元比對＝查詢的每個字都出現在同一門課就算符合。" },
  { key: "rank", title: "結果排序", intro: "決定找到很多結果時誰排前面。" },
  { key: "edm", title: "EDM 海報辨識的 AI 參數", intro: "這兩項 AI 工作（辨識海報文字、把文字整理成欄位）共用的生成參數；其他 AI 工作用模型預設值。" },
];

export const PARAMS: ParamDef[] = [
  { key: "semanticEnabled", group: "semantic", label: "啟用意思相近搜尋", desc: "關閉後完全不呼叫 AI，只用字面、同音、模糊比對。完全比對有結果時本來就不會呼叫 AI，只有「找不到」才補找。", advice: "建議開。想省 AI 額度或結果太雜時才關。", type: "bool", default: true },
  { key: "semanticMin", group: "semantic", label: "相似度門檻", desc: "AI 判斷兩段文字意思有多接近（0～1，越高越像）。低於這個數字的不顯示。調高＝更準但可能漏掉；調低＝找得多但會混進不相干的課（例如搜「水機」出現保養品）。", advice: "建議 0.62。看到不相干的結果就每次調高 0.03；漏掉該找到的就調低 0.03。", type: "number", default: 0.62, min: 0.4, max: 0.9, step: 0.01 },
  { key: "semanticLimit", group: "semantic", label: "最多顯示幾筆（Top-K）", desc: "AI 最多回傳幾門課（章節另外算）。越大結果越多、越雜。", advice: "建議 24；課程不多可降到 10～15。", type: "number", default: 24, min: 5, max: 50, step: 1, unit: "筆" },
  { key: "phoneticEnabled", group: "phonetic", label: "啟用同音搜尋", desc: "關閉後，語音辨識錯字就不會再靠拼音補找。", advice: "建議開（免費）。", type: "bool", default: true },
  { key: "phoneticMinSyllables", group: "phonetic", label: "至少幾個字才比對", desc: "查詢太短（單字）會亂配，所以字數不到就不比對。調成 1 時，說一個字（例如「水」）也會找同音字，但結果會很雜。", advice: "建議 2。", type: "number", default: 2, min: 1, max: 4, step: 1, unit: "字" },
  { key: "phoneticTypoFrom", group: "phonetic", label: "幾個字以上容許錯 1 個音", desc: "查詢夠長時，容許有 1 個字的音不一樣。數字越小越寬鬆（短詞也容許錯）；填 9 等於完全不容許。", advice: "建議 4。", type: "number", default: 4, min: 3, max: 9, step: 1, unit: "字" },
  { key: "fuzzyEnabled", group: "fuzzy", label: "啟用模糊比對（打錯字）", desc: "容許漏字、多字、錯字。", advice: "建議開（免費）。", type: "bool", default: true },
  { key: "fuzzyMaxDiff", group: "fuzzy", label: "最多容許差幾個字", desc: "上限。實際容許數依詞長：1～2 字必須完全一樣、3～4 字差 1、5 字以上差 2；這裡的數字是再往下壓的天花板。填 0＝等於關閉。", advice: "建議 2。覺得亂配就改 1。", type: "number", default: 2, min: 0, max: 3, step: 1, unit: "字" },
  { key: "charsEnabled", group: "fuzzy", label: "啟用字元比對", desc: "查詢的每個字（不分順序）都出現在同一門課的文字裡就算符合，例如「線上白金」找得到「安麗與白金線上溝通會」。", advice: "建議開。", type: "bool", default: true },
  { key: "charsMinLen", group: "fuzzy", label: "字元比對至少幾個不同字", desc: "太短（例如 2 個字）幾乎每門課都符合，所以設下限。", advice: "建議 3。", type: "number", default: 3, min: 2, max: 6, step: 1, unit: "字" },
  { key: "listCardsLast", group: "rank", label: "品牌／清單卡排在課程後面", desc: "只是「相近」才找到的品牌卡（標「教材」的，如雅姿、紐崔萊）排在課程後面；名稱字面完全符合的不受影響。", advice: "建議開。", type: "bool", default: true },
  { key: "edmTextTemperature", group: "edm", label: "EDM 文字整理：隨機度（Temperature）", desc: "AI 回答的隨機程度（0～1）。越低越照原文、穩定；越高越有變化、越容易自己發揮。整理海報欄位要求照抄。", advice: "建議 0.1（接近 0 最保守）。", type: "number", default: 0.1, min: 0, max: 1, step: 0.05 },
  { key: "edmTextMaxTokens", group: "edm", label: "EDM 文字整理：最多輸出長度", desc: "AI 一次最多寫多少（token，約 1 個中文字 1～2 個）。太小會被截斷、欄位缺字；太大浪費額度。", advice: "建議 1200；海報文字很多才調到 2000。", type: "number", default: 1200, min: 400, max: 3000, step: 100, unit: "token" },
  { key: "edmVisionMaxTokens", group: "edm", label: "EDM 圖片辨識：最多輸出長度", desc: "讀海報文字時最多輸出多少。字很多的海報太小會讀不完。", advice: "建議 1024。", type: "number", default: 1024, min: 512, max: 2048, step: 128, unit: "token" },
];

export type SearchSettings = Record<string, boolean | number | string>;
export const defaultSearchSettings = (): SearchSettings => Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));

/** 只收已知參數、型別對、範圍內的值；其餘用預設。 */
export function normalizeSearchSettings(raw: unknown, base: SearchSettings = defaultSearchSettings()): SearchSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SearchSettings = { ...base };
  for (const p of PARAMS) {
    const v = r[p.key];
    if (v === undefined) continue;
    if (p.type === "bool" && typeof v === "boolean") out[p.key] = v;
    else if (p.type === "number" && typeof v === "number" && Number.isFinite(v)) {
      const stepped = Math.round(v / (p.step ?? 1)) * (p.step ?? 1);
      out[p.key] = Math.round(Math.min(p.max!, Math.max(p.min!, stepped)) * 1000) / 1000;
    } else if (p.type === "choice" && p.choices?.some((c) => c.value === v)) out[p.key] = v as string;
  }
  return out;
}

export async function loadSearchSettings(db: D1Database): Promise<SearchSettings> {
  try {
    const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
    return normalizeSearchSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return defaultSearchSettings();
  }
}

export async function saveSearchSettings(db: D1Database, patch: unknown): Promise<SearchSettings> {
  const next = normalizeSearchSettings(patch, await loadSearchSettings(db));
  await db
    .prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(next))
    .run();
  return next;
}
