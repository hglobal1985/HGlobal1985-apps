/**
 * 短影音壓縮（網頁版，業主 2026-11-21）：在上傳者自己的瀏覽器內重新錄製成較小的影片再上傳，不需要付費的影片服務。
 * 做法：把影片放進看不見的播放器，畫面逐格畫到畫布、聲音接到錄音節點（不出聲），用 MediaRecorder 依設定的解析度與位元率錄成新檔。
 * 所以壓縮時間約等於影片長度（1 分鐘的影片要 1 分鐘）；規範（最高解析度、畫質、影格數、大小上限、最長秒數）在「設定 › 儲存空間管理 › 封面輪播與短影音」。
 */
export type VideoSpec = { maxHeight: number; kbps: number; fps: number; maxMb: number; maxSec: number };
export type VideoResult = { blob: Blob; width: number; height: number; durationSec: number; poster: Blob | null; type: string };

export const videoCompressSupported = (): boolean => typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";

const MIMES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const pickMime = () => MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(Error("無法讀取這支影片，請改用 MP4 或 MOV 格式"));
    v.src = url;
  });
}

/** 只讀影片長度與尺寸（上傳前先檢查有沒有超過最長秒數）。 */
export async function probeVideo(file: File): Promise<{ durationSec: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    return { durationSec: v.duration, width: v.videoWidth, height: v.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function posterOf(v: HTMLVideoElement): Promise<Blob | null> {
  try {
    v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    await new Promise<void>((r) => {
      v.onseeked = () => r();
      setTimeout(r, 1500);
    });
    const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(v.videoWidth * s));
    c.height = Math.max(2, Math.round(v.videoHeight * s));
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((r) => c.toBlob((b) => r(b), "image/jpeg", 0.8));
  } catch {
    return null;
  }
}

export async function compressVideo(file: File, spec: VideoSpec, onProgress: (pct: number) => void): Promise<VideoResult> {
  if (!videoCompressSupported()) throw Error("這個瀏覽器不支援影片壓縮，請改用電腦版或手機的 Chrome 瀏覽器");
  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    if (!Number.isFinite(v.duration) || v.duration <= 0) throw Error("讀不到影片長度，請換一支影片");
    if (v.duration > spec.maxSec + 0.5) throw Error(`影片太長（${Math.round(v.duration)} 秒），上限 ${spec.maxSec} 秒`);
    const poster = await posterOf(v);
    v.currentTime = 0;
    // 以「短邊」對照解析度設定（720 ＝ 1280×720 或 720×1280）；長寬取偶數。
    const s = Math.min(1, spec.maxHeight / Math.min(v.videoWidth, v.videoHeight));
    const W = Math.max(2, Math.round((v.videoWidth * s) / 2) * 2);
    const H = Math.max(2, Math.round((v.videoHeight * s) / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(spec.fps);
    // 聲音：接到錄音節點，不接喇叭，所以壓縮時不會出聲。
    let ac: AudioContext | null = null;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        ac = new AC();
        const dest = ac.createMediaStreamDestination();
        ac.createMediaElementSource(v).connect(dest);
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      }
    } catch {
      ac = null; // 沒有聲音軌也能繼續（變成無聲影片）
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: spec.kbps * 1000, audioBitsPerSecond: 96_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((resolve, reject) => {
      rec.onstop = () => resolve();
      rec.onerror = () => reject(Error("影片壓縮失敗，請換一支影片或改用其他瀏覽器"));
    });
    let stop = false;
    const draw = () => {
      if (stop) return;
      ctx.drawImage(v, 0, 0, W, H);
      onProgress(Math.min(99, Math.round((v.currentTime / v.duration) * 100)));
      const anyV = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (anyV.requestVideoFrameCallback) anyV.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    const ended = new Promise<void>((resolve) => {
      v.onended = () => resolve();
      setTimeout(resolve, (v.duration + 10) * 1000); // 保險：最多多等 10 秒
    });
    rec.start(1000);
    await ac?.resume().catch(() => undefined);
    await v.play().catch(() => {
      throw Error("瀏覽器不允許自動播放影片，請再按一次上傳");
    });
    draw();
    await ended;
    stop = true;
    v.pause();
    if (rec.state !== "inactive") rec.stop();
    await done;
    await ac?.close().catch(() => undefined);
    onProgress(100);
    const type = (rec.mimeType || mime || "video/webm").split(";")[0]!;
    const blob = new Blob(chunks, { type });
    if (blob.size > spec.maxMb * 1024 * 1024) throw Error(`壓縮後仍有 ${(blob.size / 1048576).toFixed(1)}MB，超過上限 ${spec.maxMb}MB，請剪短影片，或請管理員到設定調低畫質`);
    return { blob, width: W, height: H, durationSec: Math.round(v.duration), poster, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}
