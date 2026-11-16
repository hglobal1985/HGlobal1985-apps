/** 超級管理員可調整的畫面設定：存在 ui_settings 一筆 JSON；讀取時和預設值合併，缺的欄位自動補上。 */
import { DEFAULT_APP_SETTINGS, DEFAULT_SHARE_SETTINGS, DEFAULT_UI_CONFIG, type AppSettings, type ShareSettings, RIBBON_KEYS, RIBBON_PALETTE, SORT_GROUPS, STATS_ROLE_OPTIONS, type RibbonColor, type SortGroup, type UiConfig } from "./contract.ts";
import type { D1Database } from "./d1.ts";

const KEY = "ui_config";

/** 把任意輸入整理成合法設定（不合法的欄位退回預設，排序分組自動補齊缺的）。 */
export function normalizeConfig(raw: unknown): UiConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof UiConfig, unknown>>;
  const groups = Array.isArray(r.sortGroups) ? (r.sortGroups as unknown[]).filter((g): g is SortGroup => (SORT_GROUPS as readonly string[]).includes(g as string)) : [];
  const sortGroups: SortGroup[] = [...new Set([...groups, ...SORT_GROUPS])];
  // 後來新增的分組「費用尚未公布」：舊設定裡沒有時，放在「符合資格・尚未開課」後面，而不是最後面。
  if (!groups.includes("eligible_tba") && groups.includes("eligible_upcoming")) {
    sortGroups.splice(sortGroups.indexOf("eligible_tba"), 1);
    sortGroups.splice(sortGroups.indexOf("eligible_upcoming") + 1, 0, "eligible_tba");
  }
  const given = (r.ribbons && typeof r.ribbons === "object" ? r.ribbons : {}) as Record<string, { label?: unknown; color?: unknown; enabled?: unknown } | undefined>;
  const ribbons = { ...DEFAULT_UI_CONFIG.ribbons };
  for (const k of RIBBON_KEYS) {
    const g = given[k];
    if (!g) continue;
    let label = typeof g.label === "string" ? g.label.trim().slice(0, 20) : "";
    if (k === "countdown" && label === "剩餘 {n} 天") label = ""; // 舊預設文字，改用新預設「倒數 {n} 天」
    ribbons[k] = {
      label: label || DEFAULT_UI_CONFIG.ribbons[k].label,
      color: (RIBBON_PALETTE as readonly string[]).includes(g.color as string) ? (g.color as RibbonColor) : DEFAULT_UI_CONFIG.ribbons[k].color,
      enabled: g.enabled === undefined ? DEFAULT_UI_CONFIG.ribbons[k].enabled : g.enabled === true,
    };
  }
  const roles = Array.isArray(r.statsRoles) ? (r.statsRoles as unknown[]).filter((x): x is string => STATS_ROLE_OPTIONS.some((o) => o.key === x)) : [];
  // 系列手動排序：只收「s:」「c:」開頭的字串，去重、限長、最多 1000 筆。
  const so = Array.isArray(r.seriesOrder) ? (r.seriesOrder as unknown[]).filter((x): x is string => typeof x === "string" && /^[sc]:.{1,120}$/.test(x)) : [];
  return { sortGroups, seriesOrder: [...new Set(so)].slice(0, 1000), ribbons, statsRoles: [...new Set(roles)], app: normalizeApp(r.app), share: normalizeShare(r.share) };
}

/** 整理分享預設值：文字去頭尾空白（保留中間換行）、限制長度，空白或不合法的欄位退回預設（備註退回文字與兩個開關例外，可以是空白）。 */
export function normalizeShare(raw: unknown): ShareSettings {
  const d = DEFAULT_SHARE_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, def: string, max: number, allowEmpty = false) => {
    if (typeof v !== "string") return def;
    const t = v.replace(/\r/g, "").trim().slice(0, max);
    return t || allowEmpty ? t : def;
  };
  return {
    inviteText: str(r.inviteText, d.inviteText, 200),
    courseText: str(r.courseText, d.courseText, 300),
    linkLead: str(r.linkLead, d.linkLead, 60),
    siteName: str(r.siteName, d.siteName, 30),
    // 分隔符號前後的空白要保留（例如「 | 」），所以不 trim。
    titleSeparator: typeof r.titleSeparator === "string" && r.titleSeparator.length <= 10 && r.titleSeparator.trim() ? r.titleSeparator : d.titleSeparator,
    addressIcon: str(r.addressIcon, d.addressIcon, 8, true),
    showAddress: typeof r.showAddress === "boolean" ? r.showAddress : d.showAddress,
    showQuote: typeof r.showQuote === "boolean" ? r.showQuote : d.showQuote,
    hqName: str(r.hqName, d.hqName, 30),
    fallbackDescription: str(r.fallbackDescription, d.fallbackDescription, 100, true),
  };
}

/** 整理 APP 數值設定：數字夾在合理範圍（四捨五入成整數）、選項不合法退回預設、缺的欄位用預設補。 */
export function normalizeApp(raw: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rr = (r.rec && typeof r.rec === "object" ? r.rec : {}) as Record<string, unknown>;
  const num = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    homeLeftSec: num(r.homeLeftSec, d.homeLeftSec, 0, 60),
    homeRightSec: num(r.homeRightSec, d.homeRightSec, 0, 60),
    homePauseSec: num(r.homePauseSec, d.homePauseSec, 0, 120),
    tickerSec: num(r.tickerSec, d.tickerSec, 2, 60),
    tickerPauseSec: num(r.tickerPauseSec, d.tickerPauseSec, 0, 120),
    rec: {
      scope: rr.scope === "all" || rr.scope === "myCenter" ? rr.scope : d.rec.scope,
      includeHq: bool(rr.includeHq, d.rec.includeHq),
      onlyEligible: bool(rr.onlyEligible, d.rec.onlyEligible),
      hideEnded: bool(rr.hideEnded, d.rec.hideEnded),
      collapseSeries: bool(rr.collapseSeries, d.rec.collapseSeries),
      order: rr.order === "soonest" || rr.order === "newest" || rr.order === "list" ? rr.order : d.rec.order,
      max: num(rr.max, d.rec.max, 0, 50),
    },
    freshDays: num(r.freshDays, d.freshDays, 1, 90),
    switchCountdownSec: num(r.switchCountdownSec, d.switchCountdownSec, 5, 60),
    blurStrength: num(r.blurStrength, d.blurStrength, 4, 40),
  };
}

export async function loadConfig(db: D1Database): Promise<UiConfig> {
  const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  if (!row) return normalizeConfig({});
  try {
    return normalizeConfig(JSON.parse(row.value));
  } catch {
    return normalizeConfig({});
  }
}

export async function saveConfig(db: D1Database, cfg: UiConfig): Promise<void> {
  await db
    .prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(cfg))
    .run();
}
