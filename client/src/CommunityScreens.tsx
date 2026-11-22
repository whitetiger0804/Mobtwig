// #region 의존성과 공통 동작
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PixelRatio, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { SvgUri } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kindLabel, useApp, type Route } from './appState';
import { EmptyState } from './EmptyState';
import { useMemberAuth } from './memberAuth';
import { MemberRequestError } from './memberSession';
import { useApiUrl } from './serverConnection';
import { Action, colors, Icon, ModalPanel, s } from './ui';
import {
  communityImageUrl, createCommunityBoard, createCommunityComment, createCommunityPost, deleteCommunityComment,
  deleteCommunityPost, normalizeCommunityText, readCommunityBoards, readCommunityComments,
  readCommunityPost, readCommunityPosts, readCommunityWorks, reportCommunityPost,
  setCommunityLike, updateCommunityComment, updateCommunityPost, uploadCommunityImage,
  type CommunityBoard, type CommunityComment, type CommunityHead, type CommunityPost,
  type CommunityPostInput, type CommunityReportReason, type CommunitySticker, type CommunityWork,
} from './community';
import { deleteLocalCommunityDraft, loadLocalCommunityDraft, saveLocalCommunityDraft } from './communityDrafts';
import { communityBodyTextLength, insertCommunityBodyImage, normalizeCommunityBody, removeCommunityBodyImage, splitCommunityBody,
  type CommunityBodySelection } from './communityBody';
import { fetchWorkDetail } from './workDetails';

const modes = [['work', '작품별'], ['topic', '주제별'], ['promotion', '작품 홍보']] as const;
const heads: Record<CommunityHead, string> = {
  IMPRESSION: '감상', QUESTION: '질문', THEORY: '추측', FREE: '자유', STORY: '이야기', PROMOTION: '홍보',
};
const reasons: [CommunityReportReason, string][] = [
  ['SPAM', '광고·도배'], ['ABUSE', '욕설·비방'], ['INAPPROPRIATE', '부적절한 내용'], ['SPOILER', '스포일러 미표시'], ['OTHER', '기타'],
];

/** 화면·서버·회원이 바뀌면 이전 요청을 취소하고 새 응답만 표시합니다. */
function useQuery<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data: T | null; busy: boolean; error: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setResult(previous => ({ key, data: previous?.key === key ? previous.data : null, busy: true, error: '' }));
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, busy: false, error: '' });
    }, (failure: unknown) => {
      if (!controller.signal.aborted) setResult(previous => ({ key, data: previous?.key === key ? previous.data : null,
        busy: false, error: requestError(failure) }));
    });
    return () => controller.abort();
    // 조회에 사용한 값은 호출부의 key에 모두 포함합니다.
  }, [key, enabled, attempt]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, busy: current?.busy ?? enabled, error: current?.error ?? '',
    ready: !!current && !current.busy && !current.error, retry: () => setAttempt(value => value + 1) };
}

/** 회원 상태와 현재 API 주소를 조회 키에 함께 사용합니다. */
function useConnection() {
  const apiUrl = useApiUrl();
  const { state, client } = useMemberAuth();
  return { apiUrl, state, client, reader: state.status === 'authenticated' ? client : undefined,
    ready: state.status === 'authenticated' || state.status === 'anonymous',
    key: JSON.stringify([apiUrl, state.status, state.generation, state.member?.id]) };
}

function requestError(failure: unknown) {
  if (failure instanceof MemberRequestError) {
    if (failure.status === 401) return '로그인 후 다시 시도해 주세요.';
    if (failure.status === 403) return '이 작업을 수행할 수 없습니다. 다시 로그인해 주세요.';
    if (failure.status === 404) return '게시글이나 댓글을 찾을 수 없습니다.';
    if (failure.status === 400) return '입력 내용과 첨부 파일을 확인해 주세요.';
    if (failure.status === 409) return '현재 상태가 변경되었습니다. 다시 불러와 주세요.';
    if (failure.status === 413) return '이미지는 2MB 이하로 선택해 주세요.';
  }
  return failure instanceof TypeError ? '서버에 연결하지 못했습니다. 다시 시도해 주세요.'
    : failure instanceof Error ? failure.message : '요청을 완료하지 못했습니다.';
}

/** 중복 제출과 화면을 떠난 뒤의 응답 반영을 방지합니다. */
function useAction() {
  const { state, client } = useMemberAuth();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => () => pending.current?.abort(), [client, state.generation]);
  async function run<T>(request: (signal: AbortSignal) => Promise<T>, done: (value: T) => void) {
    if (pending.current || client.getSnapshot().generation !== state.generation) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError('');
    const current = () => !controller.signal.aborted && client.getSnapshot().generation === state.generation;
    try { const value = await request(controller.signal); if (current()) done(value); }
    catch (failure) { if (current()) setError(requestError(failure)); }
    finally { pending.current = null; if (current()) setBusy(false); }
  }
  return { busy, error, run, clear: () => setError('') };
}

/** 인증 후 원래 커뮤니티 화면으로 돌아올 식별자만 전달합니다. */
function login(app: ReturnType<typeof useApp>, route: Route = app.baseRoute) {
  const screen = ['communityBoard', 'post', 'writePost'].includes(route.screen) ? route.screen : 'community';
  app.navigate({ ...route, screen: 'login', communityReturnScreen: screen as Route['communityReturnScreen'] });
}

function QueryStatus({ busy, error, retry }: { busy: boolean; error: string; retry: () => void }) {
  if (error) return <View style={styles.problem}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Action compact label="다시 불러오기" onPress={retry} /></View>;
  return busy ? <ActivityIndicator color={colors.green} accessibilityLabel="커뮤니티 불러오는 중" style={styles.problem} /> : null;
}

function LoginRequired() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  return <View style={styles.problem}><Text style={s.text}>{state.status === 'error' ? state.error : '로그인이 필요합니다.'}</Text>
    <Action label={state.status === 'error' ? '다시 확인하기' : '로그인'} onPress={() => state.status === 'error' ? void client.refresh() : login(app)} /></View>;
}

function Pager({ page, hasNext, busy, onChange }: { page: number; hasNext: boolean; busy: boolean; onChange: (page: number) => void }) {
  return page > 1 || hasNext ? <View style={styles.pager}>
    <Action compact tone="quiet" label="이전" disabled={page === 1 || busy} onPress={() => onChange(page - 1)} />
    <Text style={styles.meta}>{page}</Text><Action compact tone="quiet" label="다음" disabled={!hasNext || busy} onPress={() => onChange(page + 1)} />
  </View> : null;
}

function Confirm({ title, visible, busy, onCancel, onConfirm }: {
  title: string; visible: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
    <View style={styles.backdrop}><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="닫기" onPress={onCancel} />
      <ModalPanel visible={visible} style={styles.dialog}><Text style={styles.heading}>{title}</Text><View style={styles.dialogActions}>
        <Action compact tone="quiet" label="취소" disabled={busy} onPress={onCancel} /><Action compact label="확인" disabled={busy} onPress={onConfirm} />
      </View></ModalPanel></View>
  </Modal>;
}

/** 표지가 있는 작품만 이미지를 표시하며 임의의 빈 표지를 만들지 않습니다. */
function WorkSummary({ work, onPress }: { work: CommunityWork; onPress?: () => void }) {
  const apiUrl = useApiUrl();
  return <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={styles.workSummary}>
    {work.imageUrl && <Image source={{ uri: communityImageUrl(apiUrl, work.imageUrl) }} style={styles.cover} />}
    <View style={s.grow}><Text style={styles.workTitle}>{work.title}</Text><Text style={styles.meta}>{kindLabel(work.kind)}{work.author ? ` · ${work.author}` : ''}</Text></View>
    {onPress && <Icon name="next" size={18} color={colors.muted} />}
  </Pressable>;
}

function StickerRow({ items, onRemove }: { items: CommunitySticker[]; onRemove?: (index: number) => void }) {
  const apiUrl = useApiUrl();
  return items.length > 0 ? <View style={styles.stickerRow}>{items.map((item, index) => <Pressable key={`${item.id}-${index}`}
    disabled={!onRemove} accessibilityRole={onRemove ? 'button' : undefined} accessibilityLabel={onRemove ? `${item.name} 제거` : item.name}
    onPress={() => onRemove?.(index)} style={styles.sticker}>
    <SvgUri uri={communityImageUrl(apiUrl, item.imageUrl)} width={64} height={64} />
    {onRemove && <View style={styles.removeBadge}><Icon name="close" size={12} /></View>}
  </Pressable>)}</View> : null;
}

function StickerPicker({ items, selected, limit, disabled, onChange }: {
  items: CommunitySticker[]; selected: string[]; limit: number; disabled: boolean; onChange: (items: string[]) => void;
}) {
  const apiUrl = useApiUrl();
  return <View><View style={styles.rowBetween}><Text style={styles.fieldLabel}>이모티콘</Text><Text style={styles.meta}>{selected.length} / {limit}</Text></View>
    <View style={styles.stickerChoices}>{items.map(item => <Pressable key={item.id} accessibilityRole="button"
      accessibilityLabel={`${item.name} 추가`} disabled={disabled || selected.length >= limit}
      onPress={() => onChange([...selected, item.id])} style={styles.stickerChoice}>
      <SvgUri uri={communityImageUrl(apiUrl, item.imageUrl)} width={52} height={52} /><Text style={styles.meta}>{item.name}</Text>
    </Pressable>)}</View>
    <StickerRow items={selected.map(id => items.find(item => item.id === id)!)}
      onRemove={disabled ? undefined : index => onChange(selected.filter((_, i) => i !== index))} />
  </View>;
}
// #endregion

// #region 커뮤니티와 게시판 목록
function PostRow({ post, expanded = false }: { post: CommunityPost; expanded?: boolean }) {
  const app = useApp();
  const apiUrl = useApiUrl();
  return <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'post', postId: post.id, boardId: post.boardId, mode: post.boardType })}
    style={[styles.postRow, post.boardType === 'promotion' && styles.promotionCard]}>
    {post.boardType === 'promotion' && post.work && <WorkSummary work={post.work} />}
    <Text style={styles.category}>{heads[post.head]}{post.hasSpoiler ? ' · 스포일러' : ''}{post.status === 'HIDDEN' ? ' · 숨김' : ''}</Text>
    <View style={styles.row}><Text style={[styles.postRowTitle, s.grow]} numberOfLines={2}>{post.locked ? '스포일러가 포함된 게시글입니다.' : post.title}</Text>
      {post.locked && <Icon name="lock" size={17} color={colors.muted} />}</View>
    {expanded && !post.locked && <Text style={styles.bodyPreview} numberOfLines={4}>{splitCommunityBody(post.body ?? '', post.images)
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')}</Text>}
    {expanded && post.images[0] && <Image source={{ uri: communityImageUrl(apiUrl, post.images[0].url) }} style={styles.previewImage} />}
    <Text style={styles.meta}>{post.nickname} · 공감 {post.likeCount} · 댓글 {post.commentCount}</Text>
  </Pressable>;
}

/** 각 게시판의 가장 최근 공개 글 하나를 게시판 바로 아래에 표시합니다. */
function LatestPost({ board }: { board: CommunityBoard }) {
  const app = useApp();
  const post = board.latestPost;
  if (!post) return null;
  return <Pressable accessibilityRole="button" style={styles.latestPost}
    onPress={() => app.navigate({ screen: 'post', postId: post.id, boardId: board.id, mode: board.type })}>
    <View style={styles.row}><Text style={styles.category}>{heads[post.head]}</Text>
      {post.hasSpoiler && <Text style={styles.meta}>스포일러</Text>}</View>
    <Text numberOfLines={2} style={styles.postRowTitle}>{post.locked ? '스포일러가 포함된 게시글입니다.' : post.title}</Text>
    <Text style={styles.meta}>{post.nickname} · 공감 {post.likeCount} · 댓글 {post.commentCount}</Text>
  </Pressable>;
}

/** 입력이 잠시 멈추면 현재 검색어를 조회에 반영합니다. */
function useSearch(value: string) {
  const [query, setQuery] = useState(value.trim());
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(value.trim()), 250);
    return () => clearTimeout(timeout);
  }, [value]);
  return query;
}

/** 제목 옆의 작은 검색창을 게시판과 홍보 목록에서 함께 사용합니다. */
function CommunitySearch({ value, onChange, placeholder, standalone = false }: {
  value: string; onChange: (value: string) => void; placeholder: string; standalone?: boolean;
}) {
  return <View style={[styles.compactSearch, standalone && styles.standaloneSearch]}><Icon name="search" size={17} color={colors.muted} />
    <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={colors.muted} value={value}
      onChangeText={onChange} maxLength={100} returnKeyType="search" style={styles.compactSearchInput} />
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => onChange('')} style={styles.clearSearch}>
      <Icon name="close" size={15} color={colors.muted} /></Pressable>}
  </View>;
}

/** 선택한 공개 작품 또는 입력한 주제로 회원이 명시적으로 게시판을 만듭니다. */
function CreateBoardDialog({ type, initialQuery, onClose, onOpen }: {
  type: 'work' | 'topic'; initialQuery: string; onClose: () => void; onOpen: (board: CommunityBoard) => void;
}) {
  const connection = useConnection();
  const action = useAction();
  const [input, setInput] = useState(initialQuery);
  const topicInput = useRef<TextInputInstance>(null);
  const [page, setPage] = useState(1);
  const query = useSearch(input);
  const works = useQuery(`${connection.key}:${query}:${page}:create-board`, type === 'work' && connection.ready && !!query,
    signal => readCommunityWorks(connection.apiUrl, { query, page, size: 20 }, signal));
  function create(workId?: string) {
    void action.run(signal => createCommunityBoard(connection.client, type === 'work'
      ? { type, workId: workId! } : { type, name: input.trim() }, signal), onOpen);
  }
  return <Modal visible transparent animationType="none" onShow={() => { if (type === 'topic') topicInput.current?.focus(); }}
    onRequestClose={() => { if (!action.busy) onClose(); }}>
    <View style={styles.backdrop}><Pressable style={StyleSheet.absoluteFill} accessibilityLabel="게시판 만들기 닫기" disabled={action.busy} onPress={onClose} />
      <ModalPanel visible style={[styles.dialog, styles.createDialog]}>
        <View style={styles.rowBetween}><Text style={styles.heading}>{type === 'work' ? '작품 게시판 만들기' : '주제 게시판 만들기'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" disabled={action.busy} style={styles.textButton} onPress={onClose}><Icon name="close" size={19} /></Pressable></View>
        {type === 'work' ? <>
          <CommunitySearch standalone placeholder="작품 검색" value={input} onChange={value => { setInput(value); setPage(1); }} />
          {!!query && <ScrollView keyboardShouldPersistTaps="handled" style={styles.createList}>
            <QueryStatus busy={works.busy} error={works.error} retry={works.retry} />
            {!works.busy && works.data?.items.map(item => <View key={item.work.id} style={styles.createWorkRow}>
              <View style={s.grow}><WorkSummary work={item.work} onPress={action.busy ? undefined : () => create(item.work.id)} /></View>
            </View>)}
            {works.ready && !works.data?.items.length && <EmptyState compact title="검색한 작품이 없습니다." />}
            <Pager page={page} hasNext={works.data?.hasNext ?? false} busy={works.busy || action.busy} onChange={setPage} />
          </ScrollView>}
        </> : <>
          <TextInput ref={topicInput} accessibilityLabel="새 주제 이름" placeholder="주제 이름" placeholderTextColor={colors.muted} value={input}
            onChangeText={setInput} maxLength={100} editable={!action.busy} style={styles.searchInput} />
          <Action label="만들기" disabled={action.busy || !input.trim()} onPress={() => create()} />
        </>}
        {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
      </ModalPanel>
    </View>
  </Modal>;
}

/** 작품·주제는 게시판을 탐색하고, 홍보는 기존 게시글 목록을 표시합니다. */
export function CommunityScreen({ route }: { route: Route }) {
  const app = useApp();
  const connection = useConnection();
  const action = useAction();
  const mode = route.mode ?? 'work';
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(!!route.communityCreate);
  const query = useSearch(input);
  const boardQuery = mode === 'topic' ? query : '';
  const boards = useQuery(`${connection.key}:${mode}:${boardQuery}:boards`, connection.ready,
    signal => readCommunityBoards(connection.apiUrl, mode, signal, boardQuery || undefined));
  const works = useQuery(`${connection.key}:${query}:${page}:works`, connection.ready && mode === 'work' && !!query,
    signal => readCommunityWorks(connection.apiUrl, { query, page, size: 20 }, signal));
  const posts = useQuery(`${connection.key}:${mode}:${query}:${page}:promotion`, connection.ready && mode === 'promotion',
    signal => readCommunityPosts(connection.apiUrl, { type: mode, query, page, size: 20 }, signal, connection.reader));
  function openBoard(board: CommunityBoard) {
    app.navigate({ screen: 'communityBoard', mode: board.type, boardId: board.id, boardTitle: board.name });
  }
  function startCreate(work?: CommunityWork) {
    if (!connection.reader) {
      login(app, { screen: 'community', mode, communityCreate: true, workTitle: work?.title });
    } else if (work) {
      void action.run(signal => createCommunityBoard(connection.client, { type: 'work', workId: work.id }, signal), openBoard);
    } else setCreating(true);
  }
  function composePromotion() {
    const board = boards.data?.items[0];
    if (!board) return;
    const next: Route = { screen: 'writePost', mode, boardId: board.id };
    if (connection.reader) app.navigate(next); else login(app, next);
  }
  function closeCreate() {
    setCreating(false);
    if (route.communityCreate) app.navigate({ screen: 'community', mode }, false, true);
  }
  return <View style={styles.screen}>
    <View style={styles.tabs} accessibilityRole="tablist">{modes.map(([value, label]) => <Pressable key={value} accessibilityRole="tab"
      accessibilityState={{ selected: mode === value }} onPress={() => app.navigate({ screen: 'community', mode: value }, true)} style={styles.tab}>
      <View style={[styles.tabLabel, mode === value && styles.selectedTab]}><Text numberOfLines={1} style={[styles.tabText, mode === value && styles.selectedText]}>{label}</Text></View>
    </Pressable>)}</View>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.communityContent}>
      <View style={styles.communityHeading}><Text style={styles.heading}>{mode === 'work' ? '작품별 이야기' : mode === 'topic' ? '주제별 이야기' : '작품 홍보'}</Text>
        <CommunitySearch placeholder={mode === 'work' ? '작품 검색' : mode === 'topic' ? '주제 검색' : '글 검색'} value={input}
          onChange={value => { setInput(value); setPage(1); }} />
        {mode === 'promotion'
          ? <Pressable accessibilityRole="button" accessibilityLabel="홍보 글쓰기" disabled={!boards.data?.items.length} onPress={composePromotion} style={styles.headingButton}><Icon name="edit" size={20} /></Pressable>
          : <Pressable accessibilityRole="button" accessibilityLabel={mode === 'work' ? '작품 게시판 만들기' : '주제 게시판 만들기'} onPress={() => startCreate()} style={styles.headingButton}><Icon name="plus" size={22} /></Pressable>}
      </View>
      <View style={styles.utilityRow}>
        <Pressable accessibilityRole="button" onPress={() => {
          const next: Route = { screen: 'communityBoard', mode, communityMine: true, boardTitle: '내 게시글' };
          if (connection.state.status === 'authenticated') app.navigate(next); else login(app, next);
        }} style={styles.textButton}><Text style={styles.linkText}>내 게시글</Text></Pressable></View>
      <QueryStatus busy={boards.busy && !boards.data} error={boards.error || (connection.state.status === 'error' ? connection.state.error ?? '' : '')}
        retry={() => connection.state.status === 'error' ? void connection.client.refresh() : boards.retry()} />
      {mode === 'work' && !query && boards.data && (['book', 'magazine', 'novel'] as const).map(kind => {
        const items = boards.data!.items.filter(item => item.work?.kind === kind);
        return items.length > 0 ? <View key={kind} style={styles.workSection}><Text style={styles.category}>{kindLabel(kind)}</Text>
          {items.map(board => <View key={board.id} style={styles.boardRow}>
            {board.work && <WorkSummary work={board.work} onPress={() => openBoard(board)} />}
            <LatestPost board={board} />
          </View>)}</View> : null;
      })}
      {mode === 'work' && !query && boards.ready && !boards.data?.items.length && <EmptyState compact title="아직 작품 게시판이 없습니다." />}
      {mode === 'work' && !!query && <>
        <QueryStatus busy={works.busy} error={works.error} retry={works.retry} />
        {!works.busy && works.data?.items.map(item => <View key={item.work.id} style={styles.createWorkRow}>
          <View style={s.grow}><WorkSummary work={item.work} onPress={item.boardId ? () => app.navigate({ screen: 'communityBoard', mode, boardId: item.boardId!, boardTitle: item.work.title }) : undefined} /></View>
          {!item.boardId && <Action compact tone="quiet" label="게시판 만들기" disabled={action.busy} onPress={() => startCreate(item.work)} />}
        </View>)}
        {works.ready && !works.data?.items.length && <EmptyState compact title="검색한 작품이 없습니다." />}
        <Pager page={page} hasNext={works.data?.hasNext ?? false} busy={works.busy} onChange={setPage} />
      </>}
      {mode === 'topic' && <>
        {boards.data?.items.map(board => <View key={board.id} style={styles.boardRow}>
          <Pressable accessibilityRole="button" onPress={() => openBoard(board)} style={styles.topicBoard}>
            <Text style={[styles.workTitle, s.grow]}>{board.name}</Text><Icon name="next" size={18} color={colors.muted} />
          </Pressable><LatestPost board={board} />
        </View>)}
        {boards.ready && !boards.data?.items.length && <EmptyState compact title={query ? '검색한 주제가 없습니다.' : '아직 주제 게시판이 없습니다.'} />}
      </>}
      {mode === 'promotion' && <>
        {posts.data?.items.map(post => <PostRow key={post.id} post={post} expanded />)}
        {posts.ready && !posts.data?.items.length && <EmptyState compact title="아직 게시글이 없습니다." />}
        <Pager page={page} hasNext={posts.data?.hasNext ?? false} busy={posts.busy} onChange={setPage} />
        <QueryStatus busy={posts.busy && !posts.data} error={posts.error} retry={posts.retry} />
      </>}
      {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
    </ScrollView>
    {creating && mode !== 'promotion' && <CreateBoardDialog type={mode} initialQuery={route.workTitle ?? ''}
      onClose={closeCreate} onOpen={board => { closeCreate(); boards.retry(); openBoard(board); }} />}
  </View>;
}

/** 선택한 게시판의 검색·말머리·페이지를 서버에 전달합니다. */
export function CommunityBoardScreen({ route }: { route: Route }) {
  const app = useApp();
  const connection = useConnection();
  const mode = route.mode ?? 'work';
  const [page, setPage] = useState(1);
  const [head, setHead] = useState<CommunityHead | undefined>();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const boards = useQuery(`${connection.key}:${mode}:boards`, connection.ready, signal => readCommunityBoards(connection.apiUrl, mode, signal));
  const board = boards.data?.items.find(item => item.id === route.boardId);
  const query = useQuery(`${connection.key}:${route.boardId}:${route.communityMine}:${page}:${head}:${search}`,
    connection.ready && (!route.communityMine || !!connection.reader), signal => readCommunityPosts(connection.apiUrl,
      { boardId: route.boardId, type: mode, mine: route.communityMine, page, size: 20, head, query: search }, signal, connection.reader));
  if (route.communityMine && connection.ready && !connection.reader) return <LoginRequired />;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.communityContent}>
    {board?.work && <WorkSummary work={board.work} onPress={() => app.navigate({ screen: 'detail', workId: board.work!.id })} />}
    <View style={styles.rowBetween}><Text style={styles.heading}>{route.communityMine ? '내 게시글' : board?.work ? '게시글' : board?.name}</Text>
      {!route.communityMine && board && <Pressable accessibilityRole="button" accessibilityLabel="글쓰기" style={styles.roundButton} onPress={() => {
        const next: Route = { screen: 'writePost', mode, boardId: route.boardId };
        if (connection.reader) app.navigate(next); else login(app, next);
      }}><Icon name="edit" /></Pressable>}</View>
    <View style={styles.search}><TextInput accessibilityLabel="게시글 검색어" value={input} onChangeText={setInput} style={[s.text, s.grow]}
      placeholder="게시글 검색" returnKeyType="search" onSubmitEditing={() => { setSearch(input.trim()); setPage(1); }} />
      <Pressable accessibilityRole="button" accessibilityLabel="게시글 검색" style={styles.textButton} onPress={() => { setSearch(input.trim()); setPage(1); }}><Icon name="search" size={21} /></Pressable></View>
    {board && <View style={styles.chips}>{[undefined, ...board.heads].map(value => <Pressable key={value ?? 'all'} accessibilityRole="tab"
      accessibilityState={{ selected: head === value }} onPress={() => { setHead(value); setPage(1); }} style={[styles.chip, head === value && styles.chipSelected]}>
      <Text style={styles.chipText}>{value ? heads[value] : '전체'}</Text></Pressable>)}</View>}
    <QueryStatus busy={query.busy && !query.data} error={query.error || boards.error} retry={() => { boards.retry(); query.retry(); }} />
    {query.data?.items.map(post => <PostRow key={post.id} post={post} />)}
    {query.ready && !query.data?.items.length && <EmptyState compact title="표시할 게시글이 없습니다." />}
    <Pager page={page} hasNext={query.data?.hasNext ?? false} busy={query.busy} onChange={setPage} />
  </ScrollView>;
}
// #endregion

// #region 게시글과 댓글
/** 게시글과 댓글을 읽고, 확인한 항목만 스포일러를 해제합니다. */
export function PostScreen() {
  const app = useApp();
  const connection = useConnection();
  const action = useAction();
  const postId = app.baseRoute.postId;
  const [reveal, setReveal] = useState(false);
  const [revealIds, setRevealIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ title: string; perform: () => void } | null>(null);
  const post = useQuery(`${connection.key}:${postId}:${reveal}`, connection.ready && !!postId,
    signal => readCommunityPost(connection.apiUrl, postId!, reveal, signal, connection.reader));
  const showComments = post.data?.status === 'PUBLISHED' && !post.data.locked;
  const comments = useQuery(`${connection.key}:${postId}:${page}:${reveal}:${revealIds.join(',')}`, connection.ready && showComments,
    signal => readCommunityComments(connection.apiUrl, postId!, { page, size: 20, revealPost: reveal, revealIds }, signal, connection.reader));
  const previousOverlay = useRef(false);
  useEffect(() => {
    if (previousOverlay.current && !app.overlay) { post.retry(); comments.retry(); }
    previousOverlay.current = !!app.overlay;
  }, [app.overlay]);
  const value = post.data;
  function compose(comment?: CommunityComment) {
    if (!connection.reader) { login(app); return; }
    app.navigate({ screen: 'commentCompose', postId, commentId: comment?.id, communityPage: page, communityReveal: reveal });
  }
  function removeComment(item: CommunityComment) {
    setConfirm({ title: '댓글을 삭제하시겠습니까?', perform: () => {
      void action.run(signal => deleteCommunityComment(connection.client, item.id, signal), () => { setConfirm(null); post.retry(); comments.retry(); });
    } });
  }
  return <View style={styles.screen}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.postContent}>
      <QueryStatus busy={post.busy && !value} error={!postId ? '게시글을 선택해 주세요.' : post.error} retry={post.retry} />
      {value && <>
        {value.work && <View style={styles.workPanel}><WorkSummary work={value.work}
          onPress={() => app.navigate({ screen: 'detail', workId: value.work!.id })} /></View>}
        <Text style={styles.category}>{heads[value.head]}{value.hasSpoiler ? ' · 스포일러' : ''}</Text>
        {value.locked ? <View style={styles.locked}><Icon name="lock" size={25} /><Text style={styles.bodyText}>스포일러가 포함되어 있습니다.</Text>
          <Action label="내용 보기" onPress={() => setConfirm({ title: '스포일러가 포함된 내용을 보시겠습니까?', perform: () => { setConfirm(null); setReveal(true); } })} /></View> : <>
          <Text style={styles.postTitle}>{value.title}</Text>
          <View style={styles.authorRow}><View style={styles.avatar}><Text style={styles.avatarText}>{[...value.nickname][0]}</Text></View>
            <View><Text style={styles.author}>{value.nickname}</Text><Text style={styles.meta}>{new Date(value.publishedAt).toLocaleDateString('ko-KR')}</Text></View></View>
          <View style={styles.bodyBlocks}>{splitCommunityBody(normalizeCommunityBody(value.body ?? '', value.images), value.images).map((block, index) => block.type === 'text'
            ? !!block.text && <Text key={index} selectable style={styles.bodyText}>{block.text}</Text>
            : <Image key={index} source={{ uri: communityImageUrl(connection.apiUrl, block.image.url) }}
              style={[styles.postImage, { width: block.image.width / PixelRatio.get(), aspectRatio: block.image.width / block.image.height }]} resizeMode="contain" />)}</View>
          <StickerRow items={value.stickers} />
        </>}
        <View style={styles.reactions}><Pressable accessibilityRole="button" accessibilityLabel={value.liked ? '공감 취소' : '공감'}
          accessibilityState={{ selected: value.liked, disabled: action.busy || value.mine || value.locked }} disabled={action.busy || value.mine || value.locked}
          style={styles.reaction} onPress={() => connection.reader
            ? void action.run(signal => setCommunityLike(connection.client, value.id, !value.liked, signal), () => post.retry()) : login(app)}>
          <Icon name="heart" size={19} color={value.liked ? colors.green : colors.muted} /><Text style={[styles.meta, value.liked && styles.selectedText]}>공감 {value.likeCount}</Text>
        </Pressable><Text style={styles.meta}>· 댓글 {value.commentCount}</Text></View>
        {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
        {showComments && <><Text style={styles.commentHeading}>댓글</Text>
          <QueryStatus busy={comments.busy && !comments.data} error={comments.error} retry={comments.retry} />
          {comments.data?.items.map(item => <View key={item.id} style={styles.commentRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{[...item.nickname][0]}</Text></View>
            <View style={s.grow}><View style={styles.rowBetween}><Text style={styles.author}>{item.nickname}</Text>
              {item.mine && <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel="댓글 수정" disabled={action.busy} style={styles.textButton} onPress={() => compose(item)}><Icon name="edit" size={16} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="댓글 삭제" disabled={action.busy} style={styles.textButton} onPress={() => removeComment(item)}><Icon name="trash" size={16} color={colors.muted} /></Pressable></View>}</View>
              {item.locked ? <Pressable accessibilityRole="button" style={styles.lockedComment} onPress={() => setConfirm({
                title: '스포일러 댓글을 보시겠습니까?', perform: () => { setConfirm(null); setRevealIds(ids => [...ids, item.id]); },
              })}><Icon name="lock" size={15} /><Text style={styles.linkText}>스포일러 · 내용 보기</Text></Pressable>
                : <>{item.body && <Text selectable style={styles.commentBody}>{item.body}</Text>}<StickerRow items={item.stickers} /></>}
              <Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</Text>
            </View>
          </View>)}
          {comments.ready && !comments.data?.items.length && <EmptyState compact title="아직 댓글이 없습니다." />}
          <Pager page={page} hasNext={comments.data?.hasNext ?? false} busy={comments.busy} onChange={next => { setPage(next); setRevealIds([]); }} />
        </>}
      </>}
    </ScrollView>
    {showComments && <View style={styles.commentFooter}><Pressable accessibilityRole="button" accessibilityLabel="댓글 쓰기" style={styles.commentEntry} onPress={() => compose()}><Text style={styles.placeholder}>댓글을 남겨 주세요.</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="댓글·이모티콘 쓰기" style={styles.roundButton} onPress={() => compose()}><Icon name="edit" color={colors.green} /></Pressable></View>}
    <Confirm title={confirm?.title ?? ''} visible={!!confirm} busy={action.busy} onCancel={() => { if (!action.busy) setConfirm(null); }} onConfirm={() => confirm?.perform()} />
  </View>;
}

/** 스포일러 여부를 글자 색으로만 표시하며 추가 선택창을 열지 않습니다. */
function SpoilerButton({ value, disabled, onChange }: { value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: value, disabled }} disabled={disabled}
    style={styles.spoilerButton} onPress={() => onChange(!value)}>
    <Text style={[styles.spoilerText, value && { color: colors.green }]}>스포일러</Text>
  </Pressable>;
}

/** 댓글을 등록하거나 본인 댓글의 본문·스포일러·스티커를 수정합니다. */
export function CommentComposeScreen() {
  const app = useApp();
  const route = app.route;
  const connection = useConnection();
  const action = useAction();
  const [body, setBody] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const data = useQuery(`${connection.key}:${route.postId}:${route.commentId}`, !!connection.reader && !!route.postId, async signal => {
    const [post, boards, comments] = await Promise.all([
      readCommunityPost(connection.apiUrl, route.postId!, !!route.communityReveal, signal, connection.reader),
      readCommunityBoards(connection.apiUrl, 'topic', signal),
      route.commentId ? readCommunityComments(connection.apiUrl, route.postId!, { page: route.communityPage ?? 1, size: 20,
        revealPost: route.communityReveal, revealIds: [route.commentId] }, signal, connection.reader) : null,
    ]);
    const comment = comments?.items.find(item => item.id === route.commentId);
    if (route.commentId && (!comment || !comment.mine)) throw new Error('수정할 댓글을 찾을 수 없습니다.');
    return { post, stickers: boards.stickers, comment };
  });
  useEffect(() => {
    if (!data.data || initialized) return;
    setBody(data.data.comment?.body ?? ''); setSpoiler(data.data.comment?.hasSpoiler ?? false);
    setSelected(data.data.comment?.stickers.map(item => item.id) ?? []); setInitialized(true);
  }, [data.data, initialized]);
  if (connection.ready && !connection.reader) return <LoginRequired />;
  function submit() {
    const input = { body: normalizeCommunityText(body) || null, hasSpoiler: spoiler, spoilerChapterId: null, stickerIds: selected };
    void action.run(signal => route.commentId ? updateCommunityComment(connection.client, route.commentId, input, signal)
      : createCommunityComment(connection.client, route.postId!, input, signal), () => app.back());
  }
  return <View style={styles.composeSheet}><Text style={styles.heading}>{route.commentId ? '댓글 수정' : '댓글 쓰기'}</Text>
    <QueryStatus busy={data.busy && !data.data} error={data.error} retry={data.retry} />
    {data.data && initialized && <>
      <TextInput accessibilityLabel="댓글 내용" value={body} onChangeText={setBody} editable={!action.busy} multiline maxLength={2000}
        placeholder="댓글을 남겨 주세요." placeholderTextColor={colors.muted} style={styles.composeInput} />
      <Text style={[styles.meta, styles.right]}>{[...body].length} / 2,000</Text>
      <SpoilerButton value={spoiler} disabled={action.busy} onChange={setSpoiler} />
      <StickerPicker items={data.data.stickers} selected={selected} limit={4} disabled={action.busy} onChange={setSelected} />
      {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
      <Action label={route.commentId ? '수정하기' : '댓글 등록하기'} style={styles.submitAction}
        disabled={action.busy || (!normalizeCommunityText(body) && !selected.length)} onPress={submit} />
    </>}
  </View>;
}
// #endregion

// #region 게시글 작성과 임시저장
/** 저장된 초안과 게시글 응답에서 수정 가능한 입력만 추출합니다. */
function postInput(post: CommunityPost): CommunityPostInput {
  return { boardId: post.boardId, workId: post.work?.id ?? null, head: post.head, title: post.title ?? '', body: normalizeCommunityBody(post.body ?? '', post.images),
    hasSpoiler: post.hasSpoiler, spoilerChapterId: post.spoiler?.id ?? null, images: post.images.map(({ url, width, height }) => ({ url, width, height })),
    stickerIds: post.stickers.map(item => item.id) };
}

/** 진입한 게시판에서 글을 작성하며 해당 회원·게시판의 기기 초안만 불러옵니다. */
export function WritePostScreen({ route }: { route: Route }) {
  const app = useApp();
  const connection = useConnection();
  const action = useAction();
  const [form, setForm] = useState<CommunityPostInput | null>(null);
  const bodySelection = useRef<CommunityBodySelection>({ start: 0, end: 0 });
  const bodyInputs = useRef(new Map<number, TextInputInstance>());
  const [bodyCaret, setBodyCaret] = useState<{ index: number; selection: CommunityBodySelection } | null>(null);
  const [saved, setSaved] = useState(false);
  const [choosingWork, setChoosingWork] = useState(!route.postId);
  const [search, setSearch] = useState('');
  const [workPage, setWorkPage] = useState(1);
  const workQuery = useSearch(search);
  const [selectedWork, setSelectedWork] = useState<CommunityWork | null>(null);
  const [localDraft, setLocalDraft] = useState<CommunityPostInput | null>(null);
  const [draftPrompt, setDraftPrompt] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const scope = { apiUrl: connection.apiUrl, memberId: connection.state.member?.id ?? '', boardId: route.boardId ?? '' };
  const data = useQuery(`${connection.key}:${route.boardId}:${route.postId}:editor`, !!connection.reader, async signal => {
    const [boards, post, draft] = await Promise.all([
      readCommunityBoards(connection.apiUrl, route.mode ?? 'work', signal), route.postId
        ? readCommunityPost(connection.apiUrl, route.postId, true, signal, connection.reader)
        : Promise.resolve(null), route.postId ? Promise.resolve(null) : loadLocalCommunityDraft(AsyncStorage, scope),
    ]);
    if (post && !post.mine) throw new Error('본인이 작성한 글만 수정할 수 있습니다.');
    const board = boards.items.find(item => item.id === route.boardId);
    if (!board) throw new Error('게시판을 찾을 수 없습니다.');
    return { board, stickers: boards.stickers, post, draft };
  });
  useLayoutEffect(() => {
    setForm(null); setBodyCaret(null); setLocalDraft(null); setDraftPrompt(false); setDraftLoaded(false); setSaved(false); setSelectedWork(null);
  }, [connection.client, connection.state.generation, route.boardId, route.postId]);
  useLayoutEffect(() => {
    if (!bodyCaret) return;
    bodyInputs.current.get(bodyCaret.index)?.focus();
    const frame = requestAnimationFrame(() => setBodyCaret(null));
    return () => cancelAnimationFrame(frame);
  }, [bodyCaret]);
  useEffect(() => {
    if (!data.data || form) return;
    const { board, post, draft } = data.data;
    const initial = post ? postInput(post) : { boardId: board.id, workId: board.work?.id ?? null,
      head: board.heads[0], title: '', body: '', hasSpoiler: false, spoilerChapterId: null, images: [], stickerIds: [] };
    setForm(initial); bodySelection.current = { start: initial.body.length, end: initial.body.length };
    setSelectedWork(post?.work ?? null); setChoosingWork(!post); setLocalDraft(draft); setDraftPrompt(!!draft);
  }, [data.data, form]);
  const board = data.data?.board;
  const works = useQuery(`${connection.key}:${workQuery}:${workPage}:promotion-work`, !!connection.reader && choosingWork && !!workQuery,
    signal => readCommunityWorks(connection.apiUrl, { query: workQuery, page: workPage, size: 20 }, signal));
  const restoredWork = useQuery(`${connection.key}:${form?.workId}:draft-work`, !!connection.reader && board?.type === 'promotion'
    && !!form?.workId && selectedWork?.id !== form.workId, signal => fetchWorkDetail(connection.apiUrl, form!.workId!, signal));
  const linkedWork = selectedWork?.id === form?.workId ? selectedWork : restoredWork.data;
  const bodyBlocks = form ? splitCommunityBody(form.body, form.images) : [];
  const bodyLength = form ? communityBodyTextLength(form.body, form.images) : 0;
  function change(patch: Partial<CommunityPostInput>) { setForm(previous => previous ? { ...previous, ...patch } : previous); setSaved(false); action.clear(); }
  /** 이미지 경계에서 삭제 키를 누르면 인접한 한 장을 지우고 합쳐진 본문에 커서를 돌려놓습니다. */
  function removeImageAtCursor(index: number, key: string): boolean {
    if (!form || (key !== 'Backspace' && key !== 'Delete')) return false;
    const block = bodyBlocks[index];
    const selection = bodySelection.current;
    if (selection.start < block.start || selection.end > block.end) return false;
    const content = removeCommunityBodyImage(form.body, form.images, selection, key);
    if (!content) return false;
    const blocks = splitCommunityBody(content.body, content.images);
    const targetIndex = blocks.findIndex(item => item.type === 'text' && item.start <= content.selection.start && item.end >= content.selection.end);
    const offset = content.selection.start - blocks[targetIndex].start;
    bodySelection.current = content.selection;
    change({ body: content.body, images: content.images });
    setBodyCaret({ index: targetIndex, selection: { start: offset, end: offset } });
    return true;
  }
  function saveDraft() {
    if (!form) return;
    void action.run(() => saveLocalCommunityDraft(AsyncStorage, scope, form), value => {
      setLocalDraft(value); setDraftLoaded(true); setSaved(true);
    });
  }
  function submit() {
    if (!form) return;
    void action.run(signal => route.postId ? updateCommunityPost(connection.client, route.postId, form, signal)
      : createCommunityPost(connection.client, form, signal), post => {
      if (route.postId) app.back();
      else {
        // 등록 성공 후 초안 정리에 실패해도 같은 글을 다시 전송하지 않습니다.
        if (draftLoaded) void deleteLocalCommunityDraft(AsyncStorage, scope).catch(error => console.warn('등록한 글의 로컬 초안을 삭제하지 못했습니다.', error));
        app.navigate({ screen: 'post', postId: post.id, boardId: post.boardId, mode: post.boardType }, false, true);
      }
    });
  }
  function addImage() {
    if (!form || form.images.length >= 3) return;
    const insertion = { ...bodySelection.current };
    void action.run(async signal => {
      const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
      if (selection.canceled || signal.aborted) return null;
      const image = selection.assets[0];
      if (!image.mimeType || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) throw new Error('PNG·JPEG·WebP 이미지를 선택해 주세요.');
      const size = image.file?.size ?? image.fileSize;
      if (size === undefined) throw new Error('이미지 크기를 확인할 수 없습니다. 다른 이미지를 선택해 주세요.');
      if (size > 2 * 1024 * 1024) throw new Error('이미지는 2MB 이하로 선택해 주세요.');
      const context = ImageManipulator.manipulate(image.uri);
      if (Math.max(image.width, image.height) > 1024) context.resize(image.width >= image.height ? { width: 1024 } : { height: 1024 });
      const rendered = await context.renderAsync();
      const output = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
      rendered.release(); context.release();
      if (!output.base64) throw new Error('이미지를 준비하지 못했습니다.');
      if (signal.aborted) return null;
      const item = await uploadCommunityImage(connection.client, output.base64, 'image/png', signal);
      return insertCommunityBodyImage(form.body, form.images, insertion, item);
    }, result => {
      if (!result) return;
      bodySelection.current = result.selection;
      change({ body: result.body, images: result.images });
    });
  }
  if (connection.state.status === 'error' || connection.ready && !connection.reader) return <LoginRequired />;
  return <View style={styles.screen}>
    <ScrollView style={s.grow} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.writeContent}>
      <QueryStatus busy={data.busy && !data.data} error={data.error} retry={data.retry} />
      {data.data && form && <>
        <View style={styles.contextRow}><Text style={styles.contextLabel}>{board?.name}</Text></View>
        {board?.type === 'promotion' && <>
          {choosingWork ? <View style={styles.promotionSearch}><CommunitySearch standalone placeholder="홍보할 작품 검색" value={search} onChange={value => { setSearch(value); setWorkPage(1); }} />
            {!!workQuery && <>
              <QueryStatus busy={works.busy} error={works.error} retry={works.retry} />
              {!works.busy && works.data?.items.map(({ work }) => <WorkSummary key={work.id} work={work}
                onPress={() => { change({ workId: work.id, spoilerChapterId: null }); setSelectedWork(work); setChoosingWork(false); }} />)}
              {works.ready && !works.data?.items.length && <EmptyState compact title="검색한 작품이 없습니다." />}
              <Pager page={workPage} hasNext={works.data?.hasNext ?? false} busy={works.busy} onChange={setWorkPage} />
            </>}
          </View> : <>
            <QueryStatus busy={restoredWork.busy} error={restoredWork.error} retry={restoredWork.retry} />
            {linkedWork && <WorkSummary work={linkedWork} onPress={action.busy || route.postId ? undefined : () => {
              change({ workId: null, spoilerChapterId: null }); setSelectedWork(null); setChoosingWork(true); setSearch(''); setWorkPage(1);
            }} />}
          </>}
        </>}
        {board && board.heads.length > 1 && <View style={styles.chips}>{board.heads.map(value => <Pressable key={value} accessibilityRole="radio"
          accessibilityState={{ checked: form.head === value }} disabled={action.busy} style={[styles.chip, form.head === value && styles.chipSelected]}
          onPress={() => change({ head: value })}><Text style={styles.chipText}>{heads[value]}</Text></Pressable>)}</View>}
        <TextInput accessibilityLabel="게시글 제목" value={form.title} onChangeText={title => change({ title })} editable={!action.busy} maxLength={100}
          placeholder="제목을 입력해 주세요." placeholderTextColor={colors.muted} style={styles.postTitleInput} />
        <View style={styles.bodyEditor}>{bodyBlocks.map((block, index) => block.type === 'text'
          ? <TextInput key={index} accessibilityLabel={index === 0 ? '게시글 본문' : `이미지 뒤 본문 ${index / 2}`} value={block.text}
            ref={input => { if (input) bodyInputs.current.set(index, input); else bodyInputs.current.delete(index); }}
            selection={bodyCaret?.index === index ? bodyCaret.selection : undefined}
            onChangeText={text => change({ body: form.body.slice(0, block.start) + text + form.body.slice(block.end) })}
            onSelectionChange={({ nativeEvent }) => {
              if (bodyCaret && (bodyCaret.index !== index || bodyCaret.selection.start !== nativeEvent.selection.start || bodyCaret.selection.end !== nativeEvent.selection.end)) return;
              bodySelection.current = { start: block.start + nativeEvent.selection.start, end: block.start + nativeEvent.selection.end };
            }}
            onKeyPress={event => { if (removeImageAtCursor(index, event.nativeEvent.key)) event.preventDefault(); }}
            editable={!action.busy} multiline maxLength={Math.max(0, 10000 - (bodyLength - [...block.text].length))}
            placeholder={index === 0 && !form.images.length ? '이야기를 들려주세요.' : ''} placeholderTextColor={colors.muted}
            style={[styles.postBodyInput, index === bodyBlocks.length - 1 && styles.bodyEndInput]} />
          : <Image key={index} source={{ uri: communityImageUrl(connection.apiUrl, block.image.url) }}
            style={[styles.attachedImage, { width: block.image.width / PixelRatio.get(), aspectRatio: block.image.width / block.image.height }]} resizeMode="contain" />)}</View>
        {stickersOpen ? <StickerPicker items={data.data.stickers} selected={form.stickerIds} limit={8} disabled={action.busy} onChange={stickerIds => change({ stickerIds })} />
          : <StickerRow items={form.stickerIds.map(id => data.data!.stickers.find(item => item.id === id)!)} />}
        {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
      </>}
    </ScrollView>
    {form && <><View style={styles.writeStatus}>
      <SpoilerButton value={form.hasSpoiler} disabled={action.busy} onChange={hasSpoiler => change({ hasSpoiler, spoilerChapterId: null })} />
      <Text style={styles.meta}>{bodyLength.toLocaleString('ko-KR')} / 10,000</Text>
    </View><View style={styles.writeToolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="이미지 첨부" disabled={action.busy || form.images.length >= 3} onPress={addImage} style={styles.toolbarButton}>
        <Icon name="image" size={21} /><Text style={styles.meta}>{form.images.length} / 3</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="이모티콘 선택" disabled={action.busy} onPress={() => setStickersOpen(!stickersOpen)} style={styles.toolbarButton}>
        <Text style={[styles.linkText, stickersOpen && styles.selectedText]}>이모티콘</Text></Pressable>
      {!route.postId && <Pressable accessibilityRole="button" accessibilityLabel={saved ? '임시저장됨' : '임시저장'} disabled={action.busy || !board || saved}
        onPress={saveDraft} style={styles.toolbarButton}>{saved && <Icon name="check" size={16} color={colors.green} />}<Text style={[styles.linkText, saved && styles.selectedText]}>임시저장</Text></Pressable>}
      {!route.postId && localDraft && <Pressable accessibilityRole="button" accessibilityLabel="임시저장 삭제" disabled={action.busy} style={styles.toolbarButton} onPress={() => setDiscard(true)}><Icon name="trash" size={18} /></Pressable>}
    </View><View style={styles.submitFooter}><Action label={route.postId ? '수정하기' : '등록하기'} style={styles.submitAction}
      disabled={action.busy || !board || !normalizeCommunityText(form.title) || !normalizeCommunityText(form.body) || (board.type === 'promotion' && !form.workId)} onPress={submit} /></View></>}
    <Modal visible={draftPrompt} transparent animationType="none" onRequestClose={() => setDraftPrompt(false)}>
      <View style={styles.backdrop}><ModalPanel visible={draftPrompt} style={styles.dialog}>
        <Text style={styles.heading}>임시저장한 글을 불러오시겠습니까?</Text>
        <View style={styles.dialogActions}><Action compact tone="quiet" label="새 글 쓰기" onPress={() => setDraftPrompt(false)} />
          <Action compact label="불러오기" onPress={() => {
            const restored = { ...localDraft!, body: normalizeCommunityBody(localDraft!.body, localDraft!.images) };
            setForm(restored); setChoosingWork(!restored.workId); bodySelection.current = { start: restored.body.length, end: restored.body.length };
            setDraftLoaded(true); setSaved(true); setDraftPrompt(false);
          }} /></View>
      </ModalPanel></View>
    </Modal>
    <Confirm title="임시저장한 글을 삭제하시겠습니까?" visible={discard} busy={action.busy} onCancel={() => { if (!action.busy) setDiscard(false); }}
      onConfirm={() => void action.run(() => deleteLocalCommunityDraft(AsyncStorage, scope), () => {
        setLocalDraft(null); setDraftLoaded(false); setSaved(false); setDiscard(false);
      })} />
  </View>;
}
// #endregion

// #region 게시글 관리와 신고
/** 본인 글에는 수정·삭제를, 다른 회원의 글에는 신고를 제공합니다. */
export function PostMenuScreen() {
  const app = useApp();
  const connection = useConnection();
  const action = useAction();
  const [deleting, setDeleting] = useState(false);
  const postId = app.route.postId ?? app.baseRoute.postId;
  const data = useQuery(`${connection.key}:${postId}:menu`, connection.ready && !!postId,
    signal => readCommunityPost(connection.apiUrl, postId!, false, signal, connection.reader));
  return <View style={styles.menuSheet}><Text style={styles.heading}>{deleting ? '게시글을 삭제하시겠습니까?' : '게시글 메뉴'}</Text>
    <QueryStatus busy={data.busy && !data.data} error={data.error} retry={data.retry} />
    {data.data && (deleting ? <View style={styles.dialogActions}><Action tone="quiet" compact label="취소" disabled={action.busy} onPress={() => setDeleting(false)} />
      <Action compact label="삭제" disabled={action.busy} onPress={() => void action.run(signal => deleteCommunityPost(connection.client, postId!, signal), () =>
        app.returnToCommunityBoard({ mode: data.data!.boardType, boardId: data.data!.boardId, boardTitle: data.data!.boardName }))} /></View>
      : data.data.mine ? <>
        <Pressable accessibilityRole="button" style={styles.menuRow} onPress={() => app.navigate({ screen: 'writePost', postId, mode: data.data!.boardType, boardId: data.data!.boardId })}><Icon name="edit" /><Text style={styles.bodyText}>수정하기</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.menuRow} onPress={() => setDeleting(true)}><Icon name="trash" color={colors.red} /><Text style={[styles.bodyText, { color: colors.red }]}>삭제하기</Text></Pressable>
      </> : <Pressable accessibilityRole="button" disabled={data.data.reported} style={styles.menuRow}
        onPress={() => connection.reader ? app.navigate({ screen: 'report', postId }) : login(app)}><Icon name="alert" color={colors.brown} /><Text style={styles.bodyText}>{data.data.reported ? '신고됨' : '신고하기'}</Text></Pressable>)}
    {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
  </View>;
}

/** 신고 사유와 선택 입력을 전송한 뒤 게시글로 돌아옵니다. */
export function ReportScreen() {
  const app = useApp();
  const { state, client } = useMemberAuth();
  const action = useAction();
  const [reason, setReason] = useState<CommunityReportReason | null>(null);
  const [detail, setDetail] = useState('');
  if (state.status !== 'authenticated') return <LoginRequired />;
  return <View style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.reportContent}>
    <Text style={styles.heading}>신고 사유를 선택해 주세요</Text>
    <View accessibilityRole="radiogroup" style={styles.reportOptions}>{reasons.map(([value, label]) => <Pressable key={value} accessibilityRole="radio"
      accessibilityState={{ checked: reason === value }} disabled={action.busy} style={styles.reportOption} onPress={() => setReason(value)}>
      <View style={[styles.radio, reason === value && styles.radioSelected]} /><Text style={styles.bodyText}>{label}</Text></Pressable>)}</View>
    <Text style={styles.fieldLabel}>추가 내용 · 선택 사항</Text><TextInput accessibilityLabel="신고 추가 내용" value={detail} onChangeText={setDetail}
      editable={!action.busy} multiline maxLength={500} placeholder="추가 내용을 입력해 주세요." style={styles.detailsInput} />
    {!!action.error && <Text accessibilityRole="alert" style={s.error}>{action.error}</Text>}
  </ScrollView><View style={styles.submitFooter}><Action label="신고하기" style={styles.submitAction} disabled={action.busy || !reason || !app.baseRoute.postId}
    onPress={() => void action.run(signal => reportCommunityPost(client, app.baseRoute.postId!, reason!, normalizeCommunityText(detail), signal), () => app.back())} /></View></View>;
}
// #endregion

// #region 시안 배치
/** 초록 강조색과 시안의 목록·본문·하단 작성 도구를 유지합니다. */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heading: { ...s.text, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: '700', flexShrink: 1 },
  bodyText: { ...s.text, color: colors.ink, fontSize: 15, lineHeight: 25 },
  meta: { ...s.text, color: colors.muted, fontSize: 12, lineHeight: 19 },
  category: { ...s.text, color: colors.green, fontWeight: '700', fontSize: 12, lineHeight: 20 },
  linkText: { ...s.text, color: colors.green, fontSize: 13, lineHeight: 20 },
  selectedText: { color: colors.green, fontWeight: '700' },
  right: { textAlign: 'right' },
  tabs: { height: 48, paddingHorizontal: 20, flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  tabLabel: { height: 47, paddingHorizontal: 6, borderBottomWidth: 3, borderColor: 'transparent', justifyContent: 'center' },
  selectedTab: { borderColor: colors.green },
  tabText: { ...s.text, color: colors.muted, fontSize: 14, fontWeight: '500' },
  communityContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 },
  communityHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  headingButton: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  compactSearch: { flex: 1, minWidth: 80, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 10 },
  standaloneSearch: { flex: 0 },
  compactSearchInput: { ...s.text, flex: 1, minWidth: 0, paddingVertical: 7, paddingHorizontal: 0, color: colors.ink, fontSize: 12, lineHeight: 18 },
  clearSearch: { minWidth: 25, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  createDialog: { maxHeight: '80%', gap: 12 },
  createList: { flexGrow: 0, maxHeight: 420 },
  createWorkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: colors.line },
  topicBoard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12 },
  utilityRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginBottom: 6 },
  textButton: { minHeight: 40, minWidth: 32, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  roundButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' },
  workSection: { paddingTop: 10 },
  boardRow: { paddingTop: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.line },
  latestPost: { gap: 8, paddingBottom: 8 },
  workSummary: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12 },
  cover: { width: 48, height: 68, borderRadius: 4, backgroundColor: colors.pale },
  workTitle: { ...s.text, color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  postRow: { paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.line, gap: 8 },
  postRowTitle: { ...s.text, fontSize: 16, lineHeight: 24, color: colors.ink, fontWeight: '600' },
  bodyPreview: { ...s.text, fontSize: 14, lineHeight: 23, color: colors.ink, marginVertical: 4 },
  promotionCard: { backgroundColor: colors.pale, borderRadius: 16, paddingHorizontal: 16, marginVertical: 10, borderBottomWidth: 0 },
  previewImage: { width: '100%', height: 150, borderRadius: 8, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.line },
  chipSelected: { backgroundColor: colors.pale, borderColor: colors.green },
  chipText: { ...s.text, fontSize: 13, color: colors.green },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: colors.line, minHeight: 48, marginTop: 10 },
  searchInput: { ...s.text, paddingHorizontal: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line, color: colors.ink },
  pager: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, paddingVertical: 16 },
  problem: { paddingVertical: 20, paddingHorizontal: 8, gap: 12, alignItems: 'center' },
  postContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20 },
  workPanel: { paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.pale, marginBottom: 22 },
  postTitle: { ...s.text, color: colors.ink, fontSize: 23, lineHeight: 33, fontWeight: '700', marginTop: 12 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 22 },
  author: { ...s.text, color: colors.ink, fontSize: 13, lineHeight: 21, fontWeight: '700' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E2EDF3', alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...s.text, color: colors.green, fontSize: 13, fontWeight: '700' },
  bodyBlocks: { gap: 12 },
  postImage: { maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 10 },
  locked: { alignItems: 'center', gap: 15, paddingVertical: 32 },
  reactions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line },
  reaction: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 },
  commentHeading: { ...s.text, color: colors.ink, fontSize: 16, fontWeight: '700', lineHeight: 24, marginVertical: 12 },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.line },
  commentBody: { ...s.text, fontSize: 14, lineHeight: 23, color: colors.ink, marginVertical: 7 },
  lockedComment: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 48, paddingVertical: 8 },
  commentFooter: { minHeight: 70, paddingHorizontal: 20, flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderColor: colors.line },
  commentEntry: { flex: 1, minHeight: 42, paddingHorizontal: 16, borderRadius: 21, backgroundColor: colors.pale, justifyContent: 'center' },
  placeholder: { ...s.text, color: colors.muted, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#0006', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, gap: 20 },
  dialogActions: { flexDirection: 'row', gap: 14, alignItems: 'center', justifyContent: 'flex-end', paddingTop: 12 },
  composeSheet: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 },
  composeInput: { ...s.text, minHeight: 94, marginTop: 18, marginBottom: 6, padding: 14, textAlignVertical: 'top', color: colors.ink, fontSize: 14, lineHeight: 22, borderWidth: 1, borderColor: colors.line, borderRadius: 14 },
  fieldLabel: { ...s.text, color: colors.green, fontSize: 13, fontWeight: '700', marginVertical: 12 },
  stickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  sticker: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  removeBadge: { position: 'absolute', top: 0, right: 0, borderRadius: 12, padding: 3, backgroundColor: colors.pale },
  stickerChoices: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingVertical: 5 },
  stickerChoice: { flex: 1, gap: 5, alignItems: 'center' },
  spoilerButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 3 },
  spoilerText: { ...s.text, color: '#222', fontSize: 13, lineHeight: 20 },
  promotionSearch: { marginVertical: 12 },
  writeContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  contextRow: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: colors.pale },
  contextLabel: { ...s.text, fontSize: 13, lineHeight: 21, fontWeight: '700', color: colors.green },
  postTitleInput: { ...s.text, color: colors.ink, fontSize: 21, fontWeight: '700', minHeight: 56, paddingVertical: 12, marginTop: 8, borderBottomWidth: 1, borderColor: colors.line },
  bodyEditor: { flexGrow: 1, minHeight: 210, paddingTop: 12 },
  postBodyInput: { ...s.text, minHeight: 48, color: colors.ink, fontSize: 15, lineHeight: 24, paddingHorizontal: 0, paddingVertical: 8, textAlignVertical: 'top' },
  bodyEndInput: { flexGrow: 1 },
  attachedImage: { maxWidth: '100%', alignSelf: 'flex-start', marginVertical: 6, borderRadius: 8, backgroundColor: colors.pale },
  writeStatus: { minHeight: 44, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  writeToolbar: { minHeight: 46, marginHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderColor: colors.line },
  toolbarButton: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 3 },
  submitFooter: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderColor: colors.line },
  submitAction: { marginTop: 0, marginBottom: 0, minHeight: 44, borderRadius: 24 },
  menuSheet: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 14 },
  menuRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 18, borderBottomWidth: 1, borderColor: colors.line },
  reportContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 },
  reportOptions: { marginTop: 18, marginBottom: 20 },
  reportOption: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line },
  radioSelected: { borderColor: colors.green, backgroundColor: colors.green },
  detailsInput: { ...s.text, minHeight: 120, padding: 15, textAlignVertical: 'top', color: colors.ink, fontSize: 14, lineHeight: 22, borderRadius: 14, backgroundColor: colors.pale },
});
// #endregion
