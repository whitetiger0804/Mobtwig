import type { MemberSessionClient } from './memberSession.ts';
import type { ReadingPosition } from './readingProgress.ts';

/** 회원의 책갈피 한 건입니다. */
export interface Bookmark {
  /** 삭제할 때 사용하는 기록 ID입니다. */
  id: string;
  /** 이동 가능 여부와 공개 상태입니다. */
  state: 'available' | 'stale' | 'hidden';
  /** 공개 작품의 slug입니다. */
  workId: string | null;
  /** 공개 작품의 제목입니다. */
  workTitle: string | null;
  /** 공개 작품의 종류입니다. */
  kind: 'book' | 'novel' | 'magazine' | null;
  /** 공개 회차의 제목입니다. */
  chapterTitle: string | null;
  /** 공개 상태에서 확인할 저장 좌표입니다. */
  position: ReadingPosition | null;
  /** 현재 버전과 일치하는 텍스트 발췌문입니다. */
  snippet: string | null;
  /** 서버 저장 시각입니다. */
  createdAt: string;
}

/** 책갈피 조회 한 페이지입니다. */
export interface BookmarkPage {
  /** 최신순 책갈피입니다. */
  items: Bookmark[];
  /** 조회한 페이지 번호입니다. */
  page: number;
  /** 다음 페이지가 존재하는지 표시합니다. */
  hasNext: boolean;
}

const path = '/api/members/bookmarks';
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => new Error('책갈피 응답을 확인하지 못했습니다.');

function parsePosition(input: unknown, magazine: boolean, stale: boolean): ReadingPosition {
  const position = object(input);
  if (!position || typeof position.chapterId !== 'string' || !/^-?[1-9][0-9]{0,18}$/.test(position.chapterId)
      || typeof position.offset !== 'number' || !Number.isInteger(position.offset) || position.offset < 0 || position.offset > 2147483647
      || typeof position.contentVersion !== 'number' || !Number.isInteger(position.contentVersion) || position.contentVersion < 1
      || position.contentVersion > 2147483647) throw invalid();
  const { chapterId, offset, contentVersion, contentHash } = position;
  if (magazine) {
    if (position.unit !== 'page' || (!stale && offset < 1) || contentHash !== null) throw invalid();
    return { chapterId, offset, contentVersion, contentHash, unit: 'page' };
  }
  if (position.unit !== 'utf16' || (!validHash(contentHash) && !(stale && contentHash === null))) throw invalid();
  return { chapterId, offset, contentVersion, contentHash, unit: 'utf16' };
}

/**
 * 공개 여부와 저장 좌표를 검증합니다.
 * @param input - 미검증 응답입니다.
 * @returns 화면에 표시할 책갈피입니다.
 */
export function parseBookmark(input: unknown): Bookmark {
  const value = object(input);
  if (!value || !validId(value.id) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw invalid();
  const { id, state, createdAt, workId, workTitle, kind, chapterTitle, snippet } = value;
  if (state === 'hidden') {
    return { id, state, createdAt, workId: null, workTitle: null, kind: null, chapterTitle: null, position: null, snippet: null };
  }
  if (state !== 'available' && state !== 'stale' || typeof workId !== 'string' || !/^[a-z0-9-]{1,120}$/.test(workId)
      || typeof workTitle !== 'string' || typeof chapterTitle !== 'string'
      || kind !== 'book' && kind !== 'novel' && kind !== 'magazine'
      || snippet !== null && (typeof snippet !== 'string' || snippet.length > 200 || state === 'stale' || kind === 'magazine')) throw invalid();
  return { id, state, createdAt, workId, workTitle, kind, chapterTitle,
    position: parsePosition(value.position, kind === 'magazine', state === 'stale'), snippet };
}

/**
 * 회원의 책갈피 한 페이지를 읽습니다.
 * @param client - 현재 회원 세션입니다.
 * @param page - 1부터 시작하는 쪽입니다.
 * @param workId - 작품별로 조회할 때 사용할 slug입니다.
 * @returns 확인한 목록과 다음 쪽 여부입니다.
 */
export async function listBookmarks(client: MemberSessionClient, page: number, workId?: string): Promise<BookmarkPage> {
  const query = new URLSearchParams({ page: String(page) });
  if (workId) query.set('workId', workId);
  const value = object(await client.request(path + '?' + query));
  if (!value || value.page !== page || typeof value.hasNext !== 'boolean' || !Array.isArray(value.items) || value.items.length > 30) throw invalid();
  const items = value.items.map(parseBookmark);
  if (workId && items.some(item => item.workId !== null && item.workId !== workId)) throw invalid();
  return { items, page, hasNext: value.hasNext };
}

/**
 * 표시한 좌표를 책갈피로 저장합니다.
 * @param client - 현재 회원 세션입니다.
 * @param workId - 읽고 있는 작품입니다.
 * @param position - 표시한 본문 좌표입니다.
 * @returns 새 기록 또는 같은 좌표의 기존 기록입니다.
 */
export async function createBookmark(client: MemberSessionClient, workId: string, position: ReadingPosition): Promise<Bookmark> {
  const { chapterId, offset, contentVersion } = position;
  const result = parseBookmark(await client.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workId, chapterId, offset, contentVersion }) }));
  if (result.workId !== workId || result.position?.chapterId !== chapterId || result.position.offset !== offset) throw invalid();
  return result;
}

/**
 * 본인 책갈피를 삭제합니다.
 * @param client - 현재 회원 세션입니다.
 * @param id - 삭제할 기록의 ID입니다.
 * @returns 서버 삭제가 확인되면 완료합니다.
 */
export async function deleteBookmark(client: MemberSessionClient, id: string): Promise<void> {
  if (!validId(id) || await client.request(path + '/' + id, { method: 'DELETE' }) !== null) throw invalid();
}
