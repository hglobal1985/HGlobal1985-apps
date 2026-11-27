/**
 * 邊讀邊打包的 ZIP 壓縮檔（不壓縮、只打包；伺服器共用模組，杜杜龍 2026-11-27：作業「一鍵下載備份」）。
 * - 檔案內容一邊從儲存空間讀、一邊送給使用者，不用先存一份暫存檔，記憶體只用到一小塊。
 * - 檔名用 UTF-8（中文檔名在 Windows、Mac、手機解壓縮都正常）。
 * - 每個壓縮檔總大小請控制在 4GB 以內（呼叫端負責分包；這裡不做 ZIP64）。
 */
export type ZipEntry = {
  /** 壓縮檔裡的路徑（用 / 分資料夾）。 */
  name: string;
  /** 取得檔案內容：串流或一段位元組；拿不到（檔案已刪除）回 null，就跳過這個檔案。 */
  open: () => Promise<ReadableStream<Uint8Array> | Uint8Array | null>;
  date?: Date;
};

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
export function crc32Update(crc: number, buf: Uint8Array): number {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const te = new TextEncoder();
function dosTime(d: Date): { time: number; date: number } {
  // 用台灣時間（UTC+8）記錄檔案時間
  const t = new Date(d.getTime() + 8 * 3600_000);
  return {
    time: (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | Math.floor(t.getUTCSeconds() / 2),
    date: (Math.max(0, t.getUTCFullYear() - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
  };
}
function header(size: number, fill: (v: DataView) => void): Uint8Array {
  const b = new Uint8Array(size);
  fill(new DataView(b.buffer));
  return b;
}

/** 產生 ZIP 串流。 */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const FLAGS = 0x0808; // bit 3：大小與 CRC 寫在檔案後面；bit 11：檔名是 UTF-8
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  let i = 0;
  let current: { reader: ReadableStreamDefaultReader<Uint8Array> | null; bytes: Uint8Array | null; crc: number; size: number; name: Uint8Array; time: number; date: number; start: number } | null = null;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        if (current) {
          let chunk: Uint8Array | undefined;
          if (current.bytes) {
            chunk = current.bytes;
            current.bytes = null;
          } else if (current.reader) {
            const r = await current.reader.read();
            chunk = r.done ? undefined : r.value;
          }
          if (chunk && chunk.length) {
            current.crc = crc32Update(current.crc, chunk);
            current.size += chunk.length;
            offset += chunk.length;
            ctrl.enqueue(chunk);
            return;
          }
          // 這個檔案結束：寫上 CRC 與大小，並記下中央目錄
          const c = current;
          const desc = header(16, (v) => {
            v.setUint32(0, 0x08074b50, true);
            v.setUint32(4, c.crc, true);
            v.setUint32(8, c.size, true);
            v.setUint32(12, c.size, true);
          });
          central.push(
            header(46 + c.name.length, (v) => {
              v.setUint32(0, 0x02014b50, true);
              v.setUint16(4, 20, true);
              v.setUint16(6, 20, true);
              v.setUint16(8, FLAGS, true);
              v.setUint16(10, 0, true);
              v.setUint16(12, c.time, true);
              v.setUint16(14, c.date, true);
              v.setUint32(16, c.crc, true);
              v.setUint32(20, c.size, true);
              v.setUint32(24, c.size, true);
              v.setUint16(28, c.name.length, true);
              v.setUint32(42, c.start, true);
              new Uint8Array(v.buffer).set(c.name, 46);
            }),
          );
          count++;
          offset += desc.length;
          current = null;
          ctrl.enqueue(desc);
          return;
        }
        if (i < entries.length) {
          const e = entries[i++]!;
          const src = await e.open().catch(() => null);
          if (!src) continue; // 檔案已不存在：跳過
          const name = te.encode(e.name);
          const { time, date } = dosTime(e.date ?? new Date());
          const start = offset;
          const local = header(30 + name.length, (v) => {
            v.setUint32(0, 0x04034b50, true);
            v.setUint16(4, 20, true);
            v.setUint16(6, FLAGS, true);
            v.setUint16(8, 0, true);
            v.setUint16(10, time, true);
            v.setUint16(12, date, true);
            v.setUint16(26, name.length, true);
            new Uint8Array(v.buffer).set(name, 30);
          });
          current = { reader: src instanceof Uint8Array ? null : src.getReader(), bytes: src instanceof Uint8Array ? src : null, crc: 0, size: 0, name, time, date, start };
          offset += local.length;
          ctrl.enqueue(local);
          return;
        }
        if (!finished) {
          finished = true;
          const cdStart = offset;
          let cdSize = 0;
          for (const c of central) {
            ctrl.enqueue(c);
            cdSize += c.length;
          }
          ctrl.enqueue(
            header(22, (v) => {
              v.setUint32(0, 0x06054b50, true);
              v.setUint16(8, count, true);
              v.setUint16(10, count, true);
              v.setUint32(12, cdSize, true);
              v.setUint32(16, cdStart, true);
            }),
          );
        }
        ctrl.close();
        return;
      }
    },
  });
}

/** 壓縮檔裡的檔名：去掉不能用的字元，同一個資料夾裡重複就加 (2)、(3)。 */
export function zipNamer(): (path: string) => string {
  const used = new Set<string>();
  const clean = (s: string) => s.replace(/[\\:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim().slice(0, 120) || "未命名";
  return (path: string) => {
    const parts = path.split("/").map(clean);
    let out = parts.join("/");
    if (used.has(out)) {
      const last = parts.pop()!;
      const dot = last.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [last.slice(0, dot), last.slice(dot)] : [last, ""];
      for (let n = 2; used.has(out); n++) out = [...parts, `${stem} (${n})${ext}`].join("/");
    }
    used.add(out);
    return out;
  };
}
