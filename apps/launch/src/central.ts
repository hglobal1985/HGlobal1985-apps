/**
 * 中央會員串接（https://id.hglobal1985.com）：
 * - 驗證 Access Token（RS256、typ=at+jwt、iss/aud、app_id=learn、exp），會員主鍵只用 sub。
 * - 獎銜資格一律即時向中央查詢（fail closed），結果只放記憶體快取，不寫入資料庫或日誌。
 * - 管理員 = 中央「超級管理員」（以 /v1/apps/learn/handoff 確認，這是中央唯一接受 App 登入的職務查詢），
 *   或列在 LEARN_ADMIN_SUBS 的會員 ID。
 * 日誌不得出現 Token、信箱、姓名。
 */
import { createTokenVerifier, looksLikeJwt, SIGNATURE_TOLERANCE_SECONDS, verifyWebhook } from "../../../packages/server-shared/src/central-verify.ts";
import { createServiceClient, validEmail, type ContactPurpose } from "../../../packages/server-shared/src/central-service.ts";
import type { CentralReviews, StaffMember, StaffRole, StaffSearch } from "./contract.ts";
export const CENTRAL = "https://id.hglobal1985.com";
export const APP_ID = "learn";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let centralFetch: Fetch = (input, init) => fetch(input, init);
/** 測試用：替換對中央的網路請求。 */
export function setCentralFetch(f: Fetch): void {
  centralFetch = f;
  keys.clear();
  memo.clear();
  lastGoodContext.clear();
}

// Access Token 驗證：伺服器共用模組（packages/server-shared/src/central-verify.ts，兩個 App 同一份）。
const verifier = createTokenVerifier(CENTRAL, APP_ID, () => centralFetch);
const keys = { clear: verifier.reset };
export { looksLikeJwt };
/** 驗證 Access Token，成功回傳 member_id，失敗回傳 null。 */
export const verifyAccessToken = (token: string): Promise<string | null> => verifier.verify(token);

/** 背景工作執行器（handleApi 每個請求設定為該請求的 waitUntil；沒有時照舊等完成）。 */
let background: ((p: Promise<unknown>) => void) | null = null;
export function setBackground(fn: ((p: Promise<unknown>) => void) | null): void {
  background = fn;
}

/** 向中央每次呼叫花的時間（依會員 Token 分開記，handleApi 回應時取出寫進 Server-Timing，方便在瀏覽器 Network → Timing 看哪個慢）。 */
const callLog = new Map<string, { path: string; ms: number }[]>();
function logCall(token: string, path: string, ms: number): void {
  const list = callLog.get(token) ?? [];
  if (list.length < 12) list.push({ path: path.split("?")[0], ms });
  callLog.set(token, list);
  if (callLog.size > 500) callLog.delete(callLog.keys().next().value!);
}
export function takeCentralTimings(token: string | undefined): string {
  if (!token) return "";
  const list = callLog.get(token);
  callLog.delete(token);
  return (list ?? []).map((c, i) => `central${i};desc="${c.path.replace(/[^\w/.-]/g, "")}";dur=${c.ms}`).join(", ");
}

/** 短時效記憶體快取（只在單一 Worker 執行個體內，不落地）。 */
const memo = new Map<string, { value: unknown; until: number }>();
const inflight = new Map<string, Promise<unknown>>();
/**
 * 查詢結果短暫放記憶體；同一時間同樣的查詢只送一次；查不到（undefined）不快取。
 * staleMs＞0＝「先給舊的、背景更新」（杜杜龍 2026-11-20）：過期後在 staleMs 內，這次先立刻回舊資料、背景去問中央換新的；
 * 超過 staleMs 才會站著等。權限相關（職務、資格）舊資料最長可用 5 分鐘（ttl＋staleMs）。
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, staleMs = 0): Promise<T> {
  const hit = memo.get(key);
  const now = Date.now();
  if (hit && hit.until > now) return hit.value as T;
  const run = async () => {
    const value = await load();
    if (value !== undefined) {
      memo.set(key, { value, until: Date.now() + ttlMs });
      if (memo.size > 2000) memo.delete(memo.keys().next().value!);
    }
    return value;
  };
  const start = (): Promise<unknown> => {
    const running = inflight.get(key);
    // 同一時間同一份資料只問一次（同一個人一開頁面會同時送好幾個請求）。
    // 但「別的請求」先開始的查詢，如果那個請求被瀏覽器取消（例如使用者切換頁面），它的連線會被一起中斷；
    // 等它的請求就會收到錯誤（2026-11-20 正式站 /courses、/ui-config 因此偶爾回 500）。所以等別人的失敗時，自己再問一次。
    if (running) return running.catch(() => run());
    const p = run();
    inflight.set(key, p);
    p.then(() => inflight.delete(key), () => inflight.delete(key));
    return p;
  };
  if (hit && staleMs > 0 && hit.until + staleMs > now && background) {
    const job = start().catch(() => undefined);
    try {
      background(job);
    } catch {
      /* 沒有可用的背景執行環境：照樣會在背景跑完 */
    }
    return hit.value as T;
  }
  return (await start()) as T;
}

async function callCentral(token: string, path: string, init: RequestInit = {}): Promise<Response | null> {
  const t0 = Date.now();
  try {
    return await centralFetch(`${CENTRAL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  } finally {
    logCall(token, path, Date.now() - t0);
  }
}

/** 顯示名稱與頭像網址（頭像在會員中心本來就是公開的；只放記憶體快取，不寫入資料庫）。不是 Amway 資料。 */
type ProfileDoc = { fields?: Record<string, { value?: unknown }>; avatar?: { url?: unknown }; info?: { google_email?: unknown } };
/** GET /v1/me/profile 只打一次（名稱、頭像、聯絡信箱、真實姓名共用；放記憶體 2 分鐘）。查不到回 undefined。 */
async function profileDoc(sub: string, token: string): Promise<ProfileDoc | undefined> {
  return cached(`pdoc:${sub}`, 120_000, async () => {
    const res = await callCentral(token, "/v1/me/profile");
    if (!res?.ok) return undefined;
    const b = (await res.json().catch(() => null)) as ProfileDoc | null;
    return b?.fields ? b : undefined;
  }, 180_000);
}

export async function profileSummary(sub: string, token: string): Promise<{ name: string; avatarUrl: string | null }> {
  const body = await profileDoc(sub, token);
  if (!body) return { name: "會員", avatarUrl: null };
  const v = body.fields?.display_name?.value;
  const a = typeof body.avatar?.url === "string" ? body.avatar.url : "";
  const avatarUrl = a.startsWith("/") ? `${CENTRAL}${a}` : /^https:\/\//.test(a) ? a : null;
  return { name: typeof v === "string" && v.trim() ? v.trim().slice(0, 50) : "會員", avatarUrl };
}

/** 會員在會員中心的獎銜（只放記憶體快取供首頁顯示，不寫入資料庫；杜杜龍 2026-11-12 授權讀取）。查不到回 undefined。 */
type AmwayMe = { enabled?: boolean; hglobal_systems?: string[]; fields?: Record<string, { value?: unknown; pending_value?: unknown }> };
/** GET /v1/me/amway 只打一次（獎銜顯示與資料補填提醒共用；放記憶體 2 分鐘）。 */
export async function amwayMe(sub: string, token: string): Promise<AmwayMe | undefined> {
  return cached(`amway:${sub}`, 120_000, async () => {
    const res = await callCentral(token, "/v1/me/amway");
    if (!res?.ok) return undefined;
    return ((await res.json().catch(() => null)) as AmwayMe | null) ?? undefined;
  }, 180_000);
}

export async function rankValue(sub: string, token: string): Promise<string | null | undefined> {
  return (async () => {
    const b = await amwayMe(sub, token);
    if (!b) return undefined;
    const v = b.fields?.rank?.value;
    const s = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { option?: unknown }).option === "string" ? (v as { option: string }).option : null;
    return s && s.trim() ? s.trim() : null;
  })();
}

/** 會員本人在會員中心的「真實姓名」（legal_name）。每次即時讀取、不快取；查不到或空白回 ""。 */
export async function legalNameOf(token: string): Promise<string> {
  const res = await callCentral(token, "/v1/me/profile");
  if (!res?.ok) return "";
  const b = (await res.json().catch(() => null)) as { fields?: Record<string, { value?: unknown }> } | null;
  const v = b?.fields?.legal_name?.value;
  return typeof v === "string" ? v.trim().slice(0, 50) : "";
}

/** 會員中心資料是否完整（只回「缺什麼」的名稱，不保存任何值）：聯絡信箱；勾選「我是 Amway 會員」時，Amway 欄位有沒有空白。 */
export async function profileGaps(sub: string, token: string, email: string | null | undefined): Promise<string[] | undefined> {
  // 會員中心暫時查不到（例如剛註冊、資料還沒建好）時回 undefined：不快取，下次進來再問，才不會把「沒有缺漏」記住。
  return cached(`gaps:${sub}:${email ? 1 : 0}`, 60_000, async (): Promise<string[] | undefined> => {
    const gaps: string[] = [];
    // Email 不列入提醒（杜杜龍 2026-11-23：Email 自動帶入 Google 信箱、非必填）：會員用 Google 登入，信箱由會員中心預設帶入。
    void email;
    {
      const [b, doc] = await Promise.all([amwayMe(sub, token), profileDoc(sub, token)]);
      if (!b) return undefined;
      // 本名必填（杜杜龍 2026-11-23）：沒填也要提醒（暫時讀不到個人資料時不誤報）。
      if (doc) {
        const ln = doc.fields?.legal_name?.value;
        if (typeof ln !== "string" || !ln.trim()) gaps.push("本名");
      }
      // 新會員還沒勾選「我是 Amway 會員」也要提醒（視窗會引導到會員中心勾選並填寫）。
      if (b.enabled !== true) gaps.push("Amway 會員資料");
      else {
        // 檢查獎銜、系統、中心與上手白金、上手鑽石（杜杜龍 2026-11-23：上手兩欄也必填，沒填就自動彈出面板）；推薦人不列入。
        const core = ["education_system", "education_center", "rank", "upline_platinum", "upline_diamond"];
        const empty = core.some((k) => {
          const f = b.fields?.[k];
          return !f || ((f.value == null || f.value === "") && (f.pending_value == null || f.pending_value === ""));
        });
        if (empty) gaps.push("Amway 會員資料");
      }
    }
    return gaps;
  });
}

/**
 * GET /v1/amway/field-definitions 全站只問這一次（獎銜名稱、獎銜選項、獎銜徽章共用；杜杜龍 2026-11-20：以前三個函式各問一次）。
 * 快取最長 5 分鐘（串接指令 2026-11-15.5 標準 13）、只放記憶體；讀不到回 undefined（不快取）。
 */
async function fieldDefinitions(token: string): Promise<unknown | undefined> {
  return cached("field-defs", 300_000, async () => {
    const res = await callCentral(token, "/v1/amway/field-definitions");
    if (!res?.ok) return undefined;
    return (await res.json().catch(() => null)) ?? undefined;
  });
}
type RankFieldDef = { options?: { value?: unknown; label?: unknown }[] };
function rankFieldOf(b: unknown): RankFieldDef | undefined {
  const list: unknown[] = Array.isArray(b) ? b : b && typeof b === "object" ? Object.values((b as { fields?: unknown }).fields ?? b) : [];
  return list.find((f) => f && typeof f === "object" && (f as { key?: unknown }).key === "rank") as RankFieldDef | undefined;
}

/** 自訂系統含這些詞要提醒／被中央擋下（串接指令 2026-11-24.3 第 39 項）：一律讀 field-definitions 的 education_system，不寫死；讀不到就是沒有。 */
export async function hglobalCenterWords(token: string): Promise<{ words: string[]; message: string } | undefined> {
  const b = await fieldDefinitions(token);
  const list: unknown[] = Array.isArray(b) ? b : b && typeof b === "object" ? Object.values((b as { fields?: unknown }).fields ?? b) : [];
  const f = list.find((x) => x && typeof x === "object" && (x as { key?: unknown }).key === "education_system") as { hglobal_center_words?: unknown; hglobal_center_message?: unknown } | undefined;
  const words = Array.isArray(f?.hglobal_center_words) ? f.hglobal_center_words.filter((w): w is string => typeof w === "string" && !!w.trim()) : [];
  return words.length && typeof f?.hglobal_center_message === "string" ? { words, message: f.hglobal_center_message } : undefined;
}

/** 獎銜選項（代碼→名稱）：不寫死，向中央讀取 key=rank 的 options。讀不到回空 Map。 */
export async function rankOptions(token: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const o of rankFieldOf(await fieldDefinitions(token))?.options ?? []) if (typeof o.value === "string" && typeof o.label === "string") out.set(o.value, o.label);
  return out;
}

/** 顯示名稱（供訂單審核辨識）。 */
export async function displayName(sub: string, token: string): Promise<string> {
  return (await profileSummary(sub, token)).name;
}

/**
 * 是否為本 App 管理員。中央的 /v1/admin/* 只接受會員中心網站本身的登入，App 的 token 一律被拒；
 * 中央提供給 App 的方式是 GET /v1/apps/learn/handoff：只有超級管理員會得到 200（不帶 integrated 參數時不寫入任何紀錄）。
 * 另可在 Worker 變數 LEARN_ADMIN_SUBS（逗號分隔的會員 ID）指定其他管理員。查不到一律否。
 */
export async function isAdmin(sub: string, token: string, extraAdmins = ""): Promise<boolean> {
  // 超級管理員、總部秘書由 memberContext 的職務判斷，不再每個請求多問一次會員中心；這裡只看 LEARN_ADMIN_SUBS。
  void token;
  return extraAdmins.split(",").map((x) => x.trim()).filter(Boolean).includes(sub);
}

/** 獎銜資格（批次）：min_rank 為 none 的課程只需登入；其餘向中央查詢，失敗一律不符合。 */
async function askEligibility(sub: string, token: string, rules: string[]): Promise<Map<string, boolean> | null> {
  const res = await callCentral(token, "/v1/eligibility/check-batch", {
    method: "POST",
    body: JSON.stringify({ rules: rules.map((min_rank) => ({ audience: "hglobal_verified", min_rank })) }),
  });
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { results?: { allowed?: unknown }[] } | null;
  const results = Array.isArray(body?.results) ? body!.results : [];
  const out = new Map<string, boolean>();
  rules.forEach((r, i) => {
    const allowed = results[i]?.allowed === true;
    out.set(r, allowed);
    // 只快取成功的結果 10 分鐘（規範上限 1 日）；失敗不快取，下次重試。
    memo.set(`elig:${sub}:${r}`, { value: allowed, until: Date.now() + 600_000 });
  });
  return out;
}
export async function rankEligibility(sub: string, token: string, minRanks: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const need = [...new Set(minRanks.filter((r) => r !== "none"))];
  for (const r of minRanks) if (r === "none") out.set(r, true);
  if (!need.length) return out;
  // 快取過期後 5 分鐘內：這次先用舊結果、背景更新（杜杜龍 2026-11-20；權限舊資料最長可用 5 分鐘）。
  const now = Date.now();
  const missing: string[] = [];
  const stale: string[] = [];
  for (const r of need) {
    const hit = memo.get(`elig:${sub}:${r}`);
    if (hit && hit.until > now) out.set(r, hit.value as boolean);
    else if (hit && hit.until + 300_000 > now && background) {
      out.set(r, hit.value as boolean);
      stale.push(r);
    } else missing.push(r);
  }
  if (stale.length) {
    const job = askEligibility(sub, token, stale).catch(() => null);
    try {
      background!(job);
    } catch {
      /* 照樣在背景跑完 */
    }
  }
  if (!missing.length) return out;
  const got = await askEligibility(sub, token, missing);
  for (const r of missing) out.set(r, got?.get(r) === true);
  return out;
}

/**
 * 中央的「獎銜、中心」新申請審核佇列（GET /v1/eligibility/reviews，杜杜龍 2026-11-17）：用會員本人的 Token 即時讀取，
 * 權限與中心範圍全由中央判斷（超級管理員、秘書看全部；審核員只看自己的中心）；這裡不判斷、不保存、不寫日誌。
 * 任何失敗（沒有權限、中央尚未開放、逾時）都回 available=false，畫面就不顯示審核區。
 */
export async function centralReviews(token: string): Promise<CentralReviews> {
  const none: CentralReviews = { available: false, scope: null, reviews: [] };
  const res = await callCentral(token, "/v1/eligibility/reviews");
  if (!res?.ok) return none;
  const b = (await res.json().catch(() => null)) as { scope?: string; reviews?: unknown[] } | null;
  if (!b || !Array.isArray(b.reviews)) return none;
  return { available: true, scope: b.scope === "all" ? "all" : "center", reviews: b.reviews as CentralReviews["reviews"] };
}

/** 處理一筆申請；回傳中央的狀態碼（200 成功；403 不是你的中心；404 已被處理過）。 */
export async function centralDecide(token: string, id: string, decision: "approve" | "reject", value?: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await callCentral(token, `/v1/eligibility/reviews/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify(value === undefined ? { decision } : { decision, value }) });
  const body = res ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  return { status: res?.status ?? 503, body };
}

/**
 * App 內指派職務（杜杜龍 2026-11-21；中央串接指令 2026-11-21.1，第三章 17、檢查清單 31）：
 * - 查人 GET /v1/eligibility/staff：不帶 q 回「有職務的人」；q 要 2～30 字。
 * - 指派 PUT /v1/eligibility/staff/{member_id}，body {"roles":[...]} 是「事後完整清單」。
 * - 一律用呼叫者本人的 App 會員 Token（不可用服務 Token）；任何非 200 都當沒有權限。
 * - 職務選項用中央回傳的 assignable_roles；**不保存名單與搜尋字，也不寫日誌**（logCall 只記路徑、不含查詢字串）。
 * 回應欄位名稱依中央回傳寬鬆讀取（member_id／id、display_name／name、center／education_center、roles）。
 */
const roleOf = (x: unknown): StaffRole | null => {
  if (typeof x === "string" && x) return { value: x, label: x };
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const value = [o.value, o.key, o.role, o.id, o.code].find((v) => typeof v === "string" && v) as string | undefined;
    const label = [o.label, o.name, o.title, o.display_name].find((v) => typeof v === "string" && v) as string | undefined;
    if (value) return { value, label: label ?? value };
  }
  return null;
};
const roleList = (v: unknown): StaffRole[] => (Array.isArray(v) ? v.map(roleOf).filter((r): r is StaffRole => !!r) : []);
const textOfStaff = (...vs: unknown[]): string => {
  for (const v of vs) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = [o.label, o.name, o.display_name].find((x) => typeof x === "string" && x) as string | undefined;
      if (t) return t;
    }
  }
  return "";
};
export async function staffSearch(token: string, q?: string): Promise<StaffSearch> {
  const none: StaffSearch = { available: false, assignable: [], members: [] };
  const res = await callCentral(token, q ? `/v1/eligibility/staff?q=${encodeURIComponent(q)}` : "/v1/eligibility/staff");
  if (!res || res.status !== 200) return none;
  const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return none;
  const rows = [b.members, b.staff, b.items, b.results, b.data].find(Array.isArray) as unknown[] | undefined;
  const members: StaffMember[] = (rows ?? [])
    .map((r): StaffMember | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const memberId = [o.member_id, o.id, o.sub].find((v) => typeof v === "string" && v) as string | undefined;
      if (!memberId) return null;
      return { memberId, name: textOfStaff(o.display_name, o.name), center: textOfStaff(o.education_center, o.center, o.center_label), roles: roleList(o.roles).map((x) => x.value) };
    })
    .filter((m): m is StaffMember => !!m);
  return { available: true, assignable: roleList(b.assignable_roles), members };
}
/** 指派（事後完整清單）。回傳中央的狀態碼與最新的職務清單（成功才有；畫面用它更新）。 */
export async function staffAssign(token: string, memberId: string, roles: string[]): Promise<{ status: number; roles: string[] | null }> {
  const res = await callCentral(token, `/v1/eligibility/staff/${encodeURIComponent(memberId)}`, { method: "PUT", body: JSON.stringify({ roles }) });
  if (!res) return { status: 503, roles: null };
  const b = res.status === 200 ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  return { status: res.status, roles: b && Array.isArray(b.roles) ? roleList(b.roles).map((x) => x.value) : null };
}

/** 會員在會員中心的第一組會員編號（安麗會員編號，用來當「我的書櫃」網址）；查不到回 null。只在建立書櫃那一刻讀一次。 */
export async function memberNumberOf(sub: string, token: string): Promise<string | null> {
  const doc = await profileDoc(sub, token);
  const v = doc?.fields?.member_number?.value;
  const first = Array.isArray(v) ? (v[0] as { number?: unknown } | undefined) : undefined;
  return typeof first?.number === "string" ? first.number : null;
}

export type MemberContext = { roles: string[]; hglobal: boolean; center: { key: string; label: string } | null };
const NO_CONTEXT: MemberContext = { roles: [], hglobal: false, center: null };

/** 與會員中心相同的中心比對鍵（normTerm）。 */
export const centerKey = (label: string) => label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** 登入者自己的職務、是否為已驗證的寰宇、已核准的中心（GET /v1/eligibility/context）。查不到一律視為沒有。 */
const lastGoodContext = new Map<string, MemberContext>();
export async function memberContext(sub: string, token: string): Promise<MemberContext> {
  // 查詢失敗（會員中心暫時連不上、逾時、5xx）時，不可把「沒有任何職務」記起來：
  // 否則超級管理員會被當成一般學員 60 秒（2026-11-19 杜杜龍回報：點通知「前往查看」顯示沒權限）。
  // 失敗時回「最近一次成功的結果」（沒有就暫時視為沒有職務），而且這次失敗不進快取，下個請求馬上重試。
  const fresh = await cached<MemberContext | undefined>(`ctx:${sub}`, 60_000, async () => {
    const res = await callCentral(token, "/v1/eligibility/context");
    if (!res?.ok) return undefined;
    const b = (await res.json().catch(() => null)) as { member_id?: string; roles?: { role?: string }[]; hglobal_verified?: boolean; center?: { key?: string; label?: string } | null } | null;
    if (!b || b.member_id !== sub) return undefined;
    const label = typeof b.center?.label === "string" ? b.center.label.trim().slice(0, 100) : "";
    const ctx: MemberContext = {
      roles: (b.roles ?? []).map((r) => String(r.role ?? "")).filter(Boolean),
      hglobal: b.hglobal_verified === true,
      center: label ? { key: typeof b.center?.key === "string" && b.center.key ? b.center.key : centerKey(label), label } : null,
    };
    lastGoodContext.set(sub, ctx);
    if (lastGoodContext.size > 2000) lastGoodContext.delete(lastGoodContext.keys().next().value!);
    return ctx;
  }, 240_000);
  return fresh ?? lastGoodContext.get(sub) ?? NO_CONTEXT;
}

export type CenterMember = { memberId: string; name: string; avatarUrl: string | null; signedIn: boolean };
export type CenterMembersPage = { center: { key: string; label: string } | null; members: CenterMember[]; next: string | null };
/**
 * 同中心會員名單（指派小編用；串接指令 2026-11-15.4 三、14）：GET /v1/eligibility/center-members。
 * 用呼叫者本人的 Token；音控／會長只會拿到自己中心，總部可帶 center。名單不保存、不快取、搜尋字不寫日誌。
 * 失敗時丟出 { status, code }，由呼叫端轉成中文訊息。
 */
export async function centerMembers(token: string, opts: { q?: string; cursor?: string | null; center?: string | null; limit?: number }): Promise<CenterMembersPage> {
  const qs = new URLSearchParams();
  qs.set("q", (opts.q ?? "").slice(0, 30));
  qs.set("limit", String(Math.min(50, Math.max(1, opts.limit ?? 20))));
  if (opts.cursor) qs.set("cursor", opts.cursor.slice(0, 500));
  if (opts.center) qs.set("center", opts.center.slice(0, 100));
  const res = await callCentral(token, `/v1/eligibility/center-members?${qs.toString()}`);
  if (!res) throw { status: 503, code: "central_unavailable" };
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw { status: res.status, code: b?.error?.code ?? "error" };
  }
  const b = (await res.json().catch(() => null)) as { center?: { key?: unknown; label?: unknown } | null; members?: unknown[]; next_cursor?: unknown } | null;
  const label = typeof b?.center?.label === "string" ? b.center.label : "";
  const members = (b?.members ?? []).flatMap((m): CenterMember[] => {
    const x = m as { member_id?: unknown; display_name?: unknown; avatar_url?: unknown; signed_in_app?: unknown };
    if (typeof x.member_id !== "string" || !x.member_id) return [];
    return [{ memberId: x.member_id, name: typeof x.display_name === "string" ? x.display_name.slice(0, 60) : "", avatarUrl: typeof x.avatar_url === "string" && /^https:\/\//.test(x.avatar_url) ? x.avatar_url : null, signedIn: x.signed_in_app === true }];
  });
  return { center: label ? { key: typeof b?.center?.key === "string" && b.center.key ? b.center.key : centerKey(label), label } : null, members, next: typeof b?.next_cursor === "string" && b.next_cursor ? b.next_cursor : null };
}

let lastCenters: string[] = [];
/**
 * 中心清單：**唯一的正本是會員中心**（地區教育中心詞庫）。行動大學不可自行新增、也不可把本地資料（報名紀錄、審核群組…）裡出現過的名稱混進來。
 * 查不到時回傳「最近一次成功取得的清單」（還沒成功過就是空陣列）；失敗不快取。
 */
export async function centerList(token: string): Promise<string[]> {
  const fresh = await cached("centers", 300_000, async (): Promise<string[] | undefined> => {
    const res = await callCentral(token, "/v1/vocab/suggestions?pool=education_center&q=");
    if (!res?.ok) return undefined; // 失敗不放進快取
    const b = (await res.json().catch(() => null)) as { suggestions?: unknown[] } | null;
    const list = (b?.suggestions ?? []).filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 300);
    return list.length ? list : undefined;
  });
  if (fresh && fresh.length) lastCenters = fresh;
  return lastCenters;
}

export { validEmail };

/**
 * 登入者在會員中心的「聯絡信箱」（個人資料欄位 contact_email，正本在中央）。
 * 回傳 undefined＝查不到（中央無回應等），呼叫端不可因此清除已存的副本。
 */
export async function contactEmail(sub: string, token: string): Promise<string | null | undefined> {
  const body = await profileDoc(sub, token);
  if (!body) return undefined;
  const v = body.fields?.contact_email?.value;
  return typeof v === "string" && validEmail(v.trim()) ? v.trim().toLowerCase() : null;
}

/** 把聯絡信箱寫回會員中心（null＝清除）。成功才回 true。 */
export async function saveContactEmail(sub: string, token: string, email: string | null): Promise<boolean> {
  const res = await callCentral(token, "/v1/me/profile/fields/contact_email", { method: "PUT", body: JSON.stringify({ value: email }) });
  if (!res?.ok) return false;
  forgetMember(sub);
  return true;
}

/**
 * App 內直接刪除帳號（中央串接指令 2026-11-23.3，三、9）：用會員自己的 Access Token ＋ 剛重新驗證拿到的 reauth_token，
 * POST /v1/me/delete-account。成功＝中央帳號已匿名化、所有 App 登出、Amway 資料全清；失敗把中央的白話訊息原樣帶回（不寫日誌）。
 */
export async function centralDeleteAccount(sub: string, token: string, reauthToken: string): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const res = await callCentral(token, "/v1/me/delete-account", { method: "POST", body: JSON.stringify({ reauth_token: reauthToken }) });
  if (!res) return { ok: false, status: 502, code: "central_unavailable", message: "會員中心暫時連不上，帳號沒有刪除，請稍後再試" };
  if (res.ok) {
    forgetMember(sub);
    return { ok: true };
  }
  const e = ((await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof e?.code === "string" ? e.code : "central_error";
  const message = typeof e?.message === "string" && e.message ? e.message : "帳號沒有刪除，請稍後再試";
  return { ok: false, status: res.status, code, message };
}

/** 寫入或查詢後，丟掉這位會員在記憶體裡的中央資料快取（下一次讀取會拿到最新的）。 */
export function forgetMember(sub: string): void {
  for (const k of [...memo.keys()]) if (k.includes(`:${sub}`)) memo.delete(k);
}

export type RankOption = { value: string; label: string };
/** 獎銜選項清單（依階梯順序）。 */
export async function rankOptionList(token: string): Promise<RankOption[]> {
  return (rankFieldOf(await fieldDefinitions(token))?.options ?? []).filter((o): o is RankOption => typeof o.value === "string" && typeof o.label === "string");
}

/** 中央提供的獎銜徽章：公開完整網址＋圖案範圍（畫布 width×height 內，圖案的上下緣）。 */
export type RankBadgeInfo = { url: string; width: number; height: number; top: number; bottom: number };

/** 從 field-definitions 回應取出每個獎銜的徽章（沒有徽章＝null）。網址一律用中央給的完整網址（必須是 https）。 */
export function parseRankBadges(b: unknown): Map<string, RankBadgeInfo | null> {
  const out = new Map<string, RankBadgeInfo | null>();
  const list: unknown[] = Array.isArray(b) ? b : b && typeof b === "object" ? Object.values((b as { fields?: unknown }).fields ?? b) : [];
  const rank = list.find((f) => f && typeof f === "object" && (f as { key?: unknown }).key === "rank") as { options?: { value?: unknown; badge_url?: unknown; badge?: { width?: unknown; height?: unknown; art_top?: unknown; art_bottom?: unknown } | null }[] } | undefined;
  for (const o of rank?.options ?? []) {
    if (typeof o.value !== "string") continue;
    const m = o.badge;
    const ok = typeof o.badge_url === "string" && /^https:\/\//.test(o.badge_url) && m && [m.width, m.height, m.art_top, m.art_bottom].every((n) => typeof n === "number" && Number.isFinite(n)) && (m.height as number) > 0;
    out.set(o.value, ok ? { url: o.badge_url as string, width: m!.width as number, height: m!.height as number, top: m!.art_top as number, bottom: m!.art_bottom as number } : null);
  }
  return out;
}

/** 獎銜徽章清單（中央是唯一來源）；讀不到回 undefined（呼叫端暫用備援）。 */
export async function rankBadges(token: string): Promise<Map<string, RankBadgeInfo | null> | undefined> {
  const b = await fieldDefinitions(token);
  if (b === undefined) return undefined;
  const m = parseRankBadges(b);
  return m.size ? m : undefined;
}

export type AmwayFieldView = { value: string; pending: string | null; status: string };
export type CentralProfileView = { /** 中央提供的「自訂系統含這些詞」清單與提醒範本（{word} 換成命中的詞）；讀不到就沒有。 */ hglobalCenterWords?: string[]; hglobalCenterMessage?: string; legalName: string; nickname: string; email: string; /** 會員自己的 Google 登入信箱（中央 info.google_email）；聯絡信箱還空著時，面板用它預先帶入。只即時回給本人，不保存。 */ googleEmail: string; enabled: boolean; hglobal: boolean; hglobalSystems: string[]; fields: Record<"education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond", AmwayFieldView>; rankOptions: RankOption[] };
const textOf = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { option?: unknown }).option === "string" ? (v as { option: string }).option : "");

/** 資料補填視窗要顯示的欄位（即時讀取、不快取、不保存）：真實姓名、培訓系統、地區教育中心、獎銜。 */
export async function centralProfileView(sub: string, token: string): Promise<CentralProfileView | null> {
  const [p, a0, opts, hw] = await Promise.all([profileDoc(sub, token), amwayMe(sub, token), rankOptionList(token), hglobalCenterWords(token).catch(() => undefined)]);
  const a = a0 as { enabled?: boolean; hglobal?: boolean; hglobal_systems?: string[]; fields?: Record<string, { value?: unknown; pending_value?: unknown; status?: string }> } | undefined;
  if (!p || !a) return null;
  const f = (k: string): AmwayFieldView => ({ value: textOf(a.fields?.[k]?.value), pending: a.fields?.[k]?.pending_value != null ? textOf(a.fields[k].pending_value) : null, status: a.fields?.[k]?.status ?? "not_required" });
  const em = p.fields?.contact_email?.value;
  const nn = p.fields?.display_name?.value;
  return { legalName: typeof p.fields?.legal_name?.value === "string" ? p.fields.legal_name.value : "", nickname: typeof nn === "string" ? nn : "", email: typeof em === "string" ? em.trim() : "", googleEmail: typeof p.info?.google_email === "string" ? p.info.google_email.trim() : "", enabled: a.enabled === true, hglobal: a.hglobal === true, hglobalSystems: Array.isArray(a.hglobal_systems) ? a.hglobal_systems.filter((x): x is string => typeof x === "string") : [], fields: { education_system: f("education_system"), education_center: f("education_center"), rank: f("rank"), upline_platinum: f("upline_platinum"), upline_diamond: f("upline_diamond") }, rankOptions: opts, ...(hw ? { hglobalCenterWords: hw.words, hglobalCenterMessage: hw.message } : {}) };
}

/** 把一個欄位寫回會員中心（用會員本人的 token）。失敗時回中央的錯誤訊息。 */
export async function centralWriteField(token: string, key: "legal_name" | "display_name" | "education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond", value: string | null): Promise<{ ok: true; status: string | null } | { ok: false; status: number; message: string; /** 中央 error.details.reason（例如 use_hglobal_center）。 */ reason?: string }> {
  const path = key === "legal_name" || key === "display_name" ? `/v1/me/profile/fields/${key}` : `/v1/me/amway/fields/${key}`;
  const res = await callCentral(token, path, { method: "PUT", body: JSON.stringify({ value }) });
  if (!res) return { ok: false, status: 502, message: "會員中心暫時無法連線，請稍後再試" };
  const b = (await res.json().catch(() => null)) as { status?: string; error?: { message?: string; details?: { reason?: string } } } | null;
  if (!res.ok) return { ok: false, status: res.status === 403 ? 403 : res.status === 422 ? 422 : 502, message: b?.error?.message ?? "會員中心拒絕了這次修改", reason: b?.error?.details?.reason };
  return { ok: true, status: b?.status ?? null };
}

/** 勾選「我是 Amway 會員」（只開不關：關閉會讓中央換掉會員編號，要關請到會員中心）。成功回 null，失敗回中央的錯誤訊息。 */
export async function centralEnableAmway(token: string): Promise<string | null> {
  const res = await callCentral(token, "/v1/me/amway/enabled", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  if (!res) return "會員中心暫時無法連線，請稍後再試";
  if (res.ok) return null;
  const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return b?.error?.message ?? "會員中心拒絕了這次修改";
}

/** 關聯詞建議（培訓系統、地區教育中心、職稱）。職稱不強迫選，只是建議，會員可自己輸入。 */
export async function centralSuggest(token: string, pool: "education_system" | "education_center" | "job_title" | "upline_platinum" | "upline_diamond", q: string): Promise<string[]> {
  const res = await callCentral(token, `/v1/vocab/suggestions?pool=${pool}&q=${encodeURIComponent(q.slice(0, 30))}`);
  if (!res?.ok) return [];
  const b = (await res.json().catch(() => null)) as { suggestions?: unknown[] } | null;
  return (b?.suggestions ?? []).filter((x): x is string => typeof x === "string").slice(0, q.trim() ? 50 : 100);
}

/**
 * 把新職稱送到中央的職稱詞庫（服務對服務憑證，不用會員個人登入）：POST /v1/vocab/suggestions {pool:"job_title", value}。
 * 中央已開放（串接指令版本 2026-11-15.5）：200 回 {pool, value, created}；新詞是「待核可」，杜杜龍在中央後台核可後才出現在別人的建議；
 * 只開放 job_title（其他詞庫 403）；value 去空白、最長 50 字；每個 App 每分鐘 30 次、待核可上限 200（429）。
 * 回傳：「ok」＝中央已收下（含已存在）；「rejected」＝400／403，內容本身有問題，不重送；
 * 「retry」＝401／429／5xx／逾時，暫存稍後重送；「unsupported」＝404／405／501（中央沒有這支 API），之後再補送。永遠不丟例外。
 */
export async function centralAddJobTitle(secret: string | undefined, value: string): Promise<"ok" | "retry" | "unsupported" | "rejected"> {
  if (!secret) return "unsupported";
  try {
    const token = await serviceToken(secret);
    if (!token) return "retry";
    const res = await centralFetch(`${CENTRAL}/v1/vocab/suggestions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pool: "job_title", value }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return "ok";
    if (res.status === 404 || res.status === 405 || res.status === 501) return "unsupported";
    if (res.status === 400 || res.status === 403) return "rejected"; // 空白、過長或不是 job_title：重送也沒用
    return "retry";
  } catch {
    return "retry";
  }
}

// ---------- 中央新標準（2026-11-12.10）：webhook 驗簽、服務金鑰查信箱、版本回報 ----------

/** 這份程式採用的中央串接指令版本，以及已做到的平台標準（least_scope 由杜杜龍在中央後台勾選，不在程式內宣稱）。 */
export const INTEGRATED_VERSION = "2026-11-24.3";
export const STANDARDS = ["webhook", "delete_copy", "no_email_copy", "snapshot_reconcile", "in_app_delete"];
export { SIGNATURE_TOLERANCE_SECONDS, verifyWebhook };

// 服務 Token 與聯絡查詢：伺服器共用模組（packages/server-shared/src/central-service.ts，兩個 App 同一份）。
const svc = createServiceClient(CENTRAL, APP_ID, () => centralFetch);
const serviceToken = svc.token;
export type { ContactPurpose };
export const lookupContactEmails = svc.lookupContactEmails;

let lastReport = 0;
/** 向中央回報採用的串接指令版本與已符合的標準（只有超級管理員的 token 會被接受；每小時最多一次，失敗不影響任何功能）。 */
export async function reportIntegration(token: string): Promise<void> {
  if (Date.now() - lastReport < 3_600_000) return;
  lastReport = Date.now();
  await callCentral(token, `/v1/apps/${APP_ID}/handoff?integrated=${INTEGRATED_VERSION}&standards=${STANDARDS.join(",")}`);
}

/**
 * 報名名單的「上手白金、上手鑽石」（Amway 資料，杜杜龍 2026-11-20；串接指令 2026-11-20.2）：
 * 用服務 Token 呼叫 POST /v1/apps/learn/members/lookup（fields＝upline_platinum、upline_diamond，use＝display），一次最多 100 個會員。
 * **不寫資料庫、不寫日誌**；只放記憶體短暫快取 10 分鐘（含「沒填」的結果）。失敗、403、422、429、逾時一律當作沒有資料（畫面顯示「未提供」，不快取）。
 * 回傳 undefined＝這次中央沒有回應（整批「未提供」）。
 */
export type Upline = { platinum: string | null; diamond: string | null };
/** 最近一次讀不到上手資料的原因（只有狀態碼與中央的錯誤代碼，不含任何會員資料；報名名單畫面顯示給管理者除錯用）。 */
export let lastUplineError = "";
export async function lookupUplines(secret: string | undefined, subs: string[]): Promise<Map<string, Upline> | undefined> {
  const out = new Map<string, Upline>();
  const ids = [...new Set(subs)].slice(0, 5000);
  const need: string[] = [];
  const now = Date.now();
  lastUplineError = "";
  for (const id of ids) {
    const hit = memo.get(`upl:${id}`);
    if (hit && hit.until > now) out.set(id, hit.value as Upline);
    else need.push(id);
  }
  if (!need.length) return out;
  if (!secret) {
    lastUplineError = "沒有設定中央服務金鑰（CENTRAL_SERVICE_SECRET）";
    return undefined;
  }
  const token = await serviceToken(secret);
  if (!token) {
    lastUplineError = "向中央取得服務 Token 失敗";
    return undefined;
  }
  let failed = false;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
  const none: Upline = { platinum: null, diamond: null };
  for (let i = 0; i < need.length; i += 100) {
    let chunk = need.slice(i, i + 100);
    // 中央只要有一個會員編號格式不合（422 member_ids.N）就整批退回：把那一筆剔除（當作沒有資料）後重送，最多重送 20 次。
    for (let attempt = 0; chunk.length && attempt < 20; attempt++) {
      const t0 = Date.now();
      try {
        const res = await centralFetch(`${CENTRAL}/v1/apps/${APP_ID}/members/lookup`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ member_ids: chunk, fields: ["upline_platinum", "upline_diamond"], use: "display" }),
          signal: AbortSignal.timeout(8000),
        });
        logCall(token, "/v1/apps/learn/members/lookup", Date.now() - t0);
        if (res.status === 401) svc.forget();
        if (!res.ok) {
          const eb = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown; details?: { field_key?: unknown } } } | null;
          const bad = res.status === 422 && typeof eb?.error?.details?.field_key === "string" ? /^member_ids\.(\d+)$/.exec(eb.error.details.field_key) : null;
          if (bad && Number(bad[1]) < chunk.length) {
            const dropped = chunk[Number(bad[1])]!;
            out.set(dropped, none);
            memo.set(`upl:${dropped}`, { value: none, until: Date.now() + 600_000 });
            chunk = chunk.filter((_, k) => k !== Number(bad[1]));
            continue;
          }
          failed = true;
          // 只顯示狀態碼、錯誤代碼與中央的錯誤說明（欄位名稱等，不含會員資料）；除錯用，長度有限制。
          const msg = typeof eb?.error?.message === "string" ? eb.error.message.slice(0, 200) : "";
          const det = eb?.error?.details !== undefined ? JSON.stringify(eb.error.details).slice(0, 200) : "";
          lastUplineError = `中央回應 ${res.status}${typeof eb?.error?.code === "string" ? `（${eb.error.code.slice(0, 40).replace(/[^\w.-]/g, "")}）` : ""}${msg ? `：${msg}` : ""}${det && det !== "{}" ? ` ${det}` : ""}`;
          break;
        }
        const b = (await res.json().catch(() => null)) as { members?: unknown[]; not_found?: unknown[] } | null;
        if (!Array.isArray(b?.members)) lastUplineError = "中央回傳的格式不是預期的（沒有 members 清單）";
        const notFound = new Set((b?.not_found ?? []).filter((x): x is string => typeof x === "string"));
        for (const raw of b?.members ?? []) {
          const m = raw as { member_id?: unknown; id?: unknown; fields?: Record<string, unknown>; upline_platinum?: unknown; upline_diamond?: unknown };
          const id = typeof m.member_id === "string" ? m.member_id : typeof m.id === "string" ? m.id : "";
          if (!id) continue;
          const f = m.fields ?? {};
          const pick = (k: "upline_platinum" | "upline_diamond") => text(f[k] ?? m[k]);
          const val: Upline = { platinum: pick("upline_platinum"), diamond: pick("upline_diamond") };
          out.set(id, val);
          memo.set(`upl:${id}`, { value: val, until: Date.now() + 600_000 });
        }
        for (const id of notFound) out.set(id, none);
        break;
      } catch {
        failed = true;
        lastUplineError = "連線逾時或失敗";
        break;
      }
    }
  }
  return failed && !out.size ? undefined : out;
}

/**
 * 審核通知用：申請人的本名（杜杜龍 2026-11-23：通知裡的審核申請要顯示本名與上手白金／鑽石）。
 * 與上手分開查（欄位 legal_name 要杜杜龍在中央「平台設定」勾選，沒勾回 403 就整批當作沒有，不影響上手查詢）；
 * 只放記憶體 10 分鐘、不寫資料庫與日誌，失敗不快取。
 */
export async function lookupLegalNames(secret: string | undefined, subs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(subs)].slice(0, 100);
  const need: string[] = [];
  for (const id of ids) {
    const hit = memo.get(`lgl:${id}`);
    if (hit && hit.until > Date.now()) {
      if (hit.value) out.set(id, hit.value as string);
    } else need.push(id);
  }
  if (!need.length || !secret) return out;
  const token = await serviceToken(secret);
  if (!token) return out;
  try {
    const res = await centralFetch(`${CENTRAL}/v1/apps/${APP_ID}/members/lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ member_ids: need, fields: ["legal_name"], use: "display" }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) svc.forget();
    if (!res.ok) return out;
    const b = (await res.json().catch(() => null)) as { members?: unknown[] } | null;
    for (const raw of b?.members ?? []) {
      const m = raw as { member_id?: unknown; id?: unknown; fields?: Record<string, unknown>; legal_name?: unknown };
      const id = typeof m.member_id === "string" ? m.member_id : typeof m.id === "string" ? m.id : "";
      const v = m.fields?.legal_name ?? m.legal_name;
      const name = typeof v === "string" ? v.trim().slice(0, 50) : "";
      if (!id) continue;
      memo.set(`lgl:${id}`, { value: name, until: Date.now() + 600_000 });
      if (name) out.set(id, name);
    }
  } catch {
    /* 讀不到就只顯示暱稱 */
  }
  return out;
}

/**
 * 會員所屬教育中心（杜杜龍 2026-11-26，食譜「更換上傳者」時自動帶入新上傳者的中心）：用服務 Token 呼叫 members/lookup 讀 education_center（use＝display）；
 * 只放記憶體快取 10 分鐘。**需要杜杜龍在中央「平台設定」替這款 App 勾選 education_center**，沒勾（403）、失敗、逾時一律回空，呼叫端就不填中心。
 */
export async function lookupCenterLabels(secret: string | undefined, subs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(subs)].slice(0, 100);
  const need: string[] = [];
  for (const id of ids) {
    const hit = memo.get(`ctr:${id}`);
    if (hit && hit.until > Date.now()) {
      if (hit.value) out.set(id, hit.value as string);
    } else need.push(id);
  }
  if (!need.length || !secret) return out;
  const token = await serviceToken(secret);
  if (!token) return out;
  try {
    const res = await centralFetch(`${CENTRAL}/v1/apps/${APP_ID}/members/lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ member_ids: need, fields: ["education_center"], use: "display" }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) svc.forget();
    if (!res.ok) return out;
    const b = (await res.json().catch(() => null)) as { members?: unknown[] } | null;
    for (const raw of b?.members ?? []) {
      const m = raw as { member_id?: unknown; id?: unknown; fields?: Record<string, unknown> };
      const id = typeof m.member_id === "string" ? m.member_id : typeof m.id === "string" ? m.id : "";
      const v = m.fields?.education_center;
      const label = typeof v === "string" ? v : v && typeof v === "object" ? ([(v as Record<string, unknown>).label, (v as Record<string, unknown>).name, (v as Record<string, unknown>).value].find((x) => typeof x === "string" && x) as string | undefined) ?? "" : "";
      if (!id) continue;
      memo.set(`ctr:${id}`, { value: label.trim().slice(0, 60), until: Date.now() + 600_000 });
      if (label.trim()) out.set(id, label.trim().slice(0, 60));
    }
  } catch {
    /* 讀不到就不填中心 */
  }
  return out;
}

/**
 * 清單分享者名片的獎銜與獎章圖（杜杜龍 2026-11-21；Amway 資料，**不寫資料庫、不寫日誌**，只放記憶體短暫快取 10 分鐘）：
 * 串接指令 2026-11-22.1：用服務 Token 呼叫 `POST /v1/apps/learn/members/lookup`（fields＝rank，use＝display），
 * 中央直接回 `rank_label`（獎銜中文名稱）與 `rank_badge`（`badge_url`＋`badge:{width,height,art_top,art_bottom}`）；
 * 服務 Token 讀不了 field-definitions，所以不再自己對照。沒開 Amway 或獎銜未審核＝全是 null，只顯示頭像與姓名。
 * 失敗、403（平台設定沒勾 rank）、422、429、逾時一律回 null，不快取失敗；失敗原因只記狀態碼與錯誤代碼。
 */
export type SharerRank = { rankLabel: string; rankBadge: string | null; rankBadgeArt: { width: number; height: number; top: number; bottom: number } | null };
export let lastSharerError = "";
export function parseSharerRank(m: { rank_label?: unknown; rank_badge?: unknown; fields?: Record<string, unknown> }): SharerRank | null {
  const label = typeof m.rank_label === "string" ? m.rank_label.trim() : typeof m.fields?.rank_label === "string" ? (m.fields.rank_label as string).trim() : "";
  if (!label) return null;
  const rb = (m.rank_badge ?? m.fields?.rank_badge) as { badge_url?: unknown; badge?: { width?: unknown; height?: unknown; art_top?: unknown; art_bottom?: unknown } | null } | null | undefined;
  const b = rb?.badge;
  const ok = typeof rb?.badge_url === "string" && /^https:\/\//.test(rb.badge_url) && !!b && [b.width, b.height, b.art_top, b.art_bottom].every((n) => typeof n === "number" && Number.isFinite(n)) && (b.height as number) > 0;
  return { rankLabel: label.slice(0, 30), rankBadge: ok ? (rb!.badge_url as string) : null, rankBadgeArt: ok ? { width: b!.width as number, height: b!.height as number, top: b!.art_top as number, bottom: b!.art_bottom as number } : null };
}
export async function lookupSharerRank(secret: string | undefined, sub: string): Promise<SharerRank | null> {
  const hit = memo.get(`shr:${sub}`);
  if (hit && hit.until > Date.now()) return hit.value as SharerRank | null;
  lastSharerError = "";
  if (!secret) {
    lastSharerError = "沒有設定中央服務金鑰（CENTRAL_SERVICE_SECRET）";
    return null;
  }
  const token = await serviceToken(secret);
  if (!token) {
    lastSharerError = "向中央取得服務 Token 失敗";
    return null;
  }
  const t0 = Date.now();
  try {
    const res = await centralFetch(`${CENTRAL}/v1/apps/${APP_ID}/members/lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ member_ids: [sub], fields: ["rank"], use: "display" }),
      signal: AbortSignal.timeout(6000),
    });
    logCall(token, "/v1/apps/learn/members/lookup", Date.now() - t0);
    if (res.status === 401) svc.forget();
    if (!res.ok) {
      const eb = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
      lastSharerError = `中央回應 ${res.status}${typeof eb?.error?.code === "string" ? `（${eb.error.code.slice(0, 40).replace(/[^\w.-]/g, "")}）` : ""}`;
      return null;
    }
    const b = (await res.json().catch(() => null)) as { members?: { member_id?: unknown; id?: unknown; fields?: Record<string, unknown>; rank_label?: unknown; rank_badge?: unknown }[] } | null;
    const m = (b?.members ?? []).find((x) => x.member_id === sub || x.id === sub);
    if (!m) {
      lastSharerError = "中央沒有回傳這位會員（沒在這款 App 登入過，或格式不是預期的）";
      return null;
    }
    const out = parseSharerRank(m);
    memo.set(`shr:${sub}`, { value: out, until: Date.now() + 600_000 });
    return out;
  } catch {
    lastSharerError = "連線逾時或失敗";
    return null;
  }
}
