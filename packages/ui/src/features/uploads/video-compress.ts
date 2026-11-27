// App（iOS／Android）版：影片壓縮與上傳先只有網頁版（杜杜龍 2026-11-21）。
export type VideoSpec = { maxHeight: number; kbps: number; fps: number; maxMb: number; maxSec: number };
export type VideoResult = { blob: Blob; width: number; height: number; durationSec: number; poster: Blob | null; type: string };
export const videoCompressSupported = (): boolean => false;
export async function probeVideo(_file: File): Promise<{ durationSec: number; width: number; height: number }> {
  throw Error("請用網頁版上傳影片");
}
export async function compressVideo(_file: File, _spec: VideoSpec, _onProgress: (pct: number) => void): Promise<VideoResult> {
  throw Error("請用網頁版上傳影片");
}
