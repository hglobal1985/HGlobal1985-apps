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
  /** 中央 webhook 簽章金鑰（業主在 Cloudflare 後台設定的 Secret）。 */
  CENTRAL_WEBHOOK_SECRET?: string;
};
