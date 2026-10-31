// #region 의존성 가져오기
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp, type Route } from './appState';
import { EmptyState } from './EmptyState';
import { colors, Icon, s } from './ui';
// #endregion

// #region 커뮤니티 목록과 게시글 상세
/**
 * 작품별·주제별·작품 홍보 탭과 각 시안의 목록 구획을 표시합니다.
 *
 * @remarks
 * 작품·게시글·댓글 영역은 {@link EmptyState}로 유지합니다. 탭과 글쓰기 버튼은
 * 화면 이동만 수행하며, 데이터가 필요한 내 작품 보기 버튼은 비활성화합니다.
 *
 * @param props - 선택한 커뮤니티 탭을 포함하는 화면 속성입니다.
 * @returns 분할 탭, 종류별 빈 목록과 고정 작성 버튼을 포함하는 화면입니다.
 */
export function CommunityScreen({ route }: {
  /** 선택한 커뮤니티 탭을 제공하는 UI 이동 상태입니다. */
  route: Route;
}) {
  const { navigate } = useApp();
  const mode = route.mode ?? 'work';

  return (
    <View style={styles.screen}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['work', '작품별'], ['topic', '주제별'], ['promotion', '작품 홍보']] as const).map(([value, label]) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }}
            onPress={() => navigate({ screen: 'community', mode: value }, true)} style={styles.tab}>
            <View style={[styles.tabLabel, mode === value && styles.selectedTab]}>
              <Text style={[styles.tabText, mode === value && styles.selectedTabText]}>{label}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.communityContent}>
        <View style={styles.communityHeading}>
          <Text style={styles.heading}>{mode === 'work' ? '작품별 이야기' : mode === 'topic' ? '독서 이야기' : '작가가 올린 작품'}</Text>
          {mode === 'work' && (
            <Pressable accessibilityRole="button" accessibilityLabel="글쓰기" style={styles.roundButton}
              onPress={() => navigate({ screen: 'writePost', mode })}>
              <Icon name="edit" />
            </Pressable>
          )}
        </View>
        {mode === 'work' && (['도서', '매거진', '웹소설'] as const).map(label => (
          <View key={label} style={styles.workSection}>
            <Text style={styles.category}>{label}</Text>
            <EmptyState compact title="표시할 작품이 없습니다." style={styles.workEmpty} />
            <EmptyState compact title="표시할 게시글이 없습니다." style={styles.postPreviewEmpty} />
          </View>
        ))}
        {mode === 'topic' && (
          <View style={styles.topicSection}>
            <EmptyState title="표시할 게시글이 없습니다." style={styles.topicEmpty} />
            <EmptyState compact title="표시할 댓글이 없습니다." style={styles.commentPreview} />
          </View>
        )}
        {mode === 'promotion' && (
          <View style={styles.promotionSection}>
            <EmptyState title="표시할 작품이 없습니다." style={styles.promotionEmpty} />
          </View>
        )}
      </ScrollView>
      {mode === 'topic' && (
        <Pressable accessibilityRole="button" accessibilityLabel="글쓰기" style={styles.floatingWrite}
          onPress={() => navigate({ screen: 'writePost', mode })}>
          <Icon name="edit" size={24} color="#FFFFFF" />
        </Pressable>
      )}
      {mode === 'promotion' && (
        <View style={styles.promotionFooter}>
          <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[styles.submitButton, styles.myWorkButton]}>
            <Text style={styles.submitText}>내 작품 보기</Text>
            <Icon name="edit" color="#FFFFFF" size={22} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * 게시글의 작품 요약·본문·댓글 구획과 하단 댓글 작성 진입부를 표시합니다.
 *
 * @remarks
 * 실제 게시글·작품·댓글은 {@link EmptyState}로 표시합니다. 공감은 비활성화하며
 * 댓글 입력 모양의 버튼과 편집 아이콘은 작성 패널만 엽니다. 메뉴는 공통 헤더에 있습니다.
 *
 * @returns 스크롤되는 빈 게시글 영역과 고정 댓글 작성 진입부입니다.
 */
export function PostScreen() {
  const { navigate } = useApp();

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.postContent}>
        <EmptyState compact title="표시할 작품이 없습니다." style={styles.postWorkSummary} />
        <EmptyState title="표시할 게시글이 없습니다." style={styles.postBodyEmpty} />
        <View style={styles.postReactions}>
          <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.reaction}>
            <Text style={styles.muted}>공감</Text>
          </Pressable>
          <Text style={styles.muted}>· 댓글</Text>
        </View>
        <Text style={styles.commentHeading}>댓글</Text>
        <EmptyState title="표시할 댓글이 없습니다." style={styles.commentsEmpty} />
      </ScrollView>
      <View style={styles.commentFooter}>
        <Pressable accessibilityRole="button" accessibilityLabel="댓글 쓰기" style={styles.commentEntry}
          onPress={() => navigate({ screen: 'commentCompose' })}>
          <Text style={styles.placeholder}>댓글을 남겨 주세요.</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="댓글·이모티콘 쓰기" style={styles.roundButton}
          onPress={() => navigate({ screen: 'commentCompose' })}>
          <Icon name="edit" color={colors.green} />
        </Pressable>
      </View>
    </View>
  );
}
// #endregion

// #region 게시글과 댓글 작성
/**
 * 글쓰기 시안의 대상 표시줄, 제목·본문과 하단 작성 도구를 표시합니다.
 *
 * @remarks
 * 제목·본문·스포일러 선택은 화면 상태에만 보관합니다. 대상 데이터는
 * {@link EmptyState}로 표시하며, 문자 수는 현재 입력 문자열의 길이입니다.
 * 임시저장과 등록은 비활성화하고 저장 완료 상태를 표시하지 않습니다.
 *
 * @param props - 작성 화면에 전달된 커뮤니티 탭을 포함하는 속성입니다.
 * @returns 임시 입력란, 공개 안내, 문자 수와 고정 작성 도구를 포함하는 화면입니다.
 */
export function WritePostScreen({ route }: {
  /** 글쓰기 종류를 표시하는 UI 이동 상태입니다. */
  route: Route;
}) {
  const mode = route.mode ?? 'work';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);

  return (
    <View style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.writeContent}>
        <View style={styles.writeContext}>
          <Text style={styles.contextLabel}>{mode === 'topic' ? '주제별' : mode === 'promotion' ? '작품 홍보' : '작품별'} ·</Text>
          <EmptyState compact title={mode === 'topic' ? '선택할 주제가 없습니다.' : '선택할 작품이 없습니다.'} style={styles.contextEmpty} />
        </View>
        <TextInput accessibilityLabel="게시글 제목" value={title} onChangeText={setTitle} placeholder="제목을 입력해 주세요."
          placeholderTextColor={colors.muted} style={styles.postTitleInput} />
        <TextInput accessibilityLabel="게시글 본문" value={body} onChangeText={setBody} multiline maxLength={2000}
          placeholder="이야기를 들려주세요." placeholderTextColor={colors.muted} style={styles.postBodyInput} />
        <View style={styles.writeMeta}>
          <Text style={styles.muted}>공개 게시글</Text>
          <Text style={styles.muted}>{body.length} / 2,000</Text>
        </View>
      </ScrollView>
      <View style={styles.writeToolbar}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: spoiler }} onPress={() => setSpoiler(!spoiler)} style={styles.toolbarButton}>
          <Text style={[styles.toolbarText, spoiler && styles.selectedTabText]}>{spoiler ? '스포일러 포함' : '스포일러 없음'}</Text>
        </Pressable>
        <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.toolbarButton}>
          <Text style={styles.muted}>임시저장</Text>
        </Pressable>
      </View>
      <View style={styles.submitFooter}>
        <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.submitButton}>
          <Text style={styles.submitText}>등록하기</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 댓글 입력란과 이모티콘 선택 영역을 가진 하단 패널 내용을 표시합니다.
 *
 * @remarks
 * 댓글 문자열은 화면 상태에만 보관하며 스티커 데이터는 {@link EmptyState}로 표시합니다.
 * 댓글 등록은 비활성화되어 있으며 패널 닫기는 공통 패널에서 제공합니다.
 *
 * @returns 임시 댓글 입력란, 빈 이모티콘 영역과 비활성 등록 버튼입니다.
 */
export function CommentComposeScreen() {
  const [body, setBody] = useState('');

  return (
    <View style={styles.composeSheet}>
      <Text style={styles.sheetHeading}>댓글 쓰기</Text>
      <TextInput accessibilityLabel="댓글 내용" value={body} onChangeText={setBody} multiline placeholder="댓글을 남겨 주세요."
        placeholderTextColor={colors.muted} style={styles.composeInput} />
      <Text style={styles.emoticonLabel}>이모티콘</Text>
      <EmptyState compact title="선택할 이모티콘이 없습니다." style={styles.emoticonEmpty} />
      <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={[styles.submitButton, styles.composeSubmit]}>
        <Text style={styles.submitText}>댓글 등록하기</Text>
      </Pressable>
    </View>
  );
}
// #endregion

// #region 게시글 메뉴와 신고
/**
 * 게시글 메뉴 시안의 제목과 신고 화면 진입 행을 표시합니다.
 *
 * @remarks
 * 신고하기는 {@link ReportScreen}으로 이동하며 신고를 전송하지 않습니다.
 * 공통 패널에서 닫기 아이콘과 배경을 제공합니다.
 *
 * @returns 제목과 신고하기 행으로 구성된 패널 내용입니다.
 */
export function PostMenuScreen() {
  const { navigate } = useApp();

  return (
    <View style={styles.menuSheet}>
      <Text style={styles.sheetHeading}>게시글 메뉴</Text>
      <Pressable accessibilityRole="button" onPress={() => navigate({ screen: 'report' })} style={styles.reportEntry}>
        <Icon name="alert" color="#9A6D47" size={24} />
        <Text style={styles.bodyText}>신고하기</Text>
      </Pressable>
    </View>
  );
}

/**
 * 신고 시안의 고정 사유 네 가지와 추가 내용 입력란을 표시합니다.
 *
 * @remarks
 * 선택한 사유와 추가 내용은 화면 상태로만 유지합니다. 신고 접수 버튼은
 * 비활성화되어 있으므로 신고 객체 생성, 저장 또는 서버 전송을 수행하지 않습니다.
 *
 * @returns 사유 선택, 추가 입력, 비공개 안내와 고정 접수 버튼을 포함하는 화면입니다.
 */
export function ReportScreen() {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');

  return (
    <View style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.reportContent}>
        <Text style={styles.reportHeading}>신고 사유를 선택해 주세요</Text>
        <View accessibilityRole="radiogroup" style={styles.reportOptions}>
          {['광고·도배', '욕설·비방', '스포일러 미표시', '기타'].map(label => (
            <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: reason === label }}
              onPress={() => setReason(label)} style={styles.reportOption}>
              <View style={[styles.radio, reason === label && styles.radioSelected]} />
              <Text style={styles.bodyText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.detailsLabel}>추가 내용</Text>
        <TextInput accessibilityLabel="신고 추가 내용" value={details} onChangeText={setDetails} multiline
          placeholder="추가 내용을 입력해 주세요." placeholderTextColor={colors.brown} style={styles.detailsInput} />
        <Text style={styles.reportNotice}>신고 내용은 다른 사용자에게 공개되지 않습니다.</Text>
      </ScrollView>
      <View style={styles.submitFooter}>
        <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.submitButton}>
          <Text style={styles.submitText}>신고 접수하기</Text>
        </Pressable>
      </View>
    </View>
  );
}
// #endregion

// #region 시안 배치
/** 커뮤니티 시안의 탭·구획·입력 도구와 고정 하단 영역에 사용하는 화면 스타일입니다. */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  tabs: { height: 57, paddingHorizontal: 20, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  tabLabel: { height: 47, paddingHorizontal: 8, borderBottomWidth: 3, borderBottomColor: 'transparent', justifyContent: 'center' },
  selectedTab: { borderBottomColor: colors.green },
  tabText: { ...s.text, color: colors.muted, fontSize: 14, fontWeight: '500' },
  selectedTabText: { color: colors.green, fontWeight: '700' },
  communityContent: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 28 },
  communityHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heading: { ...s.text, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  roundButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  workSection: { paddingTop: 2, borderBottomWidth: 1, borderBottomColor: colors.line },
  category: { ...s.text, color: colors.green, fontWeight: '700', fontSize: 13, lineHeight: 20 },
  workEmpty: { height: 104, minHeight: 0, borderWidth: 0, backgroundColor: 'transparent' },
  postPreviewEmpty: { height: 80, minHeight: 0, borderWidth: 0, backgroundColor: 'transparent' },
  topicSection: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 20 },
  topicEmpty: { height: 286, borderWidth: 0, backgroundColor: 'transparent' },
  commentPreview: { height: 77, minHeight: 0, borderWidth: 0, borderRadius: 14, backgroundColor: colors.pale },
  promotionSection: { paddingTop: 8, paddingBottom: 67, borderBottomWidth: 1, borderBottomColor: colors.line },
  promotionEmpty: { height: 279, borderWidth: 0, borderRadius: 20, backgroundColor: colors.pale },
  floatingWrite: { position: 'absolute', bottom: 30, right: 20, height: 52, width: 52, borderRadius: 26, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  promotionFooter: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30 },
  myWorkButton: { height: 46, borderRadius: 23, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  postContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 30 },
  postWorkSummary: { height: 82, minHeight: 0, borderWidth: 0, borderRadius: 16, backgroundColor: colors.pale },
  postBodyEmpty: { minHeight: 420, borderWidth: 0, backgroundColor: 'transparent' },
  postReactions: { minHeight: 56, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 5 },
  reaction: { minHeight: 44, justifyContent: 'center' },
  muted: { ...s.text, color: colors.muted, fontSize: 11, lineHeight: 18 },
  commentHeading: { ...s.text, color: colors.ink, fontSize: 16, fontWeight: '700', lineHeight: 24, marginTop: 8 },
  commentsEmpty: { minHeight: 200, borderWidth: 0, backgroundColor: 'transparent' },
  commentFooter: { height: 74, paddingHorizontal: 20, flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  commentEntry: { flex: 1, minHeight: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: colors.pale, justifyContent: 'center' },
  placeholder: { ...s.text, color: colors.muted, fontSize: 12 },
  writeContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  writeContext: { height: 44, borderRadius: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.pale, gap: 6 },
  contextLabel: { ...s.text, fontSize: 12, fontWeight: '700', color: colors.green },
  contextEmpty: { flex: 1, height: 44, minHeight: 0, flexDirection: 'row', borderWidth: 0, padding: 0, backgroundColor: 'transparent', gap: 6 },
  postTitleInput: { ...s.text, color: colors.ink, fontSize: 21, lineHeight: 31, fontWeight: '700', height: 54, marginTop: 20, padding: 0, borderBottomWidth: 1, borderBottomColor: colors.line },
  postBodyInput: { ...s.text, flex: 1, minHeight: 240, color: colors.ink, fontSize: 15, lineHeight: 21, paddingHorizontal: 0, paddingTop: 24, textAlignVertical: 'top' },
  writeMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 20, paddingRight: 50 },
  writeToolbar: { height: 40, marginHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line },
  toolbarButton: { justifyContent: 'center', minWidth: 80 },
  toolbarText: { ...s.text, fontSize: 11, color: colors.brown },
  submitFooter: { height: 74, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.line },
  submitButton: { height: 42, borderRadius: 21, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  submitText: { ...s.text, color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  composeSheet: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 2 },
  sheetHeading: { ...s.text, color: colors.ink, fontWeight: '700', fontSize: 18, lineHeight: 28, paddingLeft: 4 },
  composeInput: { ...s.text, height: 94, marginTop: 20, padding: 16, textAlignVertical: 'top', color: colors.ink, fontSize: 14, lineHeight: 21, borderWidth: 2, borderColor: colors.line, borderRadius: 14 },
  emoticonLabel: { ...s.text, color: colors.green, fontWeight: '700', fontSize: 12, lineHeight: 20, marginTop: 18 },
  emoticonEmpty: { height: 114, minHeight: 0, marginTop: 10, borderWidth: 0, backgroundColor: 'transparent' },
  composeSubmit: { height: 46, borderRadius: 23, marginTop: 22 },
  menuSheet: { minHeight: 170, paddingHorizontal: 20, paddingTop: 22 },
  reportEntry: { height: 67, marginTop: 17, flexDirection: 'row', alignItems: 'center', gap: 23, borderBottomWidth: 1, borderBottomColor: colors.line, paddingLeft: 4 },
  bodyText: { ...s.text, color: colors.ink, fontSize: 15, lineHeight: 24 },
  reportContent: { paddingHorizontal: 20, paddingTop: 30, paddingBottom: 24 },
  reportHeading: { ...s.text, color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '700' },
  reportOptions: { marginTop: 22 },
  reportOption: { height: 62, flexDirection: 'row', alignItems: 'center', gap: 16 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line },
  radioSelected: { backgroundColor: colors.green },
  detailsLabel: { ...s.text, color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: '700', marginTop: 52 },
  detailsInput: { ...s.text, height: 126, marginTop: 16, padding: 16, textAlignVertical: 'top', color: colors.brown, fontSize: 14, lineHeight: 22, borderRadius: 15, backgroundColor: colors.pale },
  reportNotice: { ...s.text, color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 32 },
});
// #endregion
