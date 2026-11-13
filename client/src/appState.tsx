// #region 의존성 가져오기
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemberAuth } from './memberAuth';
import { saveReadingPreferences, type ReadingPreferences } from './readingPreferences';
import { BackHandler } from 'react-native';
import type { ReadingPosition } from './readingProgress';
// #endregion

// #region 화면 이동 타입
/**
 * 홈·검색·서재에서 선택하는 화면 분류 탭입니다.
 *
 * @remarks
 * 화면 탭 선택과 홈 SDUI 요청의 분류로 사용합니다. DB 저장 모델은 정의하지 않습니다.
 * `all`은 전체 탭이고 나머지 값은 {@link kindLabel}로 표시 이름을 얻습니다.
 * 홈·도서·매거진·웹소설은 동등한 탭이며, 커뮤니티 화면도 같은 단계에 있습니다.
 */
export type ContentTab = 'all' | 'book' | 'magazine' | 'novel';

/**
 * 커뮤니티에서 선택하는 작품별·주제별·홍보 탭입니다.
 *
 * @remarks
 * 목록 화면과 글쓰기 화면의 임시 선택값입니다. 게시글의 서버 저장 형식을 정의하지 않습니다.
 */
export type CommunityTab = 'work' | 'topic' | 'promotion';

/**
 * 앱의 화면 선택 분기에서 사용하는 화면 이름입니다.
 *
 * @remarks
 * 일반 화면과 하단 패널 이름을 함께 포함합니다. URL이나 서버 API 경로는 아닙니다.
 */
export type Screen =
  | 'home' | 'search' | 'detail' | 'reader' | 'media' | 'world' | 'worldTerms' | 'imageFull'
  | 'library' | 'records' | 'recent' | 'community' | 'post' | 'writePost'
  | 'reviews' | 'reviewWrite' | 'reviewComments' | 'login' | 'signup' | 'my'
  | 'account' | 'password' | 'withdraw' | 'readingSettings' | 'filters' | 'share'
  | 'libraryManage' | 'postMenu' | 'report' | 'commentCompose' | 'events' | 'purchaseHistory'
  | 'notifications' | 'webFallback' | 'favorites';

/**
 * 화면 이동에 필요한 화면 이름, 선택 탭과 작품 식별자입니다.
 *
 * @remarks
 * 작품 상세는 식별자만 전달하고 정보는 해당 화면에서 조회합니다. {@link AppContextValue.navigate}에 전달합니다.
 */
export interface Route {
  /** 표시할 일반 화면 또는 하단 패널의 이름입니다. */
  screen: Screen;
  /** 선택한 작품 분류 탭입니다. 생략하면 각 화면의 기본 탭을 사용합니다. */
  kind?: ContentTab;
  /** 선택한 커뮤니티 탭입니다. 생략하면 커뮤니티 화면은 작품별 탭을 사용합니다. */
  mode?: CommunityTab;
  /** 작품 상세를 조회할 식별자입니다. 상세 화면으로 이동할 때 지정합니다. */
  workId?: string;
  /** 본문에서 선택한 공개 회차의 식별자입니다. 숫자 순서로 해석하지 않습니다. */
  chapterId?: string;
  /** 작품 상세의 이어보기에서 확인한 표시 위치입니다. */
  resumePosition?: ReadingPosition;
  /** 이어보기 위치와 같은 응답에서 받은 revision입니다. 최초 기록은 null입니다. */
  resumeRevision?: string | null;
  /** 가입 성공 후 로그인 입력란에 채울 이메일입니다. */
  registeredEmail?: string;
}
// #endregion

export type { ReadingPreferences } from './readingPreferences';

// #region 화면 컨텍스트
/** 바탕 화면을 유지한 채 하단 패널로 여는 화면 이름의 집합입니다. */
const overlays = new Set<Screen>([
  'readingSettings', 'filters', 'libraryManage',
  'postMenu', 'commentCompose', 'withdraw',
]);

/**
 * {@link AppProvider}가 하위 컴포넌트에 제공하는 화면 상태와 이동 동작입니다.
 *
 * @remarks
 * {@link useApp}으로 읽으며 읽기 설정은 기기에 저장한 뒤 화면에 적용합니다.
 */
export interface AppContextValue {
  /** 패널이 열려 있으면 패널을, 그렇지 않으면 바탕 화면을 가리킵니다. */
  route: Route;
  /** 화면 스택의 마지막 항목이며 패널 아래에 유지되는 화면입니다. */
  baseRoute: Route;
  /** 열린 하단 패널입니다. 패널이 닫혀 있으면 `null`입니다. */
  overlay: Route | null;
  /** 기기 저장소에서 복원하거나 저장을 마친 독서 설정입니다. */
  readingPreferences: ReadingPreferences;
  /** 기기 저장이 성공하면 설정을 갱신하며 실패하면 오류를 전달합니다.
   * @param preferences - 화면에 반영할 독서 설정입니다.
   */
  setReadingPreferences: (preferences: ReadingPreferences) => Promise<void>;
  /** 현재 앱 실행 중 검색 화면에 표시할 최근 검색어입니다. */
  searchHistory: string[];
  /** 검색어를 최근 검색 기록 맨 앞에 추가하고 중복을 정리합니다.
   * @param query - 검색에 사용한 문자열입니다.
   */
  addSearchHistory: (query: string) => void;
  /** 지정한 검색어 하나를 최근 검색 기록에서 제거합니다.
   * @param query - 제거할 검색어입니다.
   */
  removeSearchHistory: (query: string) => void;
  /** 최근 검색 기록을 모두 비웁니다. */
  clearSearchHistory: () => void;
  /**
   * 일반 화면으로 이동하거나 현재 화면 위에 하단 패널을 엽니다.
   *
   * @remarks
   * 패널 화면은 화면 스택을 변경하지 않으며 `reset`의 영향을 받지 않습니다.
   * 일반 화면으로 이동할 때는 열린 패널을 닫습니다.
   * 홈·도서·매거진·웹소설·커뮤니티 탭으로 이동하면 진입 경로와 관계없이 스택을 교체합니다.
   *
   * @param route - 이동할 화면과 선택 탭입니다.
   * @param reset - `true`이면 일반 화면 스택을 새 화면 하나로 교체합니다. 생략하면 `false`입니다.
   * @param replace - 현재 화면만 교체합니다. 회차 이동 시 독서 화면을 중복 적재하지 않습니다.
   * @returns 값을 반환하지 않고 화면 상태를 변경합니다.
   */
  navigate: (route: Route, reset?: boolean, replace?: boolean) => void;
  /**
   * 열린 패널을 닫거나 이전 일반 화면으로 돌아갑니다.
   *
   * @remarks
   * 패널을 먼저 닫습니다. 상단 탭 또는 로그인 화면이 루트이면 현재 화면을 유지합니다.
   * 그 외의 독립 화면에서 이전 화면이 없으면 전체 홈으로 돌아갑니다.
   *
   * @returns 값을 반환하지 않고 화면 상태를 변경합니다.
   */
  back: () => void;
}

/** 공급자 내부와 외부를 구분하기 위해 초기값을 `null`로 두는 화면 컨텍스트입니다. */
const AppContext = createContext<AppContextValue | null>(null);
// #endregion

// #region 화면 상태 공급자
/**
 * 하위 컴포넌트에 화면 스택과 하단 패널의 이동 동작을 제공합니다.
 *
 * @remarks
 * 시작 단계에서 결정한 경로와 복원된 읽기 설정을 사용합니다.
 * Android 뒤로 가기를 연결하고 해제 시 이벤트 구독을 정리합니다.
 * 화면 이동 상태는 메모리에 두고 읽기 설정은 기기에 저장합니다.
 *
 * @param props - 화면 상태를 공유할 하위 요소입니다.
 * @returns 하위 요소를 감싸는 화면 컨텍스트 공급자입니다.
 */
export function AppProvider({ children, initialRoute, initialReadingPreferences }: {
  /** 화면 상태와 이동 함수를 공유하는 하위 React 요소입니다. */
  children: ReactNode;
  /** 최초 로그인 확인 결과로 결정한 시작 화면입니다. */
  initialRoute: Route;
  /** 시작 단계에서 기기 저장소로부터 복원한 읽기 설정입니다. */
  initialReadingPreferences: ReadingPreferences;
}) {
  const [stack, setStack] = useState<Route[]>([initialRoute]);
  const [overlay, setOverlay] = useState<Route | null>(null);
  const [readingPreferences, updateReadingPreferences] = useState(initialReadingPreferences);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const baseRoute = stack[stack.length - 1];
  const { state: auth } = useMemberAuth();
  useEffect(() => {
    setOverlay(null);
    setStack(previous => {
      const current = previous[previous.length - 1];
      return [['login', 'signup', 'account', 'my'].includes(current.screen) ? current : { screen: 'home', kind: 'all' }];
    });
  }, [auth.generation]);

  /**
   * 저장이 완료된 읽기 설정을 현재 화면에 적용합니다.
   * @param preferences - 사용자가 적용할 설정입니다.
   * @returns 기기 저장과 화면 상태 갱신이 완료되면 이행됩니다.
   * @throws Error - 기기 저장에 실패하면 발생합니다.
   */
  const setReadingPreferences = useCallback(async (preferences: ReadingPreferences) => {
    const saved = await saveReadingPreferences(AsyncStorage, preferences);
    updateReadingPreferences(saved);
  }, []);

  /**
   * 패널 여부에 따라 표시 상태 또는 화면 스택을 갱신합니다.
   *
   * @param next - 이동할 화면과 탭입니다.
   * @param reset - 일반 화면의 기존 스택을 교체할지 결정합니다.
   * @param replace - 현재 일반 화면 하나만 교체할지 결정합니다.
   * @returns 값을 반환하지 않습니다.
   */
  const navigate = useCallback((next: Route, reset = false, replace = false) => {
    if (overlays.has(next.screen)) {
      setOverlay(next);
      return;
    }
    setOverlay(null);
    const replaceStack = reset || next.screen === 'home' || next.screen === 'community';
    setStack(previous => replaceStack ? [next] : replace ? [...previous.slice(0, -1), next] : [...previous, next]);
  }, []);

  const addSearchHistory = useCallback((query: string) => {
    const normalized = query.trim();
    if (!normalized) return;
    setSearchHistory(previous => [normalized, ...previous.filter(item => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase())].slice(0, 8));
  }, []);

  const removeSearchHistory = useCallback((query: string) => {
    setSearchHistory(previous => previous.filter(item => item !== query));
  }, []);

  const clearSearchHistory = useCallback(() => setSearchHistory([]), []);

  /**
   * 패널을 우선 닫고, 패널이 없으면 화면 스택에서 뒤로 이동합니다.
   *
   * @returns 값을 반환하지 않습니다.
   */
  const back = useCallback(() => {
    if (overlay) {
      setOverlay(null);
      return;
    }
    setStack(previous => previous.length > 1
      ? previous.slice(0, -1)
      : ['home', 'community', 'login'].includes(previous[0].screen)
        ? previous
        : [{ screen: 'home', kind: 'all' }]);
  }, [overlay]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay || stack.length > 1 || !['home', 'community', 'login'].includes(baseRoute.screen)) {
        back();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [back, overlay, stack.length, baseRoute.screen]);

  return (
    <AppContext.Provider value={{ route: overlay ?? baseRoute, baseRoute, overlay, readingPreferences, setReadingPreferences, searchHistory, addSearchHistory, removeSearchHistory, clearSearchHistory, navigate, back }}>
      {children}
    </AppContext.Provider>
  );
}
// #endregion

// #region 화면 컨텍스트 훅
/**
 * 가장 가까운 {@link AppProvider}의 화면 상태와 이동 함수를 읽습니다.
 *
 * @remarks
 * 공급자 내부에서 렌더링되는 컴포넌트 또는 그 컴포넌트의 사용자 정의 훅에서 호출합니다.
 *
 * @returns 현재 화면·패널과 이동 함수를 담은 {@link AppContextValue}입니다.
 * @throws `AppProvider` 외부에서 호출하면 `Error`를 발생시킵니다.
 */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('AppProvider가 필요합니다.');
  return context;
}
// #endregion

// #region 분류 표시 이름
/**
 * 전체 탭을 제외한 분류 탭의 한국어 표시 이름을 반환합니다.
 *
 * @param kind - 도서·매거진·웹소설 중 표시할 탭입니다.
 * @returns 해당 탭의 한국어 이름입니다.
 */
export const kindLabel = (kind: Exclude<ContentTab, 'all'>) => ({
  book: '도서',
  magazine: '매거진',
  novel: '웹소설',
})[kind];
// #endregion
