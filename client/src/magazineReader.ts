import type { ReadingPosition } from './readingProgress.ts';

/** 호 기준으로 표시하는 공개 기사의 범위입니다. */
export interface MagazineArticle {
  /** 저장에 사용할 공개 회차 ID입니다. */
  chapterId: string;
  /** 기사의 표시 제목입니다. */
  title: string;
  /** 호 기준 첫 쪽입니다. */
  startPage: number;
  /** 호 기준 마지막 쪽입니다. */
  endPage: number;
  /** 이미지 조회와 위치 저장에 함께 사용할 본문 버전입니다. */
  contentVersion: number;
}

/** 공개 호의 페이지 수와 읽을 수 있는 기사입니다. */
export interface MagazineIssue {
  /** 작품의 공개 slug입니다. */
  workId: string;
  /** 호의 표시 제목입니다. */
  title: string;
  /** 호 전체의 쪽 수입니다. */
  pageCount: number;
  /** 쪽 순서의 공개 기사입니다. */
  articles: MagazineArticle[];
}

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
const invalid = () => new Error('매거진 목차 정보를 확인하지 못했습니다.');
const path = (slug: string) => '/works/' + encodeURIComponent(slug) + '/magazine';

/**
 * 쪽 범위가 겹치거나 호가 다른 응답을 거절합니다.
 * @param input - 미검증 서버 JSON입니다.
 * @param slug - 요청한 호의 slug입니다.
 * @returns 서버에서 확인한 공개 목차입니다.
 */
export function parseMagazineIssue(input: unknown, slug: string): MagazineIssue {
  const issue = object(input);
  if (!issue || issue.workId !== slug || typeof issue.title !== 'string' || !issue.title.trim()
      || !positive(issue.pageCount) || !Array.isArray(issue.articles)) throw invalid();
  const articles: MagazineArticle[] = [];
  const ids = new Set<string>();
  let last = 0;
  for (const inputArticle of issue.articles) {
    const a = object(inputArticle);
    if (!a || typeof a.chapterId !== 'string' || !/^-?[1-9][0-9]{0,18}$/.test(a.chapterId) || ids.has(a.chapterId)
        || typeof a.title !== 'string' || !a.title.trim() || !positive(a.startPage) || !positive(a.endPage)
        || a.startPage <= last || a.endPage < a.startPage || a.endPage > issue.pageCount || !positive(a.contentVersion)) throw invalid();
    articles.push({ chapterId: a.chapterId, title: a.title, startPage: a.startPage, endPage: a.endPage, contentVersion: a.contentVersion });
    last = a.endPage;
    ids.add(a.chapterId);
  }
  return { workId: slug, title: issue.title, pageCount: issue.pageCount, articles };
}

/**
 * 작품 상세와 분리해 호의 공개 목차를 읽습니다.
 * @param apiUrl - 연결한 서버 주소입니다.
 * @param slug - 공개 호의 식별자입니다.
 * @param signal - 화면 전환 취소 신호입니다.
 * @returns 확인한 공개 목차입니다.
 */
export async function fetchMagazineIssue(apiUrl: string, slug: string, signal: AbortSignal): Promise<MagazineIssue> {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15_000);
  try {
    const response = await fetch(apiUrl + path(slug), { signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 503 ? '이 호의 쪽 구성을 확인할 수 없습니다.' : '이 매거진을 불러오지 못했습니다.');
    return parseMagazineIssue(await response.json().catch(() => null), slug);
  } finally {
    signal.removeEventListener('abort', cancel);
    clearTimeout(timeout);
  }
}

/**
 * 주어진 쪽을 포함하는 공개 기사만 찾습니다.
 * @param issue - 현재 호의 공개 목차입니다.
 * @param page - 호 기준 쪽입니다.
 * @returns 공개 범위가 아니면 null입니다.
 */
export function magazineArticle(issue: MagazineIssue, page: number): MagazineArticle | null {
  if (!positive(page)) return null;
  return issue.articles.find(article => page >= article.startPage && page <= article.endPage) ?? null;
}

/**
 * 명시적 기사나 현재 버전에서 확인된 저장 쪽을 엽니다.
 * @param issue - 현재 호입니다.
 * @param chapterId - 작품 상세에서 고른 기사입니다.
 * @param resume - 같은 호의 저장 쪽입니다.
 * @returns 열 수 있는 쪽이며 공개 기사가 없으면 null입니다.
 */
export function startMagazinePage(issue: MagazineIssue, chapterId?: string, resume?: ReadingPosition): number | null {
  const article = chapterId ? issue.articles.find(item => item.chapterId === chapterId) : issue.articles[0];
  if (!article) return null;
  if (resume?.unit === 'page' && resume.chapterId === article.chapterId && resume.contentVersion === article.contentVersion
      && magazineArticle(issue, resume.offset)?.chapterId === article.chapterId) return resume.offset;
  return article.startPage;
}

/**
 * 비공개 범위를 건너뛰고 인접한 공개 쪽을 찾습니다.
 * @param issue - 현재 호입니다.
 * @param page - 표시한 공개 쪽입니다.
 * @param direction - 이전은 -1, 다음은 1입니다.
 * @returns 경계에 도달하면 null입니다.
 */
export function adjacentMagazinePage(issue: MagazineIssue, page: number, direction: -1 | 1): number | null {
  const current = magazineArticle(issue, page);
  if (!current) return null;
  const next = page + direction;
  if (next >= current.startPage && next <= current.endPage) return next;
  const neighbor = issue.articles[issue.articles.indexOf(current) + direction];
  return neighbor ? direction === 1 ? neighbor.startPage : neighbor.endPage : null;
}

/**
 * 현재 공개 기사와 버전으로 PNG 요청 주소를 구성합니다.
 * @param apiUrl - 연결한 서버입니다.
 * @param issue - 현재 호입니다.
 * @param page - 표시할 공개 쪽입니다.
 * @returns 검증한 쪽과 버전만 포함한 URL입니다.
 */
export function magazinePageUrl(apiUrl: string, issue: MagazineIssue, page: number): string {
  const article = magazineArticle(issue, page);
  if (!article) throw invalid();
  return apiUrl + path(issue.workId) + '/pages/' + page + '?contentVersion=' + article.contentVersion;
}
