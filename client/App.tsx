// #region 의존성 가져오기
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, kindLabel, useApp, type Route, type Screen } from './src/appState';
import { EmptyState } from './src/EmptyState';
import { ServerConnectionProvider } from './src/serverConnection';
import { Action, colors, Icon, IconButton, s, Title } from './src/ui';
import { DetailScreen, FallbackScreen, FiltersScreen, HomeScreen, LibraryManageScreen, LibraryScreen, RecentScreen, RecordsScreen, SearchScreen, ShareScreen } from './src/CatalogScreens';
import { AccountScreen, LoginScreen, MyScreen, PasswordScreen, ReadingSettingsScreen, SignupScreen, WithdrawScreen } from './src/AccountScreens';
import { CommentComposeScreen, CommunityScreen, PostMenuScreen, PostScreen, ReportScreen, WritePostScreen } from './src/CommunityScreens';
import { ReviewCommentsScreen, ReviewsScreen, ReviewWriteScreen } from './src/ReviewScreens';
import { ImageFullScreen, ReadingScreen, WorldScreen, WorldTermsScreen } from './src/ReadingScreens';
// #endregion

// #region 화면 제목
/** 각 화면의 공통 헤더에 표시하는 고정 제목입니다. */
const titles: Record<Screen, string> = {
  home: '홈', search: '통합 검색', detail: '작품 상세', reader: '독서', media: '앱북',
  world: '세계관', worldTerms: '세계관 용어', imageFull: '이미지 확대', library: '내 서재', records: '밑줄과 책갈피', recent: '최근 본',
  community: '커뮤니티', post: '게시글', writePost: '글쓰기',
  reviews: '독자 리뷰', reviewWrite: '리뷰 쓰기', reviewComments: '댓글',
  login: '로그인', signup: '회원가입', my: '마이', account: '계정 설정',
  password: '비밀번호 변경', withdraw: '회원 탈퇴', readingSettings: '읽기 설정',
  filters: '검색 설정', share: '공유', libraryManage: '서재 관리',
  postMenu: '게시글 메뉴', report: '게시글 신고', commentCompose: '댓글 작성',
  events: '이벤트', notifications: '알림', webFallback: '공유 작품',
};
// #endregion

// #region 화면 선택
/**
 * 선택된 화면 이름에 대응하는 화면 컴포넌트를 구성합니다.
 *
 * @remarks
 * 화면 이동용 탭과 작품 식별자를 전달하며 업무 데이터 조회나 인증 검사를 수행하지 않습니다.
 * 이벤트·알림 화면도 {@link EmptyState}를 표시합니다.
 *
 * @param props - 표시할 화면과 선택 탭입니다.
 * @returns 선택된 화면의 React 요소입니다.
 */
function Content({ route }: {
  /** 표시할 화면 이름과 화면 내 선택 탭입니다. */
  route: Route;
}) {
  switch (route.screen) {
    case 'home': return <HomeScreen route={route} />;
    case 'search': return <SearchScreen route={route} />;
    case 'filters': return <FiltersScreen />;
    case 'detail': return <DetailScreen route={route} />;
    case 'reader':
    case 'media': return <ReadingScreen />;
    case 'world': return <WorldScreen />;
    case 'worldTerms': return <WorldTermsScreen />;
    case 'imageFull': return <ImageFullScreen />;
    case 'library': return <LibraryScreen route={route} />;
    case 'libraryManage': return <LibraryManageScreen />;
    case 'records': return <RecordsScreen />;
    case 'recent': return <RecentScreen />;
    case 'reviews': return <ReviewsScreen />;
    case 'reviewWrite': return <ReviewWriteScreen />;
    case 'reviewComments': return <ReviewCommentsScreen />;
    case 'community': return <CommunityScreen route={route} />;
    case 'post': return <PostScreen />;
    case 'writePost': return <WritePostScreen route={route} />;
    case 'commentCompose': return <CommentComposeScreen />;
    case 'postMenu': return <PostMenuScreen />;
    case 'report': return <ReportScreen />;
    case 'login': return <LoginScreen />;
    case 'signup': return <SignupScreen />;
    case 'my': return <MyScreen />;
    case 'account': return <AccountScreen />;
    case 'password': return <PasswordScreen />;
    case 'withdraw': return <WithdrawScreen />;
    case 'readingSettings': return <ReadingSettingsScreen />;
    case 'share': return <ShareScreen />;
    case 'webFallback': return <FallbackScreen />;
    case 'events': return (
      <View style={s.page}>
        <Title>이벤트</Title>
        <EmptyState title="표시할 이벤트가 없습니다." />
      </View>
    );
    case 'notifications': return (
      <View style={s.page}>
        <Title>알림</Title>
        <EmptyState title="표시할 알림이 없습니다." />
      </View>
    );
  }
}
// #endregion

// #region 공통 화면 틀
/**
 * 현재 화면 주위에 공통 헤더·분류 탭·하단 메뉴·패널을 배치합니다.
 *
 * @remarks
 * {@link useApp}의 바탕 화면과 패널을 각각 렌더링합니다.
 * 자체 헤더·스크롤·하단 도구가 있는 화면은 해당 화면의 배치를 그대로 사용합니다.
 * 홈과 커뮤니티는 분류 탭을 공유하고, 상세·계정·작성 화면은 시안의 개별 헤더를 사용합니다.
 * 홈·커뮤니티·검색·서재 헤더 오른쪽의 알림 버튼은 알림 화면으로 이동합니다.
 * 화면·분류·작품 식별자가 바뀌면 화면 키도 바뀌어 해당 화면의 임시 입력 상태가 초기화됩니다.
 *
 * @returns 안전 영역 안에 현재 화면과 탐색 도구를 배치한 앱 틀입니다.
 */
function Shell() {
  const app = useApp();
  const route = app.baseRoute;
  const ownHeader = ['reader', 'media', 'world', 'worldTerms', 'imageFull', 'webFallback'].includes(route.screen);
  const branded = route.screen === 'home' || route.screen === 'community';
  const showBottomNav = ['home', 'search', 'library', 'detail', 'records', 'recent', 'my', 'community', 'events', 'notifications'].includes(route.screen);
  const ownScroll = ['reader', 'media', 'world', 'worldTerms', 'imageFull', 'search', 'library', 'community', 'post', 'writePost', 'report', 'reviews', 'reviewWrite', 'reviewComments', 'login', 'signup', 'password'].includes(route.screen);
  const centeredTitle = ['signup', 'account', 'password', 'share', 'records', 'report', 'reviewWrite', 'reviewComments', 'writePost'].includes(route.screen);
  const hideTitle = route.screen === 'login' || route.screen === 'detail';
  const routeKey = [route.screen, route.kind, route.mode, route.workId].join(':');

  return (
    <SafeAreaView style={[styles.shell, route.screen === 'imageFull' && styles.darkShell]} edges={['top', 'bottom']}>
      <StatusBar style={route.screen === 'imageFull' ? 'light' : 'dark'} />
      {!ownHeader && (
        <View style={[styles.header, branded && styles.brandHeader, route.screen === 'detail' && styles.detailHeader]}>
          {branded ? (
            <Pressable accessibilityRole="button" accessibilityLabel="모북이 홈" style={s.row} onPress={() => app.navigate({ screen: 'home', kind: 'all' }, true)}>
              <Image source={require('./assets/brand/header.png')} style={styles.brand} />
              <Text style={styles.brandName}>모북이</Text>
            </Pressable>
          ) : (
            <View style={[s.row, s.grow, styles.headerStart]}>
              <IconButton icon="back" label="뒤로 가기" onPress={app.back} />
              {!hideTitle && !centeredTitle && <Text numberOfLines={1} style={[styles.headerTitle, s.grow, ['my', 'search', 'library'].includes(route.screen) && styles.mainTitle, route.screen === 'post' && styles.postTitle]}>{titles[route.screen]}</Text>}
            </View>
          )}
          {centeredTitle && <Text pointerEvents="none" numberOfLines={1} style={styles.centeredTitle}>{titles[route.screen]}</Text>}
          <View style={[s.row, styles.headerActions]}>
            {(branded || route.screen === 'search' || route.screen === 'library') && <IconButton icon="bell" label="알림" iconSize={26} style={styles.headerIconButton} onPress={() => app.navigate({ screen: 'notifications' })} />}
            {(branded || route.screen === 'search' || route.screen === 'library') && <IconButton icon="user" label="마이페이지" iconSize={26} style={styles.headerIconButton} onPress={() => app.navigate({ screen: 'my' })} />}
            {route.screen === 'my' && <View style={styles.roundHeaderAction}><IconButton icon="gear" label="계정 설정" onPress={() => app.navigate({ screen: 'account' })} /></View>}
            {route.screen === 'detail' && <IconButton icon="share" label="공유" onPress={() => app.navigate({ screen: 'share' })} />}
            {route.screen === 'post' && <IconButton icon="more" label="게시글 메뉴" onPress={() => app.navigate({ screen: 'postMenu' })} />}
            {route.screen === 'reviews' && <Action label="리뷰 쓰기" compact style={styles.headerAction} onPress={() => app.navigate({ screen: 'reviewWrite' })} />}
          </View>
        </View>
      )}
      {branded && (
        <View style={styles.categories}>
          {(['all', 'book', 'magazine', 'novel', 'community'] as const).map(kind => {
            const selected = kind === 'community' ? route.screen === 'community' : route.screen === 'home' && (route.kind ?? 'all') === kind;
            return (
            <Pressable
              key={kind}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => app.navigate(kind === 'community' ? { screen: 'community', mode: 'work' } : { screen: 'home', kind }, true)}
              style={styles.category}
            >
              <View style={[styles.categoryLabelWrap, selected && styles.categoryActive]}>
              <Text numberOfLines={1} style={[styles.categoryLabel, selected && styles.categoryLabelActive]}>
                {kind === 'all' ? '홈' : kind === 'community' ? '커뮤니티' : kindLabel(kind)}
              </Text>
              </View>
            </Pressable>
            );
          })}
        </View>
      )}
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {ownScroll ? (
          <Content key={routeKey} route={route} />
        ) : (
          <ScrollView key={routeKey} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <Content route={route} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      {showBottomNav && (
        <View style={styles.bottomNav}>
          {([
            ['search', '검색', 'search'],
            ['events', '이벤트', 'gift'],
            ['home', '홈', 'home'],
            ['library', '서재', 'library'],
            ['recent', '최근 본', 'clock'],
          ] as const).map(([screen, label, icon]) => (
            <Pressable
              key={screen}
              accessibilityRole="tab"
              accessibilityLabel={label + ' 탭'}
              accessibilityState={{ selected: route.screen === screen }}
              onPress={() => app.navigate({ screen, ...(screen === 'home' ? { kind: 'all' as const } : {}) }, true)}
              style={styles.navItem}
            >
              <View style={[styles.navIcon, screen === 'home' && styles.homeIcon]}>
                <Icon name={icon} size={screen === 'home' ? 27 : 22} color={screen === 'home' ? '#fff' : route.screen === screen ? colors.green : '#625D50'} />
              </View>
              <Text style={[styles.navLabel, (route.screen === screen || screen === 'home') && styles.selectedLabel]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal visible={!!app.overlay} transparent animationType="slide" onRequestClose={app.back}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable accessibilityRole="button" accessibilityLabel="패널 바깥에서 닫기" onPress={app.back} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.handleArea}><View style={styles.handle} /></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {app.overlay && <Content key={app.overlay.screen} route={app.overlay} />}
            </ScrollView>
            <View style={[styles.closeArea, app.overlay?.screen === 'readingSettings' && { top: 8 }, app.overlay?.screen === 'commentCompose' && { top: 24 }, app.overlay?.screen === 'postMenu' && { top: 22 }]}><IconButton icon="close" label="패널 닫기" onPress={app.back} /></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
// #endregion

// #region 루트 컴포넌트
/**
 * 안전 영역과 화면 이동 공급자를 포함한 앱의 루트 요소를 구성합니다.
 *
 * @remarks
 * 진입점에서 Expo에 등록됩니다. {@link AppProvider}를 통해 화면 이동 상태를 공유하며
 * 테스트 실행에서는 서버를 먼저 선택하고 선택한 주소로 홈의 SDUI 응답을 조회합니다.
 *
 * @returns 안전 영역 공급자와 화면 공급자로 감싼 앱 화면입니다.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.outer}>
        <ServerConnectionProvider><AppProvider><Shell /></AppProvider></ServerConnectionProvider>
      </View>
    </SafeAreaProvider>
  );
}
// #endregion

// #region 화면 스타일
/** 앱 바깥 배경, 공통 메뉴와 패널의 배치를 정의하는 스타일입니다. */
const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#EDF1E8', alignItems: 'center' },
  shell: { width: '100%', maxWidth: 480, flex: 1, backgroundColor: '#fff', overflow: 'hidden' },
  darkShell: { backgroundColor: '#20372D' },
  content: { flex: 1, minHeight: 0 },
  scrollContent: { flexGrow: 1 },
  header: { height: 72, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff' },
  brandHeader: { height: 70, paddingLeft: 20 },
  detailHeader: { height: 64 },
  headerStart: { gap: 6 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.ink },
  mainTitle: { fontSize: 22 },
  postTitle: { fontSize: 18 },
  centeredTitle: { position: 'absolute', left: 60, right: 60, textAlign: 'center', fontSize: 20, fontWeight: '700', color: colors.ink },
  headerAction: { minHeight: 34, paddingVertical: 7, paddingHorizontal: 16 },
  headerActions: { gap: 4 },
  headerIconButton: { width: 48, height: 48, borderRadius: 24 },
  roundHeaderAction: { borderRadius: 22, backgroundColor: colors.pale },
  brand: { width: 32, height: 32 },
  brandName: { fontSize: 24, fontWeight: '700', color: colors.ink },
  categories: { height: 54, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderColor: colors.line },
  category: { flexGrow: 1, flexShrink: 0, alignItems: 'center' },
  categoryLabelWrap: { height: 47, paddingHorizontal: 8, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  categoryActive: { borderBottomColor: colors.green },
  categoryLabel: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  categoryLabelActive: { color: colors.green, fontWeight: '700' },
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', borderTopWidth: 1, borderColor: colors.line, height: 73, backgroundColor: '#fff', paddingBottom: 9 },
  navItem: { alignItems: 'center', flex: 1, gap: 6 },
  navIcon: { width: 42, height: 33, alignItems: 'center', justifyContent: 'center' },
  homeIcon: { backgroundColor: colors.green, width: 62, height: 62, borderRadius: 31, marginTop: -30, borderWidth: 6, borderColor: '#fff' },
  navLabel: { color: '#625D50', fontSize: 10, fontWeight: '500' },
  selectedLabel: { color: colors.green, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(12,29,19,.42)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 480, maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fff', paddingBottom: 20 },
  handleArea: { alignItems: 'center', paddingTop: 10 },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: '#D6DDCF' },
  closeArea: { position: 'absolute', right: 10, top: 18, borderRadius: 22, backgroundColor: colors.pale },
});
// #endregion
