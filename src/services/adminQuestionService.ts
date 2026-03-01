/**
 * 관리자 문제관리: 인덱스 필터, 문제 목록 조회, 문제 수정, 이미지 업로드
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { getQuestionIndexFromCache, syncQuestionIndex, type QuestionIndexItem } from './db/localCacheDB';
import { fetchQuestionsFromPools } from './examService';
import type { Question } from '../types';

const QUESTION_POOL_ID_BY_CERT: Record<string, string> = {
  BIGDATA: 'contents_1681',
};

const INDEX_STORAGE_IMAGE_PREFIX: Record<string, string> = {
  BIGDATA: 'assets/BIGDATA/questions',
};

/** 자격증 선택 시 사용 가능한 회차 목록 (인덱스에서 추출) */
export async function getRoundsForCert(certCode: string): Promise<number[]> {
  await syncQuestionIndex(certCode);
  const items = await getQuestionIndexFromCache(certCode);
  if (!items?.length) return [1, 2, 3, 4, 5, 99];
  const rounds = new Set<number>();
  items.forEach((it) => {
    const r = it.metadata?.round;
    if (typeof r === 'number') rounds.add(r);
  });
  return Array.from(rounds).sort((a, b) => a - b);
}

/** 자격증 + 회차 선택 시 사용 가능한 과목 목록 (인덱스에서 추출). 맨 앞에 0=전체 추가 */
export async function getSubjectsForCertAndRound(
  certCode: string,
  round: number
): Promise<{ subject: number; name: string }[]> {
  const items = await getQuestionIndexFromCache(certCode);
  const subjectNames: Record<string, string[]> = {
    BIGDATA: ['빅데이터 분석 기획', '빅데이터 탐색', '빅데이터 모델링', '빅데이터 시각화'],
    SQLD: ['데이터 모델링', 'SQL 기본', 'SQL 활용'],
    ADSP: ['데이터 이해', '데이터 분석', '데이터 활용'],
  };
  const names = subjectNames[certCode] ?? [];
  const result: { subject: number; name: string }[] = [{ subject: 0, name: '전체' }];
  if (!items?.length) return result;
  const subjects = new Set<number>();
  items.forEach((it) => {
    if ((it.metadata?.round ?? 99) !== round) return;
    const s = it.metadata?.subject;
    if (typeof s === 'number') subjects.add(s);
  });
  Array.from(subjects)
    .sort((a, b) => a - b)
    .forEach((subject) => result.push({ subject, name: names[subject - 1] ?? `${subject}과목` }));
  return result;
}

/** 인덱스에서 자격증·회차·과목 필터 후 q_id 목록 (subject 0 = 전체) */
export async function getFilteredQuestionIds(
  certCode: string,
  round: number,
  subject: number
): Promise<string[]> {
  await syncQuestionIndex(certCode);
  const items = await getQuestionIndexFromCache(certCode);
  if (!items?.length) return [];
  const list = items.filter((it) => {
    if ((it.metadata?.round ?? 99) !== round) return false;
    if (subject !== 0 && (it.metadata?.subject ?? 0) !== subject) return false;
    return true;
  });
  return list.map((it) => it.q_id);
}

/** 인덱스 메타+통계 (태그용) */
export function getIndexItemByQid(
  items: QuestionIndexItem[] | null,
  qId: string
): QuestionIndexItem | undefined {
  return items?.find((it) => it.q_id === qId);
}

/** 현재 페이지 q_id 목록으로 문제 전체 로드 */
export async function fetchQuestionsForAdmin(
  certCode: string,
  qIds: string[]
): Promise<Question[]> {
  if (qIds.length === 0) return [];
  return fetchQuestionsFromPools(certCode, qIds);
}

/** 문제 문서 Firestore 경로 */
function getQuestionDocRef(certCode: string, qId: string) {
  const poolId = QUESTION_POOL_ID_BY_CERT[certCode];
  if (!poolId) return null;
  return doc(db, 'certifications', certCode, 'question_pools', poolId, 'questions', qId);
}

/** 저장 시 wrong_feedback: 1-based Record → 0-based 배열로 저장 (JSON/기존 형식 호환) */
function wrongFeedbackToStorage(wrongFeedback?: Record<string, string>): string[] | undefined {
  if (!wrongFeedback || Object.keys(wrongFeedback).length === 0) return undefined;
  const max = Math.max(...Object.keys(wrongFeedback).map((k) => parseInt(k, 10)));
  const arr: string[] = [];
  for (let i = 1; i <= max; i++) {
    arr.push(wrongFeedback[String(i)] ?? '');
  }
  return arr;
}

/** 문제 수정 저장 (answer는 1-based로 입력받아 0-based answer_idx로 저장). image·table_data 있으면 해당 필드도 반영 */
export async function updateQuestionInFirestore(
  certCode: string,
  qId: string,
  payload: {
    question_text: string;
    options: string[];
    answer: number; // 1-based (1~4)
    explanation: string;
    wrong_feedback?: Record<string, string>;
    /** 이미지 필요 시 파일명(예: q_id.png), 불필요 시 null */
    image?: string | null;
    /** 문제 본문 표: HTML 문자열 또는 { headers, rows } 또는 null */
    table_data?: string | { headers: string[]; rows: string[][] } | null;
  }
): Promise<void> {
  const ref = getQuestionDocRef(certCode, qId);
  if (!ref) throw new Error('해당 자격증의 문제 경로를 찾을 수 없습니다.');
  const answer_idx = Math.max(0, payload.answer - 1);
  const wrongArr = wrongFeedbackToStorage(payload.wrong_feedback);
  const updateData: Record<string, unknown> = {
    question_text: payload.question_text,
    options: payload.options,
    answer_idx,
    answer: answer_idx, // 호환용
    explanation: payload.explanation || null,
    wrong_feedback: wrongArr ?? null,
  };
  if (payload.image !== undefined) {
    updateData.image = payload.image ?? null;
  }
  if (payload.table_data !== undefined) {
    updateData.table_data = payload.table_data ?? null;
  }
  await updateDoc(ref, updateData);
}

/** 이미지 업로드: 파일을 {q_id}.png 로 저장 후 다운로드 URL 반환 */
export async function uploadQuestionImage(
  certCode: string,
  qId: string,
  file: File
): Promise<string> {
  const prefix = INDEX_STORAGE_IMAGE_PREFIX[certCode] ?? `assets/${certCode}/questions`;
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const safeName = `${qId}.${ext}`;
  const storageRef = ref(storage, `${prefix}/${safeName}`);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  const docRef = getQuestionDocRef(certCode, qId);
  if (docRef) {
    await updateDoc(docRef, { image: url });
  }
  return url;
}

/** 문제 문서에서 이미지 필드만 null로 초기화 (이미지 삭제) */
export async function clearQuestionImage(certCode: string, qId: string): Promise<void> {
  const docRef = getQuestionDocRef(certCode, qId);
  if (!docRef) return;
  await updateDoc(docRef, { image: null });
}

/** Storage에 이미지 존재 여부 확인 (문제 doc의 image 필드 또는 동일 경로) */
export async function getQuestionImageUrl(certCode: string, qId: string): Promise<string | null> {
  const docRef = getQuestionDocRef(certCode, qId);
  if (!docRef) return null;
  const snap = await getDoc(docRef);
  const data = snap.data();
  const url = data?.image;
  return typeof url === 'string' && url ? url : null;
}
