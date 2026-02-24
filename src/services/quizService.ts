import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Question } from '../types';
import { MOCK_QUESTIONS } from '../constants';
import { to1BasedAnswer } from '../utils/questionUtils';

const TARGET_QUESTION_COUNT = 20;

/** Firestore static exam document: { q_ids: string[] } */
interface StaticExamDoc {
  q_ids: string[];
}

/** Firestore question document (raw) */
interface FirestoreQuestionDoc {
  content: string;
  options: string[];
  answer: number; // 1-based
  explanation: string;
  wrongFeedback?: Record<string, string>;
  imageUrl?: string;
  table_data?: string | { headers: string[]; rows: string[][] } | null;
}

/** Firestore question_pool document (for round 5) */
interface QuestionPoolDoc {
  questionId?: string;
  hierarchy?: string;
  random_id: number;
  difficulty?: string;
  content?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
  wrongFeedback?: Record<string, string>;
  table_data?: string | { headers: string[]; rows: string[][] } | null;
}

function mapToQuestion(id: string, data: FirestoreQuestionDoc | QuestionPoolDoc): Question {
  const d = data as FirestoreQuestionDoc & Partial<QuestionPoolDoc> & { problem_types?: string[]; tags?: string[]; trend?: string | null; estimated_time_sec?: number; trap_score?: number; hierarchy?: string; topic?: string };
  const options = Array.isArray(d.options) ? d.options : [];
  const rawAnswer = typeof d.answer === 'number' ? d.answer : 1;
  return {
    id,
    content: d.content ?? '',
    options,
    answer: to1BasedAnswer(rawAnswer, options.length),
    explanation: d.explanation ?? '',
    wrongFeedback: d.wrongFeedback,
    imageUrl: d.imageUrl,
    hierarchy: d.hierarchy,
    topic: d.topic,
    tags: Array.isArray(d.tags) ? d.tags : [],
    trend: d.trend ?? null,
    estimated_time_sec: typeof d.estimated_time_sec === 'number' ? d.estimated_time_sec : 0,
    trap_score: typeof d.trap_score === 'number' ? d.trap_score : 0,
    problem_types: Array.isArray(d.problem_types) ? d.problem_types : undefined,
    tableData: d.table_data ?? undefined,
  };
}

/**
 * Fetch questions for round 1~4 from static exams.
 */
async function fetchStaticQuestions(certId: string, round: number): Promise<Question[]> {
  const examRef = doc(db, 'certifications', certId, 'static_exams', `Round_${round}`);
  const examSnap = await getDoc(examRef);

  if (!examSnap.exists()) {
    return [];
  }

  const { q_ids } = examSnap.data() as StaticExamDoc;
  if (!Array.isArray(q_ids) || q_ids.length === 0) {
    return [];
  }

  // Firestore 'in' query limit is 30, batch if needed
  const questionsRef = collection(db, 'questions');
  const results: Question[] = [];

  for (let i = 0; i < q_ids.length; i += 30) {
    const batch = q_ids.slice(i, i + 30);
    const refs = batch.map((id) => doc(db, 'questions', id));
    const q = query(questionsRef, where(documentId(), 'in', refs));
    const snap = await getDocs(q);

    snap.docs.forEach((d) => {
      results.push(mapToQuestion(d.id, d.data() as FirestoreQuestionDoc));
    });
  }

  // Preserve order from q_ids
  const orderMap = new Map(results.map((q) => [q.id, q]));
  return q_ids.map((id) => orderMap.get(id)).filter(Boolean) as Question[];
}

/**
 * Fetch 20 random questions from question_pools using random_id >= rand.
 * Uses compound index (hierarchy, random_id) for performance.
 */
async function fetchRandomQuestionsFromPool(certId: string): Promise<Question[]> {
  const poolRef = collection(db, 'certifications', certId, 'question_pools');
  const hierarchyValue = `certifications/${certId}`;
  const randomValue = Math.random();

  const q = query(
    poolRef,
    where('hierarchy', '==', hierarchyValue),
    where('random_id', '>=', randomValue),
    orderBy('random_id'),
    limit(TARGET_QUESTION_COUNT)
  );

  const snap = await getDocs(q);
  let questions = snap.docs.map((d) => {
    const data = d.data() as QuestionPoolDoc;
    const qId = data.questionId ?? d.id;
    return mapToQuestion(qId, data);
  });

  if (questions.length < TARGET_QUESTION_COUNT) {
    const fallback = query(
      poolRef,
      where('hierarchy', '==', hierarchyValue),
      where('random_id', '<', randomValue),
      orderBy('random_id', 'desc'),
      limit(TARGET_QUESTION_COUNT - questions.length)
    );
    const fallbackSnap = await getDocs(fallback);
    const more = fallbackSnap.docs.map((d) => {
      const data = d.data() as QuestionPoolDoc;
      const qId = data.questionId ?? d.id;
      return mapToQuestion(qId, data);
    });
    questions = [...questions, ...more];
  }

  return questions.slice(0, TARGET_QUESTION_COUNT);
}

/**
 * Get questions for a quiz.
 * @param certId - Certification ID (e.g. c1, c2)
 * @param round - 1~4: static exam, 5: AI mock (question_pools)
 * Firestore에 데이터가 없으면 c1/round 1일 때 MOCK_QUESTIONS 폴백
 */
export async function getQuestions(certId: string, round: number): Promise<Question[]> {
  let questions: Question[] = [];

  if (round >= 1 && round <= 4) {
    questions = await fetchStaticQuestions(certId, round);
  } else if (round === 5) {
    questions = await fetchRandomQuestionsFromPool(certId);
  }

  // Firestore에 데이터가 없을 때 MOCK_QUESTIONS 폴백 (개발/테스트용)
  if (questions.length === 0) {
    return MOCK_QUESTIONS;
  }

  return questions;
}
