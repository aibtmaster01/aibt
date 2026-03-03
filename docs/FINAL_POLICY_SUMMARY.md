# 핀셋(FINSET) 최종 정책 정리

팀: 반지고리. 현재 코드 기준 로그인·큐레이션·스탯 정책 요약.

---

# FINSET Final Policy Summary (EN)

Team: Banjigori. Current code-base policy: login, curation, stats.

## 1. Login / Auth

- **Email/password:** Firebase Auth; signup requires email verification.
- **Google:** signInWithPopup first; if blocked, signInWithRedirect + store intent in sessionStorage. On return, getGoogleRedirectUser() runs before onAuthStateChanged.
- **Guest:** No login; after 20 questions, prompt signup. Guest continue: intentDataForGoogle passed; on Google success stay on quiz from Q21.
- **Email verification:** sendEmailVerification on signup; is_verified false until user completes verification. "Email edit" calls deleteUnverifiedUser (remove Firestore doc + Auth user) then re-enter.
- **Device limit:** MAX_DEVICES = 3.

## 2. Curation (Mock exam item selection)

- **Static (round 1,2,3):** Index filter by round, sort by subject/core_id, take first N q_ids. Reuse user_rounds/{round}.questionIds if present.
- **Adaptive (round 99):** Use only round-99 pool. Per subject: selectForSubject(candidates, 20, ctx, globalUsedSubCoreIds).
  - **Zone 1 (coverage, 12):** One representative per core_id (max calcScore); sort core_ids by avg proficiency ascending; take top 12 core_ids.
  - **Zone 2 (weakness, 8):** Remaining candidates by calcScore descending; enforce MAX_PER_CORE_ID=3, MAX_PER_SUB_CORE_ID=2; then relax (sub_core, then core) if needed. Fill to 20.
- **Constants:** COVERAGE_PER_SUBJECT=12, WEAKNESS_PER_SUBJECT=8, MAX_PER_CORE_ID=3, MAX_PER_SUB_CORE_ID=2, EXCLUSION_WINDOW=3, REUSE_FIXED_FROM_ADAPTIVE_N=4.
- **Legacy:** 3 Zone (weakness/strength/random) ratio removed; selectQuestionIdsBy3Zones only used as name for per-subject loop that calls selectForSubject.

## 3. Stats / Grading

- **Storage:** users/{uid}/stats/{certCode} — core_concept_stats, problem_type_stats, subject_stats, sub_core_id_stats, confused_qids.
- **Elo:** New = Old + K*(Outcome - Expected), K=32, range 100–2500. Lucky-guess: if correct and confused, delta *= 0.2.
- **Submit:** submitQuizResult → exam_results + stats increment and proficiency update.

## 4. Branding

- Service: 핀셋 / FINSET. Landing: 핀셋-MVP. Team: 반지고리.
- Local keys: finset_device_id, finset_guest_quiz_progress, finset_local_cache.

## 5. Key files

- Auth: authService.ts, AuthContext.tsx, LoginModal.tsx
- Curation: aiRoundCurationService.ts, examService.ts
- Grading/Stats: gradingService.ts, statsService.ts
- Constants: constants.ts
