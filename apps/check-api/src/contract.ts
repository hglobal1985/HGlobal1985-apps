/** 前後端共用的資料格式（App 直接 import 這個檔案）。 */

export type ItemMode = "count" | "fixed" | "pass" | "score" | "stars" | "onsite";
export type Kind = "photo" | "video" | "file" | "link" | "text";
export type SubStatus = "draft" | "submitted" | "leader_ok" | "returned" | "graded";
export type Role = "student" | "teacher" | "manager";

export const MODES: Record<ItemMode, string> = {
  count: "每件計分",
  fixed: "完成給分",
  pass: "通過／重交",
  score: "分數",
  stars: "5 顆星",
  onsite: "老師登錄",
};
export const KINDS: Record<Kind, string> = { photo: "照片", video: "短影片", file: "檔案", link: "連結", text: "文字" };
export const STATUS_LABEL: Record<SubStatus | "none", string> = {
  none: "未繳交",
  draft: "草稿・尚未送出",
  submitted: "已送出・待批改",
  leader_ok: "組長已確認・待評分",
  returned: "退回重交",
  graded: "已評分",
};

/** 上傳限制（前後端共用）。 */
export const LIMITS = {
  entries: 10, // 每份最多 10 個檔案或連結
  photoMB: 15,
  fileMB: 30,
  videoMB: 80, // App 先壓縮再上傳
  videoSeconds: 180, // 短影片 3 分鐘內
  textChars: 4000,
  commentChars: 1000,
};

export type ItemCard = {
  id: string;
  lessonId: string;
  name: string;
  note: string;
  mode: ItemMode;
  per: number | null;
  unit: string;
  maxPoints: number | null;
  minCount: number | null;
  points: number | null;
  fullScore: number | null;
  inTotal: boolean;
  kinds: Kind[];
  lateAllowed: boolean | null;
  /** 學員自己的狀態。 */
  my?: { status: SubStatus; points: number | null; late: boolean } | null;
  /** 老師看到的統計。 */
  stats?: { submitted: number; toReview: number; graded: number; students: number };
};

export type LessonView = { id: string; position: number; title: string; dueAt: string | null; items: ItemCard[] };

export type ActivityCard = {
  id: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "draft" | "open" | "closed";
  role: Role;
  pending: boolean;
  groupName: string | null;
  isLeader: boolean;
  total: number;
  todo: number;
  returned: number;
  toReview: number;
  nextDue: { lessonTitle: string; dueAt: string } | null;
  filesPurged: boolean;
};

export type ActivitySettings = {
  id: string;
  title: string;
  summary: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "draft" | "open" | "closed";
  joinCode: string;
  joinApproval: boolean;
  lateAllowed: boolean;
  autoRemind: boolean;
  peersSeeScores: boolean;
  retentionUntil: string | null;
  filesPurgedAt: string | null;
};

export type ActivityView = {
  activity: ActivitySettings;
  role: Role;
  isLeader: boolean;
  groupId: string | null;
  groupName: string | null;
  total: number;
  lessons: LessonView[];
  counts: { students: number; groups: number; pendingJoin: number; toReview: number };
};

/** url：連結的網址；照片則是 10 分鐘有效的讀取網址（/f/…）。 */
export type FileView = { id: string; kind: Kind; name: string; size: number; contentType: string; url?: string; body?: string };
export type CommentView = { id: string; memberId: string; name: string; roleLabel: string; body: string; createdAt: string; mine: boolean };

export type SubmissionView = {
  id: string;
  itemId: string;
  memberId: string;
  name: string;
  status: SubStatus;
  declared: number | null;
  approved: number | null;
  note: string;
  /** 同組互看且活動沒開放看分數時，以下分數欄位一律是 null。 */
  points: number | null;
  score: number | null;
  stars: number | null;
  comment: string;
  leaderNote: string;
  gradedAt: string | null;
  submittedAt: string | null;
  late: boolean;
  files: FileView[];
  comments: CommentView[];
};

export type ItemView = {
  activityId: string;
  activityTitle: string;
  item: ItemCard;
  lesson: { id: string; title: string; dueAt: string | null };
  role: Role;
  isLeader: boolean;
  deadlinePassed: boolean;
  lateAllowed: boolean;
  /** 學員本人可以編輯（加檔案、送出）。 */
  canEdit: boolean;
  my: SubmissionView | null;
  /** 同組已送出的作業（看不到分數，除非活動開放）。 */
  peers: { submissionId: string; memberId: string; name: string; files: number; kinds: Kind[] }[];
  /** 老師、組長看到的名單。 */
  roster?: { memberId: string; name: string; groupName: string | null; status: SubStatus | "none"; submissionId: string | null; points: number | null; late: boolean }[];
};

export type QueueEntry = { submission: SubmissionView; item: ItemCard; lessonTitle: string; groupName: string | null };

export type Person = { memberId: string; name: string; avatarUrl: string | null; role: Role; status: "pending" | "active"; groupId: string | null; isLeader: boolean; total: number | null };
export type GroupView = { id: string; name: string; joinCode: string | null; members: Person[] };
export type PeopleView = { canManage: boolean; canEditGroupId: string | null; groups: GroupView[]; unassigned: Person[]; pending: Person[]; staff: Person[] };

export type Notice = { id: string; title: string; body: string; link: string; read: boolean; createdAt: string };

/** staff＝在任何一份作業是老師、管理員或組長（底部選單顯示「批改」）；toReview＝等他處理的作業份數。 */
export type Me = { memberId: string; name: string; avatarUrl: string | null; superAdmin: boolean; unread: number; staff: boolean; toReview: number };

export const DEFAULT_KINDS: Record<ItemMode, Kind[]> = {
  count: ["photo", "video", "text"],
  fixed: ["photo", "video", "file", "link"],
  pass: ["photo", "video"],
  score: ["file", "video", "link"],
  stars: ["video", "link"],
  onsite: [],
};

/** 依計分方式算出得分（老師核定的件數、分數、星數）。 */
export function pointsFor(
  item: Pick<ItemCard, "mode" | "per" | "maxPoints" | "points" | "fullScore">,
  g: { approved?: number | null; score?: number | null; stars?: number | null },
): number {
  const round = (n: number) => Math.round(n * 10) / 10;
  switch (item.mode) {
    case "count": {
      const p = Math.max(0, g.approved ?? 0) * (item.per ?? 1);
      return round(item.maxPoints != null ? Math.min(p, item.maxPoints) : p);
    }
    case "fixed":
    case "pass":
      return item.points ?? 0;
    case "score":
    case "onsite":
      return round(Math.min(Math.max(0, g.score ?? 0), item.fullScore ?? 100));
    case "stars":
      return round(Math.min(5, Math.max(0, g.stars ?? 0)) * (item.per ?? 1));
  }
}

/** 計分規則的白話說明，例如「1 分／張・最高 5 分」。 */
export function ruleText(i: Pick<ItemCard, "mode" | "per" | "unit" | "maxPoints" | "minCount" | "points" | "fullScore" | "inTotal">): string {
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));
  switch (i.mode) {
    case "count":
      return `${n(i.per ?? 1)} 分／${i.unit}` + (i.maxPoints != null ? `・最高 ${n(i.maxPoints)} 分` : "") + (i.minCount ? `・至少 ${i.minCount} ${i.unit}` : "");
    case "fixed":
      return `完成得 ${n(i.points ?? 0)} 分`;
    case "pass":
      return `通過得 ${n(i.points ?? 0)} 分`;
    case "score":
      return `分數 0～${n(i.fullScore ?? 100)}` + (i.inTotal ? "" : "（另計）");
    case "stars":
      return `5 顆星・1 星 ${n(i.per ?? 1)} 分`;
    case "onsite":
      return `老師現場登錄・0～${n(i.fullScore ?? 100)}` + (i.inTotal ? "" : "（另計）");
  }
}
