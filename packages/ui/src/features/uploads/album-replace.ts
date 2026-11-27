import { flashText } from "@/ui/flash-notice";

/** App（iOS／Android）版：更換照片先只有網頁版（與上傳一致）。 */
export function replaceAlbumPhoto(_id: string, _opts: { maxSide: number; quality: number }, _onDone: () => void): void {
  flashText("更換照片請用網頁版（learn.hglobal1985.com）");
}
