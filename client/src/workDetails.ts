// #region 작품 상세 응답
/** 작품 상세 화면에서 사용하는 콘텐츠 분류입니다. */
export type WorkKind = 'book' | 'magazine' | 'novel';

/** 서버 순서대로 표시하는 목차 또는 회차의 정보입니다. */
export interface WorkContent {
  /** 같은 작품의 목차 안에서 고유한 식별자입니다. */
  id: string;
  /** 목차나 회차의 제목입니다. */
  title: string;
  /** 매거진 아티클의 분류입니다. */
  category?: string;
  /** 매거진 아티클이 시작하는 쪽수입니다. */
  pageNumber?: number;
  /** 웹소설 회차의 연도-월-일 형식 공개일입니다. */
  publishedAt?: string;
  /** 웹소설 회차의 본문 글자 수입니다. */
  characterCount?: number;
}

/** 서버가 집계한 작품의 조회·추천·평점 정보입니다. */
export interface WorkStatistics {
  /** 누적 조회 수입니다. */
  views: number;
  /** 누적 추천 수입니다. */
  recommendations: number;
  /** 0부터 5까지의 평균 평점입니다. */
  rating: number;
}

/**
 * 고정된 상세 화면에 표시할 작품 정보입니다.
 *
 * @remarks
 * 화면 구역이나 배치 명령을 포함하지 않는 조회 응답이며 DB 저장 모델을 정의하지 않습니다.
 */
export interface WorkDetail {
  /** 홈의 작품 카드와 상세 조회에 사용하는 식별자입니다. */
  id: string;
  /** 상세 화면의 도서·매거진·웹소설 배치를 선택하는 작품 분류입니다. */
  kind: WorkKind;
  /** 작품 제목입니다. */
  title: string;
  /** 저자 또는 편집부의 표시 이름입니다. */
  author: string;
  /** HTTP(S) 주소 또는 API 서버 기준 절대 경로로 제공하는 표지입니다. */
  imageUrl: string;
  /** 작품 또는 해당 호의 소개입니다. */
  description: string;
  /** 매거진 소개에 별도 제목이 있는 경우 표시합니다. */
  descriptionTitle?: string;
  /** 출판사 또는 발행처의 이름입니다. */
  publisher: string;
  /** 연도-월-일 형식의 발행일입니다. */
  publishedAt: string;
  /** 작품의 분야 또는 장르입니다. */
  category: string;
  /** 파일 형식과 용량의 표시 정보입니다. */
  fileFormat: string;
  /** 서버 순서대로 표시할 목차 또는 회차이며 없으면 빈 배열입니다. */
  contents: WorkContent[];
  /** 제공되는 경우 표시할 전체 쪽수입니다. */
  pageCount?: number;
  /** 제공되는 경우 표시할 인용문입니다. */
  quote?: string;
  /** 매거진의 호수 표기입니다. */
  issue?: string;
  /** 매거진의 발행 주기입니다. */
  publicationCycle?: string;
  /** 제공되는 경우 표시할 작품 통계입니다. */
  statistics?: WorkStatistics;
}
// #endregion

// #region 응답 검증
/**
 * 배열과 null을 제외한 JSON 객체인지 확인합니다.
 * @param value - 확인할 값입니다.
 * @returns 속성을 검사할 수 있는 객체이면 참입니다.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 공백 이외의 내용이 있는 문자열인지 확인합니다.
 * @param value - 확인할 값입니다.
 * @returns 표시할 문자열이면 참입니다.
 */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 음수가 아닌 정수인지 확인합니다.
 * @param value - 확인할 값입니다.
 * @returns 집계 수로 사용할 수 있으면 참입니다.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 연도-월-일 형식이며 실제로 존재하는 날짜인지 확인합니다.
 * @param value - 발행일 또는 회차 공개일입니다.
 * @returns 달력에 존재하는 날짜이면 참입니다.
 */
function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

/**
 * 표지가 HTTP(S) 또는 서버 기준 절대 경로인지 확인합니다.
 * @param value - 서버에서 받은 이미지 주소입니다.
 * @returns 사용자 정보와 제어 문자가 없는 지원 주소이면 참입니다.
 */
function isImageUrl(value: unknown): boolean {
  if (!isText(value) || /[\u0000-\u001f\\]/.test(value)) return false;
  if (!(value.startsWith('/') && !value.startsWith('//')) && !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value, 'http://details.local');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * 서버 JSON의 상세 정보와 목차를 검증합니다.
 *
 * @param value - 서버에서 수신한 JSON 값입니다.
 * @returns 값과 목차 순서를 보존한 작품 상세 정보입니다.
 * @throws Error - 필수 정보, 선택 정보 또는 목차 식별자가 올바르지 않으면 발생합니다.
 */
export function parseWorkDetail(value: unknown): WorkDetail {
  if (!isObject(value)
    || !['book', 'magazine', 'novel'].includes(value.kind as string)
    || !['id', 'title', 'author', 'description', 'publisher', 'publishedAt', 'category', 'fileFormat'].every(key => isText(value[key]))
    || !isImageUrl(value.imageUrl)
    || !isDate(value.publishedAt)
    || !Array.isArray(value.contents)) {
    throw new Error('작품 상세 정보의 형식이 올바르지 않습니다.');
  }
  if ((value.pageCount !== undefined && (!isCount(value.pageCount) || value.pageCount === 0))
    || !['quote', 'issue', 'publicationCycle', 'descriptionTitle'].every(key => value[key] === undefined || isText(value[key]))) {
    throw new Error('작품의 출판 정보가 올바르지 않습니다.');
  }
  const statistics = value.statistics;
  if (statistics !== undefined && (!isObject(statistics)
    || !isCount(statistics.views) || !isCount(statistics.recommendations)
    || typeof statistics.rating !== 'number' || !Number.isFinite(statistics.rating)
    || statistics.rating < 0 || statistics.rating > 5)) {
    throw new Error('작품의 통계 정보가 올바르지 않습니다.');
  }
  const contentIds = new Set<string>();
  for (const content of value.contents) {
    if (!isObject(content) || !isText(content.id) || !isText(content.title) || contentIds.has(content.id)) {
      throw new Error('작품의 목차 또는 회차 정보가 올바르지 않습니다.');
    }
    if ((content.category !== undefined && !isText(content.category))
      || (content.publishedAt !== undefined && !isDate(content.publishedAt))
      || !['pageNumber', 'characterCount'].every(key => content[key] === undefined || (isCount(content[key]) && content[key] > 0))) {
      throw new Error('작품의 목차 또는 회차 보조 정보가 올바르지 않습니다.');
    }
    contentIds.add(content.id);
  }
  return value as unknown as WorkDetail;
}
// #endregion

// #region 작품 상세 조회
/**
 * 선택한 서버에서 식별자에 해당하는 작품 정보를 조회합니다.
 *
 * @param apiUrl - 앱에서 선택한 API 서버의 기본 주소입니다.
 * @param workId - 홈에서 선택한 작품 식별자입니다.
 * @param signal - 화면을 떠나거나 다른 작품으로 이동할 때 요청을 취소하는 신호입니다.
 * @returns 응답 형식과 요청 식별자가 일치하는 작품 정보입니다.
 * @throws Error - HTTP 오류, 응답 형식 오류 또는 다른 작품의 응답을 받으면 발생합니다.
 */
export async function fetchWorkDetail(apiUrl: string, workId: string, signal: AbortSignal): Promise<WorkDetail> {
  const response = await fetch(apiUrl + '/works/' + encodeURIComponent(workId), { signal });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? '요청한 작품을 찾을 수 없습니다.'
      : '작품 정보를 불러오지 못했습니다. (HTTP ' + response.status + ')');
  }
  const work = parseWorkDetail(await response.json());
  if (work.id !== workId) throw new Error('요청한 작품과 서버의 응답이 일치하지 않습니다.');
  return work;
}
// #endregion
