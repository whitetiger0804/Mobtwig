import type { WorkContent } from './workDetails.ts';

/** 서버가 정렬한 공개 목차에서 현재 회차와 양쪽 이웃을 가리킵니다. */
export interface ChapterSelection {
  /** 선택한 공개 목차 항목입니다. */
  current: WorkContent;
  /** 공개 목차에서 0부터 시작하는 순서입니다. */
  index: number;
  /** 공개 목차의 전체 항목 수입니다. */
  total: number;
  /** 이전 공개 항목이며 처음이면 null입니다. */
  previous: WorkContent | null;
  /** 다음 공개 항목이며 끝이면 null입니다. */
  next: WorkContent | null;
}

/**
 * 식별자에 숫자를 더하지 않고 공개 목차의 실제 순서로 이동합니다.
 * 선택이 없으면 첫 공개 항목을 사용하며, 잘못된 선택을 첫 회차로 바꾸지 않습니다.
 * @param contents 서버의 공개 목차입니다.
 * @param chapterId 사용자가 선택한 회차 ID입니다.
 * @returns 빈 목차이면 null, 그 외에는 현재 회차와 이웃입니다.
 * @throws Error 선택한 회차가 공개 목차에 없으면 발생합니다.
 */
export function selectChapter(contents: readonly WorkContent[], chapterId?: string): ChapterSelection | null {
  if (chapterId !== undefined && !contents.some(chapter => chapter.id === chapterId)) {
    throw new Error('선택한 회차가 공개 목차에 없습니다. 목차를 다시 확인해 주십시오.');
  }
  if (contents.length === 0) return null;
  const index = chapterId === undefined ? 0 : contents.findIndex(chapter => chapter.id === chapterId);
  return {
    current: contents[index], index, total: contents.length,
    previous: contents[index - 1] ?? null,
    next: contents[index + 1] ?? null,
  };
}
