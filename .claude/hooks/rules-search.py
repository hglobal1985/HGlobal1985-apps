#!/usr/bin/env python3
"""每次業主送出訊息時，自動用訊息內容搜尋 docs/rules/ 裡相關的業主規則，
把「規則標題＋所在檔案」列給 AI（只列標題，量很小），避免 AI 漏讀分檔裡的細節規則。
找不到就完全不輸出。任何錯誤都靜默結束，不影響對話。（業主 2026-11-22）"""
import glob, json, os, re, sys

try:
    data = json.load(sys.stdin)
    prompt = data.get("prompt", "") or ""
    root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    if len(prompt.strip()) < 4:
        sys.exit(0)

    # 從訊息取出「三個字一組」的片段與英文代號
    cjk = re.sub(r"[^一-鿿]+", " ", prompt).split()
    grams = set()
    for seg in cjk:
        for i in range(len(seg) - 2):
            grams.add(seg[i:i + 3])
        if len(seg) == 2:
            grams.add(seg)
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9_\-]{3,}", prompt)}
    stop = {"main", "docs", "true", "false", "this", "that", "with", "from", "claude"}
    words -= stop
    if not grams and not words:
        sys.exit(0)

    hits = []
    for path in sorted(glob.glob(os.path.join(root, "docs/rules/*.md"))):
        name = os.path.basename(path)
        for line in open(path, encoding="utf8"):
            if not line.startswith("- "):
                continue
            head = re.sub(r"\*\*|`", "", line[2:])[:90]
            low = line[:260].lower()
            score = sum(1 for g in grams if g in head) * 2 + sum(1 for w in words if w in low)
            if score >= 2:
                hits.append((score, name, head.split("：")[0][:50]))
    if not hits:
        sys.exit(0)
    hits.sort(key=lambda h: -h[0])
    top = hits[:8]
    files = sorted({h[1] for h in top})
    print("【自動規則搜尋】業主的訊息可能牽涉到以下已定案的規則（完整內容在 docs/rules/ 對應檔案，動手改之前請先讀相關條目，後面的條目常會取代前面的）：")
    for _, name, title in top:
        print(f"- docs/rules/{name}：{title}")
    print("相關分檔：" + "、".join(files))
except Exception:
    sys.exit(0)
