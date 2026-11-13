import type { MemberSessionClient } from './memberSession.ts';

/** 서버가 확인한 회차의 시작 또는 저장 위치입니다. */
export interface ReadingPosition {
  /** 공개 회차 식별자입니다. */
  chapterId: string;
  /** UTF-16 경계 또는 호 전체의 쪽 번호입니다. */
  offset: number;
  /** 작품 종류에 따른 좌표 단위입니다. */
  unit: 'utf16' | 'page';
  /** 회차의 DB 본문 버전입니다. */
  contentVersion: number;
  /** 텍스트 SHA-256이며 매거진은 null입니다. */
  contentHash: string | null;
}

/** 현재 회원과 작품에 대한 서버 응답입니다. */
export interface ReadingProgress {
  /** 작품의 공개 slug입니다. */
  workId: string;
  /** 작품 종류입니다. */
  kind: 'book' | 'novel' | 'magazine';
  /** 이력 없음, 저장 위치, 본문 재확인 상태입니다. */
  state: 'new' | 'saved' | 'stale';
  /** 복원 또는 시작할 수 있는 위치입니다. */
  position: ReadingPosition | null;
  /** 서버 저장 세대입니다. */
  revision: string | null;
  /** 마지막 정상 저장 UTC 시각입니다. */
  lastReadAt: string | null;
  /** 회차 안의 위치 백분율입니다. */
  chapterPercent: number | null;
  /** 확인한 전체 공개 본문 기준 백분율입니다. */
  workPercent: number | null;
  /** 공개된 최고 도달 회차입니다. */
  maxChapterId: string | null;
  /** 저장된 서재 상태입니다. */
  libraryStatus: 'WANT_TO_READ' | 'READING' | 'COMPLETED' | null;
  /** 완독 기록 이후 공개 회차가 추가됐는지 표시합니다. */
  hasNewChapters: boolean;
}

/** 화면에서 표시할 본문 조각과 원문 시작 경계입니다. */
export interface ReadingSegment {
  /** 원문 UTF-16 시작 경계입니다. */
  offset: number;
  /** 원문에서 잘라낸 표시 문자열입니다. */
  text: string;
}

const row = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
const id = (value: unknown): value is string => typeof value === 'string' && /^-?[1-9][0-9]{0,18}$/.test(value);
const percent = (value: unknown): value is number | null => value === null || typeof value === 'number' && value >= 0 && value <= 100;
const invalid = () => new Error('읽기 위치 응답을 확인할 수 없습니다.');

/**
 * 다른 작품·단위·잘못된 저장 상태를 표시하지 않도록 검사합니다.
 * @param value - 미검증 응답입니다.
 * @param slug - 요청한 작품입니다.
 * @returns 확인한 서버 위치입니다.
 */
export function parseReadingProgress(value: unknown, slug: string): ReadingProgress {
  const r = row(value);
  if (!r || r.workId !== slug || (r.kind !== 'book' && r.kind !== 'novel' && r.kind !== 'magazine')
      || (r.state !== 'new' && r.state !== 'saved' && r.state !== 'stale')
      || !(r.revision === null || typeof r.revision === 'string' && /^[1-9][0-9]{0,18}$/.test(r.revision))
      || !(r.lastReadAt === null || typeof r.lastReadAt === 'string' && Number.isFinite(Date.parse(r.lastReadAt)))
      || !percent(r.chapterPercent) || !percent(r.workPercent) || !(r.maxChapterId === null || id(r.maxChapterId))
      || !(r.libraryStatus === null || r.libraryStatus === 'READING' || r.libraryStatus === 'COMPLETED' || r.libraryStatus === 'WANT_TO_READ')
      || typeof r.hasNewChapters !== 'boolean') throw invalid();
  if (r.state === 'new' ? r.revision !== null || r.lastReadAt !== null : r.revision === null || r.lastReadAt === null) throw invalid();
  let position: ReadingPosition | null = null;
  if (r.position !== null) {
    const p = row(r.position);
    if (!p || !id(p.chapterId) || !integer(p.offset) || !integer(p.contentVersion) || p.contentVersion < 1) throw invalid();
    if (r.kind === 'magazine') {
      if (p.unit !== 'page' || p.offset < 1 || p.contentHash !== null) throw invalid();
      position = { chapterId: p.chapterId, offset: p.offset, unit: p.unit, contentVersion: p.contentVersion, contentHash: null };
    } else {
      if (p.unit !== 'utf16' || typeof p.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.contentHash)) throw invalid();
      position = { chapterId: p.chapterId, offset: p.offset, unit: p.unit, contentVersion: p.contentVersion, contentHash: p.contentHash };
    }
  }
  if (r.state === 'saved' && !position) throw invalid();
  return { workId: slug, kind: r.kind, state: r.state, position, revision: r.revision, lastReadAt: r.lastReadAt,
    chapterPercent: r.chapterPercent, workPercent: r.workPercent, maxChapterId: r.maxChapterId, libraryStatus: r.libraryStatus,
    hasNewChapters: r.hasNewChapters };
}

const path = (slug: string) => '/api/members/works/' + encodeURIComponent(slug) + '/reading-progress';

/**
 * 서버 위치를 읽습니다.
 * @param client - 현재 회원 세션입니다.
 * @param slug - 작품 slug입니다.
 * @returns 현재 서버 위치입니다.
 */
export async function readReadingProgress(client: MemberSessionClient, slug: string): Promise<ReadingProgress> {
  return parseReadingProgress(await client.request(path(slug)), slug);
}

/**
 * 동일 revision으로 확인한 위치를 저장합니다.
 * @param client - 현재 회원 세션입니다.
 * @param slug - 작품 slug입니다.
 * @param position - 화면이 표시한 위치입니다.
 * @param expectedRevision - 조회한 저장 세대입니다.
 * @returns 저장 성공 응답입니다.
 */
export async function saveReadingProgress(client: MemberSessionClient, slug: string, position: ReadingPosition,
  expectedRevision: string | null): Promise<ReadingProgress> {
  const { chapterId, offset, contentVersion, contentHash } = position;
  const result = parseReadingProgress(await client.request(path(slug), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterId, offset, contentVersion, contentHash, expectedRevision }),
  }), slug);
  if (result.state !== 'saved' || !sameReadingPosition(result.position, position)) throw invalid();
  return result;
}

/**
 * 같은 버전의 동일 위치인지 확인합니다.
 * @param a - 저장 또는 현재 위치입니다.
 * @param b - 비교할 위치입니다.
 * @returns 두 위치가 일치하면 참입니다.
 */
export function sameReadingPosition(a: ReadingPosition | null, b: ReadingPosition): boolean {
  return !!a && a.chapterId === b.chapterId && a.offset === b.offset && a.unit === b.unit
    && a.contentVersion === b.contentVersion && a.contentHash === b.contentHash;
}

/**
 * 상세에서 선택한 위치를 최신 저장 세대에서도 복원할 수 있는지 확인합니다.
 * @param current - 뷰어가 확인한 현재 서버 기록입니다.
 * @param position - 상세에서 선택한 시작 또는 이어보기 위치입니다.
 * @param revision - 위치를 확인한 당시의 서버 세대입니다.
 * @returns 위치와 세대가 모두 일치하면 참입니다.
 */
export function matchesReadingResume(current: ReadingProgress, position: ReadingPosition, revision: string | null | undefined): boolean {
  return current.revision === revision && sameReadingPosition(current.position, position);
}

/**
 * 원문을 바꾸지 않고 빈 줄 다음을 복원할 수 있는 경계로 만듭니다.
 * @param body - 서버의 표시 원문입니다.
 * @returns UTF-16 시작 경계와 원문 조각입니다.
 */
export function readingSegments(body: string): ReadingSegment[] {
  const parts: ReadingSegment[] = [];
  let offset = 0;
  for (const separator of body.matchAll(/\n{2,}/g)) {
    const end = separator.index! + separator[0].length;
    parts.push({ offset, text: body.slice(offset, end) });
    offset = end;
  }
  if (offset < body.length) parts.push({ offset, text: body.slice(offset) });
  return parts;
}

/**
 * 외부 저장 위치를 해당 문단 시작으로 복원합니다. 본문 끝은 별도 경계입니다.
 * @param segments - 화면의 원문 조각입니다.
 * @param offset - 서버에서 받은 UTF-16 위치입니다.
 * @param length - 원문의 UTF-16 길이입니다.
 * @returns 화면에서 복원할 경계입니다.
 */
export function restoreReadingOffset(segments: readonly ReadingSegment[], offset: number, length: number): number {
  if (offset === length) return length;
  let boundary = 0;
  for (const segment of segments) {
    if (segment.offset > offset) break;
    boundary = segment.offset;
  }
  return boundary;
}
