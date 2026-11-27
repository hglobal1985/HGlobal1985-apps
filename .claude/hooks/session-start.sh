#!/bin/bash
# 開新對話時自動同步最新的 main（杜杜龍 2026-11-20：不用每次叫 AI「先同步最新程式」）。
# 絕不破壞任何東西：有未提交的修改、或分支上有自己還沒合併的提交時，只提醒、不動程式。
# 輸出的文字會顯示給這次對話的 AI 看，所以寫成給 AI 的指示。
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# 結束前（不論走哪個分支）自動補裝套件：新對話的雲端環境是全新的，別人新加進 package.json 的套件不會自動裝。
# 沒缺東西時只要幾秒；失敗也不影響開工，只提醒。（杜杜龍 2026-11-22）
install_deps() {
  cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || return 0
  [ -f package.json ] || return 0
  if npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1; then
    echo "【自動安裝套件】已確認套件齊全。"
  else
    echo "【自動安裝套件】套件安裝失敗，開工前請自己執行 npm install；若出現 Cannot find module 就是沒裝好，不可忽略。"
  fi
}
# 開工簡報（杜杜龍 2026-11-27：隨時換新對話、換 Claude 帳號都能接手，不重做、不撞到別人正在改的檔案）。
# 只用 git 與公開網址（每個環境都有），任何一步失敗都略過，不影響開工。
briefing() {
  cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || return 0
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  timeout 40 git fetch origin --prune --quiet 2>/dev/null
  echo "【開工簡報】"
  for app in "行動大學|https://learn.hglobal1985.com/api/v2/version" "繳作業系統|https://check.hglobal1985.com/api/version"; do
    name=${app%%|*}; url=${app#*|}
    sha=$(curl -s -m 5 "$url" 2>/dev/null | grep -o '"sha":"[0-9a-f]*"' | cut -d'"' -f4)
    if [ -n "$sha" ]; then
      if git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
        behind=$(git rev-list --count "$sha"..origin/main 2>/dev/null)
        echo "- $name 線上版本 ${sha:0:7}$( [ "$behind" != "0" ] && echo "（main 比線上新 $behind 個提交，還沒部署）")"
      else
        echo "- $name 線上版本 ${sha:0:7} 不在 main 的歷史裡：有人從沒合併的分支部署過，請先查清楚再部署！"
      fi
    fi
  done
  echo "- main 最近合併的工作（新到舊）："
  git log origin/main --merges --first-parent -8 --format='  %cs %b' 2>/dev/null | grep -v '^  [0-9-]* *$'
  cutoff=$(date -d '3 days ago' +%s 2>/dev/null || echo 0)
  active=""
  for ref in $(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/origin 2>/dev/null | grep -v -E '^origin(/HEAD|/main)?$' | head -60); do
    [ "$(git log -1 --format=%ct "$ref")" -lt "$cutoff" ] && break
    [ "$(git rev-list --count origin/main.."$ref" 2>/dev/null)" = "0" ] && continue
    files=$(git diff --name-only origin/main..."$ref" 2>/dev/null | head -6 | tr '\n' ' ')
    active="$active\n  ${ref#origin/}（$(git log -1 --format=%cr "$ref")）：$files"
  done
  if [ -n "$active" ]; then
    echo "- 最近 3 天別的對話還沒合併的工作（開工前看一下有沒有撞到同一批檔案；撞到就先問杜杜龍，或等它合併後再改）：$(printf "$active" | head -16)"
  else
    echo "- 最近 3 天沒有別的對話還沒合併的工作。"
  fi
  echo "- 守則：開工第一步先開「草稿 PR」寫明要做什麼（GitHub 的 PR 清單＝大家共用的工作看板）；做完合併進 main。部署方式見 CLAUDE.md「部署」。"
}
trap 'briefing; install_deps' EXIT
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

if ! git fetch origin main --quiet 2>/dev/null; then
  echo "【自動同步】抓不到最新的 main（網路問題）。開工前請自己執行 git fetch origin main 確認。"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD)
origin=$(git rev-parse origin/main)
head=$(git rev-parse HEAD)
short=$(git rev-parse --short origin/main)

if [ "$head" = "$origin" ]; then
  echo "【自動同步】已是最新的 main（$short）。請遵守 CLAUDE.md「多個 AI 同時開發的協作守則」。"
  exit 0
fi

dirty=$(git status --porcelain)
ahead=$(git rev-list --count origin/main..HEAD)
behind=$(git rev-list --count HEAD..origin/main)

if [ -z "$dirty" ] && [ "$ahead" = "0" ]; then
  # 這個分支沒有任何自己的提交：直接移到最新的 main（只是移動指標，不會弄丟東西）。
  if git merge --ff-only origin/main --quiet 2>/dev/null; then
    echo "【自動同步】分支 $branch 已更新到最新的 main（$short，落後的 $behind 個提交已補上）。請在這份最新程式上開工。"
    exit 0
  fi
fi

echo "【自動同步】分支 $branch 比最新的 main（$short）落後 $behind 個提交、自己有 $ahead 個還沒合併的提交$( [ -n "$dirty" ] && echo "、而且有未提交的修改")。"
echo "為了不弄丟東西，這次沒有自動更新。開工前請先處理：把 origin/main 合併進目前分支（衝突時兩邊的內容都要保留），或先把目前的成果合併進 main。部署前一定要用 npm run deploy -w @learn/launch。"
exit 0
