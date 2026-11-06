import type { WorkKind } from './workDetails.ts';

/** 공개 목차의 순서와 실제 장 번호를 구분합니다. ID는 계산하지 않습니다. */
export interface ReaderChapter {
  /** 목차에서 받은 불투명 회차 식별자입니다. */
  id: string;
  /** 서버가 제공하는 회차 제목입니다. */
  title: string;
  /** 작품 안의 실제 회차 번호로 공개 목차 순서와 다를 수 있습니다. */
  number: number;
}
/** 서버가 한 번 정규화한 표시 텍스트와 공개 목차입니다. */
export interface ChapterText {
  /** 선택한 작품의 공개 slug입니다. */
  workId: string;
  /** 독서 헤더에 표시할 작품 제목입니다. */
  workTitle: string;
  /** 작품 표시 분류입니다. */
  kind: WorkKind;
  /** 이번 응답의 본문에 해당하는 회차입니다. */
  chapter: ReaderChapter;
  /** 같은 시각에 공개된 회차 번호 순서의 목차입니다. */
  contents: ReaderChapter[];
  /** 공개 목차에서 0부터 시작하는 현재 순서입니다. 쪽수가 아닙니다. */
  currentIndex: number;
  /** 이전 공개 회차이며 첫 회차에서는 null입니다. */
  previous: ReaderChapter | null;
  /** 다음 공개 회차이며 마지막 회차에서는 null입니다. */
  next: ReaderChapter | null;
  /** 서버가 정규화한 표시 텍스트로 클라이언트에서 다시 변환하지 않습니다. */
  body: string;
  /** 표시 텍스트의 UTF-16 코드 단위 길이입니다. */
  characterCount: number;
  /** DB가 관리하는 양의 정수 본문 버전입니다. */
  contentVersion: number;
  /** 표시 텍스트 UTF-8 바이트의 SHA-256 소문자 hex입니다. */
  contentHash: string;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const chapter = (v: unknown): v is ReaderChapter => object(v) && text(v.id) && text(v.title) && positive(v.number);
const same = (a: unknown, b: ReaderChapter | null) => b === null ? a === null
  : chapter(a) && a.id === b.id && a.title === b.title && a.number === b.number;

/**
 * 다른 작품·회차나 일치하지 않는 목차를 대체 본문으로 표시하지 않습니다.
 * @param value - 서버에서 받은 미검증 JSON입니다.
 * @returns 텍스트·길이·공개 목차의 내부 일관성을 확인한 응답입니다.
 * @throws Error 응답 형식이나 목차·본문 연결이 올바르지 않으면 발생합니다.
 */
export function parseChapterText(value: unknown): ChapterText {
  if (!object(value) || !text(value.workId) || !text(value.workTitle)
      || !['book', 'magazine', 'novel'].includes(value.kind as string)
      || !chapter(value.chapter) || !Array.isArray(value.contents) || !value.contents.length
      || !value.contents.every(chapter) || new Set(value.contents.map(c => c.id)).size !== value.contents.length
      || value.contents.some((c, i, list) => i > 0 && c.number <= list[i - 1].number)
      || typeof value.currentIndex !== 'number' || !Number.isInteger(value.currentIndex)
      || value.currentIndex < 0 || value.currentIndex >= value.contents.length
      || typeof value.body !== 'string' || value.body.length > 2097152 || value.body.includes('\r')
      || value.characterCount !== value.body.length || !positive(value.contentVersion)
      || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error('본문 응답 형식이 올바르지 않습니다.');
  }
  const contents = value.contents;
  const index = value.currentIndex;
  if (!same(value.chapter, contents[index]) || !same(value.previous, contents[index - 1] ?? null)
      || !same(value.next, contents[index + 1] ?? null)) throw new Error('본문과 공개 목차가 일치하지 않습니다.');
  return value as unknown as ChapterText;
}

/**
 * API 주소 한 곳만 호출하며 서버의 임의 contentUrl을 따라가지 않습니다.
 * @param apiUrl - 선택한 API 서버의 기준 주소입니다.
 * @param workId - 선택한 작품의 slug입니다.
 * @param chapterId - 공개 목차에서 선택한 회차 식별자입니다.
 * @param signal - 회차 변경·화면 이탈 시 요청을 취소하는 신호입니다.
 * @returns 요청한 작품·회차와 일치하고 검증을 통과한 본문 응답입니다.
 * @throws Error HTTP 오류·응답 불일치·시간 초과·취소 시 발생합니다.
 */
export async function fetchChapterText(apiUrl: string, workId: string, chapterId: string, signal: AbortSignal): Promise<ChapterText> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
    const response = await fetch(apiUrl + '/works/' + encodeURIComponent(workId) + '/chapters/' + encodeURIComponent(chapterId),
      { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 404 ? '선택한 작품이나 공개 회차를 찾을 수 없습니다.'
      : response.status === 415 ? '이 회차는 아직 텍스트 열람을 지원하지 않습니다.'
      : response.status === 503 ? '본문이 준비되지 않았거나 읽을 수 없습니다. 다시 시도해 주십시오.'
      : '본문을 불러오지 못했습니다. (HTTP ' + response.status + ')');
    let value: unknown;
    try { value = await response.json(); } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error('본문 응답 형식이 올바르지 않습니다.');
    }
    const result = parseChapterText(value);
    if (result.workId !== workId || result.chapter.id !== chapterId) throw new Error('선택한 작품·회차와 응답이 일치하지 않습니다.');
    return result;
  } catch (error) {
    if (timedOut) throw new Error('본문 요청 시간이 초과됐습니다. 다시 시도해 주십시오.');
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
  }
}
