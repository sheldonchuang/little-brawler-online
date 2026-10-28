#!/bin/bash
set -e

GH="/Users/sheldonair/.gemini/antigravity/scratch/bin/gh"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "================================================="
echo "🥊 熱血格鬥連線 (Little Brawlers) 自動雲端部署"
echo "================================================="

# 1. 確保 gh CLI 存在
if [ ! -f "$GH" ]; then
  echo "❌ 找不到 GitHub CLI，請確認路徑: $GH"
  exit 1
fi

# 2. 檢查 GitHub 登入狀態
echo "🔍 檢查 GitHub 帳號授權狀態..."
if ! "$GH" auth status >/dev/null 2>&1; then
  echo ""
  echo "👉 請在下方依提示完成 GitHub 登入授權："
  echo "   (建議選擇: GitHub.com -> HTTPS -> Yes -> Login with a web browser)"
  echo ""
  "$GH" auth login -h github.com -p https -w
fi

echo "✅ GitHub 帳號已成功驗證！"

# 3. 自動建立 GitHub 儲存庫並推送程式碼
echo ""
echo "🚀 正在為您建立 GitHub 公開儲存庫並推送程式碼..."
if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
else
  "$GH" repo create little-brawler-online --public --source=. --remote=origin --push
fi

# 4. 取得 Repository 網址
REPO_URL=$("$GH" repo view --json url -q .url)
echo "✅ 程式碼已成功託管在: $REPO_URL"

# 5. 生成 Render 1 鍵自動部署連結
DEPLOY_URL="https://render.com/deploy?repo=$REPO_URL"

echo ""
echo "================================================="
echo "🎉 部署準備完成！"
echo "正在自動開啟瀏覽器前往 Render 1 鍵雲端部署頁面..."
echo "若瀏覽器未自動跳出，請手動點擊以下網址："
echo "$DEPLOY_URL"
echo "================================================="

# 自動在 Mac 系統預設瀏覽器打開 Render 部署畫面
open "$DEPLOY_URL" || true
