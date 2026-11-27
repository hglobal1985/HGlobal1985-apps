/** 前後端共用的資料格式：學習成就（徽章）與成就產生器（杜杜龍 2026-11-27 從 contract.ts 依功能拆出；contract.ts 會全部轉出，舊的 import 不用改）。 */

// ---------- 學習成就（徽章）----------
export type AchievementType = "lessons_completed" | "courses_completed" | "courses_enrolled" | "learning_days" | "comments_posted" | "course_completed" | "streak_days" | "watch_minutes" | "centers_subscribed" | "series_subscribed" | "categories_explored" | "early_lessons" | "night_lessons" | "weekend_lessons" | "lessons_in_a_day" | "feature_used" | "subscriptions_total" | "material_video" | "lists_created" | "list_people" | "files_downloaded" | "target_lesson" | "series_completed";
/** 任務分類（後台「徽章任務設定」用，杜杜龍 2026-11-18）。 */
export type AchievementCategory = "progress" | "habit" | "time" | "explore" | "social" | "subscribe" | "feature" | "zone" | "list";
export const ACHIEVEMENT_CATEGORIES: { key: AchievementCategory; label: string; icon: string; desc: string }[] = [
  { key: "progress", label: "學習進度", icon: "📈", desc: "學了多少：完成的堂數、課程、學習時間" },
  { key: "habit", label: "學習習慣", icon: "🔥", desc: "有沒有持續：累計天數、連續天數" },
  { key: "time", label: "學習時段", icon: "🕒", desc: "什麼時候學：早晨、夜間、週末" },
  { key: "explore", label: "探索嘗鮮", icon: "🧭", desc: "報名多少門課、涉獵多少種分類" },
  { key: "social", label: "社群互動", icon: "💬", desc: "在課程留言板的互動" },
  { key: "subscribe", label: "訂閱關注", icon: "🔔", desc: "訂閱中心、系列的數量" },
  { key: "feature", label: "功能體驗", icon: "🧰", desc: "第一次使用某個網站功能（新手教學）" },
  { key: "list", label: "我的清單", icon: "📋", desc: "建立自己的清單、分享給別人、清單被多少人點閱" },
  { key: "zone", label: "清單影片", icon: "🎬", desc: "安麗官方資源、安麗品牌館：每個區塊隨機挑 1～2 支影片，讀完（看完）就解鎖" },
];
/** 條件類型：中文名稱、單位、分類、白話說明（後台挑選時顯示）。retired＝已停用的類型，後台不再提供。 */
export const ACHIEVEMENT_TYPES: Record<AchievementType, { label: string; unit: string; category: AchievementCategory; hint: string; needsCourse?: boolean; needsFeature?: boolean; retired?: boolean; auto?: boolean }> = {
  lessons_completed: { label: "累計完成章節數", unit: "堂", category: "progress", hint: "會員一共完成了幾個章節（每個章節只算一次）" },
  courses_completed: { label: "累計學完課程數", unit: "門", category: "progress", hint: "整門課的每個章節都完成，才算學完 1 門" },
  lessons_in_a_day: { label: "單日最多完成章節數", unit: "堂", category: "progress", hint: "同一天（台灣時間）內完成的章節數，取最高的一天" },
  watch_minutes: { label: "累計學習分鐘數", unit: "分鐘", category: "progress", hint: "把完成章節的長度加總（分鐘）" },
  learning_days: { label: "累計學習天數", unit: "天", category: "habit", hint: "有完成章節的不同日期共幾天（不需連續）" },
  streak_days: { label: "連續學習天數", unit: "天", category: "habit", hint: "連續幾天每天都有完成章節；太久很難達成，建議最多 7 天" },
  early_lessons: { label: "早晨完成章節數", unit: "堂", category: "time", hint: "04:00～08:00（台灣時間）完成的章節數" },
  night_lessons: { label: "夜間完成章節數", unit: "堂", category: "time", hint: "22:00～04:00（台灣時間）完成的章節數" },
  weekend_lessons: { label: "週末完成章節數", unit: "堂", category: "time", hint: "星期六、日完成的章節數" },
  courses_enrolled: { label: "累計報名課程數", unit: "門", category: "explore", hint: "已開通（含免費自動通過）的不同課程數" },
  categories_explored: { label: "學習過的不同分類數", unit: "種", category: "explore", hint: "完成過章節的課程，涵蓋幾種不同的分類" },
  comments_posted: { label: "課程留言次數", unit: "次", category: "social", hint: "在課程留言板留言的總次數" },
  centers_subscribed: { label: "訂閱中心數", unit: "個", category: "subscribe", hint: "按過訂閱鈴鐺的教育中心數量" },
  series_subscribed: { label: "訂閱系列數", unit: "個", category: "subscribe", hint: "按過訂閱鈴鐺的系列數量" },
  subscriptions_total: { label: "訂閱總數（中心＋系列）", unit: "個", category: "subscribe", hint: "中心與系列加起來的訂閱數量" },
  feature_used: { label: "使用過某個網站功能", unit: "次", category: "feature", hint: "第一次用到指定功能就達成（需要選功能），達成數量通常填 1", needsFeature: true },
  lists_created: { label: "累計建立清單數", unit: "份", category: "list", hint: "會員自己建立的「我的清單」份數（刪除後不算）" },
  list_people: { label: "單一清單被點閱的人數", unit: "人", category: "list", hint: "自己的清單裡，人氣最高的那份被不同的人點開過幾人（自己看不算）" },
  files_downloaded: { label: "下載教材檔案數", unit: "個", category: "feature", hint: "下載過幾個不同的教材檔案（同一個檔案下載多次只算一次）" },
  material_video: { label: "讀完指定的清單影片", unit: "支", category: "zone", hint: "由系統從清單專區、品牌專區隨機抽選影片產生（在「清單影片」分類按「重新抽選」），不能手動新增", auto: true },
  course_completed: { label: "學完指定的課程卡", unit: "門", category: "progress", hint: "指定的那張課程卡，每個章節都完成才算", needsCourse: true },
  target_lesson: { label: "完成指定的教材或章節", unit: "堂", category: "progress", hint: "指定的那個章節（或有影片的教材）看完就達成" },
  series_completed: { label: "學完指定系列卡內的課程", unit: "門", category: "progress", hint: "指定系列裡，學完幾門課程卡就達成" },
};

// ---------- 成就產生器（杜杜龍 2026-11-22）：動詞＋對象＋時段＋數量＋單位，全部用下拉選單點選 ----------
/** 時段限制（只有「完成章節」可選）。 */
export type AchTime = "any" | "early" | "night" | "weekend" | "day";
export const ACH_TIMES: { key: AchTime; label: string }[] = [
  { key: "any", label: "不限時段" },
  { key: "early", label: "早晨（04–08 點）" },
  { key: "night", label: "夜間（22–04 點）" },
  { key: "weekend", label: "週末" },
  { key: "day", label: "同一天內" },
];
/** 量化單位可選清單。 */
export const ACH_UNITS = ["堂", "門", "天", "分鐘", "次", "個", "份", "人", "種", "支"] as const;
export type AchObject = {
  name: string;
  unit: string;
  /** 這個「動詞＋對象」對應的條件類型（有時段選項的改看 times）。 */
  type?: AchievementType;
  times?: Partial<Record<AchTime, AchievementType>>;
  /** 固定的網站功能（例如分享）；pickFeature＝讓管理員從功能清單自己挑。 */
  feature?: string;
  pickFeature?: boolean;
  /** 要先搜尋並指定一個目標：lesson＝教材／章節、course＝課程卡、series＝系列卡。 */
  target?: "lesson" | "course" | "series";
  /** 達成數量固定為 1（不顯示數量與單位）。 */
  fixedOne?: boolean;
};
/** 動詞清單：icon＝這個動詞的預設徽章圖示（同動詞的成就全站一致）。新增動詞只要在這裡加一行。 */
export const ACH_VERBS: { verb: string; icon: string; objects: AchObject[] }[] = [
  { verb: "完成", icon: "✅", objects: [{ name: "章節", unit: "堂", times: { any: "lessons_completed", early: "early_lessons", night: "night_lessons", weekend: "weekend_lessons", day: "lessons_in_a_day" } }] },
  { verb: "學完", icon: "🎓", objects: [{ name: "課程", unit: "門", type: "courses_completed" }] },
  { verb: "報名", icon: "📝", objects: [{ name: "課程", unit: "門", type: "courses_enrolled" }] },
  { verb: "累計學習", icon: "📚", objects: [{ name: "時間", unit: "分鐘", type: "watch_minutes" }, { name: "天數", unit: "天", type: "learning_days" }] },
  { verb: "連續學習", icon: "🔥", objects: [{ name: "天數", unit: "天", type: "streak_days" }] },
  { verb: "涉獵", icon: "🧭", objects: [{ name: "分類", unit: "種", type: "categories_explored" }] },
  { verb: "留言", icon: "💬", objects: [{ name: "課程留言板", unit: "次", type: "comments_posted" }] },
  { verb: "訂閱", icon: "🔔", objects: [{ name: "中心", unit: "個", type: "centers_subscribed" }, { name: "系列", unit: "個", type: "series_subscribed" }, { name: "中心＋系列", unit: "個", type: "subscriptions_total" }] },
  { verb: "使用", icon: "🧰", objects: [{ name: "指定功能", unit: "次", type: "feature_used", pickFeature: true }] },
  { verb: "建立", icon: "📋", objects: [{ name: "清單", unit: "份", type: "lists_created" }] },
  { verb: "被點閱", icon: "👀", objects: [{ name: "我的清單", unit: "人", type: "list_people" }] },
  { verb: "分享", icon: "📤", objects: [{ name: "給朋友", unit: "次", type: "feature_used", feature: "share" }, { name: "我的清單", unit: "次", type: "feature_used", feature: "list_share" }] },
  { verb: "指定學習", icon: "🎯", objects: [{ name: "教材", unit: "堂", type: "target_lesson", target: "lesson", fixedOne: true }, { name: "課程卡", unit: "門", type: "course_completed", target: "course", fixedOne: true }, { name: "系列卡", unit: "門", type: "series_completed", target: "series" }] },
  { verb: "下載", icon: "📥", objects: [{ name: "教材檔案", unit: "個", type: "files_downloaded" }] },
];
/** 圖示圖庫（「隨機」與「自選」用）。 */
export const ACH_ICON_POOL = ["🏅", "🔥", "🌱", "📚", "🎓", "🔔", "💬", "⭐", "🌟", "🏆", "🚀", "💎", "🎯", "🧭", "🍀", "🎖️"] as const;
/** 動詞＋對象＋時段＋功能 → 條件類型（算不出來回 null）。 */
export function achTypeOf(vi: number, oi: number, time: AchTime): AchievementType | null {
  const o = ACH_VERBS[vi]?.objects[oi];
  if (!o) return null;
  return o.times ? (o.times[time] ?? o.times.any ?? null) : (o.type ?? null);
}
/** 反查：條件類型（與功能）＝哪個動詞、對象、時段；清單影片、指定課程這類沒有對應回 null。 */
export function achRecipeOf(type: AchievementType, feature?: string | null): { vi: number; oi: number; time: AchTime } | null {
  let loose: { vi: number; oi: number; time: AchTime } | null = null;
  for (let vi = 0; vi < ACH_VERBS.length; vi++) {
    const objs = ACH_VERBS[vi]!.objects;
    for (let oi = 0; oi < objs.length; oi++) {
      const o = objs[oi]!;
      if (o.times) {
        for (const t of Object.keys(o.times) as AchTime[]) if (o.times[t] === type) return { vi, oi, time: t };
      } else if (o.type === type) {
        if (o.feature) {
          if (o.feature === feature) return { vi, oi, time: "any" };
        } else if (o.pickFeature) loose ??= { vi, oi, time: "any" };
        else return { vi, oi, time: "any" };
      }
    }
  }
  return loose;
}
/** 預設徽章圖示（依動詞）。 */
export const achDefaultIcon = (vi: number) => ACH_VERBS[vi]?.icon ?? "🏅";
/** 徽章圖固定用圖片時的代碼（存在 achievements.icon）：畫面用圖片、通知文字退回 🏅。 */
export const BADGE_IMAGE_ICONS = ["@amway"] as const;
export const isImageIcon = (icon: string) => (BADGE_IMAGE_ICONS as readonly string[]).includes(icon);
/** 通知、純文字場合用的圖示（圖片徽章退回 🏅）。 */
export const iconText = (icon: string) => (isImageIcon(icon) ? "🏅" : icon);
/** 網站功能清單（功能體驗徽章，類似新手教學）：key 是前端回報用的代碼，label 是功能名稱，hint 是怎麼用。 */
export const FEATURES = {
  share: { label: "分享給朋友", hint: "在課程、章節或海報按分享鈕，傳給朋友" },
  copy_link: { label: "複製連結", hint: "分享時選擇複製連結" },
  download_image: { label: "下載海報圖片", hint: "放大海報後按下載" },
  edm_zoom: { label: "放大看海報", hint: "點課程或中心的海報放大，可兩指縮放" },
  player_speed: { label: "調整播放速度", hint: "播放章節時，點控制列的速度鈕" },
  video_zoom: { label: "影片拖曳縮放", hint: "播放時用兩指放大縮小影片" },
  open_material: { label: "開啟其他教材", hint: "點課程頁的簡報、文件等外部連結" },
  push_enable: { label: "開啟手機推播", hint: "設定 > 通知設定，打開手機推播" },
  notify_settings: { label: "調整通知設定", hint: "設定 > 通知設定，改 Email 通知等" },
  search: { label: "使用搜尋", hint: "在寰宇大學點放大鏡搜尋課程或章節" },
  view_mode: { label: "切換瀏覽模式", hint: "在寰宇大學切換系列、單元、教育中心" },
  profile_edit: { label: "更新個人資料", hint: "設定頁點自己的資料，修改後儲存" },
  orders_view: { label: "查看訂單紀錄", hint: "設定 > 訂單紀錄" },
  achievements_view: { label: "查看學習成就", hint: "學習中頁點學習成就" },
  sapling_tap: { label: "點小樹苗", hint: "學習中頁點小樹苗，看累計幾棵" },
  bookshelf_view: { label: "打開我的書櫃", hint: "設定 > 我的書櫃" },
  center_page: { label: "逛中心專屬頁", hint: "在寰宇大學選一個中心" },
  series_page: { label: "逛系列頁", hint: "在寰宇大學進入一個系列" },
  subscribe: { label: "訂閱中心或系列", hint: "在中心頁或系列頁按訂閱鈴鐺" },
  broadcast_open: { label: "查看廣播公告", hint: "點中心頁的黃色公告橫條" },
  notices_filter: { label: "切換通知分類", hint: "通知頁切換全部、審核、訂閱、留言" },
  list_create: { label: "建立我的清單", hint: "按「加入清單」鈕，新增一份自己的清單" },
  list_add: { label: "加入我的清單", hint: "把課程、教材、系列或中心加入自己的清單" },
  list_share: { label: "分享我的清單", hint: "在「我的清單」按分享，把清單網址傳給朋友" },
  list_copy: { label: "複製別人的清單", hint: "打開朋友分享的清單，按「複製到我的清單」" },
} as const;
export type FeatureKey = keyof typeof FEATURES;
/** 會員看到的徽章：已取得或尚未取得（含目前進度）。 */
export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AchievementType;
  threshold: number;
  feature?: string | null;
  /** 量化單位（堂、天、次…；後台自選，空白時用條件類型的預設單位）。 */
  unit?: string | null;
  /** 指定系列卡的名稱（series_completed）。 */
  series?: string | null;
  /** 清單影片徽章：指定的影片名稱與所屬清單。 */
  lessonTitle?: string | null;
  courseTitle: string | null;
  current: number;
  earned: boolean;
  earnedAt: string | null;
};
/** 超級管理員設定徽章用。 */
export type AdminAchievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AchievementType;
  threshold: number;
  feature?: string | null;
  unit?: string | null;
  series?: string | null;
  courseId: string | null;
  courseTitle: string | null;
  /** 清單影片徽章指定的影片（章節編號與名稱）。 */
  lessonId?: string | null;
  lessonTitle?: string | null;
  active: boolean;
  earnedCount: number;
  /** 難易度 1～3 顆星（後台設定）。 */
  difficulty: 1 | 2 | 3;
  /** 目前有紀錄的會員總數（算「會員完成度」用，每一筆都帶同一個數字）。 */
  memberTotal: number;
};

/** 申請人顯示名稱：本名＋暱稱同時顯示，例如「王小明（小明）」；兩者相同或只有一個時只顯示一個。 */
export function applicantLabel(legalName: string | null | undefined, nickname: string | null | undefined): string {
  const legal = (legalName ?? "").trim();
  const nick = (nickname ?? "").trim();
  if (legal && nick && legal !== nick) return `${legal}（${nick}）`;
  return legal || nick;
}
