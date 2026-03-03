# 핀셋(FINSET) 최종 정책 정리

팀: 반지고리. 현재 코드 기준 로그인·큐레이션·스탯 정책 요약.

---

# FINSET Final Policy Summary (EN)

Team: Banjigori. Current code-base policy: login, curation, stats.

## 1. Login / Auth

- Email/password: Firebase Auth; signup requires email verification.
- Google: signInWithPopup first; if blocked, signInWithRedirect + intent in sessionStorage. getGoogleRedirectUser() before onAuthStateChanged.
- Guest: No login; after 20 questions prompt signup. Guest continue: intentDataForGoogle; on Google success stay on quiz from Q21.
- Email verification: sendEmailVerification; is_verified false until done. "Email edit" calls deleteUnverifiedUser then re-enter.
- Device limit: MAX_DEVICES = 3.

## 2. Curation

- Static (round 1,2,3): Index by round, sort subject/core_id, first N q_ids. user_rounds reuse.
- Adaptive (round 99): selectForSubject per subject. Zone 1 (12): one rep per core_id, proficiency ascending top 12. Zone 2 (8): remaining by calcScore, MAX_PER_CORE_ID=3, MAX_PER_SUB_CORE_ID=2, then relax. 3 Zone ratio removed.
- Constants: COVERAGE_PER_SUBJECT=12, WEAKNESS_PER_SUBJECT=8, EXCLUSION_WINDOW=3, REUSE_FIXED_FROM_ADAPTIVE_N=4.

## 3. Stats / Grading

- users/{uid}/stats/{certCode}: core_concept_stats, problem_type_stats, subject_stats, sub_core_id_stats.
- Elo: K=32, Lucky-guess 0.2. submitQuizResult updates exam_results and stats.

## 4. Branding

- Service: FINSET / Pin-set. Landing: Pin-set-MVP. Local keys: finset_*.

## 5. Key files

authService, AuthContext, LoginModal; aiRoundCurationService, examService; gradingService, statsService; constants.
