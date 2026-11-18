// #region 의존성 가져오기
import { useRecentWorks } from './recentWorksContext';
import { useEffect, useRef, useState } from 'react';
import { parseHomeResponse, type SduiSection } from './homeSchema';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { kindLabel, useApp, type Route } from './appState';
import { EmptyState } from './EmptyState';
import { HomeContent } from './HomeContent';
import { useApiUrl } from './serverConnection';
import { useMemberAuth } from './memberAuth';
import { readReadingProgress, type ReadingProgress } from './readingProgress';
import { deleteBookmark, listBookmarks, type BookmarkPage } from './bookmarks';
import { deleteHighlight, listHighlights, type HighlightPage } from './highlights';
import { highlightColors } from './HighlightControls';
import { fetchWorkDetail, type WorkDetail } from './workDetails';
import { readMemberLibrary, type LibraryWork, type PurchaseProduct } from './purchases';
import { useWorkProducts } from './useWorkProducts';
import { WorkFollowActions } from './WorkFollowScreens';
import { searchWorks, type WorkSearchResult } from './workSearch';
import { Action, Chip, colors, Icon, IconButton, s, Title } from './ui';
import { WorkReviewPreview } from './ReviewScreens';
// #endregion

// #region 홈 화면
/**
 * 선택한 홈 분류를 서버 주도 화면 렌더러에 전달합니다.
 *
 * @remarks
 * 홈의 배너·작품 영역·장르·바로가기는 이 컴포넌트에 고정하지 않습니다.
 * 서버 화면 정의와 빈 상태 처리는 {@link HomeContent}에서 담당합니다.
 *
 * @param props - 현재 홈 분류를 포함하는 화면 속성입니다.
 * @returns 선택한 분류의 서버 주도 홈 화면입니다.
 */
export function HomeScreen({ route }: {
  /** 서버 화면을 선택할 홈 분류입니다. 생략하면 전체 홈을 표시합니다. */
  route: Route;
}) {
  return <HomeContent kind={route.kind ?? 'all'} />;
}
// #endregion

// #region 검색과 검색 설정
/**
 * 검색 전 화면과 분류별 검색 결과 화면의 배치를 구성합니다.
 *
 * @remarks
 * 입력란과 결과 분류 탭은 본문 스크롤 위에 고정합니다. 검색어는 현재 앱 실행 중
 * 최근 검색 기록에 저장하고 공개 작품 검색 API에 전달합니다.
 * 분류를 지정하지 않은 경로에서는 최근 검색 기록과 추천 작품을 표시합니다.
 *
 * @param props - 검색 전 화면 또는 결과 분류를 구분하는 화면 속성입니다.
 * @returns 검색 입력란과 탭, 검색 전 추천 목록 또는 실제 검색 결과입니다.
 */
export function SearchScreen({ route }: {
  /** 생략하면 검색 전 화면, 지정하면 해당 분류의 결과 화면을 표시합니다. */
  route: Route;
}) {
  const { navigate, searchHistory, addSearchHistory, removeSearchHistory, clearSearchHistory } = useApp();
  const [kind, setKind] = useState(route.kind);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [genre, setGenre] = useState('로맨스');
  const apiUrl = useApiUrl();
  const [recommended, setRecommended] = useState<Extract<SduiSection, { type: 'workShelf' }>['items'] | null>(null);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<WorkSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);

  const submitSearch = () => {
    const normalized = query.trim();
    if (!normalized) {
      setKind(undefined);
      setSubmittedQuery(null);
      return;
    }
    setQuery(normalized);
    setSubmittedQuery(normalized);
    setKind(current => current ?? 'all');
    addSearchHistory(normalized);
  };

  useEffect(() => {
    const controller = new AbortController();
    setRecommended(null);
    setRecommendError(null);
    fetch(`${apiUrl}/sdui/home?kind=all`, { signal: controller.signal })
      .then(result => {
        if (!result.ok) throw new Error(`서버가 요청을 처리하지 못했습니다. (HTTP ${result.status})`);
        return result.json();
      })
      .then(parseHomeResponse)
      .then(home => {
        const shelf = home.sections.find(section => section.type === 'workShelf');
        if (!controller.signal.aborted) setRecommended(shelf?.type === 'workShelf' ? shelf.items : []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setRecommendError(reason instanceof Error ? reason.message : '서버 연결을 확인해 주십시오.');
      });
    return () => controller.abort();
  }, [apiUrl]);

  useEffect(() => {
    if (kind === undefined || submittedQuery === null) {
      setSearchResults(null);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setSearchResults(null);
    setSearchError(null);
    setSearchLoading(true);
    searchWorks(apiUrl, submittedQuery, kind, controller.signal)
      .then(results => {
        if (!controller.signal.aborted) setSearchResults(results);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setSearchError(reason instanceof Error ? reason.message : '검색 결과를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearchLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, kind, submittedQuery, searchAttempt]);

  const openWork = (work: WorkSearchResult) => navigate({ screen: 'detail', workId: work.id });
  const searchContent = kind === undefined
    ? null
    : submittedQuery === null
      ? <EmptyState title="검색어를 입력해 주세요." />
      : searchError !== null
        ? <View style={c.section}>
            <EmptyState title="검색 결과를 불러오지 못했습니다." description={searchError} />
            <Action label="다시 불러오기" onPress={() => setSearchAttempt(value => value + 1)} />
          </View>
        : searchLoading || searchResults === null
          ? <ActivityIndicator color={colors.green} />
          : searchResults.length === 0
            ? <EmptyState title="검색 결과가 없습니다." description="다른 검색어로 다시 찾아보세요." />
            : kind === 'all'
              ? <>
                  {([
                    { kind: 'book', title: '도서' },
                    { kind: 'magazine', title: '매거진' },
                    { kind: 'novel', title: '웹소설' },
                  ] as const).map(section => {
                    const works = searchResults.filter(work => work.kind === section.kind);
                    if (works.length === 0) return null;
                    return <View key={section.kind} style={c.section}>
                      <Title>{section.title}</Title>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={c.recommendRow}>
                        {works.map(work => <Pressable key={work.id} accessibilityRole="button"
                          accessibilityLabel={`${work.title} 상세 보기`} onPress={() => openWork(work)} style={c.recommendItem}>
                          <Image accessibilityLabel={`${work.title} 표지`} source={{ uri: new URL(work.imageUrl, `${apiUrl}/`).href }} resizeMode="cover" style={c.recommendCover} />
                          <Text style={c.recommendTitle} numberOfLines={2}>{work.title}</Text>
                        </Pressable>)}
                      </ScrollView>
                    </View>;
                  })}
                </>
              : <View style={c.recentHistoryList}>
                  {searchResults.map(work => <Pressable key={work.id} accessibilityRole="button"
                    accessibilityLabel={`${work.title} 상세 보기`} onPress={() => openWork(work)} style={c.recentHistoryItem}>
                    <Image accessibilityLabel={`${work.title} 표지`} source={{ uri: new URL(work.imageUrl, `${apiUrl}/`).href }} resizeMode="cover" style={c.recentHistoryCover} />
                    <View style={c.recentInfo}>
                      <Text numberOfLines={2} style={c.recentTitle}>{work.title}</Text>
                      <Text style={c.recentKind}>{kindLabel(work.kind)}</Text>
                    </View>
                  </Pressable>)}
                </View>;

  return <View style={s.grow}>
    <View style={c.searchTop}>
      <View style={c.searchField}>
        <IconButton icon="search" label="검색" onPress={submitSearch} />
        <TextInput accessibilityLabel="작품명·작가명·출판사 검색" value={query} onChangeText={value => { setQuery(value); if (!value.trim()) { setKind(undefined); setSubmittedQuery(null); } }} placeholder="작품명·작가명·출판사 검색" placeholderTextColor={colors.muted} returnKeyType="search" onSubmitEditing={submitSearch} style={c.searchInput} />
      </View>
      {kind !== undefined && <View style={c.categoryTabs}>
        {(['all', 'book', 'magazine', 'novel'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[c.categoryTab, kind === value && c.categoryTabSelected]}>
          <Text style={[c.categoryTabLabel, kind === value && c.selectedLabel]}>{value === 'all' ? '전체' : kindLabel(value)}</Text>
        </Pressable>)}
      </View>}
    </View>
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[c.searchBody, kind !== undefined && kind !== 'all' && { paddingTop: 12 }]}>
      {kind === undefined ? <>
        <View style={c.searchHistory}>
          <Title action={<Pressable accessibilityRole="button" accessibilityState={{ disabled: searchHistory.length === 0 }} disabled={searchHistory.length === 0} onPress={clearSearchHistory} style={c.clearHistory}><Text style={[s.muted, searchHistory.length === 0 && c.disabledHistory]}>전체 삭제</Text></Pressable>}>검색 기록</Title>
          {searchHistory.length === 0
            ? <EmptyState compact title="검색 기록이 없습니다." />
            : <View style={c.searchHistoryList}>
                {searchHistory.map(term => <View key={term} style={c.searchHistoryItem}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`최근 검색어 ${term} 검색`} onPress={() => { setQuery(term); setSubmittedQuery(term); setKind('all'); }} style={c.searchHistorySearch}>
                    <Icon name="search" size={16} color={colors.muted} />
                    <Text numberOfLines={1} style={[s.text, s.grow]}>{term}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`최근 검색어 ${term} 삭제`} onPress={() => removeSearchHistory(term)} style={c.searchHistoryRemove}>
                    <Icon name="close" size={16} color={colors.red} />
                  </Pressable>
                </View>)}
              </View>}
        </View>
        <View style={c.section}>
          <Title>추천 작품</Title>
          {recommendError !== null
            ? <EmptyState title="추천 작품을 불러오지 못했습니다." description={recommendError} />
            : recommended === null
              ? <ActivityIndicator color={colors.green} />
              : recommended.length === 0
                ? <EmptyState title="표시할 추천 작품이 없습니다." />
                : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={c.recommendRow}>
                    {recommended.map(work => (
                      <Pressable key={work.id} accessibilityRole="button" accessibilityLabel={work.title + ' 상세 보기'} onPress={() => navigate({ screen: 'detail', workId: work.id })} style={c.recommendItem}>
                        <Image accessibilityLabel={`${work.title} 표지`} source={{ uri: new URL(work.imageUrl, `${apiUrl}/`).href }} resizeMode="cover" style={c.recommendCover} />
                        <Text style={c.recommendTitle} numberOfLines={2}>{work.title}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>}
        </View>
      </> : <>
        <ScrollView horizontal style={c.horizontalStrip} showsHorizontalScrollIndicator={false} contentContainerStyle={c.searchFilters}>
          <IconButton icon="settings" label="검색 설정" onPress={() => navigate({ screen: 'filters', kind })} />
          {(kind === 'novel' ? ['로맨스', '판타지', '현대판타지', '로맨스판타지'] : ['카테고리', '가격', '발행일']).map(label => <Chip key={label} label={label} selected={kind === 'novel' && genre === label} onPress={() => kind === 'novel' ? setGenre(label) : navigate({ screen: 'filters', kind })} />)}
        </ScrollView>
        <Title action={<Pressable accessibilityRole="button" onPress={() => navigate({ screen: 'filters', kind })} style={c.sortButton}><Text style={s.muted}>인기순</Text><View style={c.downIcon}><Icon name="next" size={12} /></View></Pressable>}>검색 결과 · {submittedQuery ?? query}</Title>
        {searchContent}
      </>}
    </ScrollView>

  </View>;
}

/**
 * 검색 설정 시안의 카테고리·가격·정렬 선택 행을 표시합니다.
 *
 * @remarks
 * 선택은 패널 내부의 임시 UI 상태입니다. 검색 요청을 만들거나 조건을 저장하지
 * 않으며 적용 버튼은 비활성 상태로 유지합니다.
 *
 * @returns 세 가지 선택 행과 비활성 적용 버튼입니다.
 */
export function FiltersScreen() {
  const [category, setCategory] = useState('문학');
  const [price, setPrice] = useState('전체');
  const [sort, setSort] = useState('인기순');
  return <View style={c.filterSheet}>
    <Title>검색 설정</Title>
    <View style={c.filterSection}><Text style={s.subtitle}>카테고리</Text><View style={c.filterOptions}>{['문학', '인문', '과학'].map(label => <View key={label} style={s.grow}><Chip label={label} selected={category === label} onPress={() => setCategory(label)} /></View>)}</View></View>
    <View style={c.filterSection}><Text style={s.subtitle}>가격</Text><View style={c.filterOptions}>{['전체', '무료', '유료'].map(label => <View key={label} style={s.grow}><Chip label={label} selected={price === label} onPress={() => setPrice(label)} /></View>)}</View></View>
    <View style={c.filterSection}><Text style={s.subtitle}>정렬</Text><View style={c.filterOptions}>{['인기순', '평점순', '최신순'].map(label => <View key={label} style={s.grow}><Chip label={label} selected={sort === label} onPress={() => setSort(label)} /></View>)}</View></View>
    <View style={c.applyButton}><Action label="적용" style={{ height: 50 }} disabled /></View>
  </View>;
}
// #endregion

// #region 작품 상세
/**
 * 서버가 전달한 목차나 회차를 순서대로 표시합니다.
 *
 * @param props - 해당 작품의 목차 또는 회차와 표시 분류입니다.
 * @returns 실제 항목 수에 맞는 목록 또는 빈 상태 안내입니다.
 */
function DetailContents({ items, kind, workId, products, ready, busy, authenticated, purchase }: {
  /** 선택 회차와 함께 전달할 작품 slug입니다. */
  workId: string;
  /** 서버에서 받은 목차 또는 회차 목록입니다. */
  items: WorkDetail['contents'];
  /** 웹소설의 회차와 다른 작품의 목차를 구분합니다. */
  kind: WorkDetail['kind'];
  /** 서버에서 확인한 상품이며 미설정 회차는 무료입니다. */
  products: PurchaseProduct[] | null;
  /** 현재 회원의 상품 조회를 성공적으로 마쳤는지 나타냅니다. */
  ready: boolean;
  /** 다른 구매를 처리하고 있는지 나타냅니다. */
  busy: boolean;
  /** 회원 구매 요청을 보낼 수 있는지 나타냅니다. */
  authenticated: boolean;
  /** 선택한 회차 상품의 구매를 처리합니다. */
  purchase: (product: PurchaseProduct) => Promise<void>;
}) {
  const { navigate } = useApp();
  if (items.length === 0) return <EmptyState title={kind === 'novel' ? '표시할 회차가 없습니다.' : '표시할 목차가 없습니다.'} />;
  return <View>
    {items.map((item, index) => {
      const characterCount = item.characterCount;
      const metadata = kind === 'novel'
        ? [item.publishedAt?.replaceAll('-', '.'), characterCount === undefined ? undefined
          : characterCount >= 1000 ? (characterCount / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '천 자'
          : characterCount + '자'].filter(Boolean).join(' · ')
        : kind === 'magazine' ? item.category : undefined;
      const product = products?.find(value => value.chapterId === (kind === 'novel' ? item.id : null));
      const readable = ready && (!product || product.readable);
      return <View key={item.id} style={[c.contentsRow, kind === 'novel' && c.novelContentsRow]}>
        <Text style={c.contentNumber}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={c.contentInfo}>
          <Pressable accessibilityRole="button" accessibilityLabel={item.title + ' 본문 읽기'}
            accessibilityState={{ disabled: !readable }} disabled={!readable}
            onPress={() => navigate({ screen: 'reader', kind, workId, chapterId: item.id })}>
            <Text style={c.contentTitle}>{item.title}</Text>
          </Pressable>
          {(metadata || (kind === 'magazine' && item.pageNumber !== undefined)) && <View style={c.contentMetadata}>
            <Text style={[c.contentMetaText, s.grow]}>{metadata}</Text>
            {kind === 'magazine' && item.pageNumber !== undefined && <Text style={c.contentMetaText}>{String(item.pageNumber).padStart(2, '0')}p</Text>}
          </View>}
        </View>
        {ready && product && !product.readable && kind === 'novel'
          ? <Action compact label="구매" style={c.chapterPurchase} disabled={busy}
            onPress={() => authenticated ? void purchase(product) : navigate({ screen: 'login' })} />
          : readable && <IconButton icon="next" label={item.title + ' 본문 읽기'}
            onPress={() => navigate({ screen: 'reader', kind, workId, chapterId: item.id })} />}
      </View>;
    })}
  </View>;
}

/**
 * 선택한 작품 정보를 조회해 도서·매거진·웹소설의 고정 상세 배치에 표시합니다.
 *
 * @remarks
 * 표지·소개·출판정보·목차는 작품 API에서 받으며 화면 구성을 서버에서 받지 않습니다.
 * 조회 중·실패·자료가 없는 항목을 구분하고 화면을 떠나면 진행 중인 요청을 취소합니다.
 * 상품별 소장·열람 권한, 구매와 작품 찜·구독을 연결합니다.
 *
 * @param props - 조회할 작품 식별자를 포함하는 화면 이동 정보입니다.
 * @returns 서버의 작품 정보와 분류에 맞는 상세 화면입니다.
 */
export function DetailScreen({ route }: {
  /** 작품 상세 API에 전달할 식별자를 포함합니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const { record } = useRecentWorks();
  const apiUrl = useApiUrl();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState('회차');
  const { state: auth, client: member } = useMemberAuth();
  const offer = useWorkProducts(route.workId);
  const owner = auth.generation + ':' + auth.member?.id;
  const [readingState, setReading] = useState<{ owner: string; client: typeof member; workId: string; value: ReadingProgress } | null>(null);
  const reading = auth.status === 'authenticated' && readingState?.owner === owner
    && readingState.client === member && readingState.workId === route.workId ? readingState.value : null;
  const [readingFailed, setReadingFailed] = useState(false);
  const [readingAttempt, setReadingAttempt] = useState(0);

  useEffect(() => {
    setReading(null);
    setReadingFailed(false);
    if (auth.status !== 'authenticated' || !work) return;
    let active = true;
    readReadingProgress(member, work.id).then(value => {
      if (active && value.kind === work.kind) setReading({ owner, client: member, workId: work.id, value });
      else if (active) setReadingFailed(true);
    }).catch(() => { if (active) setReadingFailed(true); });
    return () => { active = false; };
  }, [auth.status, owner, member, work, readingAttempt]);

  useEffect(() => {
    setWork(null);
    setError(null);
    const workId = route.workId;
    if (!workId) {
      setError('상세 정보를 볼 작품을 먼저 선택해 주십시오.');
      return;
    }
    const controller = new AbortController();
    fetchWorkDetail(apiUrl, workId, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setWork(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '작품 정보를 불러오지 못했습니다.');
      });
    return () => controller.abort();
  }, [apiUrl, route.workId, attempt]);

  useEffect(() => {
    if (work) void record(work);
  }, [work, record]);

  if (error !== null) return <View style={c.detailStatus} accessibilityLiveRegion="polite">
    <Text style={s.subtitle}>작품을 불러오지 못했습니다.</Text>
    <Text style={s.error}>{error}</Text>
    {route.workId && <Action label="다시 불러오기" onPress={() => setAttempt(value => value + 1)} />}
  </View>;
  if (work === null) return <View style={c.detailStatus} accessibilityLiveRegion="polite">
    <ActivityIndicator color={colors.green} /><Text style={s.muted}>작품 정보를 불러오고 있습니다.</Text>
  </View>;

  const kind = work.kind;
  const openReviews = () => navigate({ screen: 'reviews', kind, workId: work.id, workTitle: work.title });
  const firstChapter = work.contents[0];
  const resumePosition = reading?.position?.unit === (kind === 'magazine' ? 'page' : 'utf16')
    && work.contents.some(chapter => chapter.id === reading.position?.chapterId)
    ? reading.position : undefined;
  const startChapter = resumePosition?.chapterId ?? firstChapter?.id;
  const readingLoading = auth.status === 'authenticated' && !reading && !readingFailed;
  const readingLabel = reading?.state === 'saved' && resumePosition ? '이어보기'
    : kind === 'magazine' ? '이번 호 읽기' : kind === 'novel' ? '첫 화 읽기' : '첫 장 읽기';
  const productsReady = !offer.loading && offer.error === null && offer.products !== null;
  const startProduct = offer.products?.find(product => product.chapterId === (kind === 'novel' ? startChapter : null));
  const canRead = productsReady && (!startProduct || startProduct.readable);
  const authenticated = auth.status === 'authenticated';
  const productLabel = canRead ? readingLabel : '구매';
  const contentsProps = { products: offer.products, ready: productsReady, busy: offer.busy, authenticated, purchase: offer.purchase };
  return <View testID={'detail-' + work.id} style={c.detail}>
    <View style={[c.detailSummary, kind === 'book' && c.bookDetailSummary]}>
      <Image accessibilityLabel={work.title + ' 표지'} source={{ uri: new URL(work.imageUrl, apiUrl + '/').href }} resizeMode="cover" style={[c.detailCover, kind === 'book' && c.bookDetailCover]} />
      <View style={[c.detailSummaryInfo, kind === 'novel' && c.novelSummaryInfo]}>
        <View accessible accessibilityRole="header" accessibilityLabel={work.title} style={c.detailTitleWords}>
          {work.title.split(/\s+/).map((word, index) => <Text key={index} style={c.detailTitle}>{word}</Text>)}
        </View>
        <Text style={c.detailAuthor}>{work.author}</Text>
        {kind === 'book' && <View style={c.publisherRow}><Text style={s.muted}>출판사</Text><Text style={[s.text, s.grow]}>{work.publisher}</Text></View>}
        {kind === 'magazine' && work.issue && <Text style={c.detailIssue}>{work.issue}</Text>}
        {kind === 'novel' && work.statistics && <View style={c.stats}>
            <View style={c.stat}><Text style={s.muted}>조회</Text><Text style={c.statValue}>{work.statistics.views.toLocaleString('ko-KR')}</Text></View>
            <View style={c.stat}><Text style={s.muted}>추천</Text><Text style={c.statValue}>{work.statistics.recommendations.toLocaleString('ko-KR')}</Text></View>
            <View style={c.stat}><Text style={s.muted}>평점</Text><Text style={c.statValue}>{work.statistics.rating}</Text></View>
          </View>}
        <Action label={productLabel} style={c.detailPrimaryAction} disabled={!startChapter || !productsReady || offer.busy || canRead && readingLoading}
          onPress={() => {
            if (!canRead && startProduct) {
              if (authenticated) void offer.purchase(startProduct);
              else navigate({ screen: 'login' });
              return;
            }
            if (startChapter) navigate({ screen: 'reader', kind, workId: work.id, chapterId: startChapter, resumePosition,
              resumeRevision: resumePosition ? reading?.revision : undefined });
          }} />
      </View>
    </View>
    {offer.error !== null && <View accessibilityLiveRegion="polite"><Text style={s.error}>{offer.error}</Text>
      <Action compact label="상품 다시 불러오기" onPress={offer.refresh} /></View>}
    {offer.message !== null && <Text accessibilityLiveRegion="polite" style={s.muted}>{offer.message}</Text>}
    {readingFailed && <Action compact tone="secondary" label="저장 위치 다시 확인" onPress={() => setReadingAttempt(value => value + 1)} />}
    <WorkFollowActions key={work.id} workId={work.id} kind={kind} />
    {kind === 'novel' ? <>
      <View style={c.detailTags}><Text style={c.kindPill}>웹소설</Text><Text style={c.kindPill}>{work.category}</Text></View>
      <View style={c.novelIntroduction}>
        <View style={s.grow}><Text style={s.subtitle}>작품 소개</Text><Text style={[c.detailBody, c.description]}>{work.description}</Text></View>
      </View>
      <View style={c.detailTabs}>
        {['회차', '리뷰'].map(label => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: tab === label }} onPress={() => label === '리뷰' ? openReviews() : setTab(label)} style={[c.detailTab, tab === label && c.categoryTabSelected]}><Text style={[c.categoryTabLabel, tab === label && c.selectedLabel]}>{label}</Text></Pressable>)}
        <Text style={[s.muted, c.chapterCount]}>전체 {work.contents.length}화</Text>
      </View>
      <DetailContents items={work.contents} kind={kind} workId={work.id} {...contentsProps} />
    </> : kind === 'book' ? <>
      <View style={c.detailSection}>
        <Title>작품 정보</Title>
        <View style={c.introductionCard}><Text style={s.subtitle}>책 소개</Text><Text style={c.detailBody}>{work.description}</Text></View>
        <View style={c.metadata}>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>분야</Text><Text style={[s.text, s.grow]}>{work.category}</Text></View>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>발행일</Text><Text style={[s.text, s.grow]}>{work.publishedAt}</Text></View>
          {work.pageCount !== undefined && <View style={c.metadataRow}><Text style={c.metadataLabel}>분량</Text><Text style={[s.text, s.grow]}>{work.pageCount}쪽</Text></View>}
          <View style={c.metadataRow}><Text style={c.metadataLabel}>파일</Text><Text style={[s.text, s.grow]}>{work.fileFormat}</Text></View>
        </View>
        {work.quote && <View style={c.quoteEmpty}><Text style={c.quoteText}>{work.quote}</Text></View>}
      </View>
    </> : <>
      <View style={c.detailSection}>
        <Title>이번 호의 이야기</Title>
        <View style={[c.introductionCard, c.magazineIntroduction]}>
          {work.descriptionTitle && <Text style={c.magazineIntroductionTitle}>{work.descriptionTitle}</Text>}
          <Text style={c.detailBody}>{work.description}</Text>
        </View>
      </View>
      <View style={c.detailSection}>
        <Title action={<Text style={s.muted}>{work.contents.length}개 아티클{work.pageCount !== undefined && ' · ' + work.pageCount + '쪽'}</Text>}>목차</Title>
        <DetailContents items={work.contents} kind={kind} workId={work.id} {...contentsProps} />
      </View>
      <View style={c.detailSection}>
        <Title>발행 정보</Title>
        <View style={c.metadata}>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>발행처</Text><Text style={[s.text, s.grow]}>{work.publisher}</Text></View>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>발행일</Text><Text style={[s.text, s.grow]}>{work.publishedAt}</Text></View>
          {work.publicationCycle && <View style={c.metadataRow}><Text style={c.metadataLabel}>발행 주기</Text><Text style={[s.text, s.grow]}>{work.publicationCycle}</Text></View>}
          <View style={c.metadataRow}><Text style={c.metadataLabel}>분량·파일</Text><Text style={[s.text, s.grow]}>{work.pageCount !== undefined && work.pageCount + '쪽 · '}{work.fileFormat}</Text></View>
        </View>
      </View>
    </>}
    <View style={c.detailSection}>
      <Title action={<View style={[s.row, { gap: 8 }]}>
        <Action compact tone="secondary" label="리뷰 보기" onPress={openReviews} />
        {kind === 'book' && <Action compact tone="secondary" label="리뷰 작성"
          onPress={() => navigate({ screen: 'reviewWrite', kind, workId: work.id, workTitle: work.title })} />}
      </View>}>리뷰</Title>
      <WorkReviewPreview workId={work.id} />
    </View>
  </View>;
}
// #endregion

// #region 서재와 독서 기록
/**
 * 서재의 고정 분류 탭과 현재 회원의 작품 목록을 구성합니다.
 *
 * @remarks
 * 구매 후 서버가 등록한 작품을 화면 진입마다 다시 조회합니다. 회원·서버·분류가
 * 바뀌면 목록 컴포넌트를 새로 생성하여 이전 회원의 자료를 표시하지 않습니다.
 *
 * @param props - 서재에서 선택한 분류를 포함하는 화면 속성입니다.
 * @returns 고정 탭과 조회 상태 또는 스크롤 가능한 회원 서재입니다.
 */
export function LibraryScreen({ route }: {
  /** 서재의 현재 분류 탭을 제공하는 UI 이동 상태입니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const { state: auth, client } = useMemberAuth();
  const apiUrl = useApiUrl();
  const kind = route.kind ?? 'book';
  return <View style={s.grow}>
    <View style={c.libraryTabs}>{(['book', 'magazine', 'novel'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => navigate({ screen: 'library', kind: value }, true)} style={c.libraryTab}>
      <Text style={[c.categoryTabLabel, kind === value && c.selectedLabel]}>{kindLabel(value)}</Text>
      {kind === value && <View style={c.libraryTabIndicator} />}
    </Pressable>)}</View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={c.libraryBody}>
      {auth.status === 'checking' ? <ActivityIndicator color={colors.green} />
        : auth.status === 'error' ? <View style={c.section}><Text style={s.error}>로그인 상태를 확인하지 못했습니다.</Text>
          <Action label="로그인 상태 다시 확인" onPress={() => { void client.refresh(); }} /></View>
          : auth.status !== 'authenticated' ? <View style={c.section}>
            <EmptyState title="로그인 후 서재를 확인할 수 있습니다." />
            <Action label="로그인" onPress={() => navigate({ screen: 'login' })} />
          </View> : <LibraryContents key={[apiUrl, auth.generation, auth.member?.id, kind].join(':')} kind={kind} />}
    </ScrollView>
  </View>;
}

/**
 * 현재 회원·분류에 속한 서재만 조회하고 늦게 끝난 이전 요청은 반영하지 않습니다.
 * @param props - 조회할 작품 분류입니다.
 * @returns 서재 목록 또는 로딩·빈 상태·실패 안내입니다.
 */
function LibraryContents({ kind }: { kind: NonNullable<Route['kind']> }) {
  const { navigate } = useApp();
  const { client } = useMemberAuth();
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<LibraryWork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const openingRequest = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openingError, setOpeningError] = useState<string | null>(null);
  useEffect(() => () => openingRequest.current?.abort(), []);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    readMemberLibrary(client, kind).then(value => { if (active) setItems(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '서재를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [client, kind, attempt]);

  /** 선택한 작품의 현재 공개 목차와 저장 위치를 확인한 뒤 이동합니다. */
  async function openNovel(work: LibraryWork, next: boolean) {
    if (openingRequest.current) return;
    const controller = new AbortController();
    openingRequest.current = controller;
    setOpening(work.id);
    setOpeningError(null);
    try {
      const [detail, progress] = await Promise.all([
        fetchWorkDetail(apiUrl, work.id, controller.signal), readReadingProgress(client, work.id),
      ]);
      if (controller.signal.aborted) return;
      const position = progress.state !== 'new' && progress.position
        && detail.contents.some(chapter => chapter.id === progress.position?.chapterId) ? progress.position : undefined;
      const current = position ? detail.contents.findIndex(chapter => chapter.id === position.chapterId) : 0;
      const chapter = detail.contents[current + (next && position ? 1 : 0)];
      if (!chapter) throw new Error(next ? '다음 회차가 없습니다.' : '읽을 회차가 없습니다.');
      navigate({ screen: 'reader', kind: work.kind, workId: work.id, chapterId: chapter.id,
        resumePosition: next ? undefined : position, resumeRevision: next || !position ? undefined : progress.revision });
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setOpeningError(reason instanceof Error ? reason.message : '작품을 열지 못했습니다.');
    } finally {
      if (!controller.signal.aborted) {
        openingRequest.current = null;
        setOpening(null);
      }
    }
  }

  if (error !== null) return <View style={c.section} accessibilityLiveRegion="polite">
    <EmptyState title="서재를 불러오지 못했습니다." description={error} />
    <Action label="다시 불러오기" onPress={() => setAttempt(value => value + 1)} />
  </View>;
  if (items === null) return <ActivityIndicator accessibilityLabel="서재 불러오는 중" color={colors.green} />;
  if (items.length === 0) return <EmptyState title="서재가 비어 있습니다." />;
  if (kind !== 'novel') return <View style={c.libraryGrid}>{items.map(work => <Pressable key={work.id}
    accessibilityRole="button" accessibilityLabel={work.title + ' 상세 보기'} style={c.libraryGridItem}
    onPress={() => navigate({ screen: 'detail', workId: work.id, kind: work.kind })}>
    <Image accessibilityLabel={work.title + ' 표지'} source={{ uri: new URL(work.imageUrl, apiUrl + '/').href }} resizeMode="cover" style={c.libraryGridCover} />
    <Text style={c.libraryGridTitle} numberOfLines={2}>{work.title}</Text>
  </Pressable>)}</View>;
  return <View style={c.libraryNovelList}>
    {openingError !== null && <Text accessibilityRole="alert" style={s.error}>{openingError}</Text>}
    {items.map(work => <View key={work.id} style={c.libraryNovelItem}>
      <Pressable accessibilityRole="button" accessibilityLabel={work.title + ' 상세 보기'}
        onPress={() => navigate({ screen: 'detail', workId: work.id, kind: work.kind })} style={c.libraryNovelCoverColumn}>
        <Image accessibilityLabel={work.title + ' 표지'} source={{ uri: new URL(work.imageUrl, apiUrl + '/').href }} resizeMode="cover" style={c.libraryNovelCover} />
        {work.lastReadChapterNumber !== null && <Text style={c.libraryNovelRecent}>최근 본 화: {work.lastReadChapterNumber}화</Text>}
      </Pressable>
      <View style={c.libraryNovelInfo}>
        <Pressable accessibilityRole="button" accessibilityLabel={work.title + ' 상세 보기'}
          onPress={() => navigate({ screen: 'detail', workId: work.id, kind: work.kind })}>
          <Text style={c.libraryNovelTitle} numberOfLines={2}>{work.title}</Text>
        </Pressable>
        <Text style={c.libraryNovelAuthor}>{work.author}</Text>
        {work.statistics !== null && <Text style={c.libraryNovelStats}>
          조회 {work.statistics.views.toLocaleString('ko-KR')} · 추천 {work.statistics.recommendations.toLocaleString('ko-KR')} · 회차 {work.statistics.chapterCount}
        </Text>}
        <View style={c.libraryNovelActions}>
          <Action compact style={c.libraryNovelAction} label={work.lastReadChapterNumber === null ? '첫 화 읽기' : 'EP.' + work.lastReadChapterNumber + ' 이어보기'}
            disabled={opening !== null} onPress={() => { void openNovel(work, false); }} />
          <Action compact tone="secondary" style={c.libraryNovelAction} label="다음화보기"
            disabled={opening !== null || !work.hasNextChapter} onPress={() => { void openNovel(work, true); }} />
        </View>
      </View>
    </View>)}
  </View>;
}

/**
 * 서재의 빈 작품 안내와 즐겨찾기·숨기기 메뉴를 표시합니다.
 *
 * @remarks
 * 관리할 작품 정보가 없으므로 두 메뉴는 비활성 상태이며 서재를 변경하지 않습니다.
 *
 * @returns 빈 작품 요약과 두 개의 비활성 관리 메뉴입니다.
 */
export function LibraryManageScreen() {
  return <View style={c.manageSheet}>
    <Title>서재 관리</Title>
    <EmptyState compact title="관리할 작품이 없습니다." />
    <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={c.manageAction}><Icon name="heart" /><Text style={s.subtitle}>즐겨찾기</Text></Pressable>
    <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={c.manageAction}><Icon name="library" /><Text style={s.subtitle}>서재에서 숨기기</Text></Pressable>
  </View>;
}

/**
 * 회원 본인의 책갈피를 전체 또는 현재 작품별로 표시합니다.
 *
 * @returns 책 선택 행, 밑줄 카드와 이동·삭제 가능한 책갈피입니다.
 */
export function RecordsScreen() {
  const app = useApp();
  const workId = app.baseRoute.workId;
  const { state: auth, client } = useMemberAuth();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [result, setResult] = useState<BookmarkPage | null>(null);

  useEffect(() => {
    setResult(null);
    setFailure('');
    if (auth.status !== 'authenticated') return;
    let active = true;
    listBookmarks(client, page, workId).then(value => {
      if (!active) return;
      if (value.items.length === 0 && page > 1) setPage(previous => previous - 1);
      else setResult(value);
    }).catch(() => { if (active) setFailure('책갈피를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [auth.generation, auth.status, client, page, workId, attempt]);

  async function remove(id: string) {
    setBusy(true);
    setFailure('');
    try {
      await deleteBookmark(client, id);
      setAttempt(previous => previous + 1);
    } catch {
      setFailure('책갈피를 삭제하지 못했습니다. 목록을 다시 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={c.records}>
    <View style={s.row}>
      {workId ? <>
        <Chip label="현재 작품" selected />
        <Action compact tone="secondary" label="모든 책" onPress={() => app.navigate({ screen: 'records' }, false, true)} />
      </> : <Chip label="모든 책" selected />}
    </View>
    <HighlightRecords workId={workId} />
    <Title>책갈피</Title>
    {auth.status === 'checking' ? <ActivityIndicator color={colors.green} />
      : auth.status !== 'authenticated' ? <Action label="로그인하고 책갈피 보기" onPress={() => app.navigate({ screen: 'login' })} />
      : <>
        {!!failure && <View style={c.bookmarkCard}>
          <Text accessibilityRole="alert" style={s.error}>{failure}</Text>
          <Action compact tone="secondary" label="목록 다시 불러오기" onPress={() => setAttempt(previous => previous + 1)} />
        </View>}
        {!result && !failure && <ActivityIndicator color={colors.green} />}
        {result?.items.length === 0 && <EmptyState title="표시할 책갈피가 없습니다." />}
        {result?.items.map(item => {
          const { workId: slug, position, kind } = item;
          const available = item.state === 'available' && !!slug && !!position && !!kind;
          return <View key={item.id} style={c.bookmarkRow}>
            <Icon name="bookmark" color={colors.green} />
            <Pressable accessibilityRole="button" accessibilityLabel="책갈피 위치 열기" style={c.bookmarkInfo}
              disabled={busy || !available} accessibilityState={{ disabled: busy || !available }}
              onPress={() => available && app.navigate({ screen: 'reader', kind, workId: slug,
                chapterId: position.chapterId, bookmarkPosition: position })}>
              <Text style={c.bookmarkTitle} numberOfLines={1}>{item.chapterTitle ?? item.workTitle ?? '책갈피'}</Text>
              <Text style={c.bookmarkWork} numberOfLines={1}>{item.workTitle}{position?.unit === 'page' ? ' · ' + position.offset + '쪽' : ''}</Text>
              {item.state === 'stale' && <Text style={c.bookmarkWork}>현재 열 수 없는 책갈피입니다.</Text>}
            </Pressable>
            <IconButton icon="close" label="책갈피 삭제" disabled={busy} onPress={() => { void remove(item.id); }} />
          </View>;
        })}
        {result && (page > 1 || result.hasNext) && <View style={s.row}>
          <Action compact tone="secondary" label="이전 목록" disabled={busy || page === 1} onPress={() => setPage(previous => previous - 1)} />
          <Action compact tone="secondary" label="다음 목록" disabled={busy || !result.hasNext} onPress={() => setPage(previous => previous + 1)} />
        </View>}
      </>}
  </View>;
}

function HighlightRecords({ workId }: { workId?: string }) {
  const app = useApp();
  const { state: auth, client } = useMemberAuth();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [result, setResult] = useState<HighlightPage | null>(null);
  useEffect(() => {
    setResult(null);
    setFailure('');
    if (auth.status !== 'authenticated') return;
    let active = true;
    listHighlights(client, page, workId).then(value => {
      if (!active) return;
      if (!value.items.length && page > 1) setPage(previous => previous - 1);
      else setResult(value);
    }).catch(() => { if (active) setFailure('하이라이트를 불러오지 못했습니다.'); });
    return () => { active = false; };
  }, [auth.status, auth.generation, client, workId, page, attempt]);

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteHighlight(client, id);
      setAttempt(previous => previous + 1);
    } catch {
      setFailure('하이라이트를 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={c.highlightCard}>
    {auth.status === 'authenticated' && !result && !failure && <ActivityIndicator color={colors.green} />}
    {!!failure && <>
      <Text accessibilityRole="alert" style={s.error}>{failure}</Text>
      <Action compact tone="secondary" label="하이라이트 다시 불러오기" onPress={() => setAttempt(value => value + 1)} />
    </>}
    {(auth.status !== 'authenticated' || result?.items.length === 0) && <EmptyState compact title="표시할 밑줄이 없습니다." />}
    {auth.status === 'authenticated' && result?.items.map(item => {
      const { workId: slug, kind, range, snippet } = item;
      const canOpen = item.state === 'available' && slug && range && kind;
      return <View key={item.id} style={c.highlightEntry}>
        <View style={c.highlightTools}>
          {canOpen && range.unit === 'utf16' && !!snippet && <IconButton icon="share" label="문장 공유" disabled={busy}
            onPress={() => app.navigate({ screen: 'share', workId: slug, chapterId: range.chapterId,
              shareExcerpt: snippet, shareWorkTitle: item.workTitle ?? undefined })} />}
          <IconButton icon="close" label="하이라이트 삭제" disabled={busy} onPress={() => { void remove(item.id); }} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="하이라이트 위치 열기"
          disabled={busy || !canOpen} accessibilityState={{ disabled: busy || !canOpen }}
          style={[c.highlightQuote, item.color && { backgroundColor: highlightColors[item.color] }]}
          onPress={() => { if (canOpen) app.navigate({
            screen: 'reader', kind, workId: slug, chapterId: range.chapterId, highlightPosition: {
              chapterId: range.chapterId, offset: range.startOffset, unit: range.unit,
              contentVersion: range.contentVersion, contentHash: range.contentHash,
            },
          }); }}>
          {snippet !== null && <Text style={c.highlightText}>{snippet}</Text>}
          {range?.unit === 'page' && <Text style={c.highlightText}>{range.startOffset === range.endOffset
            ? range.startOffset + '쪽' : range.startOffset + '~' + range.endOffset + '쪽'}</Text>}
          {item.state === 'stale' && <Text style={s.muted}>본문이 변경되었거나 제공되지 않아 이 범위를 열 수 없습니다.</Text>}
          {item.state === 'hidden' && <Text style={s.muted}>열 수 없는 하이라이트입니다.</Text>}
        </Pressable>
        {!!item.workTitle && <Text style={c.highlightSource}>{[item.workTitle, item.chapterTitle].filter(Boolean).join(' · ')}</Text>}
      </View>;
    })}
    {auth.status === 'authenticated' && result && (page > 1 || result.hasNext) && <View style={s.row}>
      <Action compact tone="secondary" label="이전 하이라이트" disabled={busy || page === 1} onPress={() => setPage(value => value - 1)} />
      <Action compact tone="secondary" label="다음 하이라이트" disabled={busy || !result.hasNext} onPress={() => setPage(value => value + 1)} />
    </View>}
  </View>;
}

/** 홈과 같은 최근 본 목록을 표시하고 비회원 기록만 직접 비울 수 있습니다. */
export function RecentScreen() {
  const { navigate } = useApp();
  const apiUrl = useApiUrl();
  const { state, refresh, clearGuest } = useRecentWorks();
  useEffect(() => { void refresh(); }, [refresh]);

  if (state.status === 'loading') return <View style={c.detailStatus}><ActivityIndicator color={colors.green} /></View>;
  if (state.status === 'error') return <View style={c.detailStatus} accessibilityLiveRegion="polite">
    <Text style={s.subtitle}>최근 본 작품을 불러오지 못했습니다.</Text>
    <Text style={s.error}>{state.error}</Text>
    <Action label="다시 불러오기" onPress={() => { void refresh(); }} />
  </View>;
  return <View style={[s.page, c.recentPage]}>
    <Title action={!state.authenticated && <Pressable accessibilityRole="button" accessibilityState={{ disabled: state.items.length === 0 }} disabled={state.items.length === 0} onPress={clearGuest} style={c.clearRecent}>
      <Text style={[s.muted, state.items.length === 0 && c.disabledHistory]}>전체 삭제</Text>
    </Pressable>}>최근 본 작품</Title>
    {state.items.length === 0 ? <EmptyState title="표시할 최근 본 작품이 없습니다." description="작품을 열어 보면 이 목록에 표시됩니다." />
      : <View style={c.recentHistoryList}>{state.items.map(work => <Pressable key={work.id} accessibilityRole="button" accessibilityLabel={work.title + ' 상세 보기'}
        onPress={() => navigate({ screen: 'detail', workId: work.id })} style={c.recentHistoryItem}>
        <Image accessibilityLabel={work.title + ' 표지'} source={{ uri: new URL(work.imageUrl, apiUrl + '/').href }} resizeMode="cover" style={c.recentHistoryCover} />
        <View style={c.recentInfo}><Text style={c.recentTitle} numberOfLines={2}>{work.title}</Text><Text style={c.recentKind}>{kindLabel(work.kind)}</Text></View>
        <Icon name="next" size={18} color={colors.muted} />
      </Pressable>)}</View>}
    {!state.authenticated && <Text style={c.recentNote}>로그인 전 기록은 앱을 사용하는 동안만 보관됩니다.</Text>}
  </View>;
}
// #endregion

// #region 공유와 안내
/**
 * 시안의 전체 화면 공유 페이지를 구성합니다.
 *
 * @remarks
 * 기록에서 전달한 문장과 작품 제목을 표시합니다. 공유와 링크 복사는 비활성 상태이며
 * 주소 생성, 클립보드 변경, 운영체제 공유창 호출을 수행하지 않습니다.
 *
 * @returns 선택 문장 또는 빈 상태 안내와 두 개의 비활성 공유 버튼입니다.
 */
export function ShareScreen() {
  const { baseRoute } = useApp();
  return <View style={c.sharePage}>
    {baseRoute.shareExcerpt ? <View style={c.bookmarkCard}>
      <Text style={s.subtitle}>{baseRoute.shareWorkTitle}</Text>
      <Text selectable style={s.text}>{baseRoute.shareExcerpt}</Text>
    </View> : <EmptyState compact title="공유할 작품 정보가 없습니다." />}
    <View style={c.shareDescription}><Title>작품 링크 공유</Title><Text style={s.text}>받는 사람도 같은 작품으로 이동합니다.</Text></View>
    <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[c.shareAction, c.sharePrimary]}><Text style={c.sharePrimaryText}>공유</Text><Icon name="share" color="#fff" size={20} /></Pressable>
    <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={c.shareAction}><Text style={c.shareActionText}>링크 복사</Text><Icon name="link" size={20} /></Pressable>
  </View>;
}

/**
 * 앱 외부에서 공유 작품을 여는 안내 시안의 배치를 표시합니다.
 *
 * @remarks
 * 작품은 빈 상태이며 앱 열기는 비활성화되어 있습니다. 외부 주소나 앱 링크를
 * 실행하거나 앱 설치 여부를 검사하지 않습니다.
 *
 * @returns 브랜드, 빈 공유 작품, 앱 열기 버튼과 설치 안내입니다.
 */
export function FallbackScreen() {
  return <View style={c.fallbackPage}>
    <View style={c.fallbackBrand}><Image source={require('../assets/brand/header.png')} style={c.fallbackLogo} /><Text style={c.fallbackBrandText}>모북이</Text></View>
    <EmptyState compact title="표시할 공유 작품이 없습니다." style={c.fallbackInfo} />
    <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[c.shareAction, c.sharePrimary, c.fallbackAction]}><Text style={c.sharePrimaryText}>앱에서 작품 열기</Text><Icon name="next" color="#fff" size={18} /></Pressable>
    <Text style={c.fallbackNotice}>앱 설치 후에도 이 작품으로 이어집니다.</Text>
  </View>;
}
// #endregion

// #region 화면별 스타일
/** 빈 상태 안내와 화면별 고정 조작부의 배치입니다. */
const c = StyleSheet.create({
  horizontalStrip: { flexGrow: 0, flexShrink: 0 },
  selectedLabel: { fontWeight: '700', color: colors.green },
  section: { gap: 8 },
  recommendRow: { gap: 16 },
  recommendItem: { width: 120, gap: 8 },
  recommendCover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 7, backgroundColor: colors.pale },
  recommendTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  recentList: { padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  recentItem: { width: 120, gap: 8 },
  recentCover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 7, backgroundColor: colors.pale },
  searchTop: { paddingTop: 16, paddingHorizontal: 20, backgroundColor: '#fff' },
  searchField: { height: 52, borderRadius: 26, backgroundColor: '#F0F1E8', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, marginBottom: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: colors.ink, paddingVertical: 12 },
  categoryTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  categoryTab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  categoryTabSelected: { borderBottomColor: colors.green },
  categoryTabLabel: { fontSize: 16, color: colors.muted },
  searchBody: { padding: 20, paddingTop: 20, gap: 28, paddingBottom: 40 },
  searchHistory: { minHeight: 118, gap: 12 },
  clearHistory: { paddingHorizontal: 8, paddingVertical: 6 },
  disabledHistory: { opacity: 0.45 },
  searchHistoryList: { gap: 4 },
  searchHistoryItem: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 4 },
  searchHistorySearch: { minHeight: 42, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchHistoryRemove: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  searchFilters: { gap: 8, alignItems: 'center' },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8 },
  downIcon: { transform: [{ rotate: '90deg' }] },
  filterSheet: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 46, gap: 26 },
  filterSection: { gap: 18 },
  filterOptions: { flexDirection: 'row', gap: 10 },
  applyButton: { marginTop: 46 },
  detail: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  detailPrimaryAction: { minHeight: 46, paddingVertical: 12, marginTop: 'auto' },
  detailSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: 22 },
  bookDetailSummary: { gap: 20 },
  detailCover: { width: 132, aspectRatio: 2 / 3, borderRadius: 7 },
  bookDetailCover: { width: 138 },
  detailSummaryInfo: { flex: 1, minWidth: 0, minHeight: 207, paddingTop: 3, paddingBottom: 0, gap: 10 },
  novelSummaryInfo: { gap: 7 },
  detailTitleWords: { minHeight: 66, flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, alignContent: 'flex-start', alignItems: 'flex-start' },
  detailTitle: { maxWidth: '100%', fontSize: 24, lineHeight: 32, fontWeight: '700', color: colors.ink },
  detailAuthor: { fontSize: 14, lineHeight: 25, color: '#625D50' },
  detailIssue: { fontSize: 12, lineHeight: 23, color: '#477A96' },
  detailBody: { fontSize: 13, lineHeight: 23, color: '#625D50' },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 },
  detailStatus: { padding: 28, gap: 16, alignItems: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'flex-start', gap: 5 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  detailTags: { flexDirection: 'row', marginTop: 20, marginBottom: 16, gap: 8 },
  kindPill: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.pale, color: colors.green, fontSize: 11 },
  novelIntroduction: { padding: 16, flexDirection: 'row', minHeight: 126, borderRadius: 22, backgroundColor: colors.pale, gap: 12 },
  description: { marginTop: 10 },
  detailTabs: { flexDirection: 'row', marginTop: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailTab: { width: 91, height: 48, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent', paddingHorizontal: 4 },
  chapterCount: { flex: 1, textAlign: 'right', alignSelf: 'center' },
  detailSection: { marginTop: 52, gap: 25 },
  introductionCard: { borderRadius: 20, backgroundColor: colors.pale, minHeight: 212, padding: 17, paddingVertical: 24, gap: 16, justifyContent: 'center' },
  magazineIntroduction: { minHeight: 197, backgroundColor: '#E2EDF3', gap: 22 },
  magazineIntroductionTitle: { color: colors.ink, fontSize: 22, lineHeight: 31, fontWeight: '700' },
  metadata: { gap: 14, paddingTop: 8 },
  metadataRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  metadataLabel: { width: 75, fontSize: 12, lineHeight: 21, color: colors.muted },
  quoteEmpty: { borderRadius: 16, minHeight: 94, backgroundColor: '#F2EDDE', padding: 12, justifyContent: 'center' },
  quoteText: { color: colors.brown, fontSize: 17, lineHeight: 27, textAlign: 'center' },
  contentsRow: { minHeight: 86, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 18, borderBottomWidth: 1, borderBottomColor: colors.line },
  novelContentsRow: { minHeight: 70, paddingVertical: 12, gap: 27 },
  contentNumber: { width: 28, fontSize: 13, color: colors.muted },
  contentInfo: { flex: 1, gap: 8 },
  contentTitle: { fontSize: 14, lineHeight: 20, color: colors.ink },
  contentMetaText: { fontSize: 11, lineHeight: 16, color: colors.muted },
  chapterPurchase: { minHeight: 36, paddingHorizontal: 15, paddingVertical: 8 },
  contentMetadata: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  libraryTabs: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 7, flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line },
  libraryTab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center' },
  libraryTabIndicator: { position: 'absolute', bottom: 0, width: 36, height: 3, borderRadius: 1.5, backgroundColor: colors.green },
  libraryBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  libraryGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '6.2%', rowGap: 16 },
  libraryGridItem: { width: '29.2%', paddingBottom: 20, gap: 12 },
  libraryGridCover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 7, backgroundColor: colors.pale },
  libraryGridTitle: { minHeight: 40, fontSize: 13, fontWeight: '700', lineHeight: 19, color: colors.ink },
  libraryNovelList: { gap: 20 },
  libraryNovelItem: { minHeight: 160, flexDirection: 'row', alignItems: 'flex-start', gap: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  libraryNovelCoverColumn: { width: 72, gap: 12 },
  libraryNovelCover: { width: 72, height: 108, borderRadius: 7, backgroundColor: colors.pale },
  libraryNovelRecent: { fontSize: 10, lineHeight: 20, textAlign: 'center', color: colors.green },
  libraryNovelInfo: { flex: 1, minWidth: 0, gap: 6 },
  libraryNovelTitle: { color: colors.ink, fontSize: 17, lineHeight: 28, fontWeight: '700' },
  libraryNovelAuthor: { color: '#625D50', fontSize: 11, lineHeight: 22 },
  libraryNovelStats: { color: colors.muted, fontSize: 10, lineHeight: 23 },
  libraryNovelActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  libraryNovelAction: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  recentPage: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40, gap: 18 },
  clearRecent: { paddingHorizontal: 8, paddingVertical: 6 },
  recentHistoryList: { gap: 2 },
  recentHistoryItem: { minHeight: 106, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  recentHistoryCover: { width: 56, height: 80, borderRadius: 6, backgroundColor: colors.pale },
  recentInfo: { flex: 1, minWidth: 0, gap: 6 },
  recentTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  recentKind: { color: colors.green, fontSize: 11, fontWeight: '600' },
  recentNote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  manageSheet: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, gap: 16 },
  manageAction: { height: 64, borderRadius: 18, backgroundColor: colors.pale, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16, opacity: 0.55 },
  records: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 40, gap: 25 },
  bookmarkCard: { padding: 14, gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  bookmarkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 66, gap: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  bookmarkInfo: { flex: 1, minWidth: 0, gap: 5, paddingVertical: 10 },
  bookmarkTitle: { color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  bookmarkWork: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  highlightCard: { gap: 22, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 24 },
  highlightEntry: { gap: 10, padding: 14, borderRadius: 27, backgroundColor: '#E2EDF3' },
  highlightTools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  highlightQuote: { backgroundColor: colors.pale, padding: 10, borderRadius: 8 },
  highlightText: { fontSize: 18, lineHeight: 29, color: colors.ink },
  highlightSource: { marginHorizontal: 10, fontSize: 12, lineHeight: 18, color: colors.muted },
  sharePage: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 50, gap: 20 },
  shareDescription: { gap: 13, paddingTop: 8, paddingBottom: 26 },
  shareAction: { height: 48, borderRadius: 24, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.pale, borderWidth: 1, borderColor: colors.line, opacity: 0.55 },
  sharePrimary: { backgroundColor: colors.green, borderColor: colors.green },
  sharePrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  shareActionText: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  fallbackPage: { paddingHorizontal: 24, paddingTop: 130, paddingBottom: 54, backgroundColor: '#F2F6ED' },
  fallbackBrand: { alignItems: 'center', gap: 11 },
  fallbackLogo: { width: 38, height: 38 },
  fallbackBrandText: { color: colors.ink, fontSize: 29, lineHeight: 42, fontWeight: '700' },
  fallbackInfo: { marginTop: 24 },
  fallbackAction: { height: 52, borderRadius: 26, marginTop: 24 },
  fallbackNotice: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 30 },
});
// #endregion
