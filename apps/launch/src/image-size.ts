/**
 * 從圖片檔頭讀寬高（JPEG／PNG／WebP；不解碼整張圖）。讀不出來回 null。
 * 用途：把課程 EDM 併進中心 EDM 空間時，舊的圖沒有記寬高，封面輪播需要寬高判斷橫式／直式（杜杜龍 2026-11-23）。
 */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  // PNG：IHDR 在 16 位元組開始
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const w = ((b[16]! << 24) | (b[17]! << 16) | (b[18]! << 8) | b[19]!) >>> 0;
    const h = ((b[20]! << 24) | (b[21]! << 16) | (b[22]! << 8) | b[23]!) >>> 0;
    return w && h ? { width: w, height: h } : null;
  }
  // JPEG：找 SOF0～SOF15（不含 DHT／JPG／DAC）
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1]!;
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[i + 5]! << 8) | b[i + 6]!;
        const w = (b[i + 7]! << 8) | b[i + 8]!;
        return w && h ? { width: w, height: h } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP：RIFF....WEBP + VP8 / VP8L / VP8X
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === "VP8X") {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return { width: w, height: h };
    }
    if (kind === "VP8 ") {
      const w = (b[26]! | (b[27]! << 8)) & 0x3fff;
      const h = (b[28]! | (b[29]! << 8)) & 0x3fff;
      return w && h ? { width: w, height: h } : null;
    }
    if (kind === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  return null;
}
