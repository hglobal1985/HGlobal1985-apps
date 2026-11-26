/** 呼叫自己的後端（/api/…）。自動帶 Access Token；401 先換發再試一次。 */
import { Platform } from "react-native";
import { accessToken, refresh } from "@/central/auth";
import { WEB_ORIGIN } from "@/central/config";

/** 共用元件（讀取失敗畫面）用到的訊息。 */
export const UPGRADING_MSG = "系統升級中，請稍後再試";

export const API_BASE = Platform.OS === "web" ? "" : WEB_ORIGIN;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function send(path: string, init: RequestInit, retry = true): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, "請先登入");
  let res: Response;
  try {
    res = await fetch(API_BASE + "/api" + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, "網路不穩，請稍後再試");
  }
  if (res.status === 401 && retry && (await refresh())) return send(path, init, false);
  if (!res.ok) {
    const e = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.message ?? "系統忙碌，請稍後再試");
  }
  return res;
}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await send(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
}

/** 上傳檔案（回報進度 0～1）。網頁用 XMLHttpRequest 才拿得到進度。 */
export async function upload<T>(path: string, data: Blob, onProgress?: (p: number) => void): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, "請先登入");
  if (typeof XMLHttpRequest === "undefined" || Platform.OS !== "web") {
    const res = await send(path, { method: "POST", body: data, headers: { "content-type": data.type || "application/octet-stream" } });
    onProgress?.(1);
    return (await res.json()) as T;
  }
  return new Promise<T>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", API_BASE + "/api" + path);
    x.setRequestHeader("authorization", `Bearer ${token}`);
    x.setRequestHeader("content-type", data.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onerror = () => reject(new ApiError(0, "網路不穩，上傳失敗，請再試一次"));
    x.onload = () => {
      let b: unknown = null;
      try {
        b = JSON.parse(x.responseText);
      } catch {
        /* 不是 JSON */
      }
      if (x.status >= 200 && x.status < 300) resolve(b as T);
      else reject(new ApiError(x.status, (b as { error?: { message?: string } } | null)?.error?.message ?? "上傳失敗，請再試一次"));
    };
    x.send(data);
  });
}

/** 打開作業檔案（先拿 10 分鐘有效的下載憑證）。 */
export async function openFile(fileId: string): Promise<void> {
  const { url } = await api<{ url: string }>(`/files/${fileId}/ticket`, "POST");
  const full = (Platform.OS === "web" ? "" : WEB_ORIGIN) + url;
  if (Platform.OS === "web") window.open(full, "_blank", "noopener");
  else {
    const { openBrowserAsync } = await import("expo-web-browser");
    await openBrowserAsync(full);
  }
}
