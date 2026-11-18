import type { MemberSessionClient } from './memberSession.ts';

/** 작품에 공개되는 리뷰 항목입니다. */
export interface WorkReview {
  id: string;
  rating: number;
  body: string | null;
  nickname: string;
  createdAt: string;
}

/** 목록 페이지와 작품 전체 활성 리뷰의 평점 요약입니다. */
export interface WorkReviewPage {
  averageRating: number | null;
  reviewCount: number;
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
  items: WorkReview[];
  hasNext: boolean;
}

const ratingValues = [1, 2, 3, 4, 5] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validRating = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
const isWorkId = (value: string) => /^[a-z0-9-]{1,120}$/.test(value);
const invalid = () => new Error('리뷰 응답의 형식이 올바르지 않습니다.');
const bodySpace = /[\s\u0085]/;

/** 서버와 같은 양끝 공백 제거 후 문자 수를 사용합니다. */
export function normalizeReviewBody(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && bodySpace.test(value[start])) start++;
  while (end > start && bodySpace.test(value[end - 1])) end--;
  return value.slice(start, end);
}

function parseReview(value: unknown): WorkReview {
  if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || !validRating(value.rating)
      || typeof value.nickname !== 'string' || !value.nickname.trim()
      || !(value.body === null || typeof value.body === 'string' && !!normalizeReviewBody(value.body) && [...value.body].length <= 1000)
      || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.createdAt)
      || !Number.isFinite(Date.parse(value.createdAt))) throw invalid();
  const { id, rating, nickname, body, createdAt } = value;
  return { id, rating, nickname, body, createdAt };
}

function parsePage(value: unknown, page: number, size: number): WorkReviewPage {
  if (!object(value) || !count(value.reviewCount) || !object(value.ratingDistribution) || !Array.isArray(value.items)
      || typeof value.hasNext !== 'boolean') throw invalid();
  const { ratingDistribution, reviewCount, averageRating, hasNext } = value;
  if (Object.keys(ratingDistribution).length !== ratingValues.length) throw invalid();
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of ratingValues) {
    const total = ratingDistribution[rating];
    if (!count(total)) throw invalid();
    distribution[rating] = total;
  }
  const offset = (page - 1) * size;
  const items = value.items.map(parseReview);
  if (ratingValues.reduce((total, rating) => total + distribution[rating], 0) !== reviewCount
      || (reviewCount === 0 ? averageRating !== null : typeof averageRating !== 'number'
        || !Number.isFinite(averageRating) || averageRating < 1 || averageRating > 5)
      || items.length !== Math.min(size, Math.max(0, reviewCount - offset))
      || hasNext !== (offset + items.length < reviewCount)
      || new Set(items.map(item => item.id)).size !== items.length) throw invalid();
  return { averageRating: averageRating as number | null, reviewCount, ratingDistribution: distribution, items, hasNext };
}

/** 로그인 상태와 독립적으로 작품의 공개 리뷰를 조회합니다. */
export async function readWorkReviews(apiUrl: string, workId: string, page: number, size: number, signal: AbortSignal): Promise<WorkReviewPage> {
  if (!isWorkId(workId)) throw new Error('리뷰를 볼 작품을 선택해 주세요.');
  const response = await fetch(apiUrl + '/works/' + workId + '/reviews?' + new URLSearchParams({
    page: String(page), size: String(size),
  }), { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 404 ? '공개된 작품이 없습니다.' : '리뷰를 불러오지 못했습니다.');
  return parsePage(await response.json(), page, size);
}

/** 현재 로그인 세션과 CSRF를 사용해 별점 또는 본문이 있는 리뷰를 등록합니다. */
export async function createWorkReview(client: MemberSessionClient, workId: string, rating: number, text: string,
  signal: AbortSignal): Promise<WorkReview> {
  const body = normalizeReviewBody(text) || null;
  if (!isWorkId(workId) || !validRating(rating) || body !== null && [...body].length > 1000) {
    throw new Error('별점과 리뷰 내용을 확인해 주세요.');
  }
  const item = parseReview(await client.request('/api/members/works/' + workId + '/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, body }), signal,
  }));
  if (item.rating !== rating || item.body !== body) throw invalid();
  return item;
}
