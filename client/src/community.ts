// #region 응답과 작성 자료형
import type { MemberSessionClient } from './memberSession.ts';
import { communityBodyTextLength } from './communityBody.ts';

/** 작품별·주제별·작품 홍보 게시판의 구분입니다. */
export type CommunityType = 'work' | 'topic' | 'promotion';
/** 게시판에서 허용하는 말머리 코드입니다. */
export type CommunityHead = 'IMPRESSION' | 'QUESTION' | 'THEORY' | 'FREE' | 'STORY' | 'PROMOTION';
/** 게시글에 연결된 공개 작품 요약입니다. */
export interface CommunityWork {
  id: string; title: string; author: string; imageUrl: string | null; kind: 'book' | 'magazine' | 'novel';
}
/** 게시판 검색·생성에서 선택할 공개 작품과 기존 게시판의 식별자입니다. */
export interface CommunityWorkResult { work: CommunityWork; boardId: string | null }
/** 빈 검색어는 전체 공개 작품을 페이지별로 조회합니다. */
export interface CommunityWorkFilter { page: number; size: number; query?: string }
/** 스포일러 범위를 선택하거나 표시할 공개 회차입니다. */
export interface CommunityChapter { id: string; number: number; title: string }
/** 서버가 제공하는 고정 이모티콘입니다. */
export interface CommunitySticker { id: string; code: string; name: string; imageUrl: string }
/** 업로드 또는 게시글 조회로 확인한 이미지입니다. URL은 서버 경로를 유지합니다. */
export interface CommunityImage { url: string; width: number; height: number; representative: boolean }
/** 게시판과 선택 가능한 말머리입니다. */
export interface CommunityBoard {
  id: string; type: CommunityType; name: string; work: CommunityWork | null; heads: CommunityHead[];
  latestPost: CommunityLatestPost | null;
}
/** 게시판 목록에서 표시할 최신 공개 글입니다. 스포일러 제목은 확인 전에 가립니다. */
export interface CommunityLatestPost {
  id: string; head: CommunityHead; title: string | null; nickname: string;
  likeCount: number; commentCount: number; hasSpoiler: boolean; locked: boolean;
}
/** 게시판 선택 목록과 이모티콘 목록입니다. */
export interface CommunityBoards { items: CommunityBoard[]; stickers: CommunitySticker[] }
/** 작품은 기존 공개 작품을 연결하고 주제는 이름을 입력하여 게시판을 만듭니다. */
export type CommunityBoardInput = { type: 'work'; workId: string } | { type: 'topic'; name: string };
/** 공개 글 또는 현재 회원의 숨김 글입니다. 잠긴 글의 원문은 null입니다. */
export interface CommunityPost {
  id: string; boardId: string; boardType: CommunityType; boardName: string; work: CommunityWork | null;
  head: CommunityHead; title: string | null; body: string | null; nickname: string;
  createdAt: string; updatedAt: string; publishedAt: string; status: 'PUBLISHED' | 'HIDDEN';
  spoiler: CommunityChapter | null; hasSpoiler: boolean; locked: boolean; mine: boolean; liked: boolean; reported: boolean;
  likeCount: number; commentCount: number; images: CommunityImage[]; stickers: CommunitySticker[];
}
/** 게시글에 여러 개 작성할 수 있는 댓글입니다. 잠긴 댓글의 원문은 null입니다. */
export interface CommunityComment {
  id: string; postId: string; body: string | null; nickname: string; createdAt: string; updatedAt: string;
  spoiler: CommunityChapter | null; hasSpoiler: boolean; locked: boolean; mine: boolean; stickers: CommunitySticker[];
}
/** 서버가 확인한 현재 페이지와 다음 페이지 유무입니다. */
export interface CommunityPage<T> { items: T[]; hasNext: boolean }
/** 게시글 목록에서 지정한 조건만 서버로 전송합니다. */
export interface CommunityPostFilter {
  page: number; size: number; boardId?: string; type?: CommunityType; head?: CommunityHead; query?: string; mine?: boolean;
}
/** 댓글 페이지 및 스포일러 열람 확인 여부입니다. */
export interface CommunityCommentFilter { page: number; size: number; reveal?: boolean; revealPost?: boolean; revealIds?: string[] }
/** 게시 또는 임시저장할 입력입니다. 이미지 순서의 첫 항목이 대표 이미지가 됩니다. */
export interface CommunityPostInput {
  boardId: string; workId: string | null; head: CommunityHead; title: string; body: string;
  hasSpoiler: boolean; spoilerChapterId: string | null; images: Omit<CommunityImage, 'representative'>[]; stickerIds: string[];
}
/** 댓글 본문이 없으면 이모티콘을 하나 이상 지정해야 합니다. */
export interface CommunityCommentInput { body: string | null; hasSpoiler: boolean; spoilerChapterId: string | null; stickerIds: string[] }
/** 서버에 접수할 신고 사유입니다. */
export type CommunityReportReason = 'SPAM' | 'ABUSE' | 'INAPPROPRIATE' | 'SPOILER' | 'OTHER';
// #endregion

// #region 응답 검증
const types: readonly CommunityType[] = ['work', 'topic', 'promotion'];
const heads: Record<CommunityType, readonly CommunityHead[]> = {
  work: ['IMPRESSION', 'QUESTION', 'THEORY', 'FREE'], topic: ['STORY', 'QUESTION'], promotion: ['PROMOTION'],
};
const reasons: readonly CommunityReportReason[] = ['SPAM', 'ABUSE', 'INAPPROPRIATE', 'SPOILER', 'OTHER'];
const invalid = () => new Error('커뮤니티 응답의 형식이 올바르지 않습니다.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^-?[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n;
const slug = (value: unknown): value is string => typeof value === 'string' && value === value.trim() && /^[a-z0-9-]{1,100}$/.test(value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string'
  && (empty || value.trim().length > 0) && [...value].length <= max;
const time = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

/**
 * 서버와 같은 Unicode 공백 규칙으로 입력의 양끝을 정리합니다.
 * @param value - 제목·본문·검색어·신고 상세 문자열입니다.
 * @returns 내부 공백과 줄바꿈을 유지한 문자열입니다.
 */
export function normalizeCommunityText(value: string): string { return value.replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''); }

function imagePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u001f]/.test(value) || value.startsWith('//')) return false;
  if (!/^https?:\/\//i.test(value) && /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.split(/[?#]/)[0].split('/').some(part => /^(?:\.|%2e){1,2}$/i.test(part))) return false;
  try {
    const parsed = new URL(value, 'https://community.invalid/');
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash;
  } catch { return false; }
}

/**
 * 서버의 상대 이미지 경로를 API 기준 경로를 유지한 절대 주소로 바꿉니다.
 * @param apiUrl - HTTP(S) API 기준 주소입니다.
 * @param value - 서버가 반환한 이미지 또는 이모티콘 경로입니다.
 * @returns React Native Image와 웹에서 사용할 HTTP(S) 주소입니다.
 */
export function communityImageUrl(apiUrl: string, value: string): string {
  if (!imagePath(value)) throw invalid();
  const base = new URL(apiUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw invalid();
  return /^https?:\/\//i.test(value) ? new URL(value).href : new URL(apiUrl.replace(/\/+$/, '') + '/' + value.replace(/^\//, '')).href;
}

function parseWork(value: unknown): CommunityWork | null {
  if (value === null) return null;
  if (!object(value) || !slug(value.id) || !text(value.title, 200) || !text(value.author, 1000, true)
      || !(value.imageUrl === null || imagePath(value.imageUrl)) || !['book', 'magazine', 'novel'].includes(String(value.kind))) throw invalid();
  return { id: value.id, title: value.title, author: value.author, imageUrl: value.imageUrl as string | null,
    kind: value.kind as CommunityWork['kind'] };
}

function parseWorkResult(value: unknown): CommunityWorkResult {
  if (!object(value) || !(value.boardId === null || id(value.boardId))) throw invalid();
  const work = parseWork(value.work);
  if (!work) throw invalid();
  return { work, boardId: value.boardId as string | null };
}

function parseChapter(value: unknown): CommunityChapter {
  if (!object(value) || !id(value.id) || !count(value.number) || value.number < 1 || !text(value.title, 200)) throw invalid();
  return { id: value.id, number: value.number, title: value.title };
}

function parseSticker(value: unknown): CommunitySticker {
  if (!object(value) || !id(value.id) || !text(value.code, 30) || !text(value.name, 30) || !imagePath(value.imageUrl)) throw invalid();
  return { id: value.id, code: value.code, name: value.name, imageUrl: value.imageUrl };
}

function parseImage(value: unknown): CommunityImage {
  if (!object(value) || !imagePath(value.url) || !count(value.width) || value.width < 1 || !count(value.height)
      || value.height < 1 || typeof value.representative !== 'boolean') throw invalid();
  return { url: value.url, width: value.width, height: value.height, representative: value.representative };
}

function parseLatestPost(value: unknown, type: CommunityType): CommunityLatestPost | null {
  if (value === null) return null;
  if (!object(value) || !id(value.id) || !heads[type].includes(value.head as CommunityHead) || !text(value.nickname, 30)
      || !count(value.likeCount) || !count(value.commentCount) || typeof value.hasSpoiler !== 'boolean'
      || value.locked !== value.hasSpoiler || (value.locked ? value.title !== null : !text(value.title, 100))) throw invalid();
  return { id: value.id, head: value.head as CommunityHead, title: value.title as string | null, nickname: value.nickname,
    likeCount: value.likeCount, commentCount: value.commentCount, hasSpoiler: value.hasSpoiler, locked: value.locked };
}

function parseBoard(value: unknown): CommunityBoard {
  if (!object(value) || !id(value.id) || !types.includes(value.type as CommunityType) || !text(value.name, 200)
      || !Array.isArray(value.heads) || !value.heads.length) throw invalid();
  const type = value.type as CommunityType, work = parseWork(value.work);
  if (value.heads.some(head => !heads[type].includes(head)) || new Set(value.heads).size !== value.heads.length
      || (type === 'work') !== (work !== null)) throw invalid();
  return { id: value.id, type, name: value.name, work, heads: [...value.heads] as CommunityHead[], latestPost: parseLatestPost(value.latestPost, type) };
}

function parsePost(value: unknown, member: boolean): CommunityPost {
  if (!object(value) || !id(value.id) || !id(value.boardId) || !types.includes(value.boardType as CommunityType)
      || !text(value.boardName, 200) || !heads[value.boardType as CommunityType].includes(value.head as CommunityHead)
      || !text(value.nickname, 30) || !time(value.createdAt) || !time(value.updatedAt)
      || !['PUBLISHED', 'HIDDEN'].includes(String(value.status)) || typeof value.locked !== 'boolean' || typeof value.hasSpoiler !== 'boolean'
      || typeof value.mine !== 'boolean' || typeof value.liked !== 'boolean' || typeof value.reported !== 'boolean'
      || !count(value.likeCount) || !count(value.commentCount) || !Array.isArray(value.images) || !Array.isArray(value.stickers)
      || value.images.length > 3 || value.stickers.length > 8) throw invalid();
  const work = parseWork(value.work), spoiler = value.spoiler === null ? null : parseChapter(value.spoiler);
  const images = value.images.map(parseImage), stickers = value.stickers.map(parseSticker);
  if ((!member && (value.mine || value.liked || value.reported)) || (value.mine && (value.liked || value.reported))
      || value.status !== 'PUBLISHED' && !value.mine
      || !time(value.publishedAt)
      || value.boardType !== 'topic' && work === null || spoiler !== null && (work === null || !value.hasSpoiler)
      || (value.locked ? !value.hasSpoiler || value.mine || value.title !== null || value.body !== null || images.length || stickers.length
        : !text(value.title, 100) || !text(value.body, 25000) || communityBodyTextLength(value.body, images) > 10000)
      || images.filter(image => image.representative).length > 1) throw invalid();
  return { id: value.id, boardId: value.boardId, boardType: value.boardType as CommunityType, boardName: value.boardName, work,
    head: value.head as CommunityHead, title: value.title as string | null, body: value.body as string | null, nickname: value.nickname,
    createdAt: value.createdAt, updatedAt: value.updatedAt, publishedAt: value.publishedAt,
    status: value.status as CommunityPost['status'], spoiler, hasSpoiler: value.hasSpoiler, locked: value.locked, mine: value.mine, liked: value.liked,
    reported: value.reported, likeCount: value.likeCount, commentCount: value.commentCount, images, stickers };
}

function parseComment(value: unknown, member: boolean): CommunityComment {
  if (!object(value) || !id(value.id) || !id(value.postId) || !text(value.nickname, 30) || !time(value.createdAt)
      || !time(value.updatedAt) || typeof value.locked !== 'boolean' || typeof value.mine !== 'boolean' || typeof value.hasSpoiler !== 'boolean'
      || !Array.isArray(value.stickers) || value.stickers.length > 4 || !member && value.mine) throw invalid();
  const spoiler = value.spoiler === null ? null : parseChapter(value.spoiler), stickers = value.stickers.map(parseSticker);
  if (spoiler !== null && !value.hasSpoiler || (value.locked ? !value.hasSpoiler || value.mine || value.body !== null || stickers.length > 0
    : !(value.body === null && stickers.length > 0 || text(value.body, 2000)))) throw invalid();
  return { id: value.id, postId: value.postId, body: value.body as string | null, nickname: value.nickname,
    createdAt: value.createdAt, updatedAt: value.updatedAt, spoiler, hasSpoiler: value.hasSpoiler, locked: value.locked, mine: value.mine, stickers };
}

function parsePage<T>(value: unknown, parse: (item: unknown) => T, identify: (item: T) => string): CommunityPage<T> {
  if (!object(value) || !Array.isArray(value.items) || typeof value.hasNext !== 'boolean') throw invalid();
  const items = value.items.map(parse);
  if (new Set(items.map(identify)).size !== items.length) throw invalid();
  return { items, hasNext: value.hasNext };
}
// #endregion

// #region 요청과 작성 입력 검증
function requireId(value: string): void { if (!id(value)) throw new Error('게시판·게시글·댓글 식별자를 확인해 주십시오.'); }
function pageParams(page: number, size: number): URLSearchParams {
  if (!Number.isInteger(page) || page < 1 || page > 2147483647 || !Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error('목록의 페이지와 크기를 확인해 주십시오.');
  }
  return new URLSearchParams({ page: String(page), size: String(size) });
}
async function read(apiUrl: string, path: string, signal: AbortSignal, client?: MemberSessionClient): Promise<unknown> {
  if (client) return client.request('/api/members/community' + path, { signal });
  const response = await fetch(apiUrl.replace(/\/+$/, '') + '/community' + path, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 404 ? '게시판이나 게시글을 찾을 수 없습니다.' : '커뮤니티를 불러오지 못했습니다.');
  return response.json();
}
function json(method: string, body: unknown, signal: AbortSignal): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}
function stickerIds(value: string[], max: number): void {
  if (!Array.isArray(value) || value.length > max || value.some(item => !id(item))) throw new Error('이모티콘 선택을 확인해 주십시오.');
}
function postInput(input: CommunityPostInput, draft: boolean): CommunityPostInput {
  requireId(input.boardId);
  if (!(input.workId === null || slug(input.workId)) || !Object.values(heads).flat().includes(input.head)
      || typeof input.title !== 'string' || typeof input.body !== 'string' || typeof input.hasSpoiler !== 'boolean'
      || !(input.spoilerChapterId === null || id(input.spoilerChapterId)) || input.spoilerChapterId !== null && input.workId === null
      || input.spoilerChapterId !== null && !input.hasSpoiler
      || !Array.isArray(input.images) || input.images.length > 3) throw new Error('게시글 입력을 확인해 주십시오.');
  const title = normalizeCommunityText(input.title), body = normalizeCommunityText(input.body);
  if (!text(title, 100, draft) || !text(body, 25000, draft)) throw new Error('제목은 100자, 본문은 10,000자 이내로 입력해 주십시오.');
  const images = input.images.map(image => {
    if (!object(image) || !imagePath(image.url) || !count(image.width) || image.width < 1 || !count(image.height) || image.height < 1) {
      throw new Error('첨부 이미지를 확인해 주십시오.');
    }
    return { url: image.url, width: image.width, height: image.height };
  });
  if (new Set(images.map(image => image.url)).size !== images.length) throw new Error('같은 이미지를 중복 첨부할 수 없습니다.');
  if (communityBodyTextLength(body, images) > 10000) throw new Error('본문은 10,000자 이내로 입력해 주십시오.');
  stickerIds(input.stickerIds, 8);
  return { boardId: input.boardId, workId: input.workId, head: input.head, title, body,
    hasSpoiler: input.hasSpoiler, spoilerChapterId: input.spoilerChapterId, images, stickerIds: [...input.stickerIds] };
}

/**
 * 기기에 저장한 초안을 게시글 입력과 같은 형식으로 검증합니다.
 * @param value - 로컬 저장소에서 읽은 초안 입력입니다.
 * @returns 빈 제목·본문을 허용하고 입력 공백을 정리한 초안입니다. 이전 초안은 회차 선택 여부로 스포일러 값을 복원합니다.
 */
export function parseCommunityDraftInput(value: unknown): CommunityPostInput {
  if (!object(value)) throw new Error('임시저장한 글의 형식이 올바르지 않습니다.');
  const migrated = value.hasSpoiler === undefined ? { ...value, hasSpoiler: value.spoilerChapterId !== null } : value;
  return postInput(migrated as unknown as CommunityPostInput, true);
}

/** 현재 게시판과 표시한 이모티콘 목록을 기준으로 게시 입력을 검증하고 서버와 같은 공백 정리를 적용합니다. */
export function validateCommunityPostForBoard(input: CommunityPostInput, board: CommunityBoard,
  stickers: readonly CommunitySticker[]): CommunityPostInput {
  const parsed = postInput(input, false);
  if (parsed.boardId !== board.id || !board.heads.includes(parsed.head)) {
    throw new Error('게시판과 말머리를 확인해 주세요.');
  }
  if (board.type === 'work' && parsed.workId !== null && parsed.workId !== board.work?.id) {
    throw new Error('게시판과 연결 작품이 일치하지 않습니다.');
  }
  if (board.type === 'promotion' && parsed.workId === null) throw new Error('홍보할 작품을 선택해 주세요.');
  if (parsed.stickerIds.some(id => !stickers.some(sticker => sticker.id === id))) {
    throw new Error('현재 사용할 수 있는 이모티콘을 선택해 주세요.');
  }
  return parsed;
}
function commentInput(input: CommunityCommentInput): CommunityCommentInput {
  if (!(input.body === null || typeof input.body === 'string') || typeof input.hasSpoiler !== 'boolean'
      || !(input.spoilerChapterId === null || id(input.spoilerChapterId)) || input.spoilerChapterId !== null && !input.hasSpoiler) {
    throw new Error('댓글 내용을 확인해 주십시오.');
  }
  stickerIds(input.stickerIds, 4);
  const body = input.body === null ? null : normalizeCommunityText(input.body) || null;
  if (!(body === null && input.stickerIds.length > 0 || text(body, 2000))) throw new Error('댓글은 2,000자 이내로 입력하거나 이모티콘을 선택해 주십시오.');
  return { body, hasSpoiler: input.hasSpoiler, spoilerChapterId: input.spoilerChapterId, stickerIds: [...input.stickerIds] };
}
// #endregion

// #region 게시판과 게시글 조회
/**
 * 게시판과 글·댓글 작성에 사용할 이모티콘을 조회합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param type - 선택한 커뮤니티 탭입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @param query - 게시판 이름의 검색어입니다. 생략하면 전체 목록을 조회합니다.
 * @returns 선택한 종류의 게시판과 서버 이모티콘 목록입니다.
 */
export async function readCommunityBoards(apiUrl: string, type: CommunityType, signal: AbortSignal, query?: string): Promise<CommunityBoards> {
  if (!types.includes(type)) throw new Error('게시판 종류를 확인해 주십시오.');
  const parameters = new URLSearchParams({ type });
  if (query !== undefined) {
    if (!text(query, 100, true)) throw new Error('검색어는 100자 이내로 입력해 주십시오.');
    parameters.set('query', normalizeCommunityText(query));
  }
  const value = await read(apiUrl, '/boards?' + parameters, signal);
  if (!object(value) || !Array.isArray(value.items) || !Array.isArray(value.stickers)) throw invalid();
  const items = value.items.map(parseBoard), stickers = value.stickers.map(parseSticker);
  if (items.some(item => item.type !== type) || new Set(items.map(item => item.id)).size !== items.length
      || new Set(stickers.map(item => item.id)).size !== stickers.length) throw invalid();
  return { items, stickers };
}

/**
 * 게시판이 없는 작품을 포함하여 공개 작품을 검색하거나 페이지별로 조회합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param filter - 작품 검색어와 조회할 페이지·크기입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 작품 정보와 기존 게시판 식별자를 포함한 페이지입니다.
 */
export async function readCommunityWorks(apiUrl: string, filter: CommunityWorkFilter, signal: AbortSignal): Promise<CommunityPage<CommunityWorkResult>> {
  const parameters = pageParams(filter.page, filter.size);
  if (filter.query !== undefined && !text(filter.query, 100, true)) throw new Error('검색어는 100자 이내로 입력해 주십시오.');
  parameters.set('query', normalizeCommunityText(filter.query ?? ''));
  const page = parsePage(await read(apiUrl, '/works?' + parameters, signal),
    parseWorkResult, item => item.work.id);
  const boardIds = page.items.flatMap(item => item.boardId === null ? [] : [item.boardId]);
  if (new Set(boardIds).size !== boardIds.length) throw invalid();
  return page;
}

/**
 * 회원이 선택한 작품 또는 주제로 게시판을 만들고 이미 있으면 기존 게시판을 받습니다.
 * @param client - CSRF와 인증 세대를 관리하는 회원 세션입니다.
 * @param input - 기존 공개 작품 식별자 또는 주제 이름입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 새로 생성했거나 이미 존재하는 게시판입니다.
 */
export async function createCommunityBoard(client: MemberSessionClient, input: CommunityBoardInput, signal: AbortSignal): Promise<CommunityBoard> {
  if (!object(input)) throw new Error('생성할 게시판을 확인해 주십시오.');
  let body: CommunityBoardInput;
  if (input.type === 'work' && slug(input.workId)) body = { type: 'work', workId: input.workId };
  else if (input.type === 'topic' && typeof input.name === 'string' && text(normalizeCommunityText(input.name), 100)) {
    body = { type: 'topic', name: normalizeCommunityText(input.name) };
  } else throw new Error('공개 작품을 선택하거나 주제 이름을 100자 이내로 입력해 주십시오.');
  const item = parseBoard(await client.request('/api/members/community/boards', json('POST', body, signal)));
  if (item.type !== body.type || body.type === 'work' && item.work?.id !== body.workId) throw invalid();
  return item;
}

/**
 * 선택한 게시판·말머리·검색어와 페이지로 글을 조회합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param filter - 페이지와 선택 조건입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @param client - 회원이면 개인화 조회 경로를 사용합니다.
 * @returns 원문 가림과 소유·공감 상태가 검증된 목록입니다.
 */
export async function readCommunityPosts(apiUrl: string, filter: CommunityPostFilter, signal: AbortSignal,
  client?: MemberSessionClient): Promise<CommunityPage<CommunityPost>> {
  const parameters = pageParams(filter.page, filter.size);
  if (filter.boardId !== undefined) { requireId(filter.boardId); parameters.set('boardId', filter.boardId); }
  if (filter.type !== undefined) {
    if (!types.includes(filter.type)) throw new Error('게시판 종류를 확인해 주십시오.');
    parameters.set('type', filter.type);
  }
  if (filter.head !== undefined) {
    if (!Object.values(heads).flat().includes(filter.head)) throw new Error('말머리를 확인해 주십시오.');
    parameters.set('head', filter.head);
  }
  if (filter.query !== undefined) {
    if (!text(filter.query, 100, true)) throw new Error('검색어는 100자 이내로 입력해 주십시오.');
    parameters.set('query', normalizeCommunityText(filter.query));
  }
  if (filter.mine !== undefined) {
    if (typeof filter.mine !== 'boolean' || filter.mine && !client) throw new Error('내 게시글을 보려면 로그인해 주십시오.');
    parameters.set('mine', String(filter.mine));
  }
  const page = parsePage(await read(apiUrl, '/posts?' + parameters, signal, client),
    value => parsePost(value, !!client), item => item.id);
  if (page.items.some(item => filter.mine && !item.mine || item.hasSpoiler && !item.mine && !item.locked
    || filter.boardId !== undefined && item.boardId !== filter.boardId || filter.type !== undefined && item.boardType !== filter.type
    || filter.head !== undefined && item.head !== filter.head)) throw invalid();
  return page;
}

/**
 * 게시글 하나를 조회하며 명시적으로 확인한 경우에만 스포일러 원문을 요청합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param postId - 게시글 식별자입니다.
 * @param reveal - 스포일러 열람 확인 여부입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @param client - 회원 상태를 포함할 세션입니다.
 * @returns 요청한 게시글입니다.
 */
export async function readCommunityPost(apiUrl: string, postId: string, reveal: boolean, signal: AbortSignal,
  client?: MemberSessionClient): Promise<CommunityPost> {
  requireId(postId);
  if (typeof reveal !== 'boolean') throw new Error('스포일러 열람 선택을 확인해 주십시오.');
  const item = parsePost(await read(apiUrl, '/posts/' + postId + (reveal ? '?reveal=true' : ''), signal, client), !!client);
  if (item.id !== postId || !reveal && item.hasSpoiler && !item.mine && !item.locked) throw invalid();
  return item;
}

/**
 * 한 게시글의 댓글을 페이지별로 조회합니다.
 * @param apiUrl - API 기준 주소입니다.
 * @param postId - 댓글이 속한 게시글 식별자입니다.
 * @param filter - 페이지와 스포일러 열람 확인 여부입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @param client - 회원 상태를 포함할 세션입니다.
 * @returns 같은 회원의 복수 댓글도 그대로 포함하는 목록입니다.
 */
export async function readCommunityComments(apiUrl: string, postId: string, filter: CommunityCommentFilter, signal: AbortSignal,
  client?: MemberSessionClient): Promise<CommunityPage<CommunityComment>> {
  requireId(postId);
  const parameters = pageParams(filter.page, filter.size);
  if (filter.reveal !== undefined) {
    if (typeof filter.reveal !== 'boolean') throw new Error('스포일러 열람 선택을 확인해 주십시오.');
    parameters.set('reveal', String(filter.reveal));
  }
  if (filter.revealPost !== undefined) {
    if (typeof filter.revealPost !== 'boolean') throw new Error('게시글 스포일러 열람 선택을 확인해 주십시오.');
    parameters.set('revealPost', String(filter.revealPost));
  }
  if (filter.revealIds !== undefined) {
    if (!Array.isArray(filter.revealIds) || new Set(filter.revealIds).size > 50 || filter.revealIds.some(value => !id(value))) {
      throw new Error('열람할 댓글을 50개 이내로 선택해 주십시오.');
    }
    if (filter.revealIds.length) parameters.set('revealIds', [...new Set(filter.revealIds)].join(','));
  }
  const page = parsePage(await read(apiUrl, '/posts/' + postId + '/comments?' + parameters, signal, client),
    value => parseComment(value, !!client), item => item.id);
  if (page.items.some(item => item.postId !== postId || item.hasSpoiler && !item.mine && !item.locked
    && !filter.reveal && !filter.revealIds?.includes(item.id))) throw invalid();
  return page;
}
// #endregion

// #region 게시글 작성과 임시저장
/**
 * 본인 글을 새 게시글로 등록합니다. 로컬 초안의 정리는 작성 화면에서 처리합니다.
 * @param client - CSRF와 인증 세대를 관리하는 회원 세션입니다.
 * @param input - 게시할 작품·말머리·본문·첨부 자료입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 서버가 게시한 본인 글입니다.
 */
export async function createCommunityPost(client: MemberSessionClient, input: CommunityPostInput, signal: AbortSignal): Promise<CommunityPost> {
  const draft = postInput(input, false), item = parsePost(await client.request('/api/members/community/posts', json('POST', draft, signal)), true);
  if (!item.mine || item.status !== 'PUBLISHED' || item.boardId !== draft.boardId || item.hasSpoiler !== draft.hasSpoiler) throw invalid();
  return item;
}

/**
 * 본인의 게시글을 수정합니다.
 * @param client - 현재 회원 세션입니다.
 * @param postId - 수정할 게시글 식별자입니다.
 * @param input - 바뀐 게시글 입력입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 수정한 본인 글입니다.
 */
export async function updateCommunityPost(client: MemberSessionClient, postId: string, input: CommunityPostInput,
  signal: AbortSignal): Promise<CommunityPost> {
  requireId(postId);
  const draft = postInput(input, false), item = parsePost(await client.request('/api/members/community/posts/' + postId, json('PUT', draft, signal)), true);
  if (item.id !== postId || !item.mine || item.boardId !== draft.boardId || item.hasSpoiler !== draft.hasSpoiler) throw invalid();
  return item;
}

/**
 * 본인 글 삭제 요청이 204로 완료되었는지 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param postId - 삭제할 게시글 식별자입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 */
export async function deleteCommunityPost(client: MemberSessionClient, postId: string, signal: AbortSignal): Promise<void> {
  requireId(postId);
  if (await client.request('/api/members/community/posts/' + postId, { method: 'DELETE', signal }) !== null) throw invalid();
}

/**
 * 기기에서 변환한 JPEG·PNG를 현재 회원의 첨부 이미지로 업로드합니다.
 * @param client - 현재 회원 세션입니다.
 * @param base64 - 접두사 없는 2MB 이하의 이미지 바이트입니다.
 * @param mimeType - 변환한 이미지 형식입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 서버가 확인한 URL과 크기입니다.
 */
export async function uploadCommunityImage(client: MemberSessionClient, base64: string, mimeType: 'image/jpeg' | 'image/png',
  signal: AbortSignal): Promise<Omit<CommunityImage, 'representative'>> {
  if (typeof base64 !== 'string' || !base64.length || base64.length % 4 !== 0
      || base64.length > 2796204 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('2MB 이하의 JPEG 또는 PNG 이미지를 선택해 주십시오.');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if (base64.length / 4 * 3 - padding > 2 * 1024 * 1024) throw new Error('첨부 이미지는 2MB 이하여야 합니다.');
  const value = await client.request('/api/members/community/images', json('POST', { base64, mimeType }, signal));
  if (!object(value) || !imagePath(value.url) || !value.url.startsWith('/api/members/community/images/')
      || !count(value.width) || value.width < 1 || value.width > 1024 || !count(value.height) || value.height < 1 || value.height > 1024) throw invalid();
  return { url: value.url, width: value.width, height: value.height };
}
// #endregion

// #region 댓글과 게시글 반응
/**
 * 게시글에 새 댓글을 추가합니다. 회원별 댓글 개수는 제한하지 않습니다.
 * @param client - 현재 회원 세션입니다.
 * @param postId - 댓글을 남길 게시글 식별자입니다.
 * @param input - 본문·스포일러·이모티콘입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 등록한 본인 댓글입니다.
 */
export async function createCommunityComment(client: MemberSessionClient, postId: string, input: CommunityCommentInput,
  signal: AbortSignal): Promise<CommunityComment> {
  requireId(postId);
  const draft = commentInput(input), item = parseComment(await client.request('/api/members/community/posts/' + postId + '/comments', json('POST', draft, signal)), true);
  if (!item.mine || item.postId !== postId || item.hasSpoiler !== draft.hasSpoiler) throw invalid();
  return item;
}

/**
 * 본인 댓글의 본문·스포일러·이모티콘을 수정합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 수정할 댓글 식별자입니다.
 * @param input - 수정할 댓글 입력입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 수정한 본인 댓글입니다.
 */
export async function updateCommunityComment(client: MemberSessionClient, commentId: string, input: CommunityCommentInput,
  signal: AbortSignal): Promise<CommunityComment> {
  requireId(commentId);
  const draft = commentInput(input), item = parseComment(await client.request('/api/members/community/comments/' + commentId, json('PUT', draft, signal)), true);
  if (item.id !== commentId || !item.mine || item.hasSpoiler !== draft.hasSpoiler) throw invalid();
  return item;
}

/**
 * 본인 댓글 삭제 요청이 204로 완료되었는지 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param commentId - 삭제할 댓글 식별자입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 */
export async function deleteCommunityComment(client: MemberSessionClient, commentId: string, signal: AbortSignal): Promise<void> {
  requireId(commentId);
  if (await client.request('/api/members/community/comments/' + commentId, { method: 'DELETE', signal }) !== null) throw invalid();
}

/**
 * 게시글 공감을 지정 상태로 변경합니다.
 * @param client - 현재 회원 세션입니다.
 * @param postId - 공감할 게시글 식별자입니다.
 * @param liked - 공감을 남길지 취소할지 지정합니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 서버가 확인한 공감 여부와 개수입니다.
 */
export async function setCommunityLike(client: MemberSessionClient, postId: string, liked: boolean, signal: AbortSignal): Promise<{ liked: boolean; likeCount: number }> {
  requireId(postId);
  if (typeof liked !== 'boolean') throw new Error('공감 상태를 확인해 주십시오.');
  const value = await client.request('/api/members/community/posts/' + postId + '/like', { method: liked ? 'PUT' : 'DELETE', signal });
  if (!object(value) || value.liked !== liked || !count(value.likeCount)) throw invalid();
  return { liked, likeCount: value.likeCount };
}

/**
 * 다른 회원의 게시글을 신고하고 접수 완료 여부를 확인합니다.
 * @param client - 현재 회원 세션입니다.
 * @param postId - 신고할 게시글 식별자입니다.
 * @param reason - 선택한 고정 신고 사유입니다.
 * @param detail - 선택적으로 작성한 500자 이하의 상세입니다.
 * @param signal - 화면 변경 시 취소 신호입니다.
 * @returns 신고 접수가 완료되면 반환합니다.
 */
export async function reportCommunityPost(client: MemberSessionClient, postId: string, reason: CommunityReportReason, detail: string,
  signal: AbortSignal): Promise<void> {
  requireId(postId);
  if (!reasons.includes(reason) || typeof detail !== 'string') throw new Error('신고 사유와 내용을 확인해 주십시오.');
  const normalized = normalizeCommunityText(detail) || null;
  if (normalized !== null && !text(normalized, 500)) throw new Error('신고 상세는 500자 이내로 입력해 주십시오.');
  const value = await client.request('/api/members/community/posts/' + postId + '/reports', json('POST', { reason, detail: normalized }, signal));
  if (!object(value) || value.reported !== true) throw invalid();
}
// #endregion
