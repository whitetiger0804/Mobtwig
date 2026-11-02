// #region 의존성 가져오기
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { kindLabel, useApp, type Route } from './appState';
import { EmptyState } from './EmptyState';
import { HomeContent } from './HomeContent';
import { useApiUrl } from './serverConnection';
import { fetchWorkDetail, type WorkDetail } from './workDetails';
import { Action, Chip, colors, Icon, IconButton, s, Title } from './ui';
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
 * 입력란과 결과 분류 탭은 본문 스크롤 위에 고정합니다. 검색 제출은 빈 결과
 * 화면으로 이동하는 UI 동작이며 검색어를 요청하거나 저장하지 않습니다.
 * 분류를 지정하지 않은 경로에서는 검색 기록과 추천 작품의 빈 영역을 표시합니다.
 *
 * @param props - 검색 전 화면 또는 결과 분류를 구분하는 화면 속성입니다.
 * @returns 검색 입력란과 탭, 검색 전 안내 또는 빈 결과 목록입니다.
 */
export function SearchScreen({ route }: {
  /** 생략하면 검색 전 화면, 지정하면 해당 분류의 결과 화면을 표시합니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const [kind, setKind] = useState(route.kind);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('로맨스');

  return <View style={s.grow}>
    <View style={c.searchTop}>
      <View style={c.searchField}>
        <IconButton icon="search" label="검색" onPress={() => setKind(kind ?? 'all')} />
        <TextInput accessibilityLabel="작품명·작가명·출판사 검색" value={query} onChangeText={setQuery} placeholder="작품명·작가명·출판사 검색" placeholderTextColor={colors.muted} returnKeyType="search" onSubmitEditing={() => setKind(kind ?? 'all')} style={c.searchInput} />
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
          <Title action={<Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }}><Text style={s.muted}>전체 삭제</Text></Pressable>}>검색 기록</Title>
          <EmptyState compact title="검색 기록이 없습니다." />
        </View>
        <View style={c.section}><Title>추천 작품</Title><EmptyState title="표시할 추천 작품이 없습니다." /></View>
      </> : kind === 'all' ? <>
        <Text style={s.subtitle}>통합 검색 결과</Text>
        <View style={c.section}>
          <Title action={<IconButton icon="next" label="도서 검색 결과 더 보기" onPress={() => setKind('book')} />}>도서</Title>
          <EmptyState title="표시할 도서 검색 결과가 없습니다." />
        </View>
        <View style={c.section}>
          <Title action={<IconButton icon="next" label="매거진 검색 결과 더 보기" onPress={() => setKind('magazine')} />}>매거진</Title>
          <EmptyState title="표시할 매거진 검색 결과가 없습니다." />
        </View>
        <View style={c.section}>
          <Title action={<IconButton icon="next" label="웹소설 검색 결과 더 보기" onPress={() => setKind('novel')} />}>웹소설</Title>
          <EmptyState title="표시할 검색 결과가 없습니다." />
        </View>
      </> : <>
        <ScrollView horizontal style={c.horizontalStrip} showsHorizontalScrollIndicator={false} contentContainerStyle={c.searchFilters}>
          <IconButton icon="settings" label="검색 설정" onPress={() => navigate({ screen: 'filters', kind })} />
          {(kind === 'novel' ? ['로맨스', '판타지', '현대판타지', '로맨스판타지'] : ['카테고리', '가격', '발행일']).map(label => <Chip key={label} label={label} selected={kind === 'novel' && genre === label} onPress={() => kind === 'novel' ? setGenre(label) : navigate({ screen: 'filters', kind })} />)}
        </ScrollView>
        <Title action={<Pressable accessibilityRole="button" onPress={() => navigate({ screen: 'filters', kind })} style={c.sortButton}><Text style={s.muted}>인기순</Text><View style={c.downIcon}><Icon name="next" size={12} /></View></Pressable>}>검색 결과</Title>
        <EmptyState title="표시할 검색 결과가 없습니다." />
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
function DetailContents({ items, kind }: {
  /** 서버에서 받은 목차 또는 회차 목록입니다. */
  items: WorkDetail['contents'];
  /** 웹소설의 회차와 다른 작품의 목차를 구분합니다. */
  kind: WorkDetail['kind'];
}) {
  if (items.length === 0) return <EmptyState title={kind === 'novel' ? '표시할 회차가 없습니다.' : '표시할 목차가 없습니다.'} />;
  return <View>
    {items.map((item, index) => {
      const characterCount = item.characterCount;
      const metadata = kind === 'novel'
        ? [item.publishedAt?.replaceAll('-', '.'), characterCount === undefined ? undefined
          : characterCount >= 1000 ? (characterCount / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '천 자'
          : characterCount + '자'].filter(Boolean).join(' · ')
        : kind === 'magazine' ? item.category : undefined;
      return <View key={item.id} style={c.contentsRow}>
        <Text style={c.contentNumber}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={c.contentInfo}>
          <Text style={s.text}>{item.title}</Text>
          {(metadata || (kind === 'magazine' && item.pageNumber !== undefined)) && <View style={c.contentMetadata}>
            <Text style={[s.muted, s.grow]}>{metadata}</Text>
            {kind === 'magazine' && item.pageNumber !== undefined && <Text style={s.muted}>{String(item.pageNumber).padStart(2, '0')}p</Text>}
          </View>}
        </View>
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
 * 구매·읽기·찜·구독은 연동 전 상태를 유지합니다.
 *
 * @param props - 조회할 작품 식별자를 포함하는 화면 이동 정보입니다.
 * @returns 서버의 작품 정보와 분류에 맞는 상세 화면입니다.
 */
export function DetailScreen({ route }: {
  /** 작품 상세 API에 전달할 식별자를 포함합니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const apiUrl = useApiUrl();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState('회차');

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

  if (error !== null) return <View style={c.detailStatus} accessibilityLiveRegion="polite">
    <Text style={s.subtitle}>작품을 불러오지 못했습니다.</Text>
    <Text style={s.error}>{error}</Text>
    {route.workId && <Action label="다시 불러오기" onPress={() => setAttempt(value => value + 1)} />}
  </View>;
  if (work === null) return <View style={c.detailStatus} accessibilityLiveRegion="polite">
    <ActivityIndicator color={colors.green} /><Text style={s.muted}>작품 정보를 불러오고 있습니다.</Text>
  </View>;

  const kind = work.kind;
  return <View testID={'detail-' + work.id} style={c.detail}>
    <View style={c.detailSummary}>
      <Image accessibilityLabel={work.title + ' 표지'} source={{ uri: new URL(work.imageUrl, apiUrl + '/').href }} resizeMode="contain" style={c.detailCover} />
      <View style={c.detailSummaryInfo}>
        <View accessible accessibilityRole="header" accessibilityLabel={work.title} style={c.detailTitleWords}>
          {work.title.split(/\s+/).map((word, index) => <Text key={index} style={c.detailTitle}>{word}</Text>)}
        </View>
        <Text style={s.text}>{work.author}</Text>
        {kind === 'book' && <View style={c.publisherRow}><Text style={s.muted}>출판사</Text><Text style={[s.text, s.grow]}>{work.publisher}</Text></View>}
        {kind === 'magazine' && work.issue && <Text style={s.muted}>{work.issue}</Text>}
        {kind === 'novel' ? (work.statistics
          ? <View style={c.stats}>
            <View style={c.stat}><Text style={s.muted}>조회</Text><Text style={c.statValue}>{work.statistics.views.toLocaleString('ko-KR')}</Text></View>
            <View style={c.stat}><Text style={s.muted}>추천</Text><Text style={c.statValue}>{work.statistics.recommendations.toLocaleString('ko-KR')}</Text></View>
            <View style={c.stat}><Text style={s.muted}>평점</Text><Text style={c.statValue}>{work.statistics.rating}</Text></View>
          </View>
          : <EmptyState compact title="표시할 통계가 없습니다." />)
          : <Action label={kind === 'book' ? '구매하기' : '이번 호 읽기'} style={{ minHeight: 46 }} disabled />}
      </View>
    </View>
    {kind === 'novel' ? <>
      <View style={c.detailTags}><Text style={c.kindPill}>웹소설</Text><Text style={c.kindPill}>{work.category}</Text></View>
      <View style={c.novelIntroduction}>
        <View style={s.grow}><Text style={s.subtitle}>작품 소개</Text><Text style={[s.text, c.description]}>{work.description}</Text></View>
        <View style={c.novelActions}>
          <View style={c.labeledIcon}><IconButton icon="heart" label="찜" disabled /><Text style={s.muted}>찜</Text></View>
          <View style={c.labeledIcon}><IconButton icon="bookmark" label="구독" disabled /><Text style={s.muted}>구독</Text></View>
        </View>
      </View>
      <View style={c.detailTabs}>
        {['회차', '리뷰'].map(label => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: tab === label }} onPress={() => label === '리뷰' ? navigate({ screen: 'reviews', kind, workId: work.id }) : setTab(label)} style={[c.detailTab, tab === label && c.categoryTabSelected]}><Text style={[c.categoryTabLabel, tab === label && c.selectedLabel]}>{label}</Text></Pressable>)}
        <Text style={[s.muted, c.chapterCount]}>전체 {work.contents.length}화</Text>
      </View>
      <DetailContents items={work.contents} kind={kind} />
    </> : kind === 'book' ? <>
      <View style={c.detailSection}>
        <Title>작품 정보</Title>
        <View style={c.introductionCard}><Text style={s.subtitle}>책 소개</Text><Text style={s.text}>{work.description}</Text></View>
        <View style={c.metadata}>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>분야</Text><Text style={[s.text, s.grow]}>{work.category}</Text></View>
          <View style={c.metadataRow}><Text style={c.metadataLabel}>발행일</Text><Text style={[s.text, s.grow]}>{work.publishedAt}</Text></View>
          {work.pageCount !== undefined && <View style={c.metadataRow}><Text style={c.metadataLabel}>분량</Text><Text style={[s.text, s.grow]}>{work.pageCount}쪽</Text></View>}
          <View style={c.metadataRow}><Text style={c.metadataLabel}>파일</Text><Text style={[s.text, s.grow]}>{work.fileFormat}</Text></View>
        </View>
        {work.quote && <View style={c.quoteEmpty}><Text style={c.quoteText}>{work.quote}</Text></View>}
      </View>
      <View style={c.detailSection}><Title action={<Text style={s.muted}>{work.contents.length}개</Text>}>목차</Title><DetailContents items={work.contents} kind={kind} /></View>
      <View style={c.detailSection}><Title action={<Action compact tone="secondary" label="리뷰 작성" onPress={() => navigate({ screen: 'reviewWrite', kind, workId: work.id })} />}>리뷰</Title><EmptyState title="표시할 리뷰가 없습니다." /></View>
    </> : <>
      <View style={c.detailSection}>
        <Title>이번 호의 이야기</Title>
        <View style={[c.introductionCard, { minHeight: 197 }]}>
          {work.descriptionTitle && <Text style={s.subtitle}>{work.descriptionTitle}</Text>}
          <Text style={s.text}>{work.description}</Text>
        </View>
      </View>
      <View style={c.detailSection}>
        <Title action={<Text style={s.muted}>{work.contents.length}개 아티클{work.pageCount !== undefined && ' · ' + work.pageCount + '쪽'}</Text>}>목차</Title>
        <DetailContents items={work.contents} kind={kind} />
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
  </View>;
}
// #endregion

// #region 서재와 독서 기록
/**
 * 서재의 고정 분류 탭과 빈 상태 안내를 구성합니다.
 *
 * @remarks
 * 표지 자리나 작품 개수를 고정하지 않습니다. 서재나 열람 기록을 조회하지 않으며,
 * 작품 데이터가 없는 상태에서는 분류에 관계없이 빈 안내만 표시합니다.
 *
 * @param props - 서재에서 선택한 분류를 포함하는 화면 속성입니다.
 * @returns 고정 탭과 스크롤 가능한 빈 서재 영역입니다.
 */
export function LibraryScreen({ route }: {
  /** 서재의 현재 분류 탭을 제공하는 UI 이동 상태입니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const kind = route.kind ?? 'book';
  return <View style={s.grow}>
    <View style={c.libraryTabs}>{(['book', 'magazine', 'novel'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => navigate({ screen: 'library', kind: value }, true)} style={[c.categoryTab, kind === value && c.categoryTabSelected]}><Text style={[c.categoryTabLabel, kind === value && c.selectedLabel]}>{kindLabel(value)}</Text></Pressable>)}</View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={c.libraryBody}>
      <EmptyState title="표시할 서재 작품이 없습니다." />
    </ScrollView>
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
 * 모든 책 선택과 밑줄·책갈피의 분리된 빈 영역을 구성합니다.
 *
 * @remarks
 * 시안의 책 선택 행과 밑줄 카드·책갈피 목록 배치를 유지합니다.
 * 기록과 작품 목록을 조회하거나 인용문·페이지 정보를 생성하지 않습니다.
 *
 * @returns 책 선택 행, 빈 밑줄 카드와 빈 책갈피 영역입니다.
 */
export function RecordsScreen() {
  return <View style={c.records}>
    <View style={s.row}><Chip label="모든 책" selected /></View>
    <View style={c.highlightCard}><View style={c.highlightTools}><IconButton icon="share" label="밑줄 공유" disabled /></View><View style={c.highlightQuote}><EmptyState compact title="표시할 밑줄이 없습니다." /></View></View>
    <Title>책갈피</Title><EmptyState title="표시할 책갈피가 없습니다." />
  </View>;
}

/**
 * 최근 본 작품의 빈 상태 안내를 표시합니다.
 *
 * @remarks
 * 열람 이력이나 마지막 읽은 시각을 조회하지 않습니다.
 *
 * @returns 최근 본 작품 데이터가 없는 화면입니다.
 */
export function RecentScreen() {
  return <View style={s.page}><EmptyState title="표시할 최근 본 작품이 없습니다." /></View>;
}
// #endregion

// #region 공유와 안내
/**
 * 시안의 전체 화면 공유 페이지를 구성합니다.
 *
 * @remarks
 * 작품 정보는 빈 상태 안내로 표시합니다. 공유와 링크 복사는 비활성 상태이며
 * 주소 생성, 클립보드 변경, 운영체제 공유창 호출을 수행하지 않습니다.
 *
 * @returns 빈 공유 작품과 공유 안내, 두 개의 비활성 버튼입니다.
 */
export function ShareScreen() {
  return <View style={c.sharePage}>
    <EmptyState compact title="공유할 작품 정보가 없습니다." />
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
  searchTop: { paddingTop: 16, paddingHorizontal: 20, backgroundColor: '#fff' },
  searchField: { height: 52, borderRadius: 26, backgroundColor: '#F0F1E8', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, marginBottom: 16 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: colors.ink, paddingVertical: 12 },
  categoryTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  categoryTab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  categoryTabSelected: { borderBottomColor: colors.green },
  categoryTabLabel: { fontSize: 16, color: colors.muted },
  searchBody: { padding: 20, paddingTop: 20, gap: 28, paddingBottom: 40 },
  searchHistory: { minHeight: 118, gap: 12 },
  searchFilters: { gap: 8, alignItems: 'center' },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8 },
  downIcon: { transform: [{ rotate: '90deg' }] },
  filterSheet: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 46, gap: 26 },
  filterSection: { gap: 18 },
  filterOptions: { flexDirection: 'row', gap: 10 },
  applyButton: { marginTop: 46 },
  detail: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  detailSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  detailCover: { width: '38%', maxWidth: 138, aspectRatio: 2 / 3, borderRadius: 6 },
  detailSummaryInfo: { flex: 1, minWidth: 0, gap: 14 },
  detailTitleWords: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6 },
  detailTitle: { maxWidth: '100%', fontSize: 24, lineHeight: 32, fontWeight: '700', color: colors.ink },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailStatus: { padding: 28, gap: 16, alignItems: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 8 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.ink },
  detailTags: { flexDirection: 'row', marginTop: 20, marginBottom: 16, gap: 8 },
  kindPill: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 14, overflow: 'hidden', backgroundColor: '#E7EFDD', color: colors.green, fontSize: 11 },
  novelIntroduction: { padding: 16, flexDirection: 'row', minHeight: 126, borderRadius: 22, backgroundColor: colors.pale, gap: 12 },
  novelActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  description: { marginTop: 10 },
  labeledIcon: { alignItems: 'center' },
  detailTabs: { flexDirection: 'row', marginTop: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailTab: { width: 91, height: 48, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent', paddingHorizontal: 4 },
  chapterCount: { flex: 1, textAlign: 'right', alignSelf: 'center' },
  detailSection: { marginTop: 52, gap: 25 },
  introductionCard: { borderRadius: 20, backgroundColor: colors.pale, minHeight: 212, padding: 17, gap: 8, justifyContent: 'center' },
  metadata: { gap: 14, paddingTop: 8 },
  metadataRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  metadataLabel: { width: 75, fontSize: 12, lineHeight: 21, color: colors.muted },
  quoteEmpty: { borderRadius: 16, minHeight: 94, backgroundColor: '#F2EDDE', padding: 12, justifyContent: 'center' },
  quoteText: { color: colors.brown, fontSize: 17, lineHeight: 27, textAlign: 'center' },
  contentsRow: { minHeight: 58, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  contentNumber: { width: 28, fontSize: 13, color: colors.muted },
  contentInfo: { flex: 1, gap: 7 },
  contentMetadata: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  libraryTabs: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 7, flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line },
  libraryBody: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 40 },
  manageSheet: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, gap: 16 },
  manageAction: { height: 64, borderRadius: 18, backgroundColor: colors.pale, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16, opacity: 0.55 },
  records: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 40, gap: 25 },
  highlightCard: { minHeight: 200, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 24 },
  highlightTools: { alignItems: 'flex-end' },
  highlightQuote: { marginHorizontal: 14, backgroundColor: '#F1EBD7', minHeight: 87, borderRadius: 8, justifyContent: 'center' },
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
