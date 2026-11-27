/** 最小的 D1／R2 型別（只用到的部分；測試用 node:sqlite 與記憶體模擬）。 */
export type D1Result<T = unknown> = { results: T[]; meta?: { changes?: number } };
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export type R2Object = { size: number; httpMetadata?: { contentType?: string }; body?: ReadableStream | null; range?: { offset: number; length?: number } };
export interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string, opts?: { range?: { offset: number; length?: number } | { suffix: number } }): Promise<(R2Object & { body: ReadableStream }) | null>;
  head(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
}
export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** 只在本機測試開啟（wrangler.local.jsonc）：允許「dev:會員代號」當作登入憑證。正式環境一律 off。 */
  DEV_LOGIN?: string;
  /** 與行動大學共用的設定（Cloudflare KV「hg-shared-settings」：上傳壓縮畫質）。 */
  SHARED?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  /** 手機推播的 VAPID 私鑰（JWK 的 JSON 文字；杜杜龍在 Cloudflare 後台設定的 Secret）。沒設定就不推播，站內通知照常。 */
  VAPID_PRIVATE_JWK?: string;
  /** 中央 webhook 簽章金鑰（業主在 Cloudflare 後台設定的 Secret）。 */
  CENTRAL_WEBHOOK_SECRET?: string;
  /** 中央服務金鑰（Secret；查聯絡信箱寄 Email 用，杜杜龍在中央後台建立、Cloudflare 後台設定）。沒設定就不寄 Email。 */
  CENTRAL_SERVICE_SECRET?: string;
  /** Cloudflare Email Service 的寄信綁定（send_email）。沒綁定就不寄 Email。 */
  EMAIL?: { send(msg: { from: { email: string; name: string }; to: string; subject: string; text: string; html: string }): Promise<unknown> };
  EMAIL_FROM?: string;
};
