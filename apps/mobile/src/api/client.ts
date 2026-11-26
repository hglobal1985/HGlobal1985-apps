import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { UPGRADING_MSG, type ApiError } from "../../../launch/src/contract";
export { classifyLink, parseHttpsUrl } from "../../../launch/src/links";
export { THUMB_BADGE_COLORS, THUMB_BADGE_KINDS, LIST_COVER_COLORS, SERIES_APPLY_GROUPS, THUMB_WIDTH_CHOICES, ZONES, VIEW_SCOPES, VIEW_SCOPE_LABEL, PAYMENT_METHODS, KEYWORD_INFO, ACHIEVEMENT_TYPES, ACHIEVEMENT_CATEGORIES, ACH_VERBS, ACH_TIMES, ACH_UNITS, ACH_ICON_POOL, achTypeOf, achRecipeOf, achDefaultIcon, isImageIcon, textCoverLines, UNCATEGORIZED, FEATURES, NOTICE_KINDS, applicantLabel, reviewerInviteMessage, REVIEW_ROLES, REVIEW_ROLE_LABEL, DEFAULT_APP_SETTINGS, DEFAULT_SHARE_SETTINGS, DEFAULT_UI_CONFIG, shareMessage, DUTY_LABELS, HQ_UNIT, REVIEW_REASONS, RIBBON_INFO, RIBBON_KEYS, RIBBON_PALETTE, SORT_GROUP_INFO, SORT_GROUPS, STATS_ROLE_OPTIONS, HW_KINDS, HW_GRADINGS, HW_VIDEO, HW_LIMITS } from "../../../launch/src/contract";
import { centralToken, refresh as refreshCentral } from "./central";

export type {
  HwKind,
  HwGrading,
  HwStatus,
  HwResult,
  HwAssignment,
  HwRole,
  HwCourseView,
  HwFile,
  HwComment,
  HwSubmission,
  HwRosterRow,
  HwAssignmentView,
  HwGroupMember,
  HwGroupsView,
  MyHomeworkItem,
  MyHomework,
  MuxStats,
  RibbonColor,
  RibbonKey,
  SortGroup,
  StatBlock,
  ThumbSettings,
  UiConfig,
  Achievement,
  AchievementType,
  AchTime,
  AchievementCategory,
  AdminAchievement,
  Announcement,
  AppConfig,
  Attachment,
  ClientPlatform,
  CourseComment,
  KeywordItem,
  PaymentMethodKey,
  PaymentReport,
  KeywordKind,
  KeywordLists,
  CourseDeleteImpact,
  CourseDetail,
  CourseCan,
  CourseEditor,
  CourseRights,
  CenterArt,
  ThumbBadge,
  ThumbBadgeKind,
  ThumbBadgeRow,
  SeriesArt,
  SeriesSetting,
  EditorCandidate,
  Duty,
  OrderEvent,
  ReviewAction,
  ReviewGroup,
  ReviewDesk,
  RegistrationReport,
  ReportBy,
  ReportRow,
  ReviewRole,
  ReviewReason,
  CourseSummary,
  InviteInfo,
  SeriesApplyPlan,
  SeriesApplyResult,
  SeriesRosterPlan,
  Roster,
  RosterRow,
  Lesson,
  MediaType,
  Member,
  MuxAsset,
  MuxAssetPage,
  Notice,
  NoticeCategory,
  CentralReview,
  CentralReviews,
  StaffMember,
  CoverMediaItem,
  AlbumFolder,
  AlbumGroup,
  AlbumsResponse,
  AlbumInfo,
  AlbumSubfolder,
  AlbumSubfolders,
  AlbumPermissions,
  CoverMediaKind,
  CoverScope,
  StaffRole,
  StaffSearch,
  LibraryItem,
  LibraryMine,
  BrandCover,
  BrandLogo,
  LibraryView,
  LibraryUnlock,
  NotificationSettings,
  Order,
  OrderStatus,
  Playback,
  Rank,
  ViewScope,
  Zone,
} from "../../../launch/src/contract";

/** Web 與網站同網域；App 連正式網域。開發時可用 EXPO_PUBLIC_API_BASE 指向本機 Worker。 */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? (Platform.OS === "web" ? "" : "https://learn.hglobal1985.com");
/** 模擬會員（內部測試）的 token；中央會員的 token 由 central.ts 管理。 */
const TOKEN_KEY = "hglobal:learn:session-token";

let token: string | null = null;

/** 把 API 回傳的相對路徑（例如 /media/x.mp4）轉成完整網址；Web 版維持同網域相對路徑。 */
export function resolveUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE}${url}`;
}

let tokenInit: Promise<unknown> | null = null;
export async function loadToken(): Promise<string | null> {
  token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  return token;
}
export async function saveToken(value: string | null): Promise<void> {
  token = value;
  clearApiCache();
  if (value) await AsyncStorage.setItem(TOKEN_KEY, value).catch(() => undefined);
  else await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}

export class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 上傳檔案並回報進度 0～100（網頁版用 XMLHttpRequest，fetch 拿不到上傳進度）。 */
/** 伺服器暫時回不出正常結果（部署更新、系統忙碌…）時，全站統一顯示的白話提示（杜杜龍 2026-11-18；文字 2026-11-24 改，定義在 contract.ts 與後端共用）。 */
export { UPGRADING_MSG };

export async function apiUpload<T>(method: "POST" | "PUT", path: string, body: Blob, onProgress: (pct: number) => void, retried = false): Promise<T> {
  await (tokenInit ??= loadToken());
  const central = token ? null : await centralToken();
  const bearer = token ?? central;
  const done = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE}/api/v2${path}`);
    xhr.setRequestHeader("x-client-platform", "web");
    xhr.setRequestHeader("content-type", "application/octet-stream");
    if (bearer) xhr.setRequestHeader("authorization", `Bearer ${bearer}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && e.total > 0 && onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    xhr.onerror = () => reject(new RequestError(0, "network", "網路連線不穩定，請稍後再試"));
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.send(body);
  });
  if (done.status === 401 && central && !retried && (await refreshCentral())) return apiUpload<T>(method, path, body, onProgress, true);
  let data: (T & ApiError) | null = null;
  try {
    data = JSON.parse(done.text) as T & ApiError;
  } catch {
    data = null;
  }
  if (done.status < 200 || done.status >= 300) throw new RequestError(done.status, data?.error?.code ?? "http_error", data?.error?.message ?? UPGRADING_MSG);
  return data as T;
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, retried = false): Promise<T> {
  const raw = typeof Blob !== "undefined" && body instanceof Blob;
  const headers: Record<string, string> = { "x-client-platform": Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web" };
  await (tokenInit ??= loadToken()); // 第一個請求前先讀好測試登入憑證（開機預先抓資料時才不會漏帶）
  const central = token ? null : await centralToken();
  const bearer = token ?? central;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = raw ? "application/octet-stream" : "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v2${path}`, { method, headers, body: body === undefined ? undefined : raw ? (body as Blob) : JSON.stringify(body) });
  } catch {
    throw new RequestError(0, "network", "網路連線不穩定，請稍後再試");
  }
  // 中央 Access Token 過期：換發一次後重試。
  if (res.status === 401 && central && !retried && (await refreshCentral())) return api<T>(method, path, body, true);
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new RequestError(res.status, err?.code ?? "http_error", err?.message ?? UPGRADING_MSG);
  }
  return data as T;
}

/**
 * 讀取資料的記憶體快取（杜杜龍 2026-11-17：載入變慢）：
 * ① 同一時間同樣的 GET 只送一次（好幾個元件同時要同一份資料）；
 * ② 看過的資料先顯示、背景再更新（回到頁面不再從空白等起）；
 * ③ 登入／登出、換帳號時整份清掉，不會看到上一位的資料。
 */
const GET_CACHE = new Map<string, { data: unknown; at: number }>();
const GET_INFLIGHT = new Map<string, { p: Promise<unknown>; at: number }>();
export const peekCache = <T>(path: string): T | undefined => GET_CACHE.get(path)?.data as T | undefined;
export function clearApiCache() {
  GET_CACHE.clear();
  GET_INFLIGHT.clear();
}
/** 讀取並寫入快取；300 毫秒內同一路徑已在請求中就共用同一個請求（資料異動後的重新抓取不會用到舊的請求）。 */
export function cachedGet<T>(path: string, maxAgeMs = 0): Promise<T> {
  const hit = GET_CACHE.get(path);
  if (maxAgeMs && hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.data as T);
  const run = GET_INFLIGHT.get(path);
  // 一般開頁面（maxAgeMs>0）：開機預先抓的請求還在跑就共用它（以前只共用 300 毫秒內的，頁面程式晚一點載入就會重抓一次，2026-11-21）；
  // 重新整理、資料異動後（maxAgeMs=0）只共用 300 毫秒內剛送出的，避免拿到異動前的舊資料。
  if (run && Date.now() - run.at < (maxAgeMs || 300)) return run.p as Promise<T>;
  const p = api<T>("GET", path).then((d) => {
    GET_CACHE.set(path, { data: d, at: Date.now() });
    if (GET_CACHE.size > 200) GET_CACHE.delete(GET_CACHE.keys().next().value!);
    return d;
  });
  const entry = { p, at: Date.now() };
  GET_INFLIGHT.set(path, entry);
  const done = () => GET_INFLIGHT.get(path) === entry && GET_INFLIGHT.delete(path);
  p.then(done, done);
  return p;
}
/** 開啟網站時先把首頁、寰宇大學會用到的公開資料抓起來（跟登入檢查同時進行，不必等登入完成才開始）。 */
export function prefetchCommon(pathname: string) {
  if (/^\/(course|admin|library|auth|learn|series|orders|settings)(\/|$)/.test(pathname)) return;
  for (const p of ["/courses", "/center-art", "/series-art", "/centers"]) cachedGet(p).catch(() => undefined);
}

/** 取得需要登入的圖片（例如 Mux 影片截圖）：回傳 Blob。只在 Web 使用。 */
export async function apiBlob(path: string): Promise<Blob> {
  const bearer = token ?? (await centralToken());
  const res = await fetch(`${API_BASE}/api/v2${path}`, { headers: { "x-client-platform": "web", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
  if (!res.ok) throw new RequestError(res.status, "blob", "取得影片截圖失敗，請稍後再試");
  return res.blob();
}

/** 下載需要登入的檔案（例如 CSV 報表）；只在 Web 使用。 */
export async function download(path: string, fileName: string): Promise<void> {
  const bearer = token ?? (await centralToken());
  const res = await fetch(`${API_BASE}/api/v2${path}`, { headers: { "x-client-platform": "web", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
  if (!res.ok) throw new RequestError(res.status, "download", "下載失敗，請稍後再試");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
