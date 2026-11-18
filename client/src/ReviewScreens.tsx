// #region 의존성 가져오기
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from './EmptyState';
import { useApp } from './appState';
import { useMemberAuth } from './memberAuth';
import { MemberRequestError } from './memberSession';
import { useApiUrl } from './serverConnection';
import { Action, colors, Icon, s } from './ui';
import { createWorkReview, normalizeReviewBody, readWorkReviews, type WorkReview, type WorkReviewPage } from './workReviews';
// #endregion

// #region 리뷰 목록
function useReviewPage(workId: string | undefined, page: number, size: number) {
  const apiUrl = useApiUrl();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([apiUrl, workId, page, size, attempt]);
  const [result, setResult] = useState<{ key: string; data: WorkReviewPage | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!workId) return;
    const controller = new AbortController();
    readWorkReviews(apiUrl, workId, page, size, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ key, data, error: null }); },
      (failure: unknown) => {
        if (!controller.signal.aborted) setResult({ key, data: null,
          error: failure instanceof Error ? failure.message : '리뷰를 불러오지 못했습니다.' });
      },
    );
    return () => controller.abort();
  }, [apiUrl, workId, page, size, key]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, error: workId ? current?.error ?? null : '리뷰를 볼 작품을 선택해 주세요.',
    retry: () => setAttempt(value => value + 1) };
}

function ReviewCard({ item }: { item: WorkReview }) {
  return <View style={styles.reviewCard}>
    <Text style={s.subtitle}>{item.nickname}</Text>
    <Text style={s.muted}>{item.rating}점 · {new Date(item.createdAt).toLocaleDateString('ko-KR')}</Text>
    {item.body !== null && <Text style={s.text}>{item.body}</Text>}
  </View>;
}

/** 작품 상세에서 평점 요약과 가장 최근 리뷰를 표시합니다. */
export function WorkReviewPreview({ workId }: { workId: string }) {
  const { data, error, retry } = useReviewPage(workId, 1, 1);
  if (error) return <View style={styles.status}>
    <Text style={s.error}>{error}</Text><Action compact tone="secondary" label="리뷰 다시 불러오기" onPress={retry} />
  </View>;
  if (!data) return <ActivityIndicator accessibilityLabel="리뷰 불러오는 중" color={colors.green} />;
  return <View>
    <Text style={s.muted}>{data.averageRating === null ? '아직 등록된 리뷰가 없습니다.' :
      `평균 ${data.averageRating.toFixed(2)}점 · 리뷰 ${data.reviewCount.toLocaleString('ko-KR')}개`}</Text>
    {data.items[0] && <ReviewCard item={data.items[0]} />}
  </View>;
}

/** 작품의 전체 평점 요약과 최신순 공개 리뷰를 페이지 단위로 표시합니다. */
export function ReviewsScreen() {
  const { baseRoute: { workId, workTitle } } = useApp();
  const [page, setPage] = useState(1);
  const { data, error, retry } = useReviewPage(workId, page, 20);
  const count = data?.reviewCount ?? 0;
  return (
    <ScrollView key={page} showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewContent}>
      {workTitle && <Text accessibilityRole="header" style={styles.heading}>{workTitle}</Text>}
      {error ? <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text style={s.error}>{error}</Text>
        {workId && <Action compact label="다시 불러오기" onPress={retry} />}
      </View> : !data ? <ActivityIndicator accessibilityLabel="리뷰 불러오는 중" color={colors.green} /> : <>
      <View style={styles.ratingPanel}>
        <View style={styles.averagePanel}>
          <Text style={styles.averageLabel}>평균 평점</Text>
          <Text style={styles.averageScore}>{data.averageRating === null ? '–' : data.averageRating.toFixed(2)}</Text>
          <Text style={s.muted}>{count.toLocaleString('ko-KR')}개 평가</Text>
        </View>
        <View style={styles.ratingScale}>
          {([5, 4, 3, 2, 1] as const).map(value => {
            const total = data.ratingDistribution[value];
            return <View key={value} accessible accessibilityLabel={`${value}점 ${total}개`} style={styles.scaleRow}>
              <Text style={styles.scaleLabel}>{value}</Text>
              <View style={styles.scaleTrack}><View style={[styles.scaleFill, { width: count ? `${total / count * 100}%` : '0%' }]} /></View>
            </View>;
          })}
        </View>
      </View>
      <View style={styles.listHeading}>
        <Text style={styles.heading}>리뷰</Text>
        <Text style={styles.sortText}>최신순</Text>
      </View>
      {data.items.length === 0 && <EmptyState title="표시할 리뷰가 없습니다." style={styles.listEmpty} />}
      {data.items.map(item => <ReviewCard key={item.id} item={item} />)}
      {(page > 1 || data.hasNext) && <View style={styles.pageActions}>
        <Action compact tone="secondary" label="이전 페이지" disabled={page === 1} onPress={() => setPage(page - 1)} />
        <Text style={s.muted}>{page}페이지</Text>
        <Action compact tone="secondary" label="다음 페이지" disabled={!data.hasNext} onPress={() => setPage(page + 1)} />
      </View>}
      </>}
    </ScrollView>
  );
}
// #endregion

// #region 리뷰 작성
/** 작품 리뷰 작성에 회원 확인을 적용하고 세션 또는 서버가 바뀌면 작성 상태를 새로 시작합니다. */
export function ReviewWriteScreen() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  const apiUrl = useApiUrl();
  const { workId } = app.baseRoute;
  if (!workId) return <EmptyState title="리뷰를 쓸 작품을 선택해 주세요." />;
  if (state.status === 'checking') return <ActivityIndicator accessibilityLabel="로그인 확인 중" color={colors.green} />;
  if (state.status === 'error') return <View style={styles.status}>
    <Text style={s.error}>{state.error}</Text><Action label="로그인 상태 다시 확인" onPress={() => void client.refresh()} />
  </View>;
  if (state.status === 'anonymous') return <View style={styles.status}>
    <Text style={s.subtitle}>로그인 후 리뷰를 작성할 수 있습니다.</Text>
    <Action label="로그인" onPress={() => app.navigate({ screen: 'login', returnToReview: true })} />
  </View>;
  return <ReviewDraft key={JSON.stringify([apiUrl, workId, state.generation, state.member?.id])} workId={workId} />;
}

function ReviewDraft({ workId }: { workId: string }) {
  const { back, baseRoute: { workTitle } } = useApp();
  const { client, state } = useMemberAuth();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => pending.current?.abort(), []);
  const length = [...normalizeReviewBody(body)].length;
  const disabled = rating === 0 || length > 1000 || busy || duplicate;

  async function submit() {
    if (disabled || pending.current || client.getSnapshot().generation !== state.generation) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => !controller.signal.aborted && client.getSnapshot().generation === state.generation;
    setBusy(true);
    setError('');
    try {
      await createWorkReview(client, workId, rating, body, controller.signal);
      if (current()) back();
    } catch (failure) {
      if (!current()) return;
      const status = failure instanceof MemberRequestError ? failure.status : null;
      if (status === 409) setDuplicate(true);
      setError(status === 409 ? '이미 이 작품에 리뷰를 등록했습니다.' :
        status === 403 ? '보안 확인에 실패했습니다. 다시 시도해 주세요.' :
        status === 404 ? '공개된 작품이 없습니다.' :
        status === 400 ? '별점과 리뷰 내용을 확인해 주세요.' : '리뷰를 등록하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      pending.current = null;
      if (current()) setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewWriteContent}>
        {workTitle && <Text accessibilityRole="header" style={styles.heading}>{workTitle}</Text>}
        <View style={styles.ratingInputPanel}>
          <Text style={styles.ratingPrompt}>이 작품은 어땠나요?</Text>
          <View accessibilityRole="radiogroup" style={styles.stars}>
            {[1, 2, 3, 4, 5].map(value => (
              <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value}점`} accessibilityState={{ checked: rating === value }}
                disabled={busy} onPress={() => setRating(value)} style={styles.starButton}>
                <Svg width={36} height={36} viewBox="0 0 24 24" fill={value <= rating ? colors.green : colors.line}>
                  <Path d="m12 1.8 3.1 6.3 7 .9-5.1 5 1.2 7-6.2-3.3L5.8 21 7 14l-5.1-5 7-.9Z" />
                </Svg>
              </Pressable>
            ))}
          </View>
          <Text style={styles.ratingDescription}>{rating === 0 ? '별점을 선택해 주세요.' : rating === 5 ? '5.0 · 아주 좋았어요' : `${rating}.0`}</Text>
        </View>
        <View style={styles.writeHeading}>
          <Text style={styles.heading}>리뷰 내용 (선택)</Text>
        </View>
        <View style={styles.reviewInputBox}>
          <TextInput accessibilityLabel="리뷰 내용" value={body} onChangeText={setBody} editable={!busy} multiline
            placeholder="작품을 읽은 감상을 남겨 주세요." placeholderTextColor={colors.muted} style={styles.reviewInput} />
          <Text style={[styles.characterCount, length > 1000 && s.error]}>{length} / 1,000자</Text>
        </View>
        <Text style={styles.publicNotice}>모든 독자에게 공개되는 리뷰입니다.</Text>
      </ScrollView>
      <View style={styles.reviewSubmitFooter}>
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Action label={busy ? '등록 중…' : '리뷰 등록하기'} disabled={disabled} onPress={() => void submit()} />
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
  ratingPanel: { height: 160, marginTop: 17, borderRadius: 20, backgroundColor: colors.pale, padding: 20, flexDirection: 'row' },
  averagePanel: { width: '43%', paddingRight: 16, borderRightWidth: 1, borderRightColor: colors.line },
  averageLabel: { ...s.text, color: colors.brown, fontSize: 11, lineHeight: 18 },
  averageScore: { ...s.text, color: colors.ink, fontSize: 27, fontWeight: '700', marginVertical: 8 },
  ratingScale: { flex: 1, paddingLeft: 20, paddingRight: 24, justifyContent: 'space-between' },
  scaleRow: { height: 20, flexDirection: 'row', gap: 12, alignItems: 'center' },
  scaleLabel: { ...s.text, color: colors.brown, fontSize: 11, width: 9 },
  scaleTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  scaleFill: { height: 6, borderRadius: 3, backgroundColor: colors.green },
  listHeading: { height: 58, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...s.text, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  sortText: { ...s.text, color: colors.brown, fontSize: 11, lineHeight: 18 },
  listEmpty: { minHeight: 240, borderWidth: 0, backgroundColor: 'transparent' },
  status: { padding: 16, gap: 10 },
  reviewCard: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 12, gap: 5 },
  pageActions: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  reviewWriteContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
  ratingInputPanel: { height: 150, marginTop: 28, paddingTop: 16, paddingHorizontal: 24, alignItems: 'center', borderRadius: 20, backgroundColor: colors.pale },
  ratingPrompt: { ...s.text, color: colors.ink, fontSize: 17, lineHeight: 28, fontWeight: '600' },
  stars: { alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  starButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ratingDescription: { ...s.text, color: colors.green, fontWeight: '600', fontSize: 13, lineHeight: 20, marginTop: 10 },
  writeHeading: { marginTop: 28, height: 44, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  reviewInputBox: { height: 230, borderRadius: 16, borderWidth: 1, borderColor: colors.green, paddingHorizontal: 19, paddingTop: 20, paddingBottom: 16 },
  reviewInput: { ...s.text, flex: 1, padding: 0, color: colors.ink, fontSize: 15, lineHeight: 26.25, textAlignVertical: 'top' },
  characterCount: { ...s.text, fontSize: 11, lineHeight: 18, textAlign: 'right', color: colors.muted },
  publicNotice: { ...s.text, marginTop: 20, paddingHorizontal: 4, color: colors.muted, fontSize: 11, lineHeight: 18 },
  reviewSubmitFooter: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 8 },
  commentsContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },
  reviewSummary: { height: 224, borderWidth: 0, borderRadius: 20, backgroundColor: '#E2EDF3' },
  commentsHeading: { marginTop: 22, paddingHorizontal: 4, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentFooter: { height: 76, paddingHorizontal: 20, flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  commentInput: { ...s.text, flex: 1, height: 44, paddingHorizontal: 18, color: colors.ink, fontSize: 12, backgroundColor: colors.pale, borderRadius: 22 },
  commentSubmit: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.line },
});
// #endregion
