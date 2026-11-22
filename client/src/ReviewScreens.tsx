import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EmptyState } from './EmptyState';
import { useApp, type Route } from './appState';
import { useMemberAuth } from './memberAuth';
import { MemberRequestError } from './memberSession';
import { useApiUrl } from './serverConnection';
import { Action, colors, Icon, ModalPanel, s, Title } from './ui';
import {
  createReviewComment, createWorkReview, deleteReviewComment, deleteWorkReview, normalizeReviewBody,
  readMemberReviewComments, readMemberWorkReviews, readReviewComments, readWorkReviews,
  reportReview, reportReviewComment, setReviewCommentLike, setReviewLike, updateReviewComment, updateWorkReview,
  type ReviewComment, type ReviewCommentThread, type ReviewReportReason, type WorkReview, type WorkReviewPage,
} from './workReviews';

type ReviewContext = Pick<Route, 'workId' | 'workTitle' | 'workAuthor' | 'workImageUrl' | 'kind'>;
type Target = 'review' | 'comment';
/** 서버가 확인한 리뷰·댓글의 반응 변경값입니다. */
type ItemChange = Partial<Pick<WorkReview, 'likeCount' | 'liked' | 'reported'>>;
const starPath = 'm12 1.8 3.1 6.3 7 .9-5.1 5 1.2 7-6.2-3.3L5.8 21 7 14l-5.1-5 7-.9Z';
const reportReasons: [ReviewReportReason, string][] = [
  ['SPAM', '스팸·광고'], ['ABUSE', '욕설·비방'], ['INAPPROPRIATE', '부적절한 내용'],
  ['SPOILER', '스포일러'], ['OTHER', '기타'],
];

function context(route: Route): ReviewContext {
  const { workId, workTitle, workAuthor, workImageUrl, kind } = route;
  return { workId, workTitle, workAuthor, workImageUrl, kind };
}

function loginForReview(app: ReturnType<typeof useApp>) {
  const origin = app.baseRoute.screen;
  const reviewReturnScreen = origin === 'reviews' || origin === 'reviewWrite' || origin === 'reviewComments' ? origin : 'detail';
  app.navigate({ ...context(app.baseRoute), screen: 'login', reviewId: app.baseRoute.reviewId, reviewReturnScreen });
}

/** 이전 작품·회원의 응답을 버리고 같은 화면의 새로고침에서는 표시 중인 목록을 유지합니다. */
function useQuery<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, retry] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null; busy: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    pending.current = controller;
    setResult(previous => ({ key, data: previous?.key === key ? previous.data : null, error: null, busy: true }));
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) {
        pending.current = null;
        setResult({ key, data, error: null, busy: false });
      }
    }, (failure: unknown) => {
      if (!controller.signal.aborted) {
        pending.current = null;
        setResult(previous => ({ key, data: previous?.key === key ? previous.data : null,
        error: failure instanceof TypeError ? '서버에 연결하지 못했습니다. 다시 시도해 주세요.'
          : failure instanceof Error ? failure.message : '리뷰를 불러오지 못했습니다.', busy: false }));
      }
    });
    return () => { controller.abort(); pending.current = null; };
  }, [key, enabled, load, attempt]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, busy: current?.busy ?? enabled,
    retry: () => retry(value => value + 1),
    update: (change: (data: T) => T) => {
      const interrupted = pending.current !== null;
      pending.current?.abort();
      pending.current = null;
      setResult(previous => ({ ...previous!, data: change(previous!.data!) }));
      if (interrupted) retry(value => value + 1);
    } };
}

function useReviewPage(workId: string | undefined, page: number, size: number) {
  const apiUrl = useApiUrl();
  const { state, client } = useMemberAuth();
  const key = JSON.stringify([apiUrl, workId, page, size, state.status, state.generation]);
  const load = useCallback((signal: AbortSignal) => state.status === 'authenticated'
    ? readMemberWorkReviews(client, workId!, page, size, signal)
    : readWorkReviews(apiUrl, workId!, page, size, signal), [apiUrl, client, workId, page, size, state.status]);
  const result = useQuery<WorkReviewPage>(key, !!workId && ['authenticated', 'anonymous'].includes(state.status), load);
  return { ...result, error: !workId ? '리뷰를 볼 작품을 선택해 주세요.' : state.status === 'error' ? state.error : result.error,
    retry: () => state.status === 'error' ? void client.refresh() : result.retry(),
    change: (id: string, change: ItemChange) => result.update(data => ({ ...data,
      items: data.items.map(item => item.id === id ? { ...item, ...change } : item) })) };
}

function useReviewThread(reviewId: string | undefined) {
  const apiUrl = useApiUrl();
  const { state, client } = useMemberAuth();
  const key = JSON.stringify([apiUrl, reviewId, state.status, state.generation]);
  const load = useCallback((signal: AbortSignal) => state.status === 'authenticated'
    ? readMemberReviewComments(client, reviewId!, signal) : readReviewComments(apiUrl, reviewId!, signal),
  [apiUrl, client, reviewId, state.status]);
  const result = useQuery<ReviewCommentThread>(key, !!reviewId && ['authenticated', 'anonymous'].includes(state.status), load);
  return { ...result, error: !reviewId ? '댓글을 볼 리뷰를 선택해 주세요.' : state.status === 'error' ? state.error : result.error,
    retry: () => state.status === 'error' ? void client.refresh() : result.retry(),
    change: (target: Target, id: string, change: ItemChange) => result.update(data => target === 'review'
      ? { ...data, review: { ...data.review, ...change } }
      : { ...data, items: data.items.map(item => item.id === id ? { ...item, ...change } : item) }) };
}

/** 중복 제출과 화면·회원 전환 후의 응답 반영을 막으며 입력은 호출한 화면에 보존합니다. */
function useReviewAction() {
  const { client, state } = useMemberAuth();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => () => { pending.current?.abort(); }, [client, state.generation]);
  async function run<T>(request: (signal: AbortSignal) => Promise<T>, done: (value: T) => void) {
    if (pending.current || client.getSnapshot().generation !== state.generation) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = () => !controller.signal.aborted && client.getSnapshot().generation === state.generation;
    setBusy(true); setError('');
    try {
      const value = await request(controller.signal);
      if (current()) done(value);
    } catch (failure) {
      if (current()) setError(failure instanceof MemberRequestError && failure.status === 409
        ? '이미 등록한 리뷰가 있습니다. 기존 리뷰를 다시 불러와 주세요.'
        : failure instanceof TypeError ? '서버에 연결하지 못했습니다. 다시 시도해 주세요.'
        : failure instanceof Error ? failure.message : '요청을 완료하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      pending.current = null;
      if (current()) setBusy(false);
    }
  }
  return { run, busy, error, clear: () => setError('') };
}

function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  return <View accessible accessibilityLabel={`${rating}점`} style={styles.starRow}>
    {[1, 2, 3, 4, 5].map(value => <Svg key={value} width={size} height={size} viewBox="0 0 24 24">
      <Path d={starPath} fill={value <= rating ? colors.green : colors.line} />
    </Svg>)}
  </View>;
}

function WorkSummary({ info }: { info: ReviewContext }) {
  const { navigate } = useApp();
  const apiUrl = useApiUrl();
  if (!info.workId || !info.workTitle) return null;
  const kind = info.kind === 'book' ? '도서' : info.kind === 'magazine' ? '매거진' : info.kind === 'novel' ? '웹소설' : '';
  return <Pressable accessibilityRole="button" accessibilityLabel={info.workTitle + ' 작품 상세'} style={styles.workSummary}
    onPress={() => navigate({ screen: 'detail', workId: info.workId, kind: info.kind })}>
    {info.workImageUrl && <Image accessibilityLabel={info.workTitle + ' 표지'} resizeMode="cover"
      source={{ uri: new URL(info.workImageUrl, apiUrl + '/').href }} style={styles.workCover} />}
    <View style={s.grow}><Text numberOfLines={2} style={styles.workTitle}>{info.workTitle}</Text>
      <Text style={styles.meta}>{[info.workAuthor, kind].filter(Boolean).join(' · ')}</Text></View>
    <Icon name="next" size={17} color={colors.muted} />
  </Pressable>;
}

function QueryProblem({ error, retry }: { error: string; retry: () => void }) {
  return <View accessibilityLiveRegion="polite" style={styles.status}><Text style={s.error}>{error}</Text>
    <Action compact tone="secondary" label="다시 불러오기" onPress={retry} /></View>;
}

/** 리뷰·댓글의 공감, 본인 관리 및 신고 접수를 같은 조작부로 제공합니다. */
function ItemActions({ target, item, reload, change, edit, comments }: {
  target: Target;
  item: Pick<WorkReview, 'id' | 'likeCount' | 'liked' | 'reported' | 'mine'>;
  reload: () => void;
  change: (value: ItemChange) => void;
  edit: () => void;
  comments?: { count: number; open: () => void };
}) {
  const app = useApp();
  const { client, state } = useMemberAuth();
  const action = useReviewAction();
  const [dialog, setDialog] = useState<'delete' | 'report' | null>(null);
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const label = target === 'review' ? '리뷰' : '댓글';
  const detailLength = [...normalizeReviewBody(detail)].length;
  function requireMember(next: () => void) {
    if (state.status === 'authenticated') next();
    else loginForReview(app);
  }
  function like() {
    requireMember(() => void action.run(signal => target === 'review'
      ? setReviewLike(client, item.id, !item.liked, signal)
      : setReviewCommentLike(client, item.id, !item.liked, signal), change));
  }
  function remove() {
    void action.run(signal => target === 'review' ? deleteWorkReview(client, item.id, signal)
      : deleteReviewComment(client, item.id, signal), () => { setDialog(null); reload(); });
  }
  function report() {
    if (!reason) return;
    void action.run(signal => target === 'review' ? reportReview(client, item.id, reason, detail, signal)
      : reportReviewComment(client, item.id, reason, detail, signal), () => { change({ reported: true }); setDialog(null); });
  }
  return <>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} 공감 ${item.likeCount}개`}
        accessibilityState={{ selected: item.liked, disabled: item.mine || action.busy }} disabled={item.mine || action.busy}
        onPress={like} style={[styles.chip, item.liked && styles.selectedChip]}>
        <Icon name="heart" size={15} color={colors.green} /><Text style={styles.chipText}>{item.likeCount}</Text>
      </Pressable>
      {comments && <Pressable accessibilityRole="button" accessibilityLabel={`댓글 ${comments.count}개 보기`}
        onPress={comments.open} style={styles.chip}><Icon name="comment" size={15} /><Text style={styles.chipText}>댓글 {comments.count}</Text></Pressable>}
      <View style={s.grow} />
      {item.mine ? <>
        <Pressable accessibilityRole="button" accessibilityLabel={label + ' 수정'} disabled={action.busy} onPress={edit} style={styles.textButton}>
          <Icon name="edit" size={14} color={colors.brown} /><Text style={styles.smallAction}>수정</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={label + ' 삭제'} disabled={action.busy}
          onPress={() => { action.clear(); setDialog('delete'); }} style={styles.textButton}>
          <Icon name="trash" size={14} color={colors.brown} /><Text style={styles.smallAction}>삭제</Text></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel={label + (item.reported ? ' 신고 접수됨' : ' 신고')}
        disabled={item.reported || action.busy} onPress={() => requireMember(() => { action.clear(); setDialog('report'); })} style={styles.textButton}>
        <Text style={styles.smallAction}>{item.reported ? '신고 접수됨' : '신고'}</Text></Pressable>}
    </View>
    {action.error && !dialog && <Text accessibilityLiveRegion="polite" style={s.error}>{action.error}</Text>}
    <Modal visible={dialog !== null} transparent animationType="none" onRequestClose={() => { if (!action.busy) setDialog(null); }}>
      <View style={styles.modalOverlay}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalScroll}>
        <ModalPanel visible={dialog !== null} style={styles.modalCard}>
          <Text accessibilityRole="header" style={styles.heading}>{dialog === 'delete' ? `${label}를 삭제하시겠습니까?` : label + ' 신고'}</Text>
          {dialog === 'report' && <>
            <View accessibilityRole="radiogroup" style={styles.reportReasons}>{reportReasons.map(([value, text]) => <Pressable key={value}
              accessibilityRole="radio" accessibilityLabel={text} accessibilityState={{ checked: value === reason }} disabled={action.busy}
              onPress={() => setReason(value)} style={[styles.reason, value === reason && styles.selectedChip]}>
              <Text style={s.text}>{text}</Text>{value === reason && <Icon name="check" size={18} />}</Pressable>)}</View>
            <TextInput accessibilityLabel="신고 상세 내용" multiline editable={!action.busy} value={detail} onChangeText={setDetail}
              placeholder="상세 내용 (선택)" placeholderTextColor={colors.muted} style={styles.reportInput} />
            <Text style={[styles.characterCount, detailLength > 500 && s.error]}>{detailLength}/500</Text>
          </>}
          {!!action.error && <Text accessibilityLiveRegion="polite" style={s.error}>{action.error}</Text>}
          <View style={styles.dialogActions}>
            <Action compact tone="secondary" label="취소" disabled={action.busy} onPress={() => setDialog(null)} style={s.grow} />
            <Action compact label={action.busy ? '처리 중' : dialog === 'delete' ? '삭제' : '신고 접수'}
              disabled={action.busy || dialog === 'report' && (!reason || detailLength > 500)}
              onPress={dialog === 'delete' ? remove : report} style={s.grow} />
          </View>
        </ModalPanel>
      </ScrollView></View>
    </Modal>
  </>;
}

function ReviewCard({ item, info, reload, change, summary = false }: {
  item: WorkReview; info: ReviewContext; reload: () => void; change: (value: ItemChange) => void; summary?: boolean;
}) {
  const app = useApp();
  function openComments() { app.navigate({ ...info, screen: 'reviewComments', reviewId: item.id }); }
  return <View style={[styles.reviewCard, summary && styles.reviewSummary]}>
    {item.deleted ? <Text style={styles.deleted}>삭제된 리뷰입니다.</Text> : <>
      <View style={styles.personRow}><View style={styles.avatar}><Icon name="book" size={17} /></View>
        <View style={s.grow}><View style={s.row}><Text style={styles.nickname}>{item.nickname}</Text>
          {item.mine && <Text style={styles.ownBadge}>내 리뷰</Text>}</View>
          <View style={styles.ratingLine}><Stars rating={item.rating!} /><Text style={styles.ratingNumber}>{item.rating!.toFixed(1)}</Text></View>
        </View><Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</Text>
      </View>
      {item.body !== null && <Text selectable style={styles.reviewBody}>{item.body}</Text>}
    </>}
    {item.deleted ? !summary && <Pressable accessibilityRole="button" onPress={openComments} style={styles.chip}>
      <Text style={styles.chipText}>댓글 {item.commentCount}</Text></Pressable> : <ItemActions key={item.id} target="review" item={item} reload={reload} change={change}
      edit={() => app.navigate({ ...info, screen: 'reviewWrite', reviewId: item.id })}
      comments={summary ? undefined : { count: item.commentCount, open: openComments }} />}
  </View>;
}

/**
 * 작품 상세에서 작성 칸과 최근 리뷰 다섯 개를 표시합니다.
 * @param info - 리뷰를 조회하고 전체 목록으로 이동할 작품 정보입니다.
 * @returns 다음 리뷰가 있을 때만 전체보기를 제공하는 리뷰 영역입니다.
 */
export function WorkReviewPreview(info: ReviewContext & { workId: string }) {
  const app = useApp();
  const { state } = useMemberAuth();
  const query = useReviewPage(info.workId, 1, 5);
  const data = query.data;
  return <View>
    <Title action={data?.hasNext && <Pressable accessibilityRole="button" accessibilityLabel="리뷰 전체보기"
      onPress={() => app.navigate({ ...info, screen: 'reviews' })} style={styles.textButton}>
      <Text style={styles.allReviews}>전체보기</Text><Icon name="next" size={16} />
    </Pressable>}>리뷰</Title>
    {query.error && !data ? <QueryProblem error={query.error} retry={query.retry} /> : !data
      ? <ActivityIndicator accessibilityLabel="리뷰 불러오는 중" color={colors.green} /> : <>
        <ReviewDraft key={JSON.stringify([state.generation, info.workId, data.myReview?.id])} inline
          original={data.myReview} refresh={query.retry} refreshing={query.busy} loadError={query.error} onSaved={query.retry} />
        <Text style={styles.meta}>{data.averageRating === null ? '아직 등록된 평가가 없습니다.' :
          `평균 ${data.averageRating.toFixed(1)}점 · ${data.reviewCount.toLocaleString('ko-KR')}개 평가`}</Text>
        {data.items.map(item => <ReviewCard key={item.id} item={item} info={info} reload={query.retry} change={value => query.change(item.id, value)} />)}
      </>}
  </View>;
}

/** 작품 정보·평점 분포·등록순 리뷰와 회원의 실제 반응 상태를 표시합니다. */
export function ReviewsScreen() {
  const { baseRoute } = useApp();
  const info = context(baseRoute);
  const { state } = useMemberAuth();
  const [page, setPage] = useState(1);
  const query = useReviewPage(info.workId, page, 20);
  const data = query.data;
  return <ScrollView key={JSON.stringify([state.generation, page])} showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewContent}>
    <WorkSummary info={info} />
    {query.error && <QueryProblem error={query.error} retry={query.retry} />}
    {!data ? !query.error && <ActivityIndicator accessibilityLabel="리뷰 불러오는 중" color={colors.green} /> : <>
        <View style={styles.ratingPanel}><View style={styles.averagePanel}>
          <Text style={styles.meta}>평균 평점</Text><Text style={styles.averageScore}>{data.averageRating?.toFixed(1) ?? '–'}</Text>
          <Stars rating={data.averageRating ?? 0} /><Text style={styles.meta}>{data.reviewCount.toLocaleString('ko-KR')}개 평가</Text>
        </View><View style={styles.ratingScale}>{([5, 4, 3, 2, 1] as const).map(value => <View key={value}
          accessible accessibilityLabel={`${value}점 ${data.ratingDistribution[value]}개`} style={styles.scaleRow}>
          <Text style={styles.scaleLabel}>{value}</Text><View style={styles.scaleTrack}><View style={[styles.scaleFill,
            { width: data.reviewCount ? `${data.ratingDistribution[value] / data.reviewCount * 100}%` : '0%' }]} /></View>
          <Text style={styles.scaleCount}>{data.ratingDistribution[value]}</Text>
        </View>)}</View></View>
        <View style={styles.listHeading}><View style={s.row}><Text style={styles.heading}>리뷰</Text><Text style={styles.count}>{data.reviewCount}</Text></View>
          <Text style={styles.meta}>최신순</Text></View>
        {query.busy && <ActivityIndicator accessibilityLabel="리뷰 갱신 중" color={colors.green} />}
        {data.items.length === 0 && <EmptyState title="아직 등록된 리뷰가 없습니다." />}
        {data.items.map(item => <ReviewCard key={`${state.generation}:${item.id}`} item={item} info={info} reload={query.retry}
          change={value => query.change(item.id, value)} />)}
        {(page > 1 || data.hasNext) && <View style={styles.pageActions}>
          <Action compact tone="secondary" label="이전 페이지" disabled={page === 1 || query.busy} onPress={() => setPage(value => value - 1)} />
          <Text style={styles.meta}>{page}페이지</Text>
          <Action compact tone="secondary" label="다음 페이지" disabled={!data.hasNext || query.busy} onPress={() => setPage(value => value + 1)} />
        </View>}
      </>}
  </ScrollView>;
}

/** 회원의 기존 리뷰를 확인하여 같은 작성 화면에서 신규 등록과 수정을 구분합니다. */
export function ReviewWriteScreen() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  const query = useReviewPage(app.baseRoute.workId, 1, 1);
  if (state.status === 'anonymous') return <View style={styles.status}><Text style={s.text}>로그인 후 리뷰를 작성할 수 있습니다.</Text>
    <Action label="로그인" onPress={() => loginForReview(app)} /></View>;
  if (state.status === 'error') return <QueryProblem error={state.error!} retry={() => void client.refresh()} />;
  if (query.error && !query.data) return <QueryProblem error={query.error} retry={query.retry} />;
  if (!query.data || state.status !== 'authenticated') return <ActivityIndicator accessibilityLabel="내 리뷰 확인 중" color={colors.green} />;
  if (app.baseRoute.reviewId && app.baseRoute.reviewId !== query.data.myReview?.id) return <QueryProblem
    error="리뷰가 변경되었거나 삭제되었습니다. 목록에서 다시 선택해 주세요." retry={app.back} />;
  return <ReviewDraft key={JSON.stringify([state.generation, app.baseRoute.workId, query.data.myReview?.id])}
    original={query.data.myReview} refresh={query.retry} loadError={query.error} onSaved={app.back} />;
}

/**
 * 상세의 인라인 작성 칸과 독립 작성 화면에서 같은 등록·수정 처리를 사용합니다.
 * @param props - 기존 리뷰, 갱신 상태, 저장 후 동작과 인라인 표시 여부입니다.
 * @returns 별점과 본문 입력, 등록 또는 수정 동작입니다.
 */
function ReviewDraft({ original, refresh, loadError, onSaved, inline = false, refreshing = false }: {
  original: WorkReview | null; refresh: () => void; loadError: string | null; onSaved: () => void;
  inline?: boolean; refreshing?: boolean;
}) {
  const app = useApp();
  const { client, state } = useMemberAuth();
  const action = useReviewAction();
  const [savedReview, setSavedReview] = useState(original);
  const [rating, setRating] = useState(original?.rating ?? 0);
  const [body, setBody] = useState(original?.body ?? '');
  const length = [...normalizeReviewBody(body)].length;
  const authenticated = state.status === 'authenticated';
  const blocked = action.busy || refreshing;
  const unchanged = inline && savedReview !== null && rating === savedReview.rating
    && normalizeReviewBody(body) === (savedReview.body ?? '');
  function submit() {
    if (!authenticated || blocked || unchanged || !app.baseRoute.workId || rating === 0 || length > 1000) return;
    void action.run(signal => savedReview ? updateWorkReview(client, savedReview.id, rating, body, signal)
      : createWorkReview(client, app.baseRoute.workId!, rating, body, signal), saved => {
        setSavedReview(saved); setRating(saved.rating!); setBody(saved.body ?? '');
        onSaved();
      });
  }
  const fields = <>
    <View style={[styles.ratingInputPanel, inline && styles.inlineRatingPanel]}>
      <Text style={styles.ratingPrompt}>{inline ? '내 별점' : '이 작품은 어땠나요?'}</Text>
      <View accessibilityRole="radiogroup" style={[styles.stars, inline && styles.inlineStars]}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value}
        accessibilityRole="radio" accessibilityLabel={`${value}점`} accessibilityState={{ checked: rating === value, disabled: !authenticated || blocked }} disabled={!authenticated || blocked}
        onPress={() => setRating(value)} style={styles.starButton}><Svg width={inline ? 26 : 34} height={inline ? 26 : 34} viewBox="0 0 24 24">
        <Path d={starPath} fill={value <= rating ? colors.green : colors.line} /></Svg></Pressable>)}</View>
      {!inline && <Text style={styles.ratingDescription}>{rating === 0 ? '별점을 선택해 주세요.' : `${rating}.0 · ${['', '아쉬웠어요', '조금 아쉬웠어요', '괜찮았어요', '좋았어요', '아주 좋았어요'][rating]}`}</Text>}
    </View>
    {!inline && <View style={styles.listHeading}><Text style={styles.heading}>리뷰</Text></View>}
    <View style={[styles.reviewInputBox, inline && styles.inlineInputBox]}><TextInput accessibilityLabel="리뷰 내용" multiline value={body} onChangeText={setBody}
      editable={authenticated && !blocked} placeholder={authenticated ? '작품을 읽은 감상을 남겨 주세요. (선택)' : '로그인 후 리뷰를 작성할 수 있습니다.'}
      placeholderTextColor={colors.muted} style={[styles.reviewInput, inline && styles.inlineInput]} />
      <Text style={[styles.characterCount, length > 1000 && s.error]}>{length}/1000</Text></View>
  </>;
  const footer = <View style={[styles.submitFooter, inline && styles.inlineSubmit]}>
    {!!(loadError || action.error) && <><Text accessibilityLiveRegion="polite" style={s.error}>{loadError || action.error}</Text>
      <Action compact tone="secondary" label="내 리뷰 다시 확인" onPress={() => { action.clear(); refresh(); }} disabled={blocked} /></>}
    {authenticated ? <Action compact={inline} loading={action.busy}
      label={inline ? savedReview ? '수정' : '등록' : savedReview ? '수정 내용 저장' : '리뷰 등록하기'}
      disabled={!rating || length > 1000 || blocked || unchanged} onPress={submit} />
      : <Action compact tone="secondary" label="로그인하고 리뷰 쓰기" onPress={() => loginForReview(app)} />}
  </View>;
  if (inline) return <View style={styles.inlineDraft}>{fields}{footer}</View>;
  return <View style={styles.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.writeContent}>
      <WorkSummary info={context(app.baseRoute)} />{fields}
    </ScrollView>{footer}
  </View>;
}

function CommentRow({ item, reload, change }: { item: ReviewComment; reload: () => void; change: (value: ItemChange) => void }) {
  const { client } = useMemberAuth();
  const action = useReviewAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.body);
  const length = [...normalizeReviewBody(text)].length;
  return <View style={styles.commentRow}><View style={styles.personRow}><View style={styles.avatar}><Icon name="book" size={17} /></View>
    <Text style={[styles.nickname, s.grow]}>{item.nickname}</Text>{item.mine && <Text style={styles.ownBadge}>내 댓글</Text>}
    <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</Text></View>
    {editing ? <View style={styles.commentEditor}><TextInput accessibilityLabel="수정할 댓글" multiline value={text} onChangeText={setText}
      editable={!action.busy} style={styles.reportInput} /><Text style={[styles.characterCount, length > 500 && s.error]}>{length}/500</Text>
      {!!action.error && <Text style={s.error}>{action.error}</Text>}
      <View style={styles.dialogActions}><Action compact tone="secondary" label="수정 취소" disabled={action.busy}
        onPress={() => { setText(item.body); setEditing(false); }} style={s.grow} />
      <Action compact label="댓글 수정 저장" disabled={!length || length > 500 || action.busy}
        onPress={() => void action.run(signal => updateReviewComment(client, item.id, text, signal), () => { setEditing(false); reload(); })} style={s.grow} /></View>
    </View> : <><Text selectable style={styles.commentBody}>{item.body}</Text>
      <ItemActions target="comment" item={item} reload={reload} change={change} edit={() => { setText(item.body); setEditing(true); }} /></>}
  </View>;
}

/** 삭제 리뷰의 자리 표시와 기존 댓글을 유지하며 본인 관리·반응·신고를 연결합니다. */
export function ReviewCommentsScreen() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  const query = useReviewThread(app.baseRoute.reviewId);
  const action = useReviewAction();
  const [body, setBody] = useState('');
  const length = [...normalizeReviewBody(body)].length;
  const thread = query.data;
  const owner = JSON.stringify([state.generation, state.member?.id]);
  useEffect(() => { setBody(''); }, [owner, app.baseRoute.reviewId]);
  function submit() {
    if (!app.baseRoute.reviewId || !thread || thread.review.deleted || !length || length > 500) return;
    void action.run(signal => createReviewComment(client, app.baseRoute.reviewId!, body, signal), () => { setBody(''); query.retry(); });
  }
  return <View style={styles.screen}>
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.commentsContent}>
      {query.error && <QueryProblem error={query.error} retry={query.retry} />}
      {!thread ? !query.error && <ActivityIndicator accessibilityLabel="리뷰 댓글 불러오는 중" color={colors.green} /> : <>
          <WorkSummary info={context(app.baseRoute)} />
          <ReviewCard key={`${owner}:${thread.review.id}`} item={thread.review} info={context(app.baseRoute)} reload={query.retry}
            change={value => query.change('review', thread.review.id, value)} summary />
          <View style={styles.listHeading}><View style={s.row}><Text style={styles.heading}>댓글</Text><Text style={styles.count}>{thread.items.length}</Text></View>
            <Text style={styles.meta}>등록순</Text></View>
          {query.busy && <ActivityIndicator accessibilityLabel="댓글 갱신 중" color={colors.green} />}
          {thread.items.length === 0 && <EmptyState title="아직 댓글이 없습니다." />}
          {thread.items.map(item => <CommentRow key={`${owner}:${item.id}`} item={item} reload={query.retry}
            change={value => query.change('comment', item.id, value)} />)}
        </>}
    </ScrollView>
    {thread && <View style={styles.commentFooter}>
      {!!action.error && <Text accessibilityLiveRegion="polite" style={s.error}>{action.error}</Text>}
      {thread.review.deleted ? <Text style={styles.meta}>삭제된 리뷰에는 새 댓글을 작성할 수 없습니다.</Text>
        : state.status !== 'authenticated' ? <Action compact tone="secondary" label="로그인하고 댓글 쓰기"
          onPress={() => loginForReview(app)} /> : <>
          <View style={styles.composer}><TextInput accessibilityLabel="댓글 내용" value={body} onChangeText={setBody} editable={!action.busy}
            placeholder="댓글을 입력해 주세요." placeholderTextColor={colors.muted} multiline style={styles.commentInput} />
            <Pressable accessibilityRole="button" accessibilityLabel="댓글 등록" disabled={!length || length > 500 || action.busy}
              accessibilityState={{ disabled: !length || length > 500 || action.busy }} onPress={submit}
              style={[styles.sendButton, (!length || length > 500 || action.busy) && styles.disabled]}>
              <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 20V4m-6 6 6-6 6 6" stroke="#fff" strokeWidth={1.8} fill="none" /></Svg>
            </Pressable></View>
          <Text style={[styles.characterCount, length > 500 && s.error]}>{length}/500</Text>
        </>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, reviewContent: { paddingHorizontal: 20, paddingBottom: 28 },
  workSummary: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 22, minHeight: 104 },
  workCover: { width: 42, height: 62, borderRadius: 5, backgroundColor: colors.pale },
  workTitle: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 11, lineHeight: 18, color: colors.muted },
  ratingPanel: { minHeight: 156, borderRadius: 20, backgroundColor: colors.pale, padding: 18, flexDirection: 'row', gap: 26 },
  averagePanel: { width: 112, gap: 5 }, averageScore: { color: colors.ink, fontSize: 38, fontWeight: '700', lineHeight: 46 },
  starRow: { flexDirection: 'row', gap: 2 }, ratingScale: { flex: 1, justifyContent: 'center', gap: 11 },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, scaleLabel: { color: colors.brown, fontSize: 11 },
  scaleTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  scaleFill: { height: 6, borderRadius: 3, backgroundColor: colors.green }, scaleCount: { minWidth: 22, textAlign: 'right', fontSize: 10, color: colors.muted },
  listHeading: { minHeight: 66, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 17, lineHeight: 26, fontWeight: '700', color: colors.ink }, count: { fontSize: 16, fontWeight: '700', color: colors.green },
  reviewCard: { gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  nickname: { fontSize: 13, lineHeight: 21, color: colors.ink, fontWeight: '600' }, date: { fontSize: 10, color: colors.muted, alignSelf: 'flex-start', marginTop: 3 },
  ratingLine: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 4 }, ratingNumber: { fontSize: 10, color: colors.green },
  reviewBody: { fontSize: 14, lineHeight: 25, color: colors.ink },
  actions: { minHeight: 38, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 34, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.pale, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, lineHeight: 16, color: colors.green }, selectedChip: { backgroundColor: '#DDEBD8' },
  textButton: { minHeight: 38, paddingHorizontal: 5, paddingVertical: 10, flexDirection: 'row', gap: 4, alignItems: 'center' },
  smallAction: { fontSize: 11, lineHeight: 16, color: colors.brown }, ownBadge: { borderRadius: 9, backgroundColor: colors.pale, paddingHorizontal: 7, paddingVertical: 2, color: colors.green, fontSize: 10 },
  deleted: { paddingVertical: 16, color: colors.muted, fontSize: 13 }, status: { paddingVertical: 22, paddingHorizontal: 16, gap: 14 },
  pageActions: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  writeContent: { paddingHorizontal: 20, paddingBottom: 16 },
  allReviews: { fontSize: 13, fontWeight: '600', color: colors.ink },
  inlineDraft: { marginTop: 12, marginBottom: 18, padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 16, gap: 10 },
  inlineRatingPanel: { minHeight: 44, paddingVertical: 0, paddingHorizontal: 0, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent' },
  inlineStars: { alignSelf: 'auto' },
  inlineInputBox: { minHeight: 0, borderWidth: 0, padding: 0, gap: 6 },
  inlineInput: { minHeight: 88, padding: 12, borderRadius: 10, backgroundColor: colors.pale },
  inlineSubmit: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, alignItems: 'flex-end' },
  ratingInputPanel: { minHeight: 152, paddingVertical: 18, paddingHorizontal: 24, alignItems: 'center', borderRadius: 20, backgroundColor: colors.pale, gap: 10 },
  ratingPrompt: { color: colors.ink, fontSize: 16, lineHeight: 25, fontWeight: '600' }, stars: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between' },
  starButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, ratingDescription: { color: colors.green, fontSize: 12, lineHeight: 20 },
  reviewInputBox: { minHeight: 230, borderRadius: 16, borderWidth: 1, borderColor: colors.green, padding: 16, gap: 12 },
  reviewInput: { minHeight: 180, fontSize: 14, lineHeight: 26, color: colors.ink, padding: 0, textAlignVertical: 'top' },
  characterCount: { fontSize: 10, lineHeight: 16, textAlign: 'right', color: colors.muted },
  submitFooter: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 9 }, commentsContent: { paddingHorizontal: 20, paddingBottom: 20 },
  reviewSummary: { borderRadius: 20, padding: 16, backgroundColor: '#E2EDF3', borderBottomWidth: 0 },
  commentRow: { paddingVertical: 16, gap: 13, borderBottomWidth: 1, borderBottomColor: colors.line }, commentBody: { paddingLeft: 42, color: colors.ink, fontSize: 13, lineHeight: 24 },
  commentEditor: { gap: 8 }, commentFooter: { borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 9, gap: 5 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 }, commentInput: { flex: 1, minHeight: 44, maxHeight: 112, borderRadius: 22, backgroundColor: colors.pale, paddingHorizontal: 17, paddingVertical: 12, fontSize: 13, color: colors.ink },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, disabled: { opacity: 0.4 },
  modalOverlay: { flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 20 }, modalScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '100%', maxWidth: 440, borderRadius: 22, backgroundColor: '#fff', padding: 22, gap: 15 }, reportReasons: { gap: 6 },
  reason: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.pale },
  reportInput: { minHeight: 90, padding: 12, fontSize: 13, lineHeight: 23, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 12, textAlignVertical: 'top' },
  dialogActions: { flexDirection: 'row', gap: 10 },
});
