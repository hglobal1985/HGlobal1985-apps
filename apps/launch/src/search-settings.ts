/**
 * 搜尋與 AI 參數設定（業主 2026-11-25，超級管理員在「設定 → 搜尋與 AI 設定」自訂）。
 * 存在 ui_settings 的 search_settings 一筆 JSON；每個參數有預設值（＝建議值）、範圍與白話說明。
 * 伺服器（語意搜尋、同音搜尋、EDM 辨識）與前端（模糊、字元、排序）都讀這一份；讀不到或亂填一律退回預設。
 */
import type { D1Database } from "./d1.ts";
import { SOURCES } from "./search-sources.ts";

const KEY = "search_settings";

export type ParamDef = {
  key: string;
  group: "semantic" | "sources" | "phonetic" | "fuzzy" | "related" | "rank" | "scene" | "memory" | "edm" | "batch";
  label: string;
  /** 這個參數做什麼（白話）。 */
  desc: string;
  /** 建議值與理由（白話）。 */
  advice: string;
  type: "bool" | "number" | "choice";
  default: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: { value: string; label: string }[];
};

export const GROUPS: { key: ParamDef["group"]; title: string; intro: string }[] = [
  { key: "semantic", title: "意思相近搜尋（AI 語意搜尋）", intro: "正式名稱：語意搜尋（Semantic Search）。AI 嵌入模型（Embedding，目前是 BGE-M3）把課程名稱、章節標題轉成一串數字（向量），搜尋時把你輸入的字也轉成向量，找出「意思最接近」的課程；所以搜「疼痛」也找得到「不舒服」。換用哪個模型請到「AI 模型」頁。" },
  { key: "sources", title: "語意搜尋要搜哪些資料（搜尋結果的膠囊標籤＝資料類別）", intro: "每一類資料各自開關；開了之後，排程每 10 分鐘會替新資料補向量（每次最多 300 筆，用 AI 額度）。搜尋結果裡，教材卡顯示在課程清單，其他類別顯示在「意思相近的其他項目」，每筆前面有膠囊標籤告訴你它是哪一類。關掉不會刪向量，之後重新打開立刻可用。" },
  { key: "phonetic", title: "同音搜尋（語音辨識錯字）", intro: "不用 AI、不花額度。把文字轉成拼音比對，語音把「益之源」聽成「一支援」也找得到。" },
  { key: "fuzzy", title: "模糊比對（打錯字）", intro: "不用 AI、不花額度。容許漏字、多字、錯字（例如「益支源」找得到「益之源」）；字元比對＝查詢的每個字都出現在同一門課就算符合。" },
  { key: "related", title: "相關單元補充與最相近結果（關鍵詞片段計分）", intro: "不用 AI、不花額度。把你輸入的字拆成相鄰 2～4 字的「關鍵詞片段」（例如「晚安修護面膜」→ 面膜、晚安、修護…），看每個單元的文字命中幾個片段、越長的片段越重要。用在兩個地方：①字面完全符合的單元太少時，補上相關的單元；②什麼都找不到時，退到「最相近的單元」，結果不留空白。" },
  { key: "rank", title: "結果排序", intro: "決定找到很多結果時誰排前面。" },
  { key: "scene", title: "相簿照片搜尋（場景、照片文字 OCR）與沒有權限的內容", intro: "搜尋時比對相簿照片的 AI 場景標籤（成交百寶箱等區塊照片），以及沒有權限的內容要不要也列出來。" },
  { key: "batch", title: "AI 辨識排程（批次處理）", intro: "背景把還沒辨識的 EDM 文字、相簿照片文字（OCR）、相簿場景一次批次處理：每 10 分鐘醒來一次，在「處理時間」內分批、同時處理多張，直到沒有待辨識的照片或今天的 AI 額度用完（額度在「設定 › AI 模型」的每日上限，用完隔天 08:00 台灣時間自動續辨）。" },
  { key: "memory", title: "搜尋記憶", intro: "點了搜尋結果、按返回時，要不要回到剛剛的搜尋畫面。" },
  { key: "edm", title: "EDM 海報辨識的 AI 參數", intro: "這兩項 AI 工作（辨識海報文字、把文字整理成欄位）共用的生成參數；其他 AI 工作用模型預設值。" },
];

export const PARAMS: ParamDef[] = [
  { key: "semanticEnabled", group: "semantic", label: "啟用意思相近搜尋", desc: "關閉後完全不呼叫 AI，只用字面、同音、模糊比對。完全比對有結果時本來就不會呼叫 AI，只有「找不到」才補找。", advice: "建議開。想省 AI 額度或結果太雜時才關。", type: "bool", default: true },
  { key: "semanticMin", group: "semantic", label: "相似度門檻", desc: "AI 判斷兩段文字意思有多接近（0～1，越高越像）。低於這個數字的不顯示。調高＝更準但可能漏掉；調低＝找得多但會混進不相干的課（例如搜「水機」出現保養品）。", advice: "建議 0.62。看到不相干的結果就每次調高 0.03；漏掉該找到的就調低 0.03。", type: "number", default: 0.62, min: 0.4, max: 0.9, step: 0.01 },
  { key: "semanticLimit", group: "semantic", label: "最多顯示幾筆（Top-K）", desc: "AI 最多回傳幾門課（章節另外算）。越大結果越多、越雜。", advice: "建議 100（杜杜龍指定）；課程不多可降到 10～15。", type: "number", default: 100, min: 5, max: 200, step: 1, unit: "筆" },
  { key: "semSrcCourse", group: "sources", label: "教材卡　［標籤：教材卡］", desc: "搜尋欄位：courses.title（教材卡名稱）。", advice: "建議開（核心）。", type: "bool", default: true },
  { key: "semSrcLesson", group: "sources", label: "單一教材　［標籤：單一教材］", desc: "搜尋欄位：lessons.title（教材標題，不含區塊）。點結果直接到所屬課程。", advice: "建議開。", type: "bool", default: true },
  { key: "semSrcSection", group: "sources", label: "區塊　［標籤：區塊］", desc: "搜尋欄位：lessons.title（課程裡的區塊／分組名稱）。", advice: "建議開。", type: "bool", default: true },
  { key: "semSrcSeries", group: "sources", label: "系列卡　［標籤：系列卡］", desc: "搜尋欄位：courses.series（系列名稱，同名只算一張）。點結果到系列頁。", advice: "建議開。", type: "bool", default: true },
  { key: "semSrcCenter", group: "sources", label: "中心卡　［標籤：中心卡］", desc: "搜尋欄位：center_names.display_name／courses.host_center_key（中心名稱）。點結果到中心頁。", advice: "建議開。", type: "bool", default: true },
  { key: "semSrcIntro", group: "sources", label: "課程介紹　［標籤：課程介紹］（我補充的）", desc: "搜尋欄位：courses.description（課程說明，只取前 200 字）。能用「內容」找課，例如搜「改善睡眠」找到介紹裡有講到的課。", advice: "建議開；但介紹文字很長又雜時，結果會偏多，可再調高相似度門檻。", type: "bool", default: true },
  { key: "semSrcEdm", group: "sources", label: "EDM 海報（OCR 文字辨識）　［標籤：EDM］", desc: "搜尋欄位：cover_media.ocr_text（scope＝edm，AI 辨識完成的海報文字，只取前 200 字）。點結果到該海報所屬的中心／系列／課程。", advice: "建議開。海報文字很多又雜，通常分數較低，必要時用試搜尋看分數。", type: "bool", default: true },
  { key: "semSrcPhoto", group: "sources", label: "相片（AI 場景辨識）　［標籤：相片］", desc: "搜尋欄位：cover_media.scene_text（相簿與區塊照片的場景標籤）。點結果到該相片所屬的中心／課程。", advice: "建議開。", type: "bool", default: true },
  { key: "phoneticEnabled", group: "phonetic", label: "啟用同音搜尋", desc: "關閉後，語音辨識錯字就不會再靠拼音補找。", advice: "建議開（免費）。", type: "bool", default: true },
  { key: "phoneticMinSyllables", group: "phonetic", label: "至少幾個字才比對", desc: "查詢太短（單字）會亂配，所以字數不到就不比對。調成 1 時，說一個字（例如「水」）也會找同音字，但結果會很雜。", advice: "建議 2。", type: "number", default: 2, min: 1, max: 4, step: 1, unit: "字" },
  { key: "synonymPhonetic", group: "phonetic", label: "關聯詞也支援同音錯字", desc: "打的字跟「搜尋關聯詞」裡的某個詞同音、近音（例如「和本翠」＝漢本萃），就把同一組的所有詞一起拿去找。關閉後關聯詞只認完全相同的字。", advice: "建議開（免費）。", type: "bool", default: true },
  { key: "synonymTypoFrom", group: "phonetic", label: "關聯詞幾個字以上容許錯 1 個音", desc: "關聯詞比對錯字的寬鬆度；字數不到這個數字的關聯詞必須音完全相同。數字越小越寬鬆；填 9 等於完全不容許。", advice: "建議 3。", type: "number", default: 3, min: 2, max: 9, step: 1, unit: "字" },
  { key: "synonymExpandMinChars", group: "phonetic", label: "關聯詞展開：至少幾個字的詞才拿去找", desc: "同組關聯詞被命中後，會把組裡的每個詞都拿去找一遍；少於這個字數的詞完全不展開。你自己直接打這個詞時不受影響。", advice: "建議 2（含 2 個字的詞；太短的詞由下面兩項壓低排名）。", type: "number", default: 2, min: 1, max: 6, step: 1, unit: "字" },
  { key: "synonymShortBelow", group: "phonetic", label: "關聯詞「太短」的標準", desc: "少於這個字數的關聯詞（例如 2 個字的「中藥」）容易撞到同音的無關標題（「重要」），它們找到的結果會排在所有結果的最後面。", advice: "建議 3。", type: "number", default: 3, min: 2, max: 6, step: 1, unit: "字" },
  { key: "synonymShortMax", group: "phonetic", label: "「太短」關聯詞最多補幾筆", desc: "只靠太短的關聯詞才找到的結果，最多列出幾筆（排在最後面）。0＝完全不列。", advice: "建議 5。", type: "number", default: 5, min: 0, max: 30, step: 1, unit: "筆" },
  { key: "phoneticTypoFrom", group: "phonetic", label: "幾個字以上容許錯 1 個音", desc: "查詢夠長時，容許有 1 個字的音不一樣。數字越小越寬鬆（短詞也容許錯）；填 9 等於完全不容許。", advice: "建議 4。", type: "number", default: 4, min: 3, max: 9, step: 1, unit: "字" },
  { key: "phoneticFiller", group: "phonetic", label: "先去掉口語虛詞再比對", desc: "把「如何、怎麼、請問、我要、的、嗎…」這類口語虛詞去掉再轉拼音，長句問話也找得到。", advice: "建議開。", type: "bool", default: true },
  { key: "phoneticCoverPct", group: "phonetic", label: "短查詢（5 個音以內）要覆蓋幾％才列出", desc: "查詢被拆成片段比對時，短查詢至少要有這個比例的音節找得到才算符合。數字越大越嚴格。", advice: "建議 75。", type: "number", default: 75, min: 40, max: 100, step: 5, unit: "％" },
  { key: "phoneticLongMinSyllables", group: "phonetic", label: "口語長句至少覆蓋幾個音", desc: "長句（多個關鍵詞串在一起）至少要有這麼多音節找得到才列出，避免隨便兩個常見詞就配上。", advice: "建議 4。", type: "number", default: 4, min: 2, max: 10, step: 1, unit: "個音" },
  { key: "phoneticMaxSyllables", group: "phonetic", label: "長句最多看前幾個音", desc: "口語長句只取前面這麼多個音節比對（越大越慢）。", advice: "建議 40。", type: "number", default: 40, min: 10, max: 80, step: 5, unit: "個音" },
  { key: "relatedEnabled", group: "related", label: "字面符合太少時補相關單元", desc: "字面完全符合的單元不到下面設定的數量時，補上「命中關鍵詞片段」的單元，排在字面符合的後面。", advice: "建議開。", type: "bool", default: true },
  { key: "relatedBelow", group: "related", label: "字面符合少於幾個才補", desc: "字面完全符合的單元少於這個數字，才去補相關單元。", advice: "建議 8。", type: "number", default: 8, min: 1, max: 30, step: 1, unit: "個" },
  { key: "relatedMax", group: "related", label: "最多補幾個相關單元", desc: "補上的相關單元最多幾個（也是「最相近」結果的上限）。", advice: "建議 30。", type: "number", default: 30, min: 5, max: 60, step: 5, unit: "個" },
  { key: "relatedMinScore", group: "related", label: "補相關單元的最低分", desc: "關鍵詞片段計分的最低門檻：2 字片段 3 分、3 字 6 分、4 字 10 分（可在下面調整）。3＝命中一個 2 字片段就列出；調高＝只列命中更多或更長片段的。", advice: "建議 3。", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "分" },
  { key: "gramScore2", group: "related", label: "2 字片段每個幾分", desc: "查詢裡相鄰 2 個字（例如「面膜」）出現在單元文字裡的得分。", advice: "建議 3。", type: "number", default: 3, min: 1, max: 20, step: 1, unit: "分" },
  { key: "gramScore3", group: "related", label: "3 字片段每個幾分", desc: "相鄰 3 個字（例如「修護面」）的得分，應比 2 字高。", advice: "建議 6。", type: "number", default: 6, min: 1, max: 30, step: 1, unit: "分" },
  { key: "gramScore4", group: "related", label: "4 字片段每個幾分", desc: "相鄰 4 個字（例如「晚安修護」）的得分，應最高。", advice: "建議 10。", type: "number", default: 10, min: 1, max: 40, step: 1, unit: "分" },
  { key: "gramCommonPct", group: "related", label: "常見片段不算分的門檻", desc: "某個片段出現在這個比例以上的單元裡，就當成太常見（例如「教學」「說明」），不算分，避免雜訊。", advice: "建議 30。", type: "number", default: 30, min: 5, max: 100, step: 5, unit: "％" },
  { key: "looseEnabled", group: "related", label: "什麼都找不到時退到「最相近」", desc: "字面、模糊、同音、AI 都沒結果時，改列出關鍵詞片段分數最高的單元，結果不留空白。關閉＝顯示「找不到」。", advice: "建議開。", type: "bool", default: true },
  { key: "lexBonus", group: "rank", label: "AI 語意搜尋：字面相關度加分", desc: "AI 相似度之外，再加上「查詢字的相鄰兩字有幾成出現在該筆文字」× 這個數字。0＝只看 AI。", advice: "建議 0.3。", type: "number", default: 0.3, min: 0, max: 1, step: 0.05 },
  { key: "lexPenalty", group: "rank", label: "EDM、相片、課程介紹：完全沒有字面命中的扣分", desc: "這三類長文字最容易被 AI 誤判。查詢字連一個相鄰兩字都沒命中時，分數扣掉這個數字（0.5 幾乎等於不列）。0＝不扣。", advice: "建議 0.5。", type: "number", default: 0.5, min: 0, max: 1, step: 0.05 },
  { key: "lexPenaltyAll", group: "rank", label: "其他類別（教材卡、單元、系列、中心…）完全沒有字面命中的扣分", desc: "AI 有時會把完全沒有字面關聯的內容（例如搜「純粹和本翠」冒出淨水器、年會）判成相近。查詢字連一個相鄰兩字都沒命中時，分數扣掉這個數字，等於提高門檻、降低排名。0＝不扣。注意：靠 AI 找「同義詞」（例如搜「水機」找到益之源）的結果字面也沒命中，扣太多會漏掉。", advice: "建議 0.08；無關結果還是太多就調高（0.15），漏掉同義詞就調低。", type: "number", default: 0.08, min: 0, max: 0.5, step: 0.01 },
  { key: "chaptersShuffle", group: "rank", label: "字面符合的單元每次打開頁面洗牌", desc: "開＝同一批字面符合的單元，每次開頁面順序隨機（公平曝光）；關＝固定順序。", advice: "建議開。", type: "bool", default: true },
  { key: "sceneReverse", group: "scene", label: "場景搜尋：長句反向比對標籤", desc: "整句比對不到照片標籤時，改成「照片的某個標籤（2 字以上）出現在你說的話裡」就算符合，說一長串也找得到蔬菜水果的照片。", advice: "建議開。", type: "bool", default: true },
  { key: "sceneMaxPhotos", group: "scene", label: "場景搜尋：每個區塊最多帶幾張照片", desc: "點場景結果直接全螢幕看圖時，一次最多載入幾張符合的照片。", advice: "建議 40。", type: "number", default: 40, min: 5, max: 100, step: 5, unit: "張" },
  { key: "photoOcrEnabled", group: "scene", label: "相簿照片文字辨識（OCR）", desc: "開＝相簿（區塊）照片上傳後，AI 會讀出照片裡的文字（招牌、白板、包裝…），相簿搜尋框與全站場景搜尋都能用照片裡的文字找到照片；關＝不再辨識新照片（已辨識的文字仍可搜尋）。辨識用的模型在「設定 › AI 模型 ›『相簿照片文字辨識』」選。中心 EDM 另外有自己的海報辨識。", advice: "建議開（共用每日免費額度，用完隔天續辨）。", type: "bool", default: true },
  { key: "photoOcrMaxTokens", group: "scene", label: "相簿照片文字辨識：最多輸出長度", desc: "讀照片文字時最多輸出多少（token，約 1 個中文字 1～2 個）。字很多的照片太小會讀不完；太大浪費額度。", advice: "建議 600。", type: "number", default: 600, min: 200, max: 2000, step: 100, unit: "token" },
  { key: "aiOnEdm", group: "batch", label: "辨識來源：中心 EDM 文字", desc: "關閉後排程不再辨識中心 EDM（已辨識的不受影響）。", advice: "建議開。", type: "bool", default: true },
  { key: "aiOnScene", group: "batch", label: "辨識來源：相簿場景標籤", desc: "關閉後排程不再做相簿場景辨識。", advice: "建議開。", type: "bool", default: true },
  { key: "aiPrioEdm", group: "batch", label: "優先順序：中心 EDM 文字", desc: "數字越小越先處理（1～3）。", advice: "預設 1。", type: "number", default: 1, min: 1, max: 3, step: 1 },
  { key: "aiPrioPhotoOcr", group: "batch", label: "優先順序：相簿照片文字（OCR）", desc: "數字越小越先處理（1～3）。", advice: "預設 2。", type: "number", default: 2, min: 1, max: 3, step: 1 },
  { key: "aiPrioScene", group: "batch", label: "優先順序：相簿場景標籤", desc: "數字越小越先處理（1～3）。", advice: "預設 3。", type: "number", default: 3, min: 1, max: 3, step: 1 },
  { key: "aiBatchSize", group: "batch", label: "每一輪處理幾張（每種辨識各自）", desc: "每輪從待辨識的照片裡取這麼多張，同時處理完再取下一輪。", advice: "建議 12。", type: "number", default: 12, min: 3, max: 50, step: 1, unit: "張" },
  { key: "aiConcurrency", group: "batch", label: "同時處理幾張", desc: "一輪裡同時送給 AI 的張數。越多越快，但太多可能被 Cloudflare 限流。", advice: "建議 4。", type: "number", default: 4, min: 1, max: 8, step: 1, unit: "張" },
  { key: "aiBudgetSec", group: "batch", label: "每次排程最多處理幾秒", desc: "每 10 分鐘的排程最多跑這麼久，時間到就停、下次再接著做（避免和其他排程工作互相拖累）。", advice: "建議 240 秒（4 分鐘）。", type: "number", default: 240, min: 60, max: 600, step: 30, unit: "秒" },
  { key: "showLocked", group: "scene", label: "沒有權限的內容也列在搜尋結果", desc: "開＝沒權限的課程、教材、照片也搜尋得到，縮圖中央蓋鎖頭、寫出需要的權限，點了顯示原因；關＝場景與其他項目看不到的就不列。", advice: "建議開（杜杜龍指示）。", type: "bool", default: true },
  { key: "fuzzyEnabled", group: "fuzzy", label: "啟用模糊比對（打錯字）", desc: "容許漏字、多字、錯字。", advice: "建議開（免費）。", type: "bool", default: true },
  { key: "fuzzyMaxDiff", group: "fuzzy", label: "最多容許差幾個字", desc: "上限。實際容許數依詞長：1～2 字必須完全一樣、3～4 字差 1、5 字以上差 2；這裡的數字是再往下壓的天花板。填 0＝等於關閉。", advice: "建議 2。覺得亂配就改 1。", type: "number", default: 2, min: 0, max: 3, step: 1, unit: "字" },
  { key: "charsEnabled", group: "fuzzy", label: "啟用字元比對", desc: "查詢的每個字（不分順序）都出現在同一門課的文字裡就算符合，例如「線上白金」找得到「安麗與白金線上溝通會」。", advice: "建議開。", type: "bool", default: true },
  { key: "charsMinLen", group: "fuzzy", label: "字元比對至少幾個不同字", desc: "太短（例如 2 個字）幾乎每門課都符合，所以設下限。", advice: "建議 3。", type: "number", default: 3, min: 2, max: 6, step: 1, unit: "字" },
  { key: "listCardsLast", group: "rank", label: "品牌／清單卡排在課程後面", desc: "只是「相近」才找到的品牌卡（標「教材」的，如雅姿、紐崔萊）排在課程後面；名稱字面完全符合的不受影響。", advice: "建議開。", type: "bool", default: true },
  { key: "searchMemoryMinutes", group: "memory", label: "記住搜尋框與搜尋結果多久", desc: "點進某個搜尋結果後按返回，在這段時間內會直接回到剛剛的搜尋字與結果（不用重新輸入、不用重新等）；超過就清空。重新整理頁面一律清空。填 1 約等於幾乎不記。", advice: "建議 15 分鐘。", type: "number", default: 15, min: 1, max: 720, step: 1, unit: "分鐘" },
  { key: "edmTextTemperature", group: "edm", label: "EDM 文字整理：隨機度（Temperature）", desc: "AI 回答的隨機程度（0～1）。越低越照原文、穩定；越高越有變化、越容易自己發揮。整理海報欄位要求照抄。", advice: "建議 0.1（接近 0 最保守）。", type: "number", default: 0.1, min: 0, max: 1, step: 0.05 },
  { key: "edmTextMaxTokens", group: "edm", label: "EDM 文字整理：最多輸出長度", desc: "AI 一次最多寫多少（token，約 1 個中文字 1～2 個）。太小會被截斷、欄位缺字；太大浪費額度。", advice: "建議 1200；海報文字很多才調到 2000。", type: "number", default: 1200, min: 400, max: 3000, step: 100, unit: "token" },
  { key: "edmVisionMaxTokens", group: "edm", label: "EDM 圖片辨識：最多輸出長度", desc: "讀海報文字時最多輸出多少。字很多的海報太小會讀不完。", advice: "建議 1024。", type: "number", default: 1024, min: 512, max: 2048, step: 128, unit: "token" },
];


/** 每一類資料的「加分」與「顯示順序」（業主 2026-11-25：測試「水機」時單一教材 0.53 全被門檻擋掉，要能自己調各類的優先順序）。 */
const DEFAULT_PRIO: Record<string, number> = { series: 1, center: 2, lesson: 3, section: 4, intro: 5, edm: 6, photo: 7, course: 9 };
for (const x of SOURCES) {
  const cap = x.kind.charAt(0).toUpperCase() + x.kind.slice(1);
  PARAMS.push({ key: `semBoost${cap}`, group: "sources", label: `${x.label}：加分`, desc: "把這一類的相似度分數加上這個數字，再去跟門檻比、再排序。例如門檻 0.65、某類分數只有 0.53：加 0.12 就變 0.65、會顯示。想讓這一類更容易出現、排更前面就加；0＝不加。", advice: "建議 0。看到該找到的資料卡在門檻下面，就用「試搜尋」看差多少，加這個差距。", type: "number", default: 0, min: 0, max: 0.4, step: 0.01 });
  PARAMS.push({ key: `semPrio${cap}`, group: "sources", label: `${x.label}：顯示順序`, desc: x.kind === "course" ? "教材卡（課程清單）跟「意思相近的其他項目」各類比先後：數字比它小的類別顯示在教材卡清單上方，數字比它大（或一樣）的顯示在清單下方。9＝最後。" : "數字小的類別排前面（1＝最前，同一個順序再比分數高低）；也跟「教材卡」的順序比：比教材卡小的顯示在教材卡清單上方，其餘在下方。", advice: `建議 ${DEFAULT_PRIO[x.kind] ?? 5}。`, type: "number", default: DEFAULT_PRIO[x.kind] ?? 5, min: 1, max: 9, step: 1 });
}

export type SearchSettings = Record<string, boolean | number | string>;
export const defaultSearchSettings = (): SearchSettings => Object.fromEntries(PARAMS.map((p) => [p.key, p.default]));

/** 只收已知參數、型別對、範圍內的值；其餘用預設。 */
export function normalizeSearchSettings(raw: unknown, base: SearchSettings = defaultSearchSettings()): SearchSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SearchSettings = { ...base };
  for (const p of PARAMS) {
    const v = r[p.key];
    if (v === undefined) continue;
    if (p.type === "bool" && typeof v === "boolean") out[p.key] = v;
    else if (p.type === "number" && typeof v === "number" && Number.isFinite(v)) {
      const stepped = Math.round(v / (p.step ?? 1)) * (p.step ?? 1);
      out[p.key] = Math.round(Math.min(p.max!, Math.max(p.min!, stepped)) * 1000) / 1000;
    } else if (p.type === "choice" && p.choices?.some((c) => c.value === v)) out[p.key] = v as string;
  }
  return out;
}

export async function loadSearchSettings(db: D1Database): Promise<SearchSettings> {
  try {
    const row = await db.prepare("SELECT value FROM ui_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
    return normalizeSearchSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return defaultSearchSettings();
  }
}

export async function saveSearchSettings(db: D1Database, patch: unknown): Promise<SearchSettings> {
  const next = normalizeSearchSettings(patch, await loadSearchSettings(db));
  await db
    .prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(next))
    .run();
  return next;
}
