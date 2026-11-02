// #region 홈 응답 계약
/** 홈 요청과 화면 이동에서 사용하는 분류입니다. DB의 작품 분류 모델은 아닙니다. */
export type HomeKind = 'all' | 'book' | 'magazine' | 'novel';

/** 서버가 선택할 수 있는 앱 내부 이동 대상입니다. 임의 URL이나 코드를 실행하지 않습니다. */
export interface SduiRoute {
  /** 클라이언트에 구현된 이동 대상입니다. */
  screen: 'home' | 'search' | 'library' | 'recent' | 'detail';
  /** 대상 화면에서 선택할 분류입니다. */
  kind?: HomeKind;
  /** 상세 화면에서 조회할 작품 식별자입니다. `detail` 동작에서만 필수로 지정합니다. */
  workId?: string;
}

/** 레이블을 가진 앱 내부 이동 동작입니다. */
export interface SduiAction {
  /** 버튼에 표시할 문자열입니다. */
  label: string;
  /** 선택 시 이동할 앱 내부 화면입니다. */
  route: SduiRoute;
}

/** 모든 SDUI 구역이 공유하는 화면 표시 속성입니다. */
export interface SectionBase {
  /** 응답의 구역 배열 안에서 고유한 키입니다. */
  id: string;
  /** 생략하면 구역 제목을 표시하지 않습니다. */
  title?: string;
  /** 구역 제목 옆에 표시할 선택적 이동 버튼입니다. */
  action?: SduiAction;
}

/** 배경 이미지 위에 제목과 선택적 설명·동작을 표시할 배너입니다. */
export interface BannerItem {
  /** 같은 배너 목록 안에서 고유한 키입니다. */
  id: string;
  /** 배너에 표시할 제목입니다. 분류별 고정 문구를 사용하지 않습니다. */
  title: string;
  /** 제목 아래에 표시할 설명입니다. */
  description?: string;
  /** HTTP(S) 이미지 주소 또는 선택한 API 서버 기준의 절대 경로입니다. */
  imageUrl: string;
  /** 생략하면 배너에 동작 버튼을 만들지 않습니다. */
  action?: SduiAction;
}

/** 가로 스크롤로 넘기는 배너 구역입니다. */
export interface BannerSection extends SectionBase {
  /** 클라이언트의 배너 렌더러를 선택합니다. */
  type: 'bannerCarousel';
  /** 응답 순서와 개수 그대로 표시할 배너입니다. */
  items: BannerItem[];
}

/** 작품 목록 카드에 필요한 표시 데이터입니다. DB 저장 구조를 정의하지 않습니다. */
export interface WorkItem {
  /** 상세 API에서 조회할 작품 식별자이며 같은 목록 안에서 고유합니다. */
  id: string;
  /** 카드 아래에 표시할 작품 제목입니다. */
  title: string;
  /** HTTP(S) 표지 주소 또는 선택한 API 서버 기준의 절대 경로입니다. */
  imageUrl: string;
  /** 서버가 제공하는 선택적 보조 문구입니다. */
  subtitle?: string;
}

/** 추천·최근 본 작품 등 제목과 항목을 바꿔 공유하는 가로 작품 목록입니다. */
export interface WorkSection extends SectionBase {
  /** 클라이언트의 작품 목록 렌더러를 선택합니다. */
  type: 'workShelf';
  /** 응답 순서와 개수 그대로 표시할 작품 카드입니다. */
  items: WorkItem[];
}

/** 문구와 작품 정보를 왼쪽에, 표지를 오른쪽에 배치할 추천 작품입니다. */
export interface FeaturedWorkItem extends WorkItem {
  /** '오늘의 책' 등 서버가 지정하는 추천 문구입니다. */
  label: string;
  /** 생략하면 이동 버튼을 표시하지 않습니다. */
  action?: SduiAction;
}

/** 기존 '오늘의 책' 배치를 재사용하는 추천 작품 구역입니다. */
export interface FeaturedWorkSection extends SectionBase {
  /** 클라이언트의 좌우 추천 작품 렌더러를 선택합니다. */
  type: 'featuredWork';
  /** 응답 순서와 개수 그대로 표시할 추천 작품입니다. */
  items: FeaturedWorkItem[];
}

/** 바로가기에서 선택할 수 있는 기존 앱 아이콘입니다. */
export type LinkIcon = 'bookmark' | 'book' | 'heart' | 'library' | 'search';

/** 기존 화면으로 이동하는 바로가기 항목입니다. */
export interface LinkItem extends SduiAction {
  /** 같은 바로가기 목록 안에서 고유한 키입니다. */
  id: string;
  /** 생략하면 아이콘 영역 없이 레이블만 표시합니다. */
  icon?: LinkIcon;
}

/** 가로 스크롤로 표시할 바로가기 목록입니다. */
export interface LinkSection extends SectionBase {
  /** 클라이언트의 바로가기 렌더러를 선택합니다. */
  type: 'linkRow';
  /** 응답 순서와 개수 그대로 표시할 바로가기입니다. */
  items: LinkItem[];
}

/** 앱에 미리 구현한 공통 요소 중 서버가 선택하는 구역입니다. */
export type SduiSection = BannerSection | WorkSection | FeaturedWorkSection | LinkSection;

/** 네 종류의 홈이 공유하는 SDUI 응답입니다. */
export interface HomeResponse {
  /** 이 클라이언트가 지원하는 응답 계약 버전입니다. */
  version: 1;
  /** 위에서 아래로 표시할 구역입니다. 빈 배열도 유효합니다. */
  sections: SduiSection[];
}
// #endregion

// #region 응답 검증
/**
 * JSON 객체 여부를 검사합니다.
 * @param value - 검사할 JSON 값입니다.
 * @returns 배열과 null을 제외한 객체이면 참입니다.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 비어 있지 않은 문자열인지 검사합니다.
 * @param value - 검사할 값입니다.
 * @returns 공백 외 문자가 있는 문자열이면 참입니다.
 */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 선택적 문자열인지 검사합니다.
 * @param value - 검사할 값입니다.
 * @returns 생략되었거나 비어 있지 않은 문자열이면 참입니다.
 */
function isOptionalText(value: unknown): boolean {
  return value === undefined || isText(value);
}

/**
 * 지원하는 이미지 주소인지 검사합니다.
 * @param value - 서버가 보낸 이미지 주소입니다.
 * @returns 루트 상대 경로나 HTTP(S) 주소이면 참입니다.
 */
function isImageUrl(value: unknown): boolean {
  if (!isText(value) || /[\\\u0000-\u001f]/.test(value) || !/^(\/(?!\/)|https?:\/\/)/i.test(value)) return false;
  try {
    const url = new URL(value, 'http://sdui.local');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * 서버 동작이 앱의 허용된 화면을 가리키는지 검사합니다.
 * @param value - 검사할 동작입니다.
 * @returns 레이블과 화면·분류가 지원되는 값이면 참입니다.
 */
function isAction(value: unknown): boolean {
  if (!isObject(value) || !isText(value.label) || !isObject(value.route)) return false;
  return ['home', 'search', 'library', 'recent', 'detail'].includes(value.route.screen as string)
    && (value.route.kind === undefined || ['all', 'book', 'magazine', 'novel'].includes(value.route.kind as string))
    && (value.route.screen === 'detail' ? isText(value.route.workId) : value.route.workId === undefined);
}

/**
 * JSON 응답을 검사하고 지원되는 SDUI 계약으로 반환합니다.
 *
 * @remarks
 * 알 수 없는 버전·요소, 잘못된 항목, 중복 키를 누락시키거나 기본 데이터로 대체하지 않습니다.
 * 수신한 배열의 순서와 개수를 그대로 유지합니다.
 *
 * @param value - 서버에서 수신한 JSON 값입니다.
 * @returns 검증된 홈 응답입니다.
 * @throws Error - 버전, 구역, 항목 또는 이동 대상이 계약과 맞지 않으면 발생합니다.
 */
export function parseHomeResponse(value: unknown): HomeResponse {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.sections)) {
    throw new Error('지원하지 않는 홈 응답 형식입니다.');
  }
  const sectionIds = new Set<string>();
  for (const section of value.sections) {
    if (!isObject(section) || !isText(section.id) || sectionIds.has(section.id)
      || !isOptionalText(section.title)
      || (section.action !== undefined && !isAction(section.action)) || !Array.isArray(section.items)
      || !['bannerCarousel', 'workShelf', 'featuredWork', 'linkRow'].includes(section.type as string)) {
      throw new Error('홈 구역의 형식 또는 식별자가 올바르지 않습니다.');
    }
    sectionIds.add(section.id);
    const itemIds = new Set<string>();
    for (const item of section.items) {
      if (!isObject(item) || !isText(item.id) || itemIds.has(item.id)) {
        throw new Error('홈 항목의 형식 또는 식별자가 올바르지 않습니다.');
      }
      itemIds.add(item.id);
      const valid = section.type === 'featuredWork'
        ? isText(item.label) && isText(item.title) && isImageUrl(item.imageUrl)
          && isOptionalText(item.subtitle) && (item.action === undefined || isAction(item.action))
        : section.type === 'linkRow'
        ? isAction(item) && (item.icon === undefined || ['bookmark', 'book', 'heart', 'library', 'search'].includes(item.icon as string))
        : isText(item.title) && isImageUrl(item.imageUrl) && (section.type === 'workShelf'
          ? isOptionalText(item.subtitle)
          : isOptionalText(item.description) && (item.action === undefined || isAction(item.action)));
      if (!valid) throw new Error('홈 항목의 내용이 지원하는 형식과 다릅니다.');
    }
  }
  return value as unknown as HomeResponse;
}
// #endregion
