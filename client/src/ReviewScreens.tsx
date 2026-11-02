// #region 의존성 가져오기
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from './EmptyState';
import { colors, Icon, s } from './ui';
// #endregion

// #region 리뷰 목록
/**
 * 작품 요약, 평균 평점 패널과 리뷰 정렬·목록 구획을 표시합니다.
 *
 * @remarks
 * 작품·평점·리뷰는 {@link EmptyState}로 표시합니다. 평점 눈금은 고정된 시각적
 * 범례이며 평균·평가 수·분포 값을 생성하지 않습니다. 리뷰 쓰기는 공통 헤더에 있습니다.
 * 목록 데이터가 없으므로 정렬 버튼은 비활성화합니다.
 *
 * @returns 작품과 평점의 빈 영역, 정렬 표시와 빈 리뷰 목록을 포함한 화면입니다.
 */
export function ReviewsScreen() {
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewContent}>
      <EmptyState compact title="표시할 작품 정보가 없습니다." style={styles.workSummary} />
      <View style={styles.ratingPanel}>
        <View style={styles.averagePanel}>
          <Text style={styles.averageLabel}>평균 평점</Text>
          <EmptyState compact title="표시할 평점이 없습니다." style={styles.ratingEmpty} />
        </View>
        <View style={styles.ratingScale}>
          {[5, 4, 3, 2, 1].map(value => (
            <View key={value} style={styles.scaleRow}>
              <Text style={styles.scaleLabel}>{value}</Text>
              <View style={styles.scaleTrack} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.listHeading}>
        <Text style={styles.heading}>리뷰</Text>
        <Pressable disabled accessibilityRole="button" accessibilityLabel="리뷰 정렬: 최신순" accessibilityState={{ disabled: true }} style={styles.sortButton}>
          <Text style={styles.sortText}>최신순</Text>
          <Icon name="down" size={16} color={colors.brown} />
        </Pressable>
      </View>
      <EmptyState title="표시할 리뷰가 없습니다." style={styles.listEmpty} />
    </ScrollView>
  );
}
// #endregion

// #region 리뷰 작성
/**
 * 리뷰 작성 시안의 별점 선택, 본문 입력과 고정 등록 버튼을 표시합니다.
 *
 * @remarks
 * 작성 대상은 {@link EmptyState}로 표시합니다. 별점과 본문은 화면 내부 상태로만
 * 유지하며 문자 수는 입력 길이를 표시합니다. 등록은 비활성화하고 리뷰 객체 생성,
 * 입력 검증, 서버 전송과 저장은 수행하지 않습니다.
 *
 * @returns 별점 선택 패널, 본문 입력란과 공개 안내·등록 버튼을 포함한 화면입니다.
 */
export function ReviewWriteScreen() {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  return (
    <View style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewWriteContent}>
        <EmptyState compact title="표시할 작품 정보가 없습니다." style={styles.workSummary} />
        <View style={styles.ratingInputPanel}>
          <Text style={styles.ratingPrompt}>이 작품은 어땠나요?</Text>
          <View accessibilityRole="radiogroup" style={styles.stars}>
            {[1, 2, 3, 4, 5].map(value => (
              <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value}점`} accessibilityState={{ checked: rating === value }}
                onPress={() => setRating(value)} style={styles.starButton}>
                <Svg width={36} height={36} viewBox="0 0 24 24" fill={value <= rating ? colors.green : colors.line}>
                  <Path d="m12 1.8 3.1 6.3 7 .9-5.1 5 1.2 7-6.2-3.3L5.8 21 7 14l-5.1-5 7-.9Z" />
                </Svg>
              </Pressable>
            ))}
          </View>
          <Text style={styles.ratingDescription}>{rating === 0 ? '별점을 선택해 주세요.' : rating === 5 ? '5.0 · 아주 좋았어요' : `${rating}.0`}</Text>
        </View>
        <View style={styles.writeHeading}>
          <Text style={styles.heading}>리뷰</Text>
          <View style={styles.writingBadge}><Text style={styles.writingText}>작성 중</Text></View>
        </View>
        <View style={styles.reviewInputBox}>
          <TextInput accessibilityLabel="리뷰 내용" value={body} onChangeText={setBody} multiline
            placeholder="작품을 읽은 감상을 남겨 주세요." placeholderTextColor={colors.muted} style={styles.reviewInput} />
          <Text style={styles.characterCount}>{body.length}자</Text>
        </View>
        <Text style={styles.publicNotice}>모든 독자에게 공개되는 리뷰입니다.</Text>
      </ScrollView>
      <View style={styles.reviewSubmitFooter}>
        <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.reviewSubmit}>
          <Text style={styles.submitText}>리뷰 등록하기</Text>
        </Pressable>
      </View>
    </View>
  );
}
// #endregion

// #region 리뷰 댓글
/**
 * 리뷰 요약 카드, 댓글 정렬·목록과 고정 하단 입력란을 표시합니다.
 *
 * @remarks
 * 대상 리뷰와 댓글 목록은 {@link EmptyState}로 표시합니다. 입력한 댓글은 화면
 * 상태에만 보관하고 등록은 비활성화합니다. 서버 조회와 저장은 수행하지 않습니다.
 *
 * @returns 빈 리뷰·댓글 영역과 고정 댓글 입력 도구를 포함하는 화면입니다.
 */
export function ReviewCommentsScreen() {
  const [body, setBody] = useState('');

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.commentsContent}>
        <EmptyState title="표시할 리뷰가 없습니다." style={styles.reviewSummary} />
        <View style={styles.commentsHeading}>
          <Text style={styles.heading}>댓글</Text>
          <Text style={styles.sortText}>등록순</Text>
        </View>
        <EmptyState title="표시할 댓글이 없습니다." style={styles.listEmpty} />
      </ScrollView>
      <View style={styles.commentFooter}>
        <TextInput accessibilityLabel="댓글 내용" value={body} onChangeText={setBody} placeholder="댓글을 입력해 주세요."
          placeholderTextColor={colors.muted} style={styles.commentInput} />
        <Pressable disabled accessibilityRole="button" accessibilityLabel="댓글 등록하기" accessibilityState={{ disabled: true }} style={styles.commentSubmit}>
          <Icon name="send" color={colors.muted} size={22} />
        </Pressable>
      </View>
    </View>
  );
}
// #endregion

// #region 시안 배치
/** 리뷰 시안의 요약 카드·평점·별점 입력·고정 하단 도구에 사용하는 화면 스타일입니다. */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  reviewContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  workSummary: { height: 82, minHeight: 0, borderWidth: 0, backgroundColor: 'transparent' },
  ratingPanel: { height: 160, marginTop: 17, borderRadius: 20, backgroundColor: colors.pale, padding: 20, flexDirection: 'row' },
  averagePanel: { width: '43%', paddingRight: 16, borderRightWidth: 1, borderRightColor: colors.line },
  averageLabel: { ...s.text, color: colors.brown, fontSize: 11, lineHeight: 18 },
  ratingEmpty: { flex: 1, padding: 0, minHeight: 0, borderWidth: 0, backgroundColor: 'transparent' },
  ratingScale: { flex: 1, paddingLeft: 20, paddingRight: 24, justifyContent: 'space-between' },
  scaleRow: { height: 20, flexDirection: 'row', gap: 12, alignItems: 'center' },
  scaleLabel: { ...s.text, color: colors.brown, fontSize: 11, width: 9 },
  scaleTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  listHeading: { height: 58, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...s.text, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  sortButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 15 },
  sortText: { ...s.text, color: colors.brown, fontSize: 11, lineHeight: 18 },
  listEmpty: { minHeight: 240, borderWidth: 0, backgroundColor: 'transparent' },
  reviewWriteContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  ratingInputPanel: { height: 150, marginTop: 28, paddingTop: 16, paddingHorizontal: 24, alignItems: 'center', borderRadius: 20, backgroundColor: colors.pale },
  ratingPrompt: { ...s.text, color: colors.ink, fontSize: 17, lineHeight: 28, fontWeight: '600' },
  stars: { alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  starButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ratingDescription: { ...s.text, color: colors.green, fontWeight: '600', fontSize: 13, lineHeight: 20, marginTop: 10 },
  writeHeading: { marginTop: 28, height: 44, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  writingBadge: { height: 25, minWidth: 62, borderRadius: 13, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  writingText: { ...s.text, color: colors.green, fontWeight: '600', fontSize: 11 },
  reviewInputBox: { height: 230, borderRadius: 16, borderWidth: 1, borderColor: colors.green, paddingHorizontal: 19, paddingTop: 20, paddingBottom: 16 },
  reviewInput: { ...s.text, flex: 1, padding: 0, color: colors.ink, fontSize: 15, lineHeight: 26.25, textAlignVertical: 'top' },
  characterCount: { ...s.text, fontSize: 11, lineHeight: 18, textAlign: 'right', color: colors.muted },
  publicNotice: { ...s.text, marginTop: 20, paddingHorizontal: 4, color: colors.muted, fontSize: 11, lineHeight: 18 },
  reviewSubmitFooter: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  reviewSubmit: { height: 48, borderRadius: 24, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  submitText: { ...s.text, color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  commentsContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  reviewSummary: { height: 224, borderWidth: 0, borderRadius: 20, backgroundColor: '#E2EDF3' },
  commentsHeading: { marginTop: 22, paddingHorizontal: 4, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentFooter: { height: 76, paddingHorizontal: 20, flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  commentInput: { ...s.text, flex: 1, height: 44, paddingHorizontal: 18, color: colors.ink, fontSize: 12, backgroundColor: colors.pale, borderRadius: 22 },
  commentSubmit: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.line },
});
// #endregion
