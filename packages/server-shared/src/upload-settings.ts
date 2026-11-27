/**
 * 兩個 App 共用的「上傳壓縮設定」（杜杜龍 2026-11-26：行動大學與繳作業系統的照片、影片畫質要一樣，任一邊改，另一邊自動跟上）。
 * 正本存在 Cloudflare KV「hg-shared-settings」（兩個 Worker 都綁成 SHARED），鍵＝upload。
 * 行動大學：設定頁照舊（「儲存空間管理 › 上傳設定」），存檔時同步寫進這裡；讀取時以這裡為準。
 * 繳作業系統：「我的 › 上傳設定」（超級管理員）讀寫同一份。
 * 只放壓縮畫質；各 App 自己的大小與長度上限（例如作業短影片 3 分鐘、80MB）不在這裡。
 */
export type SharedUploadSettings = {
  /** 一般圖片（封面、教材圖片、作業照片）：長邊像素、畫質 %。 */
  imageMaxSide: number;
  imageQuality: number;
  /** 中心首頁圖：長邊、畫質。 */
  centerMaxSide: number;
  centerQuality: number;
  /** EDM 海報原圖：長邊、畫質。 */
  edmMaxSide: number;
  edmQuality: number;
  /** 影片在上傳者瀏覽器內壓縮的規格：高度、位元率、每秒格數。 */
  videoMaxHeight: 480 | 720 | 1080;
  videoKbps: number;
  videoFps: number;
  /** 圖片存進雲端的格式。 */
  storeFormat: "jpeg" | "webp" | "avif";
};

export const DEFAULT_SHARED_UPLOAD: SharedUploadSettings = {
  imageMaxSide: 1024,
  imageQuality: 88,
  centerMaxSide: 2048,
  centerQuality: 95,
  edmMaxSide: 2048,
  edmQuality: 90,
  videoMaxHeight: 720,
  videoKbps: 2500,
  videoFps: 30,
  storeFormat: "jpeg",
};

export const SHARED_UPLOAD_KEYS = Object.keys(DEFAULT_SHARED_UPLOAD) as (keyof SharedUploadSettings)[];

const num = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);
const pick = <T extends string | number>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function normalizeSharedUpload(r: Partial<Record<string, unknown>>, d: SharedUploadSettings = DEFAULT_SHARED_UPLOAD): SharedUploadSettings {
  return {
    imageMaxSide: num(r.imageMaxSide, d.imageMaxSide, 400, 4096),
    imageQuality: num(r.imageQuality, d.imageQuality, 30, 100),
    centerMaxSide: num(r.centerMaxSide, d.centerMaxSide, 800, 4096),
    centerQuality: num(r.centerQuality, d.centerQuality, 30, 100),
    edmMaxSide: num(r.edmMaxSide, d.edmMaxSide, 800, 4096),
    edmQuality: num(r.edmQuality, d.edmQuality, 30, 100),
    videoMaxHeight: pick(r.videoMaxHeight, [480, 720, 1080] as const, d.videoMaxHeight),
    videoKbps: num(r.videoKbps, d.videoKbps, 500, 8000),
    videoFps: num(r.videoFps, d.videoFps, 15, 60),
    storeFormat: pick(r.storeFormat, ["jpeg", "webp", "avif"] as const, d.storeFormat),
  };
}

/** Cloudflare KV 只用到的部分。 */
export type SharedKv = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };

const KEY = "upload";
let memo: { v: SharedUploadSettings | null; at: number } | null = null;

/** 讀共用設定（記憶體快取 30 秒）。KV 沒有或讀不到回 null（呼叫的人用自己的值）。 */
export async function readSharedUpload(kv: SharedKv | undefined): Promise<SharedUploadSettings | null> {
  if (!kv) return null;
  if (memo && Date.now() - memo.at < 30_000) return memo.v;
  try {
    const raw = await kv.get(KEY);
    const v = raw ? normalizeSharedUpload(JSON.parse(raw) as Record<string, unknown>) : null;
    memo = { v, at: Date.now() };
    return v;
  } catch {
    return memo?.v ?? null;
  }
}

/** 寫共用設定（只寫壓縮相關欄位）。 */
export async function writeSharedUpload(kv: SharedKv | undefined, next: Partial<Record<string, unknown>>): Promise<SharedUploadSettings | null> {
  if (!kv) return null;
  const cur = (await readSharedUpload(kv)) ?? DEFAULT_SHARED_UPLOAD;
  const v = normalizeSharedUpload({ ...cur, ...next });
  await kv.put(KEY, JSON.stringify(v));
  memo = { v, at: Date.now() };
  return v;
}

/** 測試用：清掉記憶體快取。 */
export const resetSharedUploadMemo = () => void (memo = null);
