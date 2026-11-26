/**
 * 選檔與上傳：照片（網頁先壓到長邊 2000）、短影片（3 分鐘內；iPhone 匯出時壓成 720p）、檔案（PDF、Office、文字檔）。
 */
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { LIMITS, type Kind } from "../../../api/src/contract";

export type Picked = { blob: Blob; name: string; kind: Kind; durationSec?: number };

async function toBlob(uri: string): Promise<Blob> {
  return await (await fetch(uri)).blob();
}

async function compressWebImage(blob: Blob, maxSide = 2000, quality = 0.85): Promise<Blob> {
  if (Platform.OS !== "web" || !/^image\/(jpeg|png|webp)/.test(blob.type)) return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 3 * 1048576) return blob;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? blob), "image/jpeg", quality));
  } catch {
    return blob;
  }
}

function webVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    if (Platform.OS !== "web") return resolve(0);
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(blob);
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
    };
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

export async function pickPhotos(max: number): Promise<Picked[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: max, quality: 0.85 });
  if (r.canceled) return [];
  const out: Picked[] = [];
  for (const a of r.assets.slice(0, max)) {
    let blob = await toBlob(a.uri);
    blob = await compressWebImage(blob);
    const name = (a.fileName ?? `照片.jpg`).replace(/\.(png|webp|heic|heif)$/i, Platform.OS === "web" ? ".jpg" : ".$1");
    out.push({ blob, name, kind: "photo" });
  }
  return out;
}

export async function takePhoto(): Promise<Picked[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("請到手機設定允許使用相機");
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
  if (r.canceled) return [];
  return [{ blob: await toBlob(r.assets[0].uri), name: r.assets[0].fileName ?? "照片.jpg", kind: "photo" }];
}

export async function pickVideo(): Promise<Picked[]> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    videoMaxDuration: LIMITS.videoSeconds,
    videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (r.canceled) return [];
  const a = r.assets[0];
  const blob = await toBlob(a.uri);
  const dur = a.duration ? a.duration / 1000 : await webVideoDuration(blob);
  if (dur > LIMITS.videoSeconds + 1) throw new Error("短影片要在 3 分鐘內，請先剪短再上傳");
  if (blob.size > LIMITS.videoMB * 1048576) throw new Error(`影片太大（最大 ${LIMITS.videoMB}MB），請剪短或用較低畫質重錄`);
  return [{ blob, name: a.fileName ?? "影片.mp4", kind: "video", durationSec: Math.round(dur) }];
}

export async function pickFiles(max: number): Promise<Picked[]> {
  const r = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ],
  });
  if (r.canceled) return [];
  const out: Picked[] = [];
  for (const a of r.assets.slice(0, max)) {
    const blob = a.file ?? (await toBlob(a.uri));
    if (blob.size > LIMITS.fileMB * 1048576) throw new Error(`「${a.name}」超過 ${LIMITS.fileMB}MB`);
    out.push({ blob, name: a.name, kind: "file" });
  }
  return out;
}
