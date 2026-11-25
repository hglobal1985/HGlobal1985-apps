/** 自訂關聯詞（業主 2026-11-25）：一行一組，詞之間用 = 或 ＝ 隔開；至少 2 個詞才算一組。 */
export const MAX_SYNONYM_GROUPS = 300;
export const MAX_TERM_LEN = 30;

export function parseSynonymText(text: string): string[][] {
  const groups: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const terms = [...new Set(line.split(/[=＝]/).map((t) => t.trim().replace(/\s+/g, " ").slice(0, MAX_TERM_LEN)).filter(Boolean))];
    if (terms.length >= 2) groups.push(terms);
    if (groups.length >= MAX_SYNONYM_GROUPS) break;
  }
  return groups;
}

export const synonymsToText = (groups: string[][]): string => groups.map((g) => g.join(" = ")).join("\n");
