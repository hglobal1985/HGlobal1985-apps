# 新增一款寰宇 App 的範本與檢查清單（杜杜龍 2026-11-27）

> 寰宇生態系的每一款 App 都放在這個專案（`apps/<代號>-api` 後端＋`apps/<代號>-app` 手機／網頁），以中央會員為核心，共用 `packages/ui`（畫面）與 `packages/server-shared`（伺服器）。**照著繳作業系統（check）做最快**：它就是第一個照這份範本做出來的 App，需要的寫法都可以直接參考 `apps/check-api`、`apps/check-app`。

## 一、先跟杜杜龍確認（只有這幾件要問）
1. App 名稱、代號（GitHub／Cloudflare／網址都用同一個代號，例如 `check`）、網址（`<代號>.hglobal1985.com`）。
2. 請杜杜龍在中央會員後台登記這款 App（App 代號、網頁版來源、手機回傳網址 `<代號>://auth/google`），並把串接指令網址給你：`https://id.hglobal1985.com/handoff/<代號>`。**一律重新讀這個網址照做**，不要憑記憶。
3. 需要金鑰的（中央 webhook 簽章、服務金鑰、推播 VAPID）：由杜杜龍在 Cloudflare 後台設定，或杜杜龍明確授權你產生；**不寫進程式庫、不貼在對話**。

## 二、照抄的骨架（從 check 複製後改名）
| 要做的 | 參考 check 的檔案 | 共用模組（直接用，不要另寫） |
|---|---|---|
| Worker 進入點、網頁打包進 Worker | `apps/check-api/src/index.ts`、`scripts/embed-static.mjs` | `apps/launch/src/site.ts` 的 `serveStatic` |
| API 拆檔結構 | `src/core.ts`（共用）＋`src/routes/*.ts`（功能）＋`src/api.ts`（進入點） | — |
| 中央 Access Token 驗證、webhook 驗簽 | `src/central.ts` | `server-shared/src/central-verify.ts` |
| 寄 Email 前查信箱（服務金鑰） | `src/central.ts`、`core.ts` 的 `flushEmails` | `server-shared/src/central-service.ts` |
| 站內通知 → 手機推播 | `core.ts` 的 `flushPushes`、`/push/*` 路由、`apps/check-app/public/sw.js` | `server-shared/src/web-push.ts`、`server-shared/src/notice-push.ts` |
| 上傳壓縮設定（與所有 App 共用） | `/upload-settings` 路由、KV 綁定 `SHARED` | `server-shared/src/upload-settings.ts` |
| 整包下載（ZIP） | `routes/files.ts` 的 `handleZip` | `server-shared/src/zip-stream.ts` |
| 部署安全檢查、版本回報 | `scripts/safe-deploy.mjs`、`/api/version` 回 `sha` | `server-shared/deploy/guard.mjs` |
| 前台錯誤回報 | `routes/system.ts` 的 `/api/client-errors` | `packages/ui/src/lib/error-report.ts` |
| 手機／網頁登入（Google 中繼、換發、共用登入、刪除帳號） | `apps/check-app/src/central/auth.ts`、`config.ts` | `packages/ui/src/lib/central-client.ts`（錯誤、呼叫中央、憑證保存與跨分頁鎖、版本比對）、`packages/ui/src/lib/sso-keychain.ts`（iPhone 共用登入） |
| 畫面元件 | `apps/check-app/src/kit.tsx`（把共用元件接成 App 自己的名稱） | `packages/ui/src/ui/*`、`features/*`（見 `docs/rules/shared-ui.md`） |
| 共用元件需要的轉接檔 | `apps/check-app/src/lib/*.ts`、`state/session.tsx`、`api/client.ts` | 清單見 `docs/rules/shared-ui.md`「轉接檔完整清單」 |

## 三、上線前檢查清單
1. **登入**：Google 中繼、換發加鎖、登入永不過期（網頁 localStorage、手機安全儲存）、共用登入（網頁整頁導向；iPhone Keychain 群組，`app.json` 的 `extra.appleTeamId` 與 `keychain-access-groups`）、登出所有 App、App 內刪除帳號。
2. **中央規範**：收 webhook（member.deleted 刪副本、profile_changed 重讀）、不長期存信箱、只用核准的權限、App 內可刪帳號；`INTEGRATED_VERSION` 寫成目前的串接指令版本。
3. **部署**：`wrangler.jsonc` 不寫 `account_id`（公開程式庫），部署用 `npm run deploy -w @<代號>/api`（共用的安全檢查），自訂網域 `<代號>.hglobal1985.com`。
4. **自動檢查**：把新 App 的型別檢查與測試加進 `.github/workflows/checks.yml`；migration 放 `apps/<代號>-api/migrations/`（編號檢查會自動涵蓋）。
5. **開工簡報**：把新 App 的版本網址加進 `.claude/hooks/session-start.sh` 的清單。
6. **規則文件**：新增 `docs/rules/<代號>-app.md`，並加進 CLAUDE.md 的索引。
7. **手機優先**：390px 寬度截圖檢查；有填寫內容的頁面要攔「上一頁」（CLAUDE.md 規定）。
