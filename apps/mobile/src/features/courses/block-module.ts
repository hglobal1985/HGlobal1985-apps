/**
 * 「區塊」模組（業主 2026-11-19）：清單卡與套裝課程共用同一套區塊功能，行為參數全部集中在這裡。
 * - 誰有區塊：清單卡（isList）永遠有；課程卡要勾「套裝課程」（isPackage）才有，也才會出現「新增區塊」。
 * - 區塊的畫面（封面格、右下角教材數膠囊、點一下展開教材、同時只展開一個、空區塊灰階淡化）在 `lesson-list.tsx` 的 `FullVersionList`；
 *   編輯（上下移動整塊、新增／移動教材、預設收起）在 `course-edit/lessons.tsx` 的 `BlockEditList`；淡化樣式在 `ui/fade-style.ts`。
 * - 區塊底下的教材歸屬＝排在它後面、下一個區塊之前；章節不屬於任何區塊。
 * 要改區塊的行為參數，改這裡的 `BLOCK_BEHAVIOR`；要判斷一張卡有沒有區塊功能，一律用 `hasBlocks()`。
 */
export const BLOCK_BEHAVIOR = {
  /** 預設全部收起，同一時間只展開一個。 */
  singleOpen: true,
  /** 區塊封面格欄數：手機 2 欄，越寬越多，最多 5 欄。 */
  columns: (width: number) => (width < 440 ? 2 : width < 660 ? 3 : width < 880 ? 4 : 5),
  /** 沒有內容的區塊（學員看）灰階淡化。 */
  fadeEmpty: true,
  /** 教材數膠囊放在封面格右下角。 */
  countBadge: "bottom-right",
} as const;

export const hasBlocks = (c: { isList: boolean; isPackage?: boolean }) => c.isList || !!c.isPackage;
