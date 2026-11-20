# 新專案「多 AI 協作設定」範本（業主 2026-11-20）

用途：業主開新的 GitHub 專案（新 App、新後台…）時，叫新對話的 AI「照 `docs/ai-collab-template/README.md` 把協作設定加進來」。

## 套用步驟（給 AI）
1. 確認新專案可寫入（`add_repo` 要 push 權限），從最新 `main` 開分支。
2. 複製 `session-start.sh` 到新專案的 `.claude/hooks/session-start.sh`（`chmod +x`），複製 `settings.json` 到 `.claude/settings.json`（新專案若已有 settings.json，合併 `hooks.SessionStart`，不要覆蓋）。
3. 把 `CLAUDE-section.md` 的內容加進新專案的 `CLAUDE.md`（沒有就新建；專案若是用 `AGENTS.md`，新建 `CLAUDE.md` 第一行寫 `@AGENTS.md` 再接這段）。
4. 改 `session-start.sh` 裡最後一段文字中的「部署指令」為新專案實際的部署方式；改 `CLAUDE-section.md` 第 3 點的部署入口。
5. 部署防護（選配，有手動部署才需要）：參考行動大學 `apps/launch/scripts/safe-deploy.mjs` 與 `GET /api/v2/version`——部署時把 git 編號寫進網站，部署前檢查「線上版本必須是目前程式的祖先」。若專案是合併後由 CI 自動部署，就不需要這一步。
6. 驗證：在乾淨的 main 跑一次 `bash .claude/hooks/session-start.sh`（應顯示已是最新）；在舊分支跑一次（應自動追上或提醒）。
7. 開 PR 合併。**機密一律不放進這些檔案。**

## 注意
- 開機動作只動「沒有自己提交、沒有未提交修改」的分支，其餘一律只提醒。
- 只用在「業主一次只用一個對話」的情境最安全；同時多對話請另外加上自動部署。
