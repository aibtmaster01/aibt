#!/bin/bash
# GitHub 푸시용 스크립트 (처음 한 번 또는 업로드 안 될 때)
# 사용: 터미널에서 프로젝트 루트로 이동 후 → ./scripts/git-push.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 원격 확인 ==="
git remote -v

echo ""
echo "=== 현재 브랜치 ==="
git branch

echo ""
echo "=== 변경 사항 스테이징 ==="
git add -A
git status

echo ""
read -p "커밋하고 푸시할까요? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "취소했습니다."
  exit 0
fi

if [[ -n $(git status -s) ]]; then
  git commit -m "chore: sync project (docs, config, frontend)"
  echo "커밋 완료."
else
  echo "커밋할 변경이 없습니다."
fi

echo ""
echo "=== 푸시 (origin) ==="
# main 브랜치가 있으면 main, 없으면 master
if git show-ref --verify --quiet refs/heads/main; then
  git push -u origin main
else
  git push -u origin master
fi

echo ""
echo "완료."
