-- 寰宇繳作業系統（check）初始資料表。
-- 規則：會員只存中央的 member_id；顯示名稱是「必要的副本」（給老師、組員看），收到中央 member.profile_changed 會標記重讀、member.deleted 會刪除。
-- 不保存任何 Amway 資料（獎銜、會員編號、中心…）。

-- 一份作業活動（例如「美力之星 第二屆」）。
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  starts_on TEXT,                    -- YYYY-MM-DD
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft（只有管理員、老師看得到）／open／closed
  join_code TEXT NOT NULL UNIQUE,    -- 學員加入連結 /a/<code>
  join_approval INTEGER NOT NULL DEFAULT 1,  -- 加入要管理員核准
  late_allowed INTEGER NOT NULL DEFAULT 1,   -- 預設：截止後可補交（標示逾期）
  auto_remind INTEGER NOT NULL DEFAULT 1,    -- 截止前 3 天、1 天自動提醒沒交的人
  peers_see_scores INTEGER NOT NULL DEFAULT 0, -- 同組互看時看得到分數
  retention_until TEXT,              -- 檔案自動刪除日期 YYYY-MM-DD（成績保留）
  files_purged_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 活動的成員：學員、老師、活動管理員。
CREATE TABLE members (
  activity_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',   -- student／teacher／manager
  status TEXT NOT NULL DEFAULT 'active',  -- pending（等核准）／active／removed
  group_id TEXT,
  is_leader INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (activity_id, member_id)
);
CREATE INDEX members_member ON members (member_id);
CREATE INDEX members_group ON members (group_id);

-- 顯示名稱的必要副本（會員本人登入時從中央讀取更新；中央通知改名就標記 stale、刪帳號就刪除）。
CREATE TABLE people (
  member_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 分組：每組有自己的加入連結 /j/<code>。
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX groups_activity ON groups (activity_id, position);

-- 老師邀請連結（24 小時、只能一人使用）。
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher',
  expires_at TEXT NOT NULL,
  used_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 堂（第一堂…），每堂一個截止時間。
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,                       -- ISO 時間（含時區）
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lessons_activity ON lessons (activity_id, position);

-- 作業項目：計分方式 mode＝count（每件計分）／fixed（完成給分）／pass（通過或重交）／score（分數）／stars（5 顆星）／onsite（老師現場登錄）。
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'count',
  per REAL,          -- count：每件幾分；stars：1 星幾分
  unit TEXT NOT NULL DEFAULT '件',
  max_points REAL,   -- count：最高幾分
  min_count INTEGER, -- count：至少幾件（提示用）
  points REAL,       -- fixed／pass：得幾分
  full_score REAL,   -- score／onsite：滿分
  in_total INTEGER NOT NULL DEFAULT 1,  -- 是否加入總分
  kinds TEXT NOT NULL DEFAULT 'photo,video,file,link,text',
  late_allowed INTEGER,  -- NULL＝跟活動設定
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX items_lesson ON items (lesson_id, position);
CREATE INDEX items_activity ON items (activity_id);

-- 繳交：每人每項一筆。status＝draft／submitted／leader_ok／returned／graded。
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  declared INTEGER,          -- 學員申報的件數（count）
  approved INTEGER,          -- 老師核定的件數
  note TEXT NOT NULL DEFAULT '',
  points REAL,               -- 計入總分的得分
  score REAL,                -- score／onsite 的分數
  stars INTEGER,
  comment TEXT NOT NULL DEFAULT '',   -- 老師評語（退回時必填）
  leader_note TEXT NOT NULL DEFAULT '',
  graded_by TEXT,
  graded_at TEXT,
  submitted_at TEXT,
  late INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (item_id, member_id)
);
CREATE INDEX submissions_member ON submissions (member_id, activity_id);
CREATE INDEX submissions_activity ON submissions (activity_id, status);

-- 繳交的內容：kind＝photo／video／file／link／text。檔案存 R2（sub/<活動>/<繳交>/<隨機>），只用短效下載憑證讀取。
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  r2_key TEXT,
  url TEXT,
  body TEXT,
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX files_submission ON files (submission_id, position);

-- 下載憑證：10 分鐘內有效（影片可多次分段讀取），只發給有權限的人。
CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 留言（學員本人、同組、組長、老師）。
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  body TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,  -- 被管理員隱藏（檢舉處理）
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX comments_submission ON comments (submission_id, created_at);

-- 檢舉（商店上架規定：使用者產生的內容要能檢舉）。
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  target TEXT NOT NULL,      -- comment:<id>／file:<id>
  member_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 站內通知（之後接推播）。
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX notices_member ON notices (member_id, created_at);

-- 截止提醒已送出的紀錄（避免重複）。
CREATE TABLE reminders_sent (
  lesson_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,   -- d3／d1
  PRIMARY KEY (lesson_id, member_id, kind)
);

-- 中央 webhook 事件去重。
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
