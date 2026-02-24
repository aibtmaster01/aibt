# Public (정적 파일)

이 폴더의 파일은 빌드 시 그대로 복사되며, 루트 경로(`/`)로 제공됩니다.

## 퀴즈 문제 이미지 (샘플)

- **파일명**: `sample-question-image.png`
- **용도**: 퀴즈 문제 화면에서 참조하는 샘플 이미지. 실제 문제 이미지 연동 전까지 사용됩니다.
- **사용처**: `src/pages/Quiz.tsx` 에서 `/sample-question-image.png` 로 참조합니다.

이미지 파일을 이 폴더에 `sample-question-image.png` 이름으로 넣어두면 퀴즈 화면에 표시됩니다.  
실제 API 연동 시에는 `Quiz.tsx` 내 주석을 해제해 `currentQ.imageUrl`을 사용하면 됩니다.
