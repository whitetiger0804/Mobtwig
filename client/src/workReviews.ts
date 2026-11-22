import type { MemberSessionClient } from './memberSession.ts';

/** 활성 리뷰 또는 원문이 제거된 삭제 자리표시입니다. */
export interface WorkReview {
  id: string;
  rating: number | null;
  body: string | null;
  nickname: string | null;
  createdAt: string;
  commentCount: number;
  likeCount: number;
  mine: boolean;
  liked: boolean;
  reported: boolean;
  deleted: boolean;
}

/** 활성 리뷰의 평점 요약과 삭제 자리표시를 포함한 목록 페이지입니다. */
export interface WorkReviewPage {
  averageRating: number | null;
  reviewCount: number;
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
  items: WorkReview[];
  hasNext: boolean;
  myReview: WorkReview | null;
}

/** 리뷰에 등록된 댓글과 현재 회원의 상태입니다. */
export interface ReviewComment {
  id: string;
  body: string;
  nickname: string;
  createdAt: string;
  likeCount: number;
  mine: boolean;
  liked: boolean;
  reported: boolean;
}

/** 부모 리뷰와 등록순으로 정렬된 전체 댓글입니다. */
export interface ReviewCommentThread {
  review: WorkReview;
  items: ReviewComment[];
}

/** 공감 변경 후 서버가 확인한 상태입니다. */
export interface ReviewLikeResult {
  likeCount: number;
  liked: boolean;
}

/** 서버가 접수하는 신고 사유입니다. */
export type ReviewReportReason = 'SPAM' | 'ABUSE' | 'INAPPROPRIATE' | 'SPOILER' | 'OTHER';

const ratingValues = [1, 2, 3, 4, 5] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validRating = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
const isWorkId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,120}$/.test(value) && value === value.trim();
const isId = (value: unknown): value is string => typeof value === 'string' && /^-?[1-9][0-9]{0,18}$/.test(value) && value === value.trim()
  && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n;
const invalid = () => new Error('리뷰 응답의 형식이 올바르지 않습니다.');
const bodySpace = /[\s\u0085]/;

/**
 * 서버와 동일하게 양끝 Unicode 공백을 제거합니다.
 * @param value - 리뷰·댓글·신고 상세 입력입니다.
 * @returns 내부 공백을 유지한 정규화 문자열입니다.
 */
export function normalizeReviewBody(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && bodySpace.test(value[start])) start++;
  while (end > start && bodySpace.test(value[end - 1])) end--;
  return value.slice(start, end);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    && value === value.trim() && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && !!value && normalizeReviewBody(value) === value && [...value].length <= limit;
}

function viewerFlags(value: Record<string, unknown>, member: boolean): boolean {
  return typeof value.mine === 'boolean' && typeof value.liked === 'boolean' && typeof value.reported === 'boolean'
    && (member || !value.mine && !value.liked && !value.reported)
    && (!value.mine || !value.liked && !value.reported);
}

function parseReview(value: unknown, member: boolean): WorkReview {
  if (!object(value) || !isId(value.id) || !validTime(value.createdAt) || !count(value.commentCount)
      || !count(value.likeCount) || typeof value.deleted !== 'boolean' || !viewerFlags(value, member)) throw invalid();
  const { id, rating, body, nickname, createdAt, commentCount, likeCount, mine, liked, reported, deleted } = value;
  if (deleted ? rating !== null || body !== null || nickname !== null || mine || liked || reported
    : !validRating(rating) || typeof nickname !== 'string' || !normalizeReviewBody(nickname)
      || !(body === null || validText(body, 1000))) throw invalid();
  return { id, rating: rating as number | null, body: body as string | null, nickname: nickname as string | null,
    createdAt, commentCount, likeCount, mine: mine as boolean, liked: liked as boolean, reported: reported as boolean, deleted };
}

function parseComment(value: unknown, member: boolean): ReviewComment {
  if (!object(value) || !isId(value.id) || !validText(value.body, 500) || typeof value.nickname !== 'string'
      || !normalizeReviewBody(value.nickname) || !validTime(value.createdAt) || !count(value.likeCount)
      || !viewerFlags(value, member)) throw invalid();
  const { id, body, nickname, createdAt, likeCount, mine, liked, reported } = value;
  return { id, body, nickname, createdAt, likeCount, mine: mine as boolean, liked: liked as boolean, reported: reported as boolean };
}

function parsePage(value: unknown, member: boolean): WorkReviewPage {
  if (!object(value) || !count(value.reviewCount) || !object(value.ratingDistribution) || !Array.isArray(value.items)
      || !(value.averageRating === null || typeof value.averageRating === 'number' && Number.isFinite(value.averageRating))
      || typeof value.hasNext !== 'boolean') throw invalid();
  const { ratingDistribution, reviewCount, averageRating, hasNext } = value;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of ratingValues) {
    const total = ratingDistribution[rating];
    if (!count(total)) throw invalid();
    distribution[rating] = total;
  }
  const items = value.items.map(item => parseReview(item, member));
  const myReview = value.myReview === null ? null : parseReview(value.myReview, member);
  if (new Set(items.map(item => item.id)).size !== items.length || (!member && myReview !== null)
      || myReview !== null && (!myReview.mine || myReview.deleted)
      || items.some(item => item.mine && item.id !== myReview?.id)) throw invalid();
  return { averageRating, reviewCount, ratingDistribution: distribution, items, hasNext, myReview };
}

function parseThread(value: unknown, reviewId: string, member: boolean): ReviewCommentThread {
  if (!object(value) || !Array.isArray(value.items)) throw invalid();
  const review = parseReview(value.review, member);
  const items = value.items.map(item => parseComment(item, member));
  if (review.id !== reviewId || new Set(items.map(item => item.id)).size !== items.length) throw invalid();
  return { review, items };
}

function pagePath(workId: string, page: number, size: number): string {
  if (!isWorkId(workId)) throw new Error('리뷰를 볼 작품을 선택해 주십시오.');
  if (!Number.isInteger(page) || page < 1 || page > 2147483647 || !Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error('리뷰 페이지와 크기를 확인해 주십시오.');
  }
  return '/works/' + workId + '/reviews?' + new URLSearchParams({ page: String(page), size: String(size) });
}

function requireId(id: string): void {
  if (!isId(id)) throw new Error('리뷰 또는 댓글을 선택해 주십시오.');
}

function reviewBody(rating: number, text: string): string | null {
  if (!validRating(rating)) throw new Error('별점과 리뷰 내용을 확인해 주십시오.');
  const body = normalizeReviewBody(text) || null;
  if (body !== null && [...body].length > 1000) throw new Error('별점과 리뷰 내용을 확인해 주십시오.');
  return body;
}

function commentBody(text: string): string {
  const body = normalizeReviewBody(text);
  if (!body || [...body].length > 500) throw new Error('댓글 내용을 확인해 주십시오.');
  return body;
}

/**
 * 쿠키를 보내지 않고 작품의 공개 리뷰를 조회합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param workId - 공개 작품의 slug입니다.
 * @param page - 1부터 시작하는 페이지입니다.
 * @param size - 1부터 50까지의 페이지 크기입니다.
 * @param signal - 화면 이탈·갱신 취소 신호입니다.
 * @returns 활성 리뷰 집계와 공개 목록입니다.
 */
export async function readWorkReviews(apiUrl: string, workId: string, page: number, size: number, signal: AbortSignal): Promise<WorkReviewPage> {
  const response = await fetch(apiUrl + pagePath(workId, page, size), { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 404 ? '공개된 작품이 없습니다.' : '리뷰를 불러오지 못했습니다.');
  return parsePage(await response.json(), false);
}

/**
 * 현재 회원의 소유·공감·신고 상태와 페이지 밖의 본인 리뷰를 조회합니다.
 * @param client - 인증 세대와 쿠키를 관리하는 회원 세션입니다.
 * @param workId - 공개 작품의 slug입니다.
 * @param page - 1부터 시작하는 페이지입니다.
 * @param size - 1부터 50까지의 페이지 크기입니다.
 * @param signal - 화면 이탈·갱신 취소 신호입니다.
 * @returns 활성 리뷰 집계와 회원 목록입니다.
 */
export async function readMemberWorkReviews(client: MemberSessionClient, workId: string, page: number, size: number,
  signal: AbortSignal): Promise<WorkReviewPage> {
  return parsePage(await client.request('/api/members' + pagePath(workId, page, size), { signal }), true);
}

/**
 * 현재 회원의 별점과 선택 본문을 등록합니다.
 * @param client - CSRF와 인증 세대를 관리하는 회원 세션입니다.
 * @param workId - 리뷰를 작성할 작품의 slug입니다.
 * @param rating - 1부터 5까지의 필수 별점입니다.
 * @param text - 양끝 공백 제거 후 최대 1000 코드 포인트인 본문입니다.
 * @param signal - 화면 이탈·계정 전환 취소 신호입니다.
 * @returns 서버에 등록된 본인 리뷰입니다.
 */
export async function createWorkReview(client: MemberSessionClient, workId: string, rating: number, text: string,
  signal: AbortSignal): Promise<WorkReview> {
  if (!isWorkId(workId)) throw new Error('리뷰를 작성할 작품을 선택해 주십시오.');
  const body = reviewBody(rating, text);
  const item = parseReview(await client.request('/api/members/works/' + workId + '/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, body }), signal,
  }), true);
  if (!item.mine || item.deleted) throw invalid();
  return item;
}

/**
 * 본인 활성 리뷰의 별점과 본문을 수정합니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 수정할 리뷰 ID입니다.
 * @param rating - 1부터 5까지의 별점입니다.
 * @param text - 빈 문자열이면 별점만 남기는 본문입니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 수정한 본인 리뷰입니다.
 */
export async function updateWorkReview(client: MemberSessionClient, reviewId: string, rating: number, text: string,
  signal: AbortSignal): Promise<WorkReview> {
  requireId(reviewId);
  const body = reviewBody(rating, text);
  const item = parseReview(await client.request('/api/members/reviews/' + reviewId, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, body }), signal,
  }), true);
  if (item.id !== reviewId || !item.mine || item.deleted) throw invalid();
  return item;
}

/**
 * 본인 리뷰를 삭제하고 204 응답을 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 삭제할 리뷰 ID입니다.
 * @param signal - 화면 취소 신호입니다.
 */
export async function deleteWorkReview(client: MemberSessionClient, reviewId: string, signal: AbortSignal): Promise<void> {
  requireId(reviewId);
  if (await client.request('/api/members/reviews/' + reviewId, { method: 'DELETE', signal }) !== null) throw invalid();
}

/**
 * 쿠키 없이 공개 댓글 스레드를 읽습니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param reviewId - 부모 리뷰 ID입니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 부모 리뷰와 등록순 댓글입니다.
 */
export async function readReviewComments(apiUrl: string, reviewId: string, signal: AbortSignal): Promise<ReviewCommentThread> {
  requireId(reviewId);
  const response = await fetch(apiUrl + '/reviews/' + reviewId + '/comments', { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 404 ? '리뷰를 찾을 수 없습니다.' : '댓글을 불러오지 못했습니다.');
  return parseThread(await response.json(), reviewId, false);
}

/**
 * 현재 회원의 상태가 포함된 댓글 스레드를 읽습니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 부모 리뷰 ID입니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 부모 리뷰와 등록순 댓글입니다.
 */
export async function readMemberReviewComments(client: MemberSessionClient, reviewId: string, signal: AbortSignal): Promise<ReviewCommentThread> {
  requireId(reviewId);
  return parseThread(await client.request('/api/members/reviews/' + reviewId + '/comments', { signal }), reviewId, true);
}

/**
 * 활성 리뷰에 댓글을 등록합니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 댓글을 작성할 리뷰 ID입니다.
 * @param text - 정규화 후 1부터 500 코드 포인트의 본문입니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 등록된 본인 댓글입니다.
 */
export async function createReviewComment(client: MemberSessionClient, reviewId: string, text: string, signal: AbortSignal): Promise<ReviewComment> {
  requireId(reviewId);
  const body = commentBody(text);
  const item = parseComment(await client.request('/api/members/reviews/' + reviewId + '/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }), signal,
  }), true);
  if (!item.mine) throw invalid();
  return item;
}

/**
 * 삭제된 부모에 남은 본인 댓글도 수정합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 수정할 댓글 ID입니다.
 * @param text - 정규화 후 1부터 500 코드 포인트의 본문입니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 수정한 본인 댓글입니다.
 */
export async function updateReviewComment(client: MemberSessionClient, commentId: string, text: string, signal: AbortSignal): Promise<ReviewComment> {
  requireId(commentId);
  const body = commentBody(text);
  const item = parseComment(await client.request('/api/members/review-comments/' + commentId, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }), signal,
  }), true);
  if (item.id !== commentId || !item.mine) throw invalid();
  return item;
}

/**
 * 본인 댓글을 삭제하고 204 응답을 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 삭제할 댓글 ID입니다.
 * @param signal - 화면 취소 신호입니다.
 */
export async function deleteReviewComment(client: MemberSessionClient, commentId: string, signal: AbortSignal): Promise<void> {
  requireId(commentId);
  if (await client.request('/api/members/review-comments/' + commentId, { method: 'DELETE', signal }) !== null) throw invalid();
}

async function setLike(client: MemberSessionClient, path: string, id: string, liked: boolean, signal: AbortSignal): Promise<ReviewLikeResult> {
  requireId(id);
  const value = await client.request(path + '/' + id + '/like', { method: liked ? 'PUT' : 'DELETE', signal });
  if (!object(value) || !count(value.likeCount) || value.liked !== liked) throw invalid();
  return { likeCount: value.likeCount, liked };
}

/**
 * 다른 회원 리뷰의 공감을 지정한 상태로 멱등 변경합니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 공감할 리뷰 ID입니다.
 * @param liked - true면 추가하고 false면 취소합니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 서버가 확인한 공감 수와 상태입니다.
 */
export function setReviewLike(client: MemberSessionClient, reviewId: string, liked: boolean, signal: AbortSignal): Promise<ReviewLikeResult> {
  return setLike(client, '/api/members/reviews', reviewId, liked, signal);
}

/**
 * 다른 회원 댓글의 공감을 지정한 상태로 멱등 변경합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 공감할 댓글 ID입니다.
 * @param liked - true면 추가하고 false면 취소합니다.
 * @param signal - 화면 취소 신호입니다.
 * @returns 서버가 확인한 공감 수와 상태입니다.
 */
export function setReviewCommentLike(client: MemberSessionClient, commentId: string, liked: boolean, signal: AbortSignal): Promise<ReviewLikeResult> {
  return setLike(client, '/api/members/review-comments', commentId, liked, signal);
}

async function report(client: MemberSessionClient, path: string, id: string, reason: ReviewReportReason, text: string,
  signal: AbortSignal): Promise<void> {
  requireId(id);
  const detail = normalizeReviewBody(text) || null;
  if (detail !== null && [...detail].length > 500) throw new Error('신고 사유와 내용을 확인해 주십시오.');
  const value = await client.request(path + '/' + id + '/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, detail }), signal,
  });
  if (!object(value) || value.reported !== true) throw invalid();
}

/**
 * 다른 회원의 리뷰를 신고하며 중복 접수 결과도 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param reviewId - 신고할 리뷰 ID입니다.
 * @param reason - 서버가 정의한 신고 사유입니다.
 * @param detail - 빈 문자열이면 null이며 최대 500 코드 포인트의 상세입니다.
 * @param signal - 화면 취소 신호입니다.
 */
export function reportReview(client: MemberSessionClient, reviewId: string, reason: ReviewReportReason, detail: string,
  signal: AbortSignal): Promise<void> {
  return report(client, '/api/members/reviews', reviewId, reason, detail, signal);
}

/**
 * 다른 회원의 댓글을 신고하며 중복 접수 결과도 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 신고할 댓글 ID입니다.
 * @param reason - 서버가 정의한 신고 사유입니다.
 * @param detail - 빈 문자열이면 null이며 최대 500 코드 포인트의 상세입니다.
 * @param signal - 화면 취소 신호입니다.
 */
export function reportReviewComment(client: MemberSessionClient, commentId: string, reason: ReviewReportReason, detail: string,
  signal: AbortSignal): Promise<void> {
  return report(client, '/api/members/review-comments', commentId, reason, detail, signal);
}
