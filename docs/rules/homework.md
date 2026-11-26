# 作業（繳交、批改評分、分組）

- **作業功能（杜杜龍 2026-11-25，第一個用在美力之星；照互動設計圖 https://claude.ai/artifact/SE1cJhFwDZJtg6j1i8uwvJ）**：
  ① **入口（不新增主選單按鈕）**：「學習中」最上面的「我的作業」卡（`features/homework/my-homework-card.tsx`，`GET /homework/mine`：被退回、還沒交的排前面，最近截止與剩幾天；老師另外看到「待批改」）；課程頁封面下方的「作業」列（`features/homework/course-entry.tsx`，只有已開通的學員、組員、老師看得到；沒有作業時只有老師看得到）；課程設定（編輯模式）多兩項「作業與批改」「學員分組」（`course-sections.tsx`，清單卡不顯示）。通知點了直接進那份作業 `/homework/a/:id`。
  ② **頁面**：`app/homework/[courseId].tsx`（一門課的作業清單；老師「出新作業」「學員分組」）、`app/homework/a/[id].tsx`（一份作業：學員放檔案→下方固定「送出作業」，截止前可修改；老師／組長看「繳交狀況」依組別、篩選全部／待批改／已批改／未繳、老師「開始批改」「提醒還沒交的人」「修改作業」）、`app/homework/s/[id].tsx`（看一份繳交；老師批改：分數快速鈕＋−／＋、5 顆星、通過；下方固定「退回重交」（左）／「儲存並下一份」（右），批完自動跳下一份）、`app/homework/groups/[courseId].tsx`（分組）。
  ③ **學員可以交**：照片（瀏覽器先壓到長邊 2000）、**短影片 3 分鐘內**（沿用 `features/uploads/video-compress` 在學員自己的瀏覽器壓縮，規格 `contract.ts` 的 `HW_VIDEO`：720p、1200kbps、上限 80MB，並擷取預覽圖）、檔案（PDF、Word、簡報、Excel、文字檔，30MB，沿用 `files.ts` 的 `classifyFile`，影片檔不收）、連結、文字心得；每份最多 10 個檔案或連結（`HW_LIMITS`）。老師出作業時勾選這份收哪些。**上傳只有網頁版**（App 版顯示請用手機瀏覽器，同相簿上傳的做法）。
  ④ **評分方式三種**（`HW_GRADINGS`）：分數（可設滿分）、5 顆星、通過／重交；每種都能「退回重交」（必須寫評語）。**只有老師能評分**；老師＝管理員、有這門課修改權的人、這門課「費用與審核」的審核窗口（`api.ts` 的 `hwIsTeacher`）。評分、退回、留言都會通知學員。
  ⑤ **誰看得到（作業不公開）**：本人；老師（全部）；**組長**（自己這組，看得到分數、可以留言，不能評分）；**同組組員互相看得到已送出的作業，但看不到別人的分數**（杜杜龍決定可以互看）；其他組、沒報名的人都看不到。只有這門課已開通（`enrollments`）的學員能交。
  ⑥ **分組**：組長、老師都可以編（杜杜龍決定）。老師：建組、改名、刪組、換組、指定組長（一組一位）；組長：把還沒分組的學員拉進自己這組、把組員移出、改自己這組的組名，不能指定組長；一般學員只看得到自己這組的名單。
  ⑦ **後端**：`apps/launch/src/homework.ts`（`HW_ROUTES`，由 `api.ts` 的 `hwDeps` 接上登入、`fail`、`notify`、`isTeacher`）；資料表 migration 0138：`hw_assignments`、`hw_submissions`（draft／submitted／graded／returned）、`hw_files`、`hw_comments`、`hw_groups`、`hw_group_members`。**檔案存 R2 的 `hw/…`，不經過 `/media/pub`**，一律用 `GET /homework/file?k&e&n&s` 短效簽名網址（Secret `MEDIA_URL_SECRET`，6 小時有效，網址被改就失效）；刪除作業會一併刪掉 R2 檔案；儲存空間統計歸到課程的主辦中心。測試 `tests/homework.test.ts`。
  ⑧ **注意**：免費、沒有章節、也沒有日期的課程會被當成「教材卡」而不能報名——要交作業的課（例如美力之星每一屆）要設定上課日期或章節，學員才報得了名、交得了作業。截止前自動提醒還沒做（目前是老師按「提醒還沒交的人」）。
