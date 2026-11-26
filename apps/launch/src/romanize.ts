import { pinyin } from "pinyin-pro";

/**
 * 把主講人姓名轉成網址用的英文小寫連字號（wang-xiaoming）。
 * - 英文：小寫、去音標、空白轉連字號。
 * - 中文：漢語拼音（第一個字當姓，其餘合併為名）。
 * - 韓文：Revised Romanization（內建拆字演算法）。
 * - 日文假名：Hepburn（內建對照表）；日文漢字沒有可靠規則，會用中文讀音。
 * 轉不出任何英文字母就回空字串（＝不產生專屬網址）。
 */
const COMPOUND = ["歐陽", "司馬", "上官", "諸葛", "夏侯", "皇甫", "東方", "公孫", "慕容", "長孫", "尉遲", "司徒", "令狐", "端木", "南宮", "軒轅"];

export function romanizeName(name: string): string {
  const words: string[] = [];
  let latin = "";
  const flush = () => {
    const w = latin
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (w) words.push(w);
    latin = "";
  };
  const han: string[] = [];
  const flushHan = () => {
    if (!han.length) return;
    const text = han.join("");
    han.length = 0;
    const syl = pinyin(text, { toneType: "none", type: "array", surname: "head", v: false }).map((s) => s.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
    if (!syl.length) return;
    // 第一個字當姓（複姓用前兩個字），其餘合併為名。
    const n = COMPOUND.some((x) => text.startsWith(x)) && syl.length > 2 ? 2 : 1;
    words.push(syl.slice(0, n).join(""));
    if (syl.length > n) words.push(syl.slice(n).join(""));
  };
  let kana = "";
  const flushKana = () => {
    if (!kana) return;
    const r = kanaToRomaji(kana);
    kana = "";
    if (r) words.push(r);
  };
  for (const ch of name.trim()) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      flush();
      flushHan();
      flushKana();
      words.push(hangulToRoman(ch));
    } else if ((code >= 0x3040 && code <= 0x30ff) || code === 0x30fc) {
      flush();
      flushHan();
      kana += ch;
    } else if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      flush();
      flushKana();
      han.push(ch);
    } else if (/\s|[-_・·.]/.test(ch)) {
      flush();
      flushHan();
      flushKana();
    } else {
      flushHan();
      flushKana();
      latin += ch;
    }
  }
  flush();
  flushHan();
  flushKana();
  // 韓文逐字各自成「詞」，合併相鄰的韓文音節為一個詞（金民秀 → kim-minsu 不適用；韓文姓名：姓一個音節、名其餘）。
  return mergeHangul(words).filter(Boolean).join("-");
}

// ---------- 韓文（Revised Romanization，不處理連音變化，姓名用） ----------
const HANGUL_MARK = "\u0001";
const L = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const V = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const T = ["", "k", "kk", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
function hangulToRoman(ch: string): string {
  const i = ch.codePointAt(0)! - 0xac00;
  return HANGUL_MARK + L[Math.floor(i / 588)] + V[Math.floor((i % 588) / 28)] + T[i % 28];
}
function mergeHangul(words: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const end = () => {
    if (!run.length) return;
    out.push(run[0]!);
    if (run.length > 1) out.push(run.slice(1).join(""));
    run = [];
  };
  for (const w of words) {
    if (w.startsWith(HANGUL_MARK)) run.push(w.slice(1));
    else (end(), out.push(w));
  }
  end();
  return out;
}

// ---------- 日文假名（Hepburn） ----------
const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko", さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to", な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo", だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo", ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", ちゃ: "cha", ちゅ: "chu", ちょ: "cho", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo", りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};
function kanaToRomaji(text: string): string {
  // 片假名先轉成平假名；長音符號「ー」略過。
  const hira = [...text].map((c) => (c >= "ァ" && c <= "ヶ" ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c)).filter((c) => c !== "ー");
  let out = "";
  for (let i = 0; i < hira.length; i++) {
    const c = hira[i]!;
    if (c === "っ") {
      const next = KANA[(hira[i + 1] ?? "") + (/[ゃゅょ]/.test(hira[i + 2] ?? "") ? hira[i + 2] : "")] ?? KANA[hira[i + 1] ?? ""] ?? "";
      out += next[0] ?? "";
      continue;
    }
    const two = c + (hira[i + 1] ?? "");
    if (KANA[two]) {
      out += KANA[two];
      i++;
    } else out += KANA[c] ?? "";
  }
  return out;
}

/** 課程專屬網址名稱的可接受寫法：原樣、去掉前導 0（-001→-1）、補成三位數（-1→-001，相容舊網址）。 */
export function urlNameVariants(name: string): string[] {
  const m = /^(.*-)(\d+)$/.exec(name);
  if (!m) return [name];
  const n = String(Number(m[2]));
  return [...new Set([name, `${m[1]}${n}`, `${m[1]}${n.padStart(3, "0")}`])];
}

/**
 * 沒有主講人的課程（勾了「無」）：專屬網址用課程名稱的英譯（規則同主講人姓名；杜杜龍 2026-11-19）。
 * 名稱很長時只取前 40 個字元（在連字號處斷開），避免網址過長；轉不出英文字母就回空字串（＝不產生專屬網址）。
 */
export function romanizeTitle(title: string): string {
  const base = romanizeName(title);
  if (base.length <= 40) return base;
  const cut = base.slice(0, 40);
  const at = cut.lastIndexOf("-");
  return (at >= 12 ? cut.slice(0, at) : cut).replace(/-+$/, "");
}
