// #region 의존성 가져오기
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from './appState';
import { EmptyState } from './EmptyState';
import { useApiUrl } from './serverConnection';
import { parseHomeResponse, type BannerSection, type FeaturedWorkSection, type HomeKind, type HomeResponse, type SduiSection } from './homeSchema';
import { Action, colors, Icon, s, Title } from './ui';
// #endregion

// #region 배너 목록
/**
 * 응답에 포함된 배너만 가로로 넘겨 표시합니다.
 *
 * @remarks
 * 배경은 서버 이미지이며 내부에 책 표지 자리를 예약하지 않습니다.
 * 너비에 비례한 높이를 사용하고 큰 글꼴에서는 문구에 맞춰 더 늘어납니다.
 *
 * @param props - 서버가 선택한 배너 구역입니다.
 * @returns 응답 개수만큼의 배너를 담은 가로 스크롤입니다.
 */
function BannerCarousel({ section }: {
  /** 비어 있지 않은 배너 구역입니다. 빈 목록은 상위 요소에서 처리합니다. */
  section: BannerSection;
}) {
  const apiUrl = useApiUrl();
  const { navigate } = useApp();
  const [width, setWidth] = useState(0);
  return <View onLayout={({ nativeEvent }) => setWidth(Math.max(0, nativeEvent.layout.width - 50))}>
    <ScrollView horizontal accessibilityLabel={section.title ?? '배너 목록'} showsHorizontalScrollIndicator={false}
      snapToInterval={width + 12} decelerationRate="fast" disableIntervalMomentum contentContainerStyle={styles.carousel}>
      {section.items.map(item => <View key={item.id} testID={`banner-${item.id}`} style={[styles.banner, { width, minHeight: width * 156 / 270 }]}>
        <Image source={{ uri: new URL(item.imageUrl, `${apiUrl}/`).href }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.bannerShade]} />
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle}>{item.title}</Text>
          {item.description && <Text style={styles.bannerDescription}>{item.description}</Text>}
          {item.action && <Pressable accessibilityRole="button" accessibilityLabel={item.action.label}
            onPress={() => navigate(item.action!.route)} style={styles.bannerAction}>
            <Text style={styles.bannerActionText}>{item.action.label}</Text><Icon name="next" size={15} color="#fff" />
          </Pressable>}
        </View>
      </View>)}
    </ScrollView>
  </View>;
}
// #endregion

// #region 좌우 추천 작품
/**
 * 기존 '오늘의 책'의 문구·작품 정보와 우측 표지 배치를 표시합니다.
 *
 * @remarks
 * 표시 문구와 작품, 추가 이동 동작은 응답에서 받으며 한 개의 작품으로 고정하지 않습니다.
 * 작품 정보나 표지를 누르면 해당 식별자의 상세 정보를 조회하는 화면으로 이동합니다.
 * 빈 목록은 상위 구역에서 안내만 표시하므로 표지 자리를 만들지 않습니다.
 *
 * @param props - 서버가 선택한 추천 작품 구역입니다.
 * @returns 응답 순서대로 배치한 추천 작품 요소입니다.
 */
function FeaturedWorks({ section }: {
  /** 추천 작품 구역입니다. */
  section: FeaturedWorkSection;
}) {
  const apiUrl = useApiUrl();
  const { navigate } = useApp();
  return <View style={styles.featuredList}>
    {section.items.map(item => <View key={item.id} testID={`featured-${item.id}`} style={styles.featured}>
      <View style={styles.featuredCopy}>
        <Pressable accessibilityRole="button" accessibilityLabel={item.title + ' 상세 보기'}
          onPress={() => navigate({ screen: 'detail', workId: item.id })} style={styles.featuredInfo}>
          <View style={styles.featuredLabelRow}><Icon name="book" size={18} color={colors.green} /><Text style={styles.featuredLabel}>{item.label}</Text></View>
          <Text style={styles.featuredTitle}>{item.title}</Text>
          {item.subtitle && <Text style={styles.featuredSubtitle}>{item.subtitle}</Text>}
        </Pressable>
        {item.action && <Pressable accessibilityRole="button" accessibilityLabel={item.action.label}
          onPress={() => navigate(item.action!.route)} style={styles.featuredAction}>
          <Text style={styles.featuredActionText}>{item.action.label}</Text><Icon name="next" size={14} />
        </Pressable>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={item.title + ' 상세 보기'}
        onPress={() => navigate({ screen: 'detail', workId: item.id })} style={styles.featuredCover}>
        <Image accessibilityLabel={`${item.title} 표지`} source={{ uri: new URL(item.imageUrl, `${apiUrl}/`).href }} resizeMode="contain" style={styles.featuredCoverImage} />
      </Pressable>
    </View>)}
  </View>;
}
// #endregion

// #region 공통 구역 렌더러
/** 항목이 없는 구역에 표시할 클라이언트 공통 안내입니다. */
const emptyMessages: Record<SduiSection['type'], string> = {
  bannerCarousel: '표시할 배너가 없습니다.',
  featuredWork: '표시할 작품이 없습니다.',
  workShelf: '표시할 작품이 없습니다.',
  linkRow: '표시할 바로가기가 없습니다.',
};

/**
 * 서버의 구역 유형을 앱에 등록된 공통 요소로 렌더링합니다.
 *
 * @remarks
 * 빈 목록의 안내 문구와 구역 이동 버튼의 오른쪽 화살표는 클라이언트에서 제공합니다.
 *
 * @param props - 검증을 마친 구역입니다.
 * @returns 구역 제목·동작과 실제 항목 또는 빈 상태입니다.
 */
function Section({ section }: {
  /** 서버 응답의 구역 하나입니다. */
  section: SduiSection;
}) {
  const apiUrl = useApiUrl();
  const { navigate } = useApp();
  const action = section.action;
  return <View testID={`section-${section.id}`} style={styles.section}>
    {(section.title || action) && <View style={styles.heading}>
      <Title action={action && <Pressable accessibilityRole="button" accessibilityLabel={action.label}
        onPress={() => navigate(action.route)} style={({ pressed }) => [s.action, s.compact, s.quiet, pressed && { opacity: .55 }]}>
        <Text style={[s.actionText, { color: colors.ink }]}>{action.label}</Text><Icon name="next" size={14} />
      </Pressable>}>
        {section.title}
      </Title>
    </View>}
    {section.items.length === 0 ? <EmptyState compact title={emptyMessages[section.type]} />
      : section.type === 'bannerCarousel' ? <BannerCarousel section={section} />
      : section.type === 'featuredWork' ? <FeaturedWorks section={section} />
      : section.type === 'workShelf' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
        {section.items.map(item => <Pressable key={item.id} testID={`work-${item.id}`} accessibilityRole="button"
          accessibilityLabel={item.title + ' 상세 보기'} onPress={() => navigate({ screen: 'detail', workId: item.id })} style={styles.work}>
          <Image accessibilityLabel={`${item.title} 표지`} source={{ uri: new URL(item.imageUrl, `${apiUrl}/`).href }} resizeMode="cover" style={styles.cover} />
          <Text style={styles.workTitle}>{item.title}</Text>
          {item.subtitle && <Text style={s.muted}>{item.subtitle}</Text>}
        </Pressable>)}
      </ScrollView>
      : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
        {section.items.map(item => <Pressable key={item.id} testID={`link-${item.id}`} accessibilityRole="button"
          accessibilityLabel={item.label} onPress={() => navigate(item.route)} style={styles.link}>
          {item.icon && <Icon name={item.icon} size={22} color={colors.green} />}
          <Text style={styles.linkLabel}>{item.label}</Text>
        </Pressable>)}
      </ScrollView>}
  </View>;
}
// #endregion

// #region 홈 응답 조회
/**
 * 선택한 서버에서 홈 구성을 읽어 공통 요소 집합으로 표시합니다.
 *
 * @remarks
 * 구역 제목·순서·내용·개수는 응답을 따릅니다. 목록 없음과 통신·계약 오류를 구분하며,
 * 실패 시 간이 데이터나 빈 표지를 대신 표시하지 않습니다. 화면을 떠나면 요청을 취소합니다.
 *
 * @param props - 조회할 홈의 분류입니다.
 * @returns 로딩·오류·빈 화면 또는 응답 구역 목록입니다.
 */
export function HomeContent({ kind }: {
  /** 전체·도서·매거진·웹소설 중 조회할 홈입니다. */
  kind: HomeKind;
}) {
  const apiUrl = useApiUrl();
  const [response, setResponse] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setResponse(null);
    setError(null);
    fetch(`${apiUrl}/sdui/home?kind=${kind}`, { signal: controller.signal })
      .then(result => {
        if (!result.ok) throw new Error(`서버가 요청을 처리하지 못했습니다. (HTTP ${result.status})`);
        return result.json();
      })
      .then(parseHomeResponse)
      .then(value => {
        if (!controller.signal.aborted) setResponse(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '서버 연결을 확인해 주십시오.');
      });
    return () => controller.abort();
  }, [apiUrl, kind, attempt]);

  if (error !== null) return <View style={styles.status} accessibilityLiveRegion="polite">
    <Text style={s.subtitle}>홈을 불러오지 못했습니다.</Text>
    <Text style={s.error}>{error}</Text>
    <Action label="다시 불러오기" onPress={() => setAttempt(value => value + 1)} />
  </View>;
  if (response === null) return <View style={styles.status} accessibilityLiveRegion="polite">
    <ActivityIndicator color={colors.green} /><Text style={s.muted}>홈을 불러오고 있습니다.</Text>
  </View>;
  if (response.sections.length === 0) return <EmptyState title="표시할 홈 구성이 없습니다." description="서버에서 표시할 구역을 보내지 않았습니다." />;
  return <View style={styles.page}>{response.sections.map(section => <Section key={section.id} section={section} />)}</View>;
}
// #endregion

// #region 공통 요소 스타일
/** 서버가 선택하는 공통 요소의 표시 규칙입니다. 항목 수를 지정하지 않습니다. */
const styles = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 32, gap: 28 },
  section: { gap: 14 },
  heading: { paddingHorizontal: 20 },
  items: { paddingHorizontal: 20, gap: 14, alignItems: 'flex-start' },
  carousel: { paddingHorizontal: 20, gap: 12 },
  banner: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#20372D', justifyContent: 'center' },
  bannerShade: { backgroundColor: 'rgba(10, 22, 33, 0.42)' },
  bannerCopy: { paddingHorizontal: 20, paddingVertical: 16, gap: 10 },
  bannerTitle: { color: '#fff', fontSize: 23, lineHeight: 30, fontWeight: '700' },
  bannerDescription: { color: '#F3F6EC', fontSize: 13, lineHeight: 20 },
  bannerAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 8 },
  bannerActionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  featuredList: { gap: 20 },
  featured: { minHeight: 238, paddingVertical: 20, paddingLeft: 20, paddingRight: 40, flexDirection: 'row', alignItems: 'flex-start', gap: 20, backgroundColor: '#EEE3D3' },
  featuredCopy: { flex: 1, minWidth: 0, gap: 12 },
  featuredInfo: { gap: 12 },
  featuredLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featuredLabel: { flex: 1, color: colors.green, fontSize: 13, lineHeight: 20, fontWeight: '700' },
  featuredTitle: { maxWidth: 184, fontSize: 28, lineHeight: 38, fontWeight: '700', color: colors.ink },
  featuredSubtitle: { fontSize: 12, lineHeight: 20, color: '#625D50' },
  featuredAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6 },
  featuredActionText: { flexShrink: 1, fontSize: 13, lineHeight: 20, fontWeight: '700', color: colors.ink },
  featuredCover: { width: '36%', maxWidth: 122, aspectRatio: 2 / 3 },
  featuredCoverImage: { width: '100%', height: '100%', borderRadius: 5 },
  work: { width: 120, gap: 8 },
  cover: { width: '100%', aspectRatio: 2 / 3, borderRadius: 7 },
  workTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.ink },
  link: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: colors.pale, flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkLabel: { fontSize: 13, color: colors.green, fontWeight: '600' },
  status: { padding: 24, gap: 16, alignItems: 'center' },
});
// #endregion
