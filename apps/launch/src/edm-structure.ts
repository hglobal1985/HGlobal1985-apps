/**
 * EDM 辨識文字「套入格式」（業主 2026-11-24）：視覺模型讀出的是一大段沒整理的文字，
 * 這裡再用一個便宜的文字模型（設定 → AI 模型 →「EDM 文字整理」選用），照業主在「設定 → AI 文字辨識」自訂的欄位格式整理成
 * 日期、時間、主題…各欄；歸不進任何欄位的放「其他內容」。格式改了，舊的 EDM 會在背景自動重新整理（只重跑文字模型，不用再看圖）。
 */
import type { D1Database, Env } from "./d1.ts";
import { loadSearchSettings } from "./search-settings.ts";
import { AiStopped, callClaude, estimateTokens, loadSelection, markExhausted, refundAi, reserveAi } from "./ai-models.ts";

export type FieldDef = { name: string; hint: string };
export const OTHER = "其他內容";
export const MAX_FIELDS = 20;
export const DEFAULT_FIELDS: FieldDef[] = [
  { name: "日期", hint: "活動舉辦日期（含星期）" },
  { name: "時間", hint: "活動開始與結束時間；線上、現場時間不同要分開寫" },
  { name: "主題", hint: "活動名稱或演講主題（最大的標題）" },
  { name: "活動介紹", hint: "活動內容、特色、亮點的說明" },
  { name: "講師", hint: "主講人姓名與稱謂" },
  { name: "講師資歷", hint: "講師的經歷、獎銜、成就" },
  { name: "講師介紹", hint: "對講師的文字介紹" },
  { name: "地點", hint: "實體地址、場地名稱、線上連結或會議資訊" },
  { name: "費用", hint: "報名費、票價、是否免費" },
  { name: "主辦單位", hint: "主辦、協辦單位與聯絡方式" },
];
const KEY = "edm_fields";

export function normalizeFields(raw: unknown): FieldDef[] {
  if (!Array.isArray(raw)) return DEFAULT_FIELDS.map((f) => ({ ...f }));
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const x of raw) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 20) : "";
    if (!name || name === OTHER || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, hint: typeof o.hint === "string" ? o.hint.trim().slice(0, 120) : "" });
    if (out.length >= MAX_FIELDS) break;
  }
  return out.length ? out : DEFAULT_FIELDS.map((f) => ({ ...f }));
}
export async function loadFields(db: D1Database): Promise<FieldDef[]> {
  const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  try {
    return normalizeFields(row ? JSON.parse(row.value) : null);
  } catch {
    return normalizeFields(null);
  }
}
export async function saveFields(db: D1Database, fields: FieldDef[]): Promise<void> {
  await db.prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(KEY, JSON.stringify(fields)).run();
}
/** 格式版本：欄位名稱與說明有任何不同就會變（djb2 雜湊）。 */
export function fmtOf(fields: FieldDef[]): string {
  let h = 5381;
  for (const ch of fields.map((f) => `${f.name}|${f.hint}`).join("\n")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * 去掉 AI 自己加的話（業主 2026-11-24：只能留海報上的文字）：開場白（「好的」「圖片上有以下文字：」「這是一個…活動」）、
 * 「今天是…」「活動舉辦日期應該是…」這類判斷猜測，以及 Markdown 符號（** ### 條列）。
 */
export function cleanOcrText(s: string): string {
  const talk = /^(好的|好，|以下|根據|這是|這張|這份|圖片(上|中|裡)?(有|的|顯示|內容)|海報(上|中|裡)?(有|的|顯示|內容)|圖中|看起來|似乎|可能|應該|推測|判斷|注意|備註|說明)/;
  let t = s.replace(/\\n/g, "\n").replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/\*\*/g, "").replace(/^\s*[*•]\s+/gm, "");
  t = t.replace(/^[\s\S]*?(以下文字|文字如下|文字內容如下|如下)\s*[：:]\s*/, ""); // 「…圖片上有以下文字：」之前的開場白整段拿掉
  t = t.replace(/[，,]?\s*今天是[^。\n]*[。]?/g, "").replace(/[，,]?\s*(活動(舉辦)?日期|日期)\s*(應該|可能|推測|大概)[^。\n]*[。]?/g, "");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l && !talk.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Structured = { f: [string, string][]; o: string };

export function buildPrompt(text: string, fields: FieldDef[], _today = ""): { system: string; user: string } {
  const list = fields.map((f) => `- ${f.name}${f.hint ? `：${f.hint}` : ""}`).join("\n");
  const system = `你是活動海報資訊整理員。使用者會給你從活動海報（EDM）辨識出來的文字，請照指定的欄位整理。規則：
1. 每個欄位只能放海報文字裡「原本就有」的字句，一個字都不可以自己加；絕對不可以寫你自己的話、判斷、推測、補充、說明或年份。海報沒寫的，該欄位一律填空字串 ""。
2. 盡量照原文抄寫，不要改寫、不要摘要、不要加評論；同一欄有多項時用換行分開。
3. 無法歸入任何欄位、但海報上有的文字，全部放進「${OTHER}」。
4. 只回傳一個 JSON 物件，不要任何說明、不要 Markdown。`;
  const keys = [...fields.map((f) => f.name), OTHER].map((k) => `"${k}": ""`).join(", ");
  const user = `欄位：\n${list}\n- ${OTHER}：無法歸入上面任何欄位的內容\n\n回傳格式：{${keys}}\n\n海報文字：\n${text.slice(0, 4000)}`;
  return { system, user };
}

/** 從模型回的文字取出 JSON，依欄位順序整理；解析不了回 null。 */
export function parseStructured(raw: string, fields: FieldDef[]): Structured | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const val = (v: unknown): string => (Array.isArray(v) ? v.map((x) => val(x)).filter(Boolean).join("\n") : v == null ? "" : typeof v === "object" ? Object.values(v as object).map((x) => val(x)).filter(Boolean).join("\n") : String(v)).replace(/\*\*/g, "").trim().slice(0, 1500);
  const f = fields.map((x): [string, string] => [x.name, val(j[x.name])]);
  const o = val(j[OTHER] ?? j["其他"] ?? j["其他內容"]);
  return { f, o };
}

async function runText(env: Env, db: D1Database, model: string, system: string, user: string): Promise<string> {
  const st = await loadSearchSettings(db); // 隨機度與輸出長度由「搜尋與 AI 設定」決定
  const maxTokens = st.edmTextMaxTokens as number;
  if (model.startsWith("claude-")) return (await callClaude(env, db, model, { system, prompt: user, maxTokens })).text;
  if (!env.AI) throw new Error("沒有綁定 Workers AI");
  const est = await reserveAi(db, model, { inputTokens: estimateTokens(system + user) + 100, outputTokens: 800 });
  try {
    const res = (await env.AI.run(model as never, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: st.edmTextTemperature as number } as never)) as { response?: string; choices?: { message?: { content?: string } }[] };
    return res?.response ?? res?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/3036|daily free allocation/i.test(msg)) {
      await markExhausted(db);
      throw new AiStopped("今天的 AI 免費額度已用完");
    }
    await refundAi(db, est);
    throw e;
  }
}

/** 整理一張 EDM 的辨識文字；成功寫入 ocr_fields。額度用完（AiStopped）往外丟，之後再試。 */
export async function structureEdm(env: Env, db: D1Database, rowId: string): Promise<void> {
  const row = await db.prepare("SELECT ocr_text FROM cover_media WHERE id = ?").bind(rowId).first<{ ocr_text: string }>();
  if (!row) return;
  const fields = await loadFields(db);
  const fmt = fmtOf(fields);
  const text = cleanOcrText(row.ocr_text);
  if (!text) {
    await db.prepare("UPDATE cover_media SET ocr_fields = '', ocr_fmt = ? WHERE id = ?").bind(fmt, rowId).run();
    return;
  }
  const model = (await loadSelection(db)).edm_structure!;
  const { system, user } = buildPrompt(text, fields, new Date().toISOString().slice(0, 10));
  let out = "";
  try {
    out = await runText(env, db, model, system, user);
  } catch (e) {
    if (e instanceof AiStopped) throw e;
    return; // 這次失敗：不改 ocr_fmt，之後背景會再試
  }
  const s = parseStructured(out, fields);
  // 解析不了：記成這個版本已處理（不無限重試耗額度），畫面改顯示清理過的原文
  await db.prepare("UPDATE cover_media SET ocr_fields = ?, ocr_fmt = ? WHERE id = ?").bind(s ? JSON.stringify(s) : "", fmt, rowId).run();
}

/** 背景整理「已辨識、但還沒用目前格式整理過」的 EDM（每次最多 limit 張）。 */
export async function structurePending(env: Env, db: D1Database, limit = 2): Promise<number> {
  if (!env.AI) return 0;
  const fmt = fmtOf(await loadFields(db));
  const { results } = await db.prepare("SELECT id FROM cover_media WHERE scope = 'edm' AND kind = 'image' AND ocr_status = 'done' AND ocr_text <> '' AND ocr_fmt <> ? ORDER BY created_at DESC LIMIT ?").bind(fmt, limit).all<{ id: string }>();
  let n = 0;
  for (const r of results) {
    try {
      await structureEdm(env, db, r.id);
      n++;
    } catch (e) {
      if (e instanceof AiStopped) break;
    }
  }
  return n;
}
export async function structureStats(db: D1Database): Promise<{ total: number; done: number; pending: number }> {
  const fmt = fmtOf(await loadFields(db));
  const r = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN ocr_fmt = ?1 THEN 1 ELSE 0 END) AS done FROM cover_media WHERE scope = 'edm' AND kind = 'image' AND ocr_status = 'done' AND ocr_text <> ''").bind(fmt).first<{ total: number; done: number | null }>();
  const total = r?.total ?? 0;
  const done = r?.done ?? 0;
  return { total, done, pending: total - done };
}
