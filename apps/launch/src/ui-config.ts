/** 超級管理員可調整的畫面設定：存在 ui_settings 一筆 JSON；讀取時和預設值合併，缺的欄位自動補上。 */
import { THUMB_WIDTH_CHOICES, type ThumbSettings, DEFAULT_APP_SETTINGS, DEFAULT_SHARE_SETTINGS, DEFAULT_UI_CONFIG, type AppSettings, type ShareSettings, RIBBON_KEYS, RIBBON_PALETTE, SORT_GROUPS, STATS_ROLE_OPTIONS, type RibbonColor, type SortGroup, type UiConfig } from "./contract.ts";
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
  const ao = Array.isArray(r.albumOrder) ? (r.albumOrder as unknown[]).filter((x): x is string => typeof x === "string" && ["edm", "cover", "series", "course", "block", "treasure"].includes(x)) : [];
  return { sortGroups, seriesOrder: [...new Set(so)].slice(0, 1000), albumOrder: [...new Set(ao)], ribbons, statsRoles: [...new Set(roles)], app: normalizeApp(r.app), share: normalizeShare(r.share) };
}

/** 2026-11-16 以前的單堂課程預設範本（沒有 {職稱}）。 */
const OLD_COURSE_TEXT = "我剛聽完這場 {主講人}的這場精彩演講 {課程名稱} 我就立刻想到要分享給你！";

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
    // 舊預設範本（沒有 {職稱}，代表杜杜龍沒自己改過）自動升級成新預設；杜杜龍自己改過的文字不動。
    courseText: (() => {
      const t = str(r.courseText, d.courseText, 300);
      return t === OLD_COURSE_TEXT ? d.courseText : t;
    })(),
    linkLead: str(r.linkLead, d.linkLead, 60),
    siteName: str(r.siteName, d.siteName, 30),
    // 分隔符號前後的空白要保留（例如「 | 」），所以不 trim。
    titleSeparator: typeof r.titleSeparator === "string" && r.titleSeparator.length <= 10 && r.titleSeparator.trim() ? r.titleSeparator : d.titleSeparator,
    titleBadge: str(r.titleBadge, d.titleBadge, 8, true),
    addressIcon: str(r.addressIcon, d.addressIcon, 8, true),
    showAddress: typeof r.showAddress === "boolean" ? r.showAddress : d.showAddress,
    showQuote: typeof r.showQuote === "boolean" ? r.showQuote : d.showQuote,
    hqName: str(r.hqName, d.hqName, 30),
    fallbackDescription: str(r.fallbackDescription, d.fallbackDescription, 100, true),
    materialText: str(r.materialText, d.materialText, 300),
    chapterText: str(r.chapterText, d.chapterText, 300),
    listText: str(r.listText, d.listText, 300),
    listItemText: str(r.listItemText, d.listItemText, 300),
    reviewerInviteText: str(r.reviewerInviteText, d.reviewerInviteText, 300),
  };
}

/** 學習紀錄的兩個比例：開始 1～50%、完成 50～100%；完成必須大於開始（否則自動調成開始＋1），避免設錯後永遠無法完成。 */
function learnPct(r: Record<string, unknown>, d: AppSettings): { learnStartPct: number; learnDonePct: number } {
  const n = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
  const start = n(r.learnStartPct, d.learnStartPct, 1, 50);
  const done = Math.max(n(r.learnDonePct, d.learnDonePct, 50, 100), start + 1);
  return { learnStartPct: start, learnDonePct: done };
}

const pick = <T extends string | number>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
const hex = (v: unknown, def: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
/** 即時縮圖設定：每個欄位都限制在合法範圍內，壞資料一律退回預設。 */
export function normalizeThumb(raw: unknown): ThumbSettings {
  const d = DEFAULT_APP_SETTINGS.thumb;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
  const widths = Array.isArray(r.widths) ? [...new Set((r.widths as unknown[]).filter((x): x is number => THUMB_WIDTH_CHOICES.includes(x as number)))].sort((a, b) => a - b) : d.widths;
  return {
    enabled: r.enabled === true,
    widths: widths.length ? widths : d.widths,
    height: n(r.height, d.height, 0, 3),
    fit: pick(r.fit, ["scale-down", "contain", "cover", "crop", "pad", "squeeze"] as const, d.fit),
    gravity: pick(r.gravity, ["auto", "center", "face", "left", "right", "top", "bottom"] as const, d.gravity),
    format: pick(r.format, ["auto", "avif", "webp", "jpeg", "png"] as const, d.format),
    quality: Math.round(n(r.quality, d.quality, 1, 100)),
    qualityLevel: pick(r.qualityLevel, ["", "high", "medium-high", "medium-low", "low"] as const, d.qualityLevel),
    anim: r.anim === undefined ? d.anim : r.anim === true,
    metadata: pick(r.metadata, ["none", "keep", "copyright"] as const, d.metadata),
    rotate: pick(r.rotate, [0, 90, 180, 270] as const, d.rotate),
    flip: pick(r.flip, ["", "h", "v", "hv"] as const, d.flip),
    blur: n(r.blur, d.blur, 0, 250),
    sharpen: n(r.sharpen, d.sharpen, 0, 10),
    brightness: n(r.brightness, d.brightness, 0, 4),
    contrast: n(r.contrast, d.contrast, 0, 4),
    gamma: n(r.gamma, d.gamma, 0.1, 4),
    saturation: n(r.saturation, d.saturation, 0, 4),
    background: r.background === "" || r.background === undefined ? "" : hex(r.background, ""),
    trim: Math.round(n(r.trim, d.trim, 0, 500)),
    borderWidth: Math.round(n(r.borderWidth, d.borderWidth, 0, 50)),
    borderColor: hex(r.borderColor, d.borderColor),
    quota: (() => {
      const q = (r.quota && typeof r.quota === "object" ? r.quota : {}) as Record<string, unknown>;
      return { monthly: Math.round(n(q.monthly, d.quota.monthly, 100, 1_000_000)), edmPct: Math.round(n(q.edmPct, d.quota.edmPct, 0, 100)), albumPct: Math.round(n(q.albumPct, d.quota.albumPct, 0, 100)) };
    })(),
  };
}

/** 清單解鎖條件：每項＝一個學習成就編號＋解鎖幾份（1～20）；同一個成就只留一筆，最多 100 筆。 */
function normalizeListUnlocks(raw: unknown): { achievementId: string; extra: number }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { achievementId: string; extra: number }[] = [];
  for (const x of raw.slice(0, 100)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = typeof o.achievementId === "string" ? o.achievementId.trim().slice(0, 60) : "";
    const extra = typeof o.extra === "number" && Number.isFinite(o.extra) ? Math.min(20, Math.max(1, Math.round(o.extra))) : 0;
    if (!id || !extra || seen.has(id)) continue;
    seen.add(id);
    out.push({ achievementId: id, extra });
  }
  return out;
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
    blurStrength: num(r.blurStrength, d.blurStrength, 4, 40),
    ...learnPct(r, d),
    watchReportSec: num(r.watchReportSec, d.watchReportSec, 5, 120),
    libraryKeyBadges: num(r.libraryKeyBadges, d.libraryKeyBadges, 1, 1000),
    listBaseQuota: num(r.listBaseQuota, d.listBaseQuota, 0, 50),
    listUnlocks: normalizeListUnlocks(r.listUnlocks),
    fileMaxMb: 95, // 教材檔案單檔上限固定最高 95MB、不可調（杜杜龍 2026-11-25；舊設定存的值一律忽略）
    imageMaxSide: num(r.imageMaxSide, d.imageMaxSide, 400, 4096),
    imageQuality: num(r.imageQuality, d.imageQuality, 30, 100),
    centerMaxSide: num(r.centerMaxSide, d.centerMaxSide, 800, 4096),
    centerQuality: num(r.centerQuality, d.centerQuality, 30, 100),
    edmMaxSide: num(r.edmMaxSide, d.edmMaxSide, 800, 4096),
    edmQuality: num(r.edmQuality, d.edmQuality, 30, 100),
    coverSec: num(r.coverSec, d.coverSec, 1, 10),
    videoMaxHeight: pick(r.videoMaxHeight, [480, 720, 1080] as const, 720),
    videoKbps: num(r.videoKbps, d.videoKbps, 500, 8000),
    videoFps: num(r.videoFps, d.videoFps, 15, 60),
    videoMaxMb: num(r.videoMaxMb, d.videoMaxMb, 2, 60),
    videoMaxSec: num(r.videoMaxSec, d.videoMaxSec, 5, 60),
    storeFormat: pick(r.storeFormat, ["jpeg", "webp", "avif"] as const, d.storeFormat),
    albumFormat: pick(r.albumFormat, ["jpeg", "webp", "avif"] as const, d.albumFormat),
    albumQuality: num(r.albumQuality, d.albumQuality, 30, 100),
    albumScope: pick(r.albumScope, ["off", "treasure", "all"] as const, d.albumScope),
    thumb: normalizeThumb(r.thumb),
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
