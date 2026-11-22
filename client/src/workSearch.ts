/** 작품 검색 API가 반환하는 작품 종류입니다. */
export type WorkSearchKind = 'book' | 'magazine' | 'novel';

/** 검색 API에 전달할 작품 분류입니다. */
export type WorkSearchFilter = 'all' | WorkSearchKind;

/** 공개 작품 검색 결과입니다. */
export interface WorkSearchResult {
  /** 작품 상세 API에 전달하는 slug입니다. */
  id: string;
  /** 검색 결과에 표시할 작품 제목입니다. */
  title: string;
  /** 작품 표지 주소입니다. */
  imageUrl: string;
  /** 작품 종류입니다. */
  kind: WorkSearchKind;
}

/** 검색 응답이 작품 배열인지 확인하고 표시 가능한 형태로 반환합니다. */
function parseWorkSearchResults(value: unknown): WorkSearchResult[] {
  if (!Array.isArray(value)) throw new Error('검색 결과 형식이 올바르지 않습니다.');
  return value.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new Error('검색 결과 형식이 올바르지 않습니다.');
    const result = item as Record<string, unknown>;
    if (typeof result.id !== 'string' || typeof result.title !== 'string'
      || typeof result.imageUrl !== 'string'
      || !['book', 'magazine', 'novel'].includes(result.kind as string)) {
      throw new Error('검색 결과 형식이 올바르지 않습니다.');
    }
    return {
      id: result.id,
      title: result.title,
      imageUrl: result.imageUrl,
      kind: result.kind as WorkSearchKind,
    };
  });
}

/**
 * 공개 작품 검색 API를 호출합니다.
 * @param apiUrl - 선택한 서버의 기본 주소입니다.
 * @param query - 검색할 작품 제목·저자·출판사의 일부입니다.
 * @param kind - 검색할 작품 종류입니다.
 * @param signal - 화면 이탈이나 조건 변경 시 요청을 취소합니다.
 * @param genre - 선택한 장르 이름이며 생략하면 장르를 제한하지 않습니다.
 * @returns 조건에 일치하는 공개 작품입니다.
 */
export async function searchWorks(
  apiUrl: string,
  query: string,
  kind: WorkSearchFilter,
  signal: AbortSignal,
  genre?: string,
): Promise<WorkSearchResult[]> {
  const parameters = new URLSearchParams({ query, kind });
  if (genre !== undefined) parameters.set('genre', genre);
  const response = await fetch(`${apiUrl}/works?${parameters}`, { signal });
  if (!response.ok) throw new Error(`검색 요청을 처리하지 못했습니다. (HTTP ${response.status})`);
  return parseWorkSearchResults(await response.json());
}
