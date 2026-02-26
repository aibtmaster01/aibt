#!/usr/bin/env bash
# Firebase Storage 버킷에 CORS 설정 적용 (근본 해결)
# 사용: ./apply-storage-cors.sh [버킷이름]
# 버킷이름 생략 시 aibt-99bc6.appspot.com, aibt-99bc6.firebasestorage.app 순으로 시도

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORS_FILE="${SCRIPT_DIR}/storage-cors.json"
PROJECT="aibt-99bc6"

if [ ! -f "$CORS_FILE" ]; then
  echo "CORS 파일이 없습니다: $CORS_FILE"
  exit 1
fi

if [ -n "$1" ]; then
  BUCKETS=("$1")
else
  BUCKETS=("${PROJECT}.appspot.com" "${PROJECT}.firebasestorage.app")
fi

for BUCKET in "${BUCKETS[@]}"; do
  echo "버킷 gs://${BUCKET} 에 CORS 적용 시도 중..."
  if gcloud storage buckets update "gs://${BUCKET}" --cors-file="$CORS_FILE" 2>/dev/null; then
    echo "CORS 적용 완료: gs://${BUCKET}"
    exit 0
  fi
  if gsutil cors set "$CORS_FILE" "gs://${BUCKET}" 2>/dev/null; then
    echo "CORS 적용 완료(gsutil): gs://${BUCKET}"
    exit 0
  fi
  echo "해당 버킷 적용 실패(권한/이름 확인): gs://${BUCKET}"
done

echo ""
echo "수동 적용 방법:"
echo "  1. Google Cloud Console → 스토리지 → 버킷 에서 실제 버킷 이름 확인"
echo "  2. gcloud storage buckets update gs://<버킷이름> --cors-file=${CORS_FILE}"
echo "  또는: gsutil cors set ${CORS_FILE} gs://<버킷이름>"
exit 1
