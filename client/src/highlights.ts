import type { MemberSessionClient } from './memberSession.ts';

/** 하이라이트에 사용할 색입니다. */
export type HighlightColor = 'YELLOW' | 'GREEN';

/** 뷰어 표시 원문 또는 매거진 쪽의 범위입니다. */
export interface HighlightRange {
  /** 공개 회차 ID입니다. */
  chapterId: string;
  /** 첫 UTF-16 경계 또는 첫 쪽입니다. */
  startOffset: number;
  /** 끝 제외 UTF-16 경계 또는 포함되는 마지막 쪽입니다. */
  endOffset: number;
  /** 표시 좌표 단위입니다. */
  unit: 'utf16' | 'page';
  /** 저장 당시의 본문 버전입니다. */
  contentVersion: number;
  /** 텍스트 SHA-256입니다. 쪽은 null입니다. */
  contentHash: string | null;
}

/** 회원의 하이라이트 한 건입니다. */
export interface Highlight {
  /** 삭제에 사용하는 문자열 ID입니다. */
  id: string;
  /** 기록의 현재 공개·검증 상태입니다. */
  state: 'available' | 'stale' | 'hidden';
  /** 공개 작품의 slug입니다. */
  workId: string | null;
  /** 공개 작품 제목입니다. */
  workTitle: string | null;
  /** 공개 작품 종류입니다. */
  kind: 'book' | 'novel' | 'magazine' | null;
  /** 공개 회차 제목입니다. */
  chapterTitle: string | null;
  /** 공개 상태일 때 저장한 범위입니다. */
  range: HighlightRange | null;
  /** 공개 상태일 때 저장한 색입니다. */
  color: HighlightColor | null;
  /** 현재 원문에서 확인한 발췌입니다. */
  snippet: string | null;
  /** 서버 기록 시각입니다. */
  createdAt: string;
}

/** 서버가 반환한 목록 한 페이지입니다. */
export interface HighlightPage {
  /** 최신순 기록입니다. */
  items: Highlight[];
  /** 조회한 페이지입니다. */
  page: number;
  /** 다음 목록 여부입니다. */
  hasNext: boolean;
}

const endpoint = '/api/members/highlights';
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
const invalid = () => new Error('하이라이트 응답을 확인하지 못했습니다.');

/**
 * 공개 상태에 맞는 기록과 좌표를 읽습니다.
 * @param input - 미검증 서버 응답입니다.
 * @returns 표시할 기록입니다.
 */
export function parseHighlight(input: unknown): Highlight {
  const value = object(input);
  if (!value || !id(value.id) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw invalid();
  const { id: key, state, createdAt, workId, workTitle, chapterTitle, kind, color, snippet } = value;
  if (state === 'hidden') return { id: key, state, createdAt, workId: null, workTitle: null, chapterTitle: null, kind: null,
    color: null, range: null, snippet: null };
  const range = object(value.range);
  if (!range || state !== 'available' && state !== 'stale' || typeof workId !== 'string' || !/^[a-z0-9-]{1,120}$/.test(workId)
      || typeof workTitle !== 'string' || typeof chapterTitle !== 'string' || kind !== 'book' && kind !== 'novel' && kind !== 'magazine'
      || color !== 'YELLOW' && color !== 'GREEN' || snippet !== null && (typeof snippet !== 'string' || snippet.length > 500
        || state !== 'available' || kind === 'magazine')) throw invalid();
  const { chapterId, startOffset, endOffset, contentVersion, contentHash, unit } = range;
  if (typeof chapterId !== 'string' || !/^-?[1-9][0-9]{0,18}$/.test(chapterId) || !integer(startOffset)
      || !integer(endOffset) || endOffset < startOffset || !integer(contentVersion) || contentVersion < 1) throw invalid();
  if (kind === 'magazine') {
    if (unit !== 'page' || contentHash !== null || state === 'available' && startOffset < 1) throw invalid();
  } else if (unit !== 'utf16' || !(typeof contentHash === 'string' && /^[a-f0-9]{64}$/.test(contentHash)
    || state === 'stale' && contentHash === null) || state === 'available' && startOffset === endOffset) throw invalid();
  return { id: key, state, createdAt, workId, workTitle, chapterTitle, kind, color, snippet,
    range: { chapterId, startOffset, endOffset, contentVersion, contentHash, unit } };
}

/**
 * 본인 기록을 페이지로 조회합니다.
 * @param client - 현재 회원 세션입니다.
 * @param page - 1부터 시작하는 페이지입니다.
 * @param workId - 작품으로 제한할 때 사용합니다.
 * @param chapterId - 현재 회차로 제한할 때 사용합니다.
 * @returns 검증한 목록입니다.
 */
export async function listHighlights(client: MemberSessionClient, page: number, workId?: string, chapterId?: string): Promise<HighlightPage> {
  const query = new URLSearchParams({ page: String(page) });
  if (workId) query.set('workId', workId);
  if (chapterId) query.set('chapterId', chapterId);
  const value = object(await client.request(endpoint + '?' + query));
  if (!value || value.page !== page || typeof value.hasNext !== 'boolean' || !Array.isArray(value.items) || value.items.length > 30) throw invalid();
  const items = value.items.map(parseHighlight);
  if (items.some(item => item.state !== 'hidden' && (workId && item.workId !== workId || chapterId && item.range?.chapterId !== chapterId))) throw invalid();
  return { items, page, hasNext: value.hasNext };
}

/**
 * 선택한 범위를 저장합니다.
 * @param client - 현재 회원 세션입니다.
 * @param workId - 읽는 작품의 slug입니다.
 * @param range - 화면에서 확인한 범위입니다.
 * @param color - 선택한 색입니다.
 * @returns 새 기록 또는 같은 범위의 기존 기록입니다.
 */
export async function saveHighlight(client: MemberSessionClient, workId: string, range: HighlightRange, color: HighlightColor): Promise<Highlight> {
  const { chapterId, startOffset, endOffset, contentVersion, contentHash } = range;
  const result = parseHighlight(await client.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workId, chapterId, startOffset, endOffset, contentVersion, contentHash, color }) }));
  if (result.workId !== workId || result.range?.chapterId !== chapterId || result.range.startOffset !== startOffset
      || result.range.endOffset !== endOffset) throw invalid();
  return result;
}

/**
 * 본인 기록을 삭제합니다.
 * @param client - 현재 회원 세션입니다.
 * @param recordId - 삭제할 기록입니다.
 * @returns 서버에서 삭제를 확인하면 완료합니다.
 */
export async function deleteHighlight(client: MemberSessionClient, recordId: string): Promise<void> {
  if (!id(recordId) || await client.request(endpoint + '/' + recordId, { method: 'DELETE' }) !== null) throw invalid();
}

/**
 * 원문에서 유효한 UTF-16 선택 경계인지 확인합니다.
 * @param text - 표시 문자열입니다.
 * @param offset - 검사할 좌표입니다.
 * @returns 서로게이트 쌍을 나누지 않는 경계면 참입니다.
 */
export function isTextBoundary(text: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length
    && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}

/** 표시할 텍스트 조각입니다. */
export interface HighlightPiece {
  /** 보존된 원문입니다. */
  text: string;
  /** 이 조각에 적용할 최신 기록의 색입니다. */
  color: HighlightColor | null;
}

/**
 * 문단 안에 걸치는 범위만 표시 조각으로 나눕니다.
 * @param text - 문단 원문입니다.
 * @param offset - 문단 시작의 UTF-16 좌표입니다.
 * @param records - 최신순으로 확인된 현재 본문의 기록입니다.
 * @returns 원문 순서를 유지한 표시 조각입니다.
 */
export function highlightPieces(text: string, offset: number, records: readonly Highlight[]): HighlightPiece[] {
  const ranges = records.flatMap(item => item.range && item.color && item.range.endOffset > offset && item.range.startOffset < offset + text.length
    ? [{ start: Math.max(0, item.range.startOffset - offset), end: Math.min(text.length, item.range.endOffset - offset), color: item.color }] : []);
  const edges = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  return edges.slice(1).map((end, index) => {
    const start = edges[index];
    return { text: text.slice(start, end), color: ranges.find(range => range.start <= start && range.end >= end)?.color ?? null };
  });
}
