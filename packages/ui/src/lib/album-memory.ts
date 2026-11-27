/**
 * 相簿的「上次位置」記憶（杜杜龍 2026-11-25）：退出相簿時記住最後看的類別、資料夾與照片，下次進入顯示同一條路徑。
 * 存在這支裝置的瀏覽器（localStorage，只是個人使用的便利，不上傳伺服器）；沒有 localStorage（App、無痕）就只記在這次開啟期間。
 * mode＝library：停在資料夾檢視（folder＝null 是相簿首頁、有值是那個資料夾的照片格）；photo：停在單張看圖（photo＝照片編號）。
 */
export type AlbumPos = { group: string | null; folder: string | null; photo: string | null; mode: "library" | "photo" };
const KEY = "hg_album_pos";
let mem: AlbumPos | null = null;

export function loadAlbumPos(): AlbumPos | null {
  if (mem) return mem;
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (v) mem = JSON.parse(v) as AlbumPos;
  } catch {
    /* 讀不到就當沒有 */
  }
  return mem;
}
export function saveAlbumPos(p: Partial<AlbumPos>): void {
  mem = { group: null, folder: null, photo: null, mode: "library", ...(mem ?? {}), ...p };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* 寫不進去就只記在記憶體 */
  }
}
