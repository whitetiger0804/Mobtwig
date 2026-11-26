// #region 의존성 가져오기
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from './appState';
import { useApiUrl } from './serverConnection';
import { readingFonts } from './readingFonts';
import { fetchChapterText, type ChapterText } from './chapterText';
import { useMemberAuth } from './memberAuth';
import { useWorkProducts } from './useWorkProducts';
import { MemberRequestError } from './memberSession';
import { createBookmark, hasBookmarkAtPosition, listWorkBookmarks, type Bookmark } from './bookmarks';
import { HighlightEditor, highlightColors, useReaderHighlights } from './HighlightControls';
import { highlightPieces, isTextBoundary } from './highlights';
import { adjacentMagazinePage, fetchMagazineIssue, fetchMagazinePage, magazineArticle, startMagazinePage,
  type MagazineIssue } from './magazineReader';
import { matchesReadingResume, readReadingProgress, readingSegments, restoreReadingOffset, sameReadingPosition, saveReadingProgress,
  type ReadingPosition, type ReadingProgress } from './readingProgress';
import { EmptyState } from './EmptyState';
import { buildPageTops, classifyPageTouch, pageOf, turnPage, type PageLine } from './readerPages';
import { Action, colors, Icon, IconButton, ModalPanel, s } from './ui';
// #endregion

// #region 독서 화면
/**
 * 본문 독서 도구 또는 앱북의 미디어 배치를 표시합니다.
 *
 * @remarks
 * 본문 화면은 상단 목차·기록·설정과 하단 회차 이동 도구를 유지합니다.
 * 텍스트 위치는 문단 경계로, 매거진 위치는 호 기준 쪽 번호로 저장·복원합니다.
 * 이전/다음은 공개 목차의 이웃이며 경계에서 비활성화합니다.
 *
 * @returns 현재 독서 종류에 맞는 본문 또는 미디어 화면입니다.
 */
export function ReadingScreen() {
  const app = useApp();
  const { state: auth } = useMemberAuth();
  const apiUrl = useApiUrl();
  const owner = [apiUrl, auth.generation, auth.status, auth.member?.id].join(':');
  if (auth.status === 'checking') return <ActivityIndicator accessibilityLabel="로그인 확인 중" color={colors.green} />;
  if (app.baseRoute.screen === 'media') return <MediaScreen />;
  if (app.baseRoute.kind === 'magazine') return <MagazineReader key={owner} />;
  return <TextReader key={owner} />;
}

/** 열람 권한 오류는 로그인 또는 기존 상품 상세로 연결합니다. */
function ReadingAccessActions({ status, workId }: { status: number | null; workId?: string }) {
  const app = useApp();
  const { state: auth } = useMemberAuth();
  return <>
    {(status === 401 || status === 402 && auth.status !== 'authenticated') && <Action label="로그인" onPress={() => app.navigate({ screen: 'login' })} />}
    {status === 402 && workId && <Action label="구매 상태 확인" onPress={() => app.navigate({ screen: 'detail', workId }, false, true)} />}
  </>;
}

/** 원문 응답을 노출하지 않고 미소장·미인증 이유를 안내합니다. */
function readingFailure(failure: unknown): string {
  if (failure instanceof MemberRequestError && failure.status === 402) return '소장하지 않은 자료입니다. 작품 상세에서 구매 상태를 확인해 주십시오.';
  return failure instanceof Error ? failure.message : '본문을 불러오지 못했습니다.';
}

type SaveView = { busy: boolean; problem: 'review' | 'body' | null; message: string; retry: boolean };
type SaveRun = { current: ReadingProgress | null; draft: ReadingPosition | null; busy: boolean; reviewRequired: boolean; write: Promise<boolean> | null };
const emptySaveView: SaveView = { busy: false, problem: null, message: '', retry: false };

/** 저장 위치가 충돌하면 서버 위치로 이동하며, 통신 실패만 재시도를 받습니다. */
function useReadingSave(workId: string | undefined, eligible: boolean, resume?: ReadingPosition, revision?: string | null) {
  const app = useApp();
  const { state: auth, client } = useMemberAuth();
  const enabled = !!workId && eligible && auth.status === 'authenticated';
  const run = useRef<SaveRun | null>(null);
  const [status, setStatus] = useState(emptySaveView);

  async function review() {
    const active = run.current;
    if (!active || !workId || active.busy) return;
    active.busy = true;
    setStatus({ ...emptySaveView, busy: true });
    try {
      const previous = active.current;
      const actual = await readReadingProgress(client, workId);
      if (run.current !== active) return;
      active.current = actual;
      active.reviewRequired = false;
      if (active.draft && actual.state === 'saved' && sameReadingPosition(actual.position, active.draft)) {
        active.draft = null;
        setStatus(emptySaveView);
      } else if (!previous && resume && !matchesReadingResume(actual, resume, revision)
          || active.draft && previous?.revision !== actual.revision) {
        active.draft = null;
        if (actual.position || resume) {
          active.reviewRequired = true;
          app.navigate({ screen: 'reader', kind: actual.kind, workId: actual.workId,
            chapterId: actual.position?.chapterId ?? app.baseRoute.chapterId,
            autoContinue: app.baseRoute.autoContinue,
            ...(actual.position && { resumePosition: actual.position, resumeRevision: actual.revision }) }, false, true);
        }
        setStatus(emptySaveView);
      } else if (active.draft) {
        setStatus({ ...emptySaveView, retry: true, message: '읽기 위치를 저장하지 못했습니다. 다시 시도해 주세요.' });
      } else {
        setStatus(emptySaveView);
      }
    } catch {
      if (run.current === active) setStatus({ ...emptySaveView, problem: 'review', message: '읽기 위치를 확인하지 못했습니다.' });
    } finally {
      active.busy = false;
    }
  }

  useEffect(() => {
    run.current = enabled ? { current: null, draft: null, busy: false, reviewRequired: false, write: null } : null;
    setStatus(emptySaveView);
    if (enabled) void review();
    return () => { run.current = null; };
  }, [enabled, workId, client, auth.generation, resume, revision]);

  async function save(position: ReadingPosition, automatic = false): Promise<boolean> {
    const active = run.current;
    if (!active || !workId || !active.current || active.reviewRequired) return false;
    if (automatic && active.draft && !active.write) return false; // 확인 후 수동 재시도를 기다립니다.
    if (active.busy && !active.write) return false;
    active.draft = position;
    if (active.write) return active.write;
    active.busy = true;
    const task = writePending(active, workId, automatic);
    active.write = task;
    try {
      return await task;
    } finally {
      active.busy = false;
      active.write = null;
    }
  }

  async function writePending(active: SaveRun, slug: string, automatic: boolean): Promise<boolean> {
    while (run.current === active && active.draft) {
      const target = active.draft, current = active.current!;
      active.draft = null;
      if (current.state === 'saved' && sameReadingPosition(current.position, target)) {
        if (!automatic) setStatus(emptySaveView);
        continue;
      }
      setStatus({ ...emptySaveView, busy: true });
      try {
        const result = await saveReadingProgress(client, slug, target, current.revision);
        if (run.current !== active) return false;
        active.current = result;
        setStatus(emptySaveView);
      } catch (error) {
        if (run.current !== active) return false;
        active.draft ??= target;
        active.reviewRequired = true;
        const changed = error instanceof MemberRequestError && error.code === 'CONTENT_CHANGED';
        if (error instanceof MemberRequestError && error.code === 'PROGRESS_CONFLICT') {
          active.busy = false;
          await review();
          return run.current === active && !active.reviewRequired && active.draft === null;
        }
        setStatus({ ...emptySaveView, problem: changed ? 'body' : 'review',
          message: changed ? '본문이 바뀌었습니다. 최신 본문에서 위치를 다시 확인해 주세요.'
            : '저장을 확인하지 못했습니다. 현재 위치를 이 화면에 남겼습니다.' });
        return false;
      }
    }
    return run.current === active;
  }

  const canAutoSave = !!run.current?.current && !run.current.reviewRequired && (!run.current.draft || !!run.current.write);
  return { enabled, canAutoSave, status, review, save, wait: () => run.current?.write };
}

/** 상단 기록 메뉴에서 책갈피 저장·하이라이트 편집·기록 조회를 제공합니다. */
function BookmarkButton({ workId, position, onHighlight, highlightsFailed, refreshHighlights, disabled = false }: {
  workId?: string;
  position: ReadingPosition | null;
  onHighlight: () => void;
  highlightsFailed: boolean;
  refreshHighlights: () => void;
  disabled?: boolean;
}) {
  const app = useApp();
  const { state: auth, client } = useMemberAuth();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  const lookupRun = useRef<AbortController | null>(null);
  const [lookup, setLookup] = useState<{ items: Bookmark[]; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (auth.status !== 'authenticated' || !workId) return;
    const controller = new AbortController();
    lookupRun.current = controller;
    setLookup(null);
    setMessage('');
    void listWorkBookmarks(client, workId, controller.signal).then(items => {
      if (!controller.signal.aborted) setLookup({ items, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setLookup({ items: [], failed: true });
    });
    return () => { controller.abort(); lookupRun.current = null; };
  }, [client, auth.status, workId, attempt]);
  const marked = !disabled && hasBookmarkAtPosition(lookup?.items ?? [], workId, position);
  async function save() {
    const current = position;
    if (!workId || !current || pending.current) return;
    if (auth.status !== 'authenticated') { setOpen(false); app.navigate({ screen: 'login' }); return; }
    const run = lookupRun.current;
    if (!run || !lookup || lookup.failed || marked) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    const active = () => lookupRun.current === run && !run.signal.aborted && client.getSnapshot().generation === auth.generation;
    try {
      const result = await createBookmark(client, workId, current);
      if (!active()) return;
      if (!hasBookmarkAtPosition([result], workId, current)) {
        setMessage('이 위치의 책갈피를 사용할 수 없습니다. 독서 기록에서 확인해 주세요.');
        return;
      }
      setLookup({ items: [result, ...lookup.items.filter(item => item.id !== result.id)], failed: false });
      setOpen(false);
    } catch (error) {
      if (active()) setMessage(error instanceof MemberRequestError && error.status === 409
        ? '본문이 변경되었습니다. 최신 본문을 불러온 뒤 다시 시도해 주세요.' : '책갈피를 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      pending.current = false;
      if (active()) setBusy(false);
    }
  }
  return <>
    <IconButton icon="bookmark" label={marked ? '책갈피가 저장된 위치 · 밑줄과 책갈피 메뉴' : '밑줄과 책갈피 메뉴'}
      selected={marked} filled={marked} onPress={() => setOpen(true)} />
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <View style={styles.magazineBackdrop}>
        <ModalPanel visible={open} style={[styles.magazineContents, { paddingBottom: 22 + insets.bottom }]}>
          <Text style={s.title}>밑줄과 책갈피</Text>
          <Action label="책갈피 저장" loading={busy || auth.status === 'authenticated' && lookup === null}
            disabled={disabled || marked || busy || auth.status === 'checking' || auth.status === 'authenticated' && (lookup === null || lookup.failed)}
            onPress={() => { void save(); }} />
          {lookup?.failed && <>
            <Text accessibilityRole="alert" style={s.error}>책갈피를 불러오지 못했습니다.</Text>
            <Action tone="secondary" label="책갈피 다시 불러오기" onPress={() => setAttempt(value => value + 1)} />
          </>}
          {!!message && <Text accessibilityLiveRegion="polite" style={s.muted}>{message}</Text>}
          <Action tone="secondary" label="하이라이트 만들기" disabled={disabled || busy || auth.status === 'checking'}
            onPress={() => { setOpen(false); onHighlight(); }} />
          {highlightsFailed && <Action tone="secondary" label="하이라이트 다시 불러오기" onPress={refreshHighlights} />}
          <Action tone="secondary" label="밑줄과 책갈피 보기" onPress={() => {
            setOpen(false);
            app.navigate({ screen: 'records', workId });
          }} />
          <Action tone="quiet" label="닫기" onPress={() => setOpen(false)} />
        </ModalPanel>
      </View>
    </Modal>
  </>;
}

/** 명시적으로 연 PNG가 표시된 뒤에만 새 쪽을 저장합니다. */
function MagazineReader() {
  const app = useApp();
  const apiUrl = useApiUrl();
  const { client, state: auth } = useMemberAuth();
  const memberClient = auth.status === 'authenticated' ? client : undefined;
  const { workId, chapterId, resumePosition, resumeRevision, bookmarkPosition, highlightPosition } = app.baseRoute;
  const opening = highlightPosition ?? bookmarkPosition ?? resumePosition;
  const recordEntry = !!(highlightPosition || bookmarkPosition);
  const [readingStarted, setReadingStarted] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const gestureUntil = useRef(0);
  const [issue, setIssue] = useState<MagazineIssue | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<{ key: string; ratio: number | null } | null>(null);
  const [pageSource, setPageSource] = useState<{ key: string; uri: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<number | null>(null);
  const [resumeAdjusted, setResumeAdjusted] = useState(false);
  const requested = useRef<ReadingPosition | null>(null);
  const leaving = useRef(false);
  const pageRequest = useRef<AbortController | null>(null);
  const target = useRef('');
  const savedPage = useRef('');
  const article = issue && page !== null ? magazineArticle(issue, page) : null;
  const key = issue && article && page !== null ? [issue.workId, page, article.contentVersion, attempt].join(':') : '';
  const position: ReadingPosition | null = article && page !== null ? {
    chapterId: article.chapterId, offset: page, unit: 'page', contentVersion: article.contentVersion, contentHash: null,
  } : null;
  const storage = useReadingSave(workId, !!position, attempt === 0 ? resumePosition : undefined, resumeRevision);
  const highlights = useReaderHighlights(workId, article?.chapterId);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const marked = highlights.items.find(item => item.state === 'available' && item.range?.unit === 'page'
    && item.range.chapterId === article?.chapterId && item.range.contentVersion === article.contentVersion && page !== null
    && item.range.startOffset <= page && page <= item.range.endOffset);
  const ready = !!key && image?.key === key && image.ratio !== null;
  const failed = !!key && image?.key === key && image.ratio === null;

  const startGesture = () => {
    if (ready && !highlightOpen && !app.overlay) gestureUntil.current = Date.now() + 1_500;
  };
  useEffect(() => { gestureUntil.current = 0; }, [key, ready, highlightOpen, app.overlay]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = scroll.current?.getScrollableNode() as unknown as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) startGesture();
    };
    node.addEventListener('wheel', startGesture, { passive: true });
    node.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('wheel', startGesture); node.removeEventListener('keydown', onKey); };
  }, [key, ready, highlightOpen, app.overlay]);

  useEffect(() => {
    if (!workId) { setError('열람할 매거진을 선택해 주세요.'); return; }
    const controller = new AbortController();
    const wanted = requested.current ?? opening;
    fetchMagazineIssue(apiUrl, workId, controller.signal, memberClient).then(current => {
      if (controller.signal.aborted) return;
      const selected = startMagazinePage(current, wanted?.chapterId ?? chapterId, wanted);
      const selectedArticle = selected === null ? null : magazineArticle(current, selected);
      setResumeAdjusted(attempt === 0 && !!opening && (selected !== opening.offset
        || selectedArticle?.contentVersion !== opening.contentVersion));
      setIssue(current);
      setPage(selected ?? (attempt > 0 ? startMagazinePage(current) : null));
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setError(readingFailure(failure));
        setAccessError(failure instanceof MemberRequestError ? failure.status : null);
      }
    });
    return () => controller.abort();
  }, [apiUrl, workId, chapterId, opening, attempt, memberClient]);

  useLayoutEffect(() => {
    target.current = key;
    scrollY.current = 0;
    return () => { target.current = ''; };
  }, [key]);

  useEffect(() => {
    if (!key || !issue || page === null) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageSource(null); setPageError(null); setAccessError(null);
    fetchMagazinePage(apiUrl, issue, page, controller.signal, memberClient).then(uri => {
      if (!controller.signal.aborted && target.current === key) setPageSource({ key, uri });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || target.current !== key) return;
      setPageError(readingFailure(failure));
      setAccessError(failure instanceof MemberRequestError ? failure.status : null);
      setImage({ key, ratio: null });
    });
    return () => controller.abort();
  }, [apiUrl, issue, page, key, memberClient]);

  useEffect(() => {
    if (!key || ready || failed) return;
    const timer = setTimeout(() => {
      if (target.current === key) {
        pageRequest.current!.abort();
        target.current = '';
        setImage({ key, ratio: null });
      }
    }, 15_000);
    return () => clearTimeout(timer);
  }, [key, ready, failed]);

  useEffect(() => {
    if (!ready || !position || highlightOpen || recordEntry && !readingStarted
        || !storage.canAutoSave || savedPage.current === key) return;
    savedPage.current = key;
    void storage.save(position, true);
  }, [ready, key, storage.canAutoSave, highlightOpen, recordEntry, readingStarted]);

  function turn(next: number) {
    setContentsOpen(false);
    if (page === next || loadingImage || highlightOpen || storage.status.busy) return;
    setReadingStarted(true);
    setResumeAdjusted(false);
    target.current = '';
    setImage(null);
    setPage(next);
  }

  function reload() {
    requested.current = position;
    target.current = '';
    setError(null);
    setIssue(null);
    setPage(null);
    setImage(null);
    setAttempt(value => value + 1);
  }

  function leave(next: () => void) {
    if (leaving.current) return;
    const pending = storage.wait();
    if (!pending) { next(); return; }
    leaving.current = true;
    void pending.then(saved => { if (saved) next(); }).finally(() => { leaving.current = false; });
  }
  useLayoutEffect(() => app.registerBackHandler(leave), [app.registerBackHandler, leave]);

  const previous = issue && page !== null ? adjacentMagazinePage(issue, page, -1) : null;
  const next = issue && page !== null ? adjacentMagazinePage(issue, page, 1) : null;
  const loadingImage = !!key && !ready && !failed;
  const canTurn = !loadingImage && !storage.status.busy;
  return <View style={styles.magazine}>
    <View style={styles.readerHeader}>
      <IconButton icon="back" label="매거진에서 돌아가기" onPress={app.back} />
      <View style={styles.magazineHeaderSpace} />
      <IconButton icon="share" label="작품 공유" disabled={!issue}
        onPress={() => issue && app.navigate({ screen: 'share', workId, shareWorkTitle: issue.title })} />
      <IconButton icon="list" label="매거진 목차" disabled={!issue?.articles.length} onPress={() => setContentsOpen(true)} />
      <BookmarkButton key={workId} workId={workId} disabled={!ready} position={ready ? position : null}
        highlightsFailed={highlights.failed} refreshHighlights={highlights.refresh} onHighlight={() => {
          if (highlights.authenticated) setHighlightOpen(true);
          else app.navigate({ screen: 'login' });
        }} />
    </View>
    <ScrollView ref={scroll} key={key ? 'magazine-page:' + key : 'magazine-status'} style={styles.magazineScroll} contentContainerStyle={styles.magazinePage}
      onLayout={() => { gestureUntil.current = 0; }} onContentSizeChange={() => { gestureUntil.current = 0; }}
      onScrollBeginDrag={startGesture} scrollEventThrottle={16} onScroll={event => {
        const y = event.nativeEvent.contentOffset.y;
        const moved = scrollY.current !== y;
        scrollY.current = y;
        if (!moved || !ready || gestureUntil.current < Date.now() || highlightOpen || app.overlay) return;
        gestureUntil.current = Date.now() + 1_500;
        setReadingStarted(true);
      }}
      showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
      {error ? <View style={s.grow}>
        <Text accessibilityRole="alert" style={s.error}>{error}</Text>
        <ReadingAccessActions status={accessError} workId={workId} />
        <Action label="호 다시 불러오기" onPress={reload} />
      </View> : !issue ? <ActivityIndicator color={colors.green} />
        : !article || page === null ? <View>
          <EmptyState title="선택한 쪽을 열 수 없습니다." />
          {!!issue.articles.length && <Action label="첫 기사로 이동" onPress={reload} />}
        </View>
        : <>
          {ready && marked?.color && <Text style={[s.text, { backgroundColor: highlightColors[marked.color], color: colors.ink }]}>하이라이트 표시</Text>}
          {resumeAdjusted && <Text style={s.muted}>저장한 쪽이 변경되어 기사 처음을 표시합니다.</Text>}
          {loadingImage && <ActivityIndicator accessibilityLabel="쪽 불러오는 중" color={colors.green} />}
          {failed ? <View>
            <Text accessibilityRole="alert" style={s.error}>{pageError ?? '쪽을 불러오지 못했습니다. 최신 목차와 쪽을 다시 확인해 주세요.'}</Text>
            <ReadingAccessActions status={accessError} workId={workId} />
            <Action label="쪽 다시 불러오기" onPress={reload} />
          </View> : pageSource?.key === key && <Image key={key} source={{ uri: pageSource.uri }}
            accessibilityLabel={article.title + ' ' + page + '쪽'} resizeMode="contain"
            style={[styles.magazineImage, { aspectRatio: image?.key === key && image.ratio ? image.ratio : 0.72 }]}
            onLoad={event => {
              if (target.current !== key) return;
              const { width, height } = event.nativeEvent.source ?? { width: 0, height: 0 };
              const ratio = width > 0 && height > 0 ? width / height : 0.72;
              setImage({ key, ratio });
            }}
            onError={() => {
              if (target.current !== key) return;
              target.current = '';
              setImage({ key, ratio: null });
            }} />}
        </>}
    </ScrollView>
    {storage.enabled && (storage.status.problem !== null || storage.status.retry) && <View style={styles.readerSave}>
      {!!storage.status.message && <Text accessibilityLiveRegion="polite" style={s.muted}>{storage.status.message}</Text>}
      {storage.status.problem === 'body' ? <Action compact label="최신 쪽 다시 불러오기" onPress={reload} />
        : storage.status.problem === 'review' ? <Action compact label="읽기 위치 다시 확인" onPress={() => void storage.review()} />
        : <Action compact label="현재 쪽 다시 저장" disabled={storage.status.busy || !ready} onPress={() => void storage.save(position!)} />}
    </View>}
    {highlightOpen && ready && workId && position && <HighlightEditor key={key} workId={workId} chapterId={position.chapterId}
      offset={position.offset} contentVersion={position.contentVersion} contentHash={null}
      onSaved={highlights.refresh} onClose={() => setHighlightOpen(false)} />}
    <View style={styles.magazineControls}>
      <IconButton icon="back" label="이전 쪽" iconSize={28} style={styles.magazineTurn} disabled={!canTurn || previous === null} onPress={() => { if (previous !== null) turn(previous); }} />
      <IconButton icon="next" label="다음 쪽" iconSize={28} style={styles.magazineTurn} disabled={!canTurn || next === null} onPress={() => { if (next !== null) turn(next); }} />
    </View>
    <Modal visible={contentsOpen} transparent animationType="none" onRequestClose={() => setContentsOpen(false)}>
      <View style={styles.magazineBackdrop}>
        <ModalPanel visible={contentsOpen} style={styles.magazineContents}>
          <Text style={s.title}>매거진 목차</Text>
          <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
            {issue?.articles.map(item => <Pressable key={item.chapterId} accessibilityRole="button"
              accessibilityState={{ selected: item.chapterId === article?.chapterId, disabled: !canTurn }} disabled={!canTurn}
              style={styles.magazineArticle} onPress={() => turn(item.startPage)}>
              <Text style={s.subtitle}>{item.title}</Text><Text style={s.muted}>{item.startPage}~{item.endPage}쪽</Text>
            </Pressable>)}
          </ScrollView>
          <Action label="목차 닫기" onPress={() => setContentsOpen(false)} />
        </ModalPanel>
      </View>
    </Modal>
  </View>;
}

/** 선택이 바뀌면 요청을 취소하고 이전 본문을 새 회차로 표시하지 않습니다. */
function TextReader() {
  const app = useApp(), apiUrl = useApiUrl();
  const { client, state: auth } = useMemberAuth();
  const memberClient = auth.status === 'authenticated' ? client : undefined;
  const insets = useSafeAreaInsets();
  const { workId, chapterId, resumePosition, resumeRevision, bookmarkPosition, highlightPosition } = app.baseRoute;
  const opening = highlightPosition ?? bookmarkPosition ?? resumePosition;
  const recordEntry = !!(highlightPosition || bookmarkPosition);
  const readingStarted = useRef(false);
  const readingPalette = {
    '크림': { background: '#F7F1E4', text: colors.ink, muted: '#625D50' },
    '연노랑': { background: '#FFF3C7', text: '#3D3526', muted: '#82765D' },
    '연회색': { background: '#ECEEF1', text: '#29323B', muted: '#68717C' },
    '다크': { background: '#233B2F', text: '#F5F1E6', muted: '#C5CEC5' },
  }[app.readingPreferences.theme];
  const bodySize = [13, 15, 17, 19, 21][app.readingPreferences.size];
  const bodyFont = readingFonts[app.readingPreferences.font].family;
  const paged = app.readingPreferences.mode === '책장';
  const lineHeight = bodySize * 1.85;
  const [data, setData] = useState<ChapterText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0), [contentsOpen, setContentsOpen] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [restart, setRestart] = useState(false);
  const [restorationComplete, setRestorationComplete] = useState(false);
  const [viewportProgress, setViewportProgress] = useState(0);
  const [visiblePosition, setVisiblePosition] = useState<ReadingPosition | null>(null);
  const savedChapter = useRef('');
  const storage = useReadingSave(workId, !!data && data.kind !== 'magazine', restart ? undefined : resumePosition, resumeRevision);
  const segments = useMemo(() => readingSegments(data?.body ?? '')
    .filter((part, index) => index > 0 || part.text.trim() !== data?.chapter.title), [data?.body, data?.chapter.title]);
  const highlights = useReaderHighlights(workId, data?.chapter.id);
  const [selectedPart, setSelectedPart] = useState<(typeof segments)[number] | null>(null);
  const autoContinue = app.baseRoute.autoContinue === true;
  const offer = useWorkProducts(autoContinue && data?.kind === 'novel' && data.next ? workId : undefined);
  const [advancing, setAdvancing] = useState(false);
  const [nextError, setNextError] = useState('');
  const continuation = useRef<object | null>(null);
  const endTouch = useRef<{ x: number; y: number } | null>(null);
  const nativeEndDrag = useRef(false);
  const advanceRef = useRef(advanceNext);
  const goPageRef = useRef(goPage);
  /** 화면에 확정된 책장 모드 쪽이며 {@link commitPage}만 스크롤 위치와 함께 바꿉니다. */
  const [page, setPage] = useState<{ tops: number[]; index: number }>({ tops: [0], index: 0 });
  const windowHeight = useWindowDimensions().height;
  const [pageNotice, setPageNotice] = useState('');
  /** 화면 상단 문단의 utf16 오프셋이며 모드·글자 크기 변경의 기준입니다. */
  const visibleOffset = useRef<number | null>(null);
  /** 사용자 입력 전까지 레이아웃이 바뀌어도 다시 맞출 문단 오프셋입니다. */
  const pendingAnchor = useRef<number | null>(null);
  const anchorFrame = useRef<number | null>(null);
  const layoutKey = [paged, bodySize, bodyFont].join(':');
  const lastLayout = useRef(layoutKey);
  const pagesView = useRef<ComponentRef<typeof View>>(null);
  const pagesFrame = useRef({ x: 0, width: 0 });
  const pageTouch = useRef<{ x: number; y: number; at: number } | null>(null);
  const pressStarted = useRef(false);
  const painted = useMemo(() => {
    const current = highlights.items.filter(item => item.state === 'available' && item.range?.unit === 'utf16'
      && item.range.chapterId === data?.chapter.id && item.range.contentVersion === data.contentVersion
      && item.range.contentHash === data.contentHash);
    return segments.map(part => highlightPieces(part.text, part.offset, current));
  }, [segments, highlights.items, data]);
  const geometry = useRef({ y: 0, viewport: 0, height: 0, chapterY: 0, textY: 0 });
  const anchors = useRef(new Map<number, number>());
  /** 문단 Text의 높이이며 onTextLayout이 없는 웹에서 줄 위치를 추정할 때 사용합니다. */
  const paragraphHeights = useRef(new Map<number, number>());
  /** 문단 Text 기준의 실제 줄 위치이며 네이티브 onTextLayout에서 받습니다. */
  const paragraphLines = useRef(new Map<number, PageLine[]>());
  /** 줄 경계에 맞춘 책장 모드 쪽 시작 위치이며 pageIndex와 함께 확정된 값입니다. */
  const pageTops = useRef<number[]>([0]);
  const pageIndex = useRef(0);
  const pageTopsFrame = useRef<number | null>(null);
  /** 직전 쪽 계산에 사용한 줄 배치이며 화면 높이만 바뀌었는지 구분합니다. */
  const linesKey = useRef('');
  /**
   * 사용자 이동·복원·기준 문단 재정렬로 확정한 쪽의 맨 위 줄입니다.
   * 화면 높이만 바뀔 때는 이 줄이 포함된 쪽을 찾고 값을 덮어쓰지 않아 축소→확대 후 원래 쪽으로 돌아옵니다.
   */
  const anchorLineY = useRef<number | null>(null);
  const restored = useRef(false);
  const gestureUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const leaving = useRef(false);
  const validResume = !restart && data && opening?.chapterId === data.chapter.id
    && opening.contentVersion === data.contentVersion && opening.contentHash === data.contentHash
    && isTextBoundary(data.body, opening.offset) ? opening : null;

  const clearGesture = () => {
    gestureUntil.current = 0;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  function selectPart(part?: (typeof segments)[number]) {
    if (!highlights.authenticated) { app.navigate({ screen: 'login' }); return; }
    const offset = currentPosition()?.offset ?? 0;
    const candidate = part ?? segments.find(item => item.offset === offset) ?? segments.at(-1);
    if (candidate) {
      clearGesture();
      setSelectedPart(candidate);
    }
  }
  const startGesture = () => {
    if (!restored.current || app.overlay || selectedPart) return;
    pendingAnchor.current = null;
    gestureUntil.current = Date.now() + 1_500;
  };
  useEffect(() => {
    endTouch.current = null;
    nativeEndDrag.current = false;
    setAdvancing(false);
    setNextError('');
    return () => { continuation.current = null; };
  }, [data, autoContinue, app.overlay, selectedPart]);
  useEffect(() => {
    clearGesture();
    return clearGesture;
  }, [app.overlay, bodySize, bodyFont, app.readingPreferences.theme, data, selectedPart]);
  useEffect(() => {
    if (Platform.OS !== 'web' || paged) return;
    const node = scroll.current?.getScrollableNode() as unknown as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    let wheel: { armed: boolean; distance: number } | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      startGesture();
      wheel ??= { armed: autoContinue && atEnd(), distance: 0 };
      wheel.distance += event.deltaY;
      if (event.deltaY < 0) wheel.armed = false;
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        const completed = wheel;
        wheel = null;
        wheelTimer = null;
        if (completed?.armed && completed.distance >= 48) void advanceRef.current();
      }, 180);
    };
    const key = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) startGesture();
      if (!event.repeat && ['PageDown', ' '].includes(event.key) && autoContinue && atEnd()) {
        event.preventDefault();
        void advanceRef.current();
      }
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('keydown', key);
    return () => {
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      node.removeEventListener('wheel', onWheel); node.removeEventListener('keydown', key);
    };
  }, [app.overlay, data, selectedPart, autoContinue, paged]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !paged || typeof document === 'undefined') return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey
        || target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const delta = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key) ? 1
        : ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
      if (delta !== 0 && goPageRef.current(delta)) event.preventDefault();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [paged]);
  useEffect(() => {
    if (lastLayout.current === layoutKey) return;
    lastLayout.current = layoutKey;
    schedulePages();
    if (!restored.current) return;
    pendingAnchor.current ??= visibleOffset.current;
    reanchor();
  }, [layoutKey]);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (anchorFrame.current !== null) cancelAnimationFrame(anchorFrame.current);
    if (pageTopsFrame.current !== null) cancelAnimationFrame(pageTopsFrame.current);
  }, []);

  function restore() {
    if (!data || restored.current || geometry.current.viewport <= 0 || geometry.current.height <= 0) return;
    const anchor = restoreReadingOffset(segments, validResume?.offset ?? 0, data.body.length);
    if (anchor > 0 && anchor < data.body.length && !anchors.current.has(anchor)) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      clearGesture();
      if (paged) {
        const tops = flushPages();
        restored.current = true;
        commitPage(pageOfOffset(anchor, tops) ?? 0, tops, { anchor: true, force: true });
        setRestorationComplete(true);
        return;
      }
      const { chapterY, textY } = geometry.current;
      const y = snapToPage(anchor === 0 ? 0 : anchor === data.body.length ? endY()
        : chapterY + textY + (anchors.current.get(anchor) ?? 0));
      restored.current = true;
      geometry.current.y = y;
      updateVisiblePosition();
      scroll.current?.scrollTo({ y, animated: false });
      setViewportProgress(progressAt(y));
      setRestorationComplete(true);
    });
  }

  /** 스크롤 모드의 위치를 스크롤 범위 안으로 맞춥니다. */
  function snapToPage(y: number): number {
    const { height, viewport } = geometry.current;
    return Math.min(Math.max(0, y), Math.max(0, height - viewport));
  }

  /** 스크롤 모드의 본문 끝 위치입니다. */
  function endY(): number {
    const { height, viewport } = geometry.current;
    return Math.max(0, height - viewport);
  }

  /** 진행률이며 책장 모드는 위치가 아니라 확정된 쪽 번호로 계산합니다. */
  function progressAt(y: number): number {
    const { height, viewport } = geometry.current;
    if (paged) {
      const count = pageTops.current.length;
      return count <= 1 ? 1 : pageIndex.current / (count - 1);
    }
    return height <= viewport ? 1 : Math.min(1, Math.max(0, y / (height - viewport)));
  }

  /** utf16 문단 오프셋이 시작하는 쪽이며 아직 측정되지 않은 문단이면 null입니다. */
  function pageOfOffset(offset: number, tops: readonly number[]): number | null {
    if (!data || offset <= 0) return 0;
    if (offset >= data.body.length) return tops.length - 1;
    const top = anchors.current.get(offset);
    return top === undefined ? null : pageOf(geometry.current.chapterY + geometry.current.textY + top, tops);
  }

  /** 측정된 머리글과 문단 줄을 콘텐츠 기준 절대 y의 줄 목록으로 모읍니다. */
  function measureLines(): PageLine[] {
    const { chapterY, textY } = geometry.current;
    const lines: PageLine[] = [];
    // 회차 번호와 제목은 쪼개지 않는 한 블록입니다.
    if (chapterY + textY > 0) lines.push({ top: 0, height: chapterY + textY });
    for (const part of segments) {
      const top = anchors.current.get(part.offset);
      if (top === undefined) continue;
      const base = chapterY + textY + top;
      const measured = Platform.OS === 'web' ? undefined : paragraphLines.current.get(part.offset);
      if (measured?.length) {
        for (const line of measured) lines.push({ ...line, top: base + line.top });
        continue;
      }
      // 웹은 onTextLayout이 없으므로 문단 높이를 줄 높이로 나눈 균등한 줄로 추정합니다.
      const height = paragraphHeights.current.get(part.offset) ?? 0;
      const count = Math.max(1, Math.round(height / lineHeight));
      for (let index = 0; index < count; index++) lines.push({ top: base + index * height / count, height: height / count });
    }
    return lines;
  }

  /**
   * 책장 모드에서 쪽 경계·쪽 번호·스크롤 위치·진행률을 한 번에 확정하는 유일한 경로입니다.
   * @param options.anchor - 기준 줄을 이 쪽의 맨 위 줄로 바꿀지입니다. 화면 높이 변경에 의한 재계산은 바꾸지 않습니다.
   * @param options.force - 위치가 같아도 스크롤을 다시 보낼지입니다.
   */
  function commitPage(index: number, tops: number[], { anchor, force = false }: { anchor: boolean; force?: boolean }) {
    const next = Math.min(Math.max(0, index), tops.length - 1), y = tops[next];
    pageTops.current = tops;
    pageIndex.current = next;
    if (anchor) anchorLineY.current = y;
    if (force || geometry.current.y !== y) scroll.current?.scrollTo({ y, animated: false });
    geometry.current.y = y;
    setPage(previous => previous.index === next && previous.tops.length === tops.length
      && previous.tops.every((top, at) => top === tops[at]) ? previous : { tops, index: next });
    updateVisiblePosition();
    setViewportProgress(progressAt(y));
  }

  /**
   * 줄 배치와 화면 높이로 쪽 경계를 다시 계산하고 같은 실행 안에서 머물 쪽까지 확정합니다.
   * 기준은 ① 재정렬 중인 문단 ② 마지막 쪽 ③ 화면 높이만 바뀌면 기준 줄 ④ 줄 배치가 바뀌면 화면 상단 문단 순입니다.
   */
  function runPages() {
    if (!paged) return;
    const lines = measureLines();
    const key = lines.map(line => `${line.top},${line.height},${line.blank ? 1 : 0}`).join(';');
    const reflowed = key !== linesKey.current;
    linesKey.current = key;
    const tops = buildPageTops(lines, geometry.current.viewport);
    if (!restored.current || geometry.current.viewport <= 0) {
      pageTops.current = tops;
      pageIndex.current = Math.min(pageIndex.current, tops.length - 1);
      updateVisiblePosition();
      return;
    }
    const pending = pendingAnchor.current;
    const wasLast = pageIndex.current === pageTops.current.length - 1 && pageTops.current.length > 1;
    if (pending !== null) {
      const index = pageOfOffset(pending, tops);
      // 기준 문단이 아직 측정되지 않았으면 이전 쪽을 유지하고 다음 측정에서 다시 맞춥니다.
      if (index !== null) commitPage(index, tops, { anchor: true });
      else commitPage(pageOf(anchorLineY.current ?? geometry.current.y, tops), tops, { anchor: false });
    } else if (wasLast) commitPage(tops.length - 1, tops, { anchor: false });
    else if (!reflowed) commitPage(pageOf(anchorLineY.current ?? geometry.current.y, tops), tops, { anchor: false });
    else {
      // 회전처럼 줄 배치가 바뀌면 이전 줄 위치는 의미가 없으므로 화면 상단 문단의 쪽으로 다시 맞춥니다.
      const offset = visibleOffset.current;
      const index = offset === null ? null : pageOfOffset(offset, tops);
      commitPage(index ?? pageOf(geometry.current.y, tops), tops, { anchor: true });
    }
  }

  /** 예약된 쪽 재계산을 즉시 실행하고 확정된 쪽 경계를 돌려줍니다. */
  function flushPages(): number[] {
    if (pageTopsFrame.current !== null) {
      cancelAnimationFrame(pageTopsFrame.current);
      pageTopsFrame.current = null;
      runPages();
    }
    return pageTops.current;
  }

  /** 문단 레이아웃이 연달아 바뀌어도 쪽 경계는 프레임마다 한 번만 다시 계산합니다. */
  function schedulePages() {
    if (pageTopsFrame.current !== null) cancelAnimationFrame(pageTopsFrame.current);
    pageTopsFrame.current = requestAnimationFrame(() => {
      pageTopsFrame.current = null;
      runPages();
    });
  }

  /** 레이아웃 측정값이 바뀔 때마다 쪽 경계 예약과 위치 복원·재정렬을 함께 처리합니다. */
  function relayout() {
    schedulePages();
    restore();
    reanchor();
    updateVisiblePosition();
  }

  /** 사용자 입력 전까지 기준 문단을 화면 상단(책장 모드는 그 문단의 쪽)에 다시 맞춥니다. */
  function reanchor() {
    // 책장 모드의 재정렬은 relayout·설정 변경이 예약한 쪽 재계산에서 함께 확정합니다.
    if (paged) return;
    const offset = pendingAnchor.current;
    if (offset === null || !data || !restored.current || geometry.current.viewport <= 0 || geometry.current.height <= 0) return;
    if (offset > 0 && offset < data.body.length && !anchors.current.has(offset)) return;
    if (anchorFrame.current !== null) cancelAnimationFrame(anchorFrame.current);
    anchorFrame.current = requestAnimationFrame(() => {
      anchorFrame.current = null;
      const target = pendingAnchor.current;
      if (target === null) return;
      const { chapterY, textY } = geometry.current;
      const y = snapToPage(target === 0 ? 0 : target === data.body.length ? endY()
        : chapterY + textY + (anchors.current.get(target) ?? 0));
      geometry.current.y = y;
      scroll.current?.scrollTo({ y, animated: false });
      updateVisiblePosition();
      setViewportProgress(progressAt(y));
    });
  }

  function currentPosition(atEnd = false): ReadingPosition | null {
    if (!data || data.kind === 'magazine' || !restored.current) return null;
    const { y, viewport, height, chapterY, textY } = geometry.current;
    let offset = 0;
    const tops = pageTops.current, index = pageIndex.current;
    // 책장 모드의 끝은 위치가 아니라 마지막 쪽 번호로 판정하며 한 쪽짜리 회차는 스크롤 모드처럼 처음으로 저장합니다.
    const end = paged ? tops.length > 1 && index === tops.length - 1 : height > viewport + 4 && y + viewport >= height - 4;
    if (atEnd || end) offset = data.body.length;
    else {
      for (const part of segments) {
        const top = anchors.current.get(part.offset);
        if (top !== undefined && chapterY + textY + top <= y + 12) offset = part.offset;
      }
      if (paged && viewport > 0 && height > 0) {
        // 책장 모드는 현재 쪽에서 시작하는 첫 문단을 기록하여 복원 시 같은 쪽으로 돌아옵니다.
        const first = index === 0 ? undefined : segments.find(part => {
          const top = anchors.current.get(part.offset);
          return top !== undefined && pageOf(chapterY + textY + top, tops) === index;
        });
        if (first) offset = first.offset;
      }
    }
    return { chapterId: data.chapter.id, offset, unit: 'utf16', contentVersion: data.contentVersion, contentHash: data.contentHash };
  }

  /** 복원·관성 이동이 아닌, 본문 끝에서 시작한 추가 입력만 이어보기에 사용합니다. */
  function atEnd(): boolean {
    const { y, height, viewport } = geometry.current;
    if (!restored.current || viewport <= 0 || height <= 0) return false;
    if (paged) return pageIndex.current === flushPages().length - 1;
    return y + viewport >= height - 4;
  }

  function beginEndTouch(event: GestureResponderEvent) {
    const { pageX, pageY, touches } = event.nativeEvent;
    nativeEndDrag.current = false;
    endTouch.current = autoContinue && atEnd() && touches.length === 1
      ? { x: pageX, y: pageY } : null;
  }

  function finishEndTouch(event: GestureResponderEvent, transferred = false) {
    const start = endTouch.current;
    endTouch.current = null;
    if (!start) return;
    const distance = start.y - event.nativeEvent.pageY;
    const upward = distance >= (transferred ? 8 : 48) && Math.abs(start.x - event.nativeEvent.pageX) < distance;
    // 네이티브 ScrollView가 터치를 인계받으면 실제 드래그 종료를 기다립니다.
    if (transferred) nativeEndDrag.current = upward;
    else if (upward) void advanceRef.current();
  }

  function finishNativeDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const armed = nativeEndDrag.current;
    nativeEndDrag.current = false;
    if (armed && !(Platform.OS === 'android' && (event.nativeEvent.velocity?.y ?? 0) > 0)) void advanceRef.current();
  }

  /** 현재 회차 저장과 다음 상품의 구매가 확인된 뒤 한 회차만 이동합니다. */
  async function advanceNext(): Promise<void> {
    if (!autoContinue || !data?.next || !atEnd() || app.overlay || selectedPart
        || continuation.current || leaving.current || offer.busy || offer.loading) return;
    const next = data.next;
    const operation = {};
    continuation.current = operation;
    const current = () => continuation.current === operation;
    setAdvancing(true);
    setNextError('');
    clearGesture();
    readingStarted.current = true;
    try {
      if (storage.enabled && (!storage.canAutoSave || !await saveVisible(true, true))) return;
      if (!current()) return;
      if (data.kind === 'novel') {
        const product = offer.products?.find(item => item.chapterId === next.id);
        if (!product) { setNextError(offer.error ?? '다음 화의 구매 정보를 불러오지 못했습니다.'); return; }
        if (!product.readable) {
          if (auth.status !== 'authenticated') { app.navigate({ screen: 'login' }); return; }
          if (!await offer.purchase(product) || !current()) return;
        }
      }
      app.navigate({ screen: 'reader', workId: data.workId, chapterId: next.id,
        kind: data.kind, autoContinue: true }, false, true);
    } finally {
      if (current()) { continuation.current = null; setAdvancing(false); }
    }
  }
  advanceRef.current = advanceNext;

  /**
   * 책장 모드의 모든 쪽 넘김 입력이 호출하는 단일 진입점입니다.
   * @returns 입력을 쪽 넘김으로 처리했으면 true, 가드에 막혔으면 false입니다.
   */
  function goPage(delta: -1 | 1): boolean {
    if (!paged || !data || !restored.current || app.overlay || selectedPart || contentsOpen
      || continuation.current || advancing || leaving.current) return false;
    const { viewport, height } = geometry.current;
    if (viewport <= 0 || height <= 0) return false;
    pendingAnchor.current = null;
    const tops = flushPages();
    const turn = turnPage(pageIndex.current, delta, tops.length);
    if (turn.edge === 'start') { setPageNotice(''); return true; }
    if (turn.edge === 'end') {
      if (autoContinue && data.next) { setPageNotice(''); void advanceRef.current(); }
      else setPageNotice('회차의 마지막 쪽입니다.');
      return true;
    }
    setPageNotice('');
    readingStarted.current = true;
    commitPage(turn.index, tops, { anchor: true, force: true });
    scheduleAutoSave();
    return true;
  }
  goPageRef.current = goPage;

  function beginPageTouch(x: number, y: number, single = true) {
    const pressed = pressStarted.current;
    pressStarted.current = false;
    pageTouch.current = paged && single && !pressed ? { x, y, at: Date.now() } : null;
  }

  function finishPageTouch(x: number, y: number) {
    const start = pageTouch.current;
    pageTouch.current = null;
    pressStarted.current = false;
    if (!start) return;
    const { x: left, width } = pagesFrame.current;
    const delta = classifyPageTouch({ x: start.x - left, y: start.y }, { x: x - left, y }, width, Date.now() - start.at);
    if (delta !== null) goPage(delta);
  }

  /** 본문 안 버튼에서 시작한 터치는 자식→부모 순서로 먼저 표시하여 좌우 탭에서 제외합니다. */
  const markPress = () => { pressStarted.current = true; };

  function updateVisiblePosition() {
    const next = currentPosition();
    // 기준 문단을 다시 맞추는 동안에는 스냅·재배치 결과로 기준을 덮어쓰지 않습니다.
    if (next && pendingAnchor.current === null) visibleOffset.current = next.offset;
    setVisiblePosition(previous => next && sameReadingPosition(previous, next) ? previous : next);
  }

  function saveVisible(automatic = false, atEnd = false): Promise<boolean> {
    if (paged) flushPages();
    const position = currentPosition(atEnd);
    if (!position || automatic && (selectedPart || recordEntry && !readingStarted.current)) return Promise.resolve(false);
    return storage.save(position, automatic);
  }

  function leave(next: () => void, atEnd = false) {
    if (leaving.current) return;
    const flush = restorationComplete && storage.canAutoSave
      && !selectedPart && (!recordEntry || readingStarted.current);
    clearGesture();
    const pending = flush ? saveVisible(true, atEnd) : storage.wait();
    if (!pending) { next(); return; }
    leaving.current = true;
    void pending.then(saved => { if (saved) next(); }).finally(() => { leaving.current = false; });
  }
  useLayoutEffect(() => app.registerBackHandler(leave), [app.registerBackHandler, leave]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (paged) {
      // 책장 모드의 위치는 확정된 쪽이 기준이며 네이티브가 위치를 옮겼으면 되돌립니다.
      geometry.current.height = contentSize.height;
      if (restored.current && Math.abs(contentOffset.y - geometry.current.y) > 1) {
        scroll.current?.scrollTo({ y: geometry.current.y, animated: false });
      }
      return;
    }
    const moved = geometry.current.y !== contentOffset.y;
    geometry.current.y = contentOffset.y;
    geometry.current.height = contentSize.height;
    geometry.current.viewport = layoutMeasurement.height;
    updateVisiblePosition();
    setViewportProgress(progressAt(contentOffset.y));
    if (!moved || gestureUntil.current < Date.now() || !restored.current || app.overlay || selectedPart) return;
    readingStarted.current = true;
    scheduleAutoSave();
  }

  /** 사용자 이동이 멈춘 뒤 화면 위치를 한 번 자동 저장합니다. */
  function scheduleAutoSave() {
    if (!storage.canAutoSave) return;
    gestureUntil.current = Date.now() + 1_500;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { clearGesture(); void saveVisible(true); }, 450);
  }

  useEffect(() => {
    setData(null); setError(null); setAccessError(null); setContentsOpen(false); setSelectedPart(null);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (anchorFrame.current !== null) cancelAnimationFrame(anchorFrame.current);
    anchorFrame.current = null;
    pendingAnchor.current = null;
    visibleOffset.current = null;
    pageTouch.current = null;
    setPageNotice('');
    anchors.current.clear();
    paragraphHeights.current.clear();
    paragraphLines.current.clear();
    if (pageTopsFrame.current !== null) cancelAnimationFrame(pageTopsFrame.current);
    pageTopsFrame.current = null;
    pageTops.current = [0];
    pageIndex.current = 0;
    linesKey.current = '';
    anchorLineY.current = null;
    setPage({ tops: [0], index: 0 });
    restored.current = false;
    readingStarted.current = false;
    setRestorationComplete(false);
    setVisiblePosition(null);
    setViewportProgress(0);
    geometry.current.y = 0;
    clearGesture();
    if (!workId || !chapterId) { setError('작품 상세의 목차에서 읽을 회차를 선택해 주십시오.'); return; }
    const controller = new AbortController();
    fetchChapterText(apiUrl, workId, chapterId, controller.signal, memberClient).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(readingFailure(reason));
        setAccessError(reason instanceof MemberRequestError ? reason.status : null);
      }
    });
    return () => controller.abort();
  }, [apiUrl, workId, chapterId, attempt, memberClient]);
  useEffect(() => {
    if (!data || data.workId !== workId || data.chapter.id !== chapterId || !restorationComplete
      || selectedPart || recordEntry && !readingStarted.current || !storage.canAutoSave) return;
    const key = [data.workId, data.chapter.id, data.contentVersion, data.contentHash].join(':');
    if (savedChapter.current === key) return;
    savedChapter.current = key;
    void saveVisible(true);
  }, [data, workId, chapterId, restorationComplete, storage.canAutoSave, selectedPart, recordEntry]);
  const move = (id: string) => {
    if (!data || id === data.chapter.id) { setContentsOpen(false); return; }
    leave(() => app.navigate({ screen: 'reader', workId: data.workId, chapterId: id, kind: data.kind, autoContinue }, false, true),
      data.next?.id === id);
  };
  return <View style={[styles.reader, { backgroundColor: readingPalette.background }]}>
    <View style={[styles.readerHeader, { backgroundColor: readingPalette.background }]}>
      <View style={styles.roundTool}><IconButton icon="back" label="읽기 화면에서 돌아가기" onPress={app.back} /></View>
      <Text numberOfLines={1} style={[s.subtitle, styles.readerTitle, { color: readingPalette.muted }]}>{data?.workTitle ?? '독서'}</Text>
      <View style={styles.roundTool}><IconButton icon="share" label="작품 공유" disabled={!data}
        onPress={() => data && app.navigate({ screen: 'share', workId, shareWorkTitle: data.workTitle })} /></View>
      <View style={styles.roundTool}><IconButton icon="list" label="목차" disabled={!data} onPress={() => setContentsOpen(true)} /></View>
      <View style={styles.roundTool}><BookmarkButton key={workId} workId={workId} disabled={!data} position={visiblePosition}
        highlightsFailed={highlights.failed} refreshHighlights={highlights.refresh} onHighlight={() => selectPart()} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="읽기 설정" onPress={() => app.navigate({ screen: 'readingSettings' })} style={styles.roundTool}><Text style={[s.text, styles.typeTool]}>가</Text></Pressable>
    </View>
    <View ref={pagesView} testID="reader-pages" style={styles.readerPages}
      onLayout={event => {
        const { x, width } = event.nativeEvent.layout;
        pagesFrame.current = { x, width };
        pagesView.current?.measureInWindow?.((left, _top, measured) => { pagesFrame.current = { x: left, width: measured }; });
      }}
      onTouchStart={paged ? event => beginPageTouch(event.nativeEvent.pageX, event.nativeEvent.pageY, event.nativeEvent.touches.length === 1) : undefined}
      onTouchEnd={paged ? event => finishPageTouch(event.nativeEvent.pageX, event.nativeEvent.pageY) : undefined}
      onTouchCancel={paged ? () => { pageTouch.current = null; pressStarted.current = false; } : undefined}
      onPointerDown={paged && Platform.OS === 'web' ? event => {
        if (event.nativeEvent.pointerType === 'mouse') beginPageTouch(event.nativeEvent.pageX, event.nativeEvent.pageY);
      } : undefined}
      onPointerUp={paged && Platform.OS === 'web' ? event => {
        if (event.nativeEvent.pointerType === 'mouse') finishPageTouch(event.nativeEvent.pageX, event.nativeEvent.pageY);
      } : undefined}>
    <ScrollView ref={scroll} contentContainerStyle={styles.readerBody} showsVerticalScrollIndicator={false} scrollEnabled={!paged}
      onLayout={event => {
        // 책장 모드에서 화면 높이가 바뀌면 쪽 재계산이 기준 줄이 포함된 쪽으로 다시 맞춥니다.
        geometry.current.viewport = event.nativeEvent.layout.height; relayout();
      }}
      onContentSizeChange={(_, height) => { clearGesture(); geometry.current.height = height; relayout(); }}
      onScrollBeginDrag={startGesture} scrollEventThrottle={16} onScroll={onScroll}
      onTouchStart={paged ? undefined : beginEndTouch} onTouchEnd={paged ? undefined : event => finishEndTouch(event)}
      onTouchCancel={paged ? undefined : event => finishEndTouch(event, true)} onScrollEndDrag={paged ? undefined : finishNativeDrag}>
      {error ? <View accessibilityLiveRegion="polite" onTouchStart={markPress} onPointerDown={markPress}><Text style={[s.subtitle, { color: readingPalette.text }]}>본문을 불러오지 못했습니다.</Text><Text style={s.error}>{error}</Text><ReadingAccessActions status={accessError} workId={workId} />{workId && chapterId && <Action label="다시 불러오기" onPress={() => setAttempt(v => v + 1)} />}{workId && accessError !== 402 && <Action label="작품 상세로" onPress={() => app.navigate({ screen: 'detail', workId }, false, true)} />}</View>
        : !data ? <View accessibilityLiveRegion="polite"><ActivityIndicator color={colors.green} /><Text style={[s.muted, { color: readingPalette.muted }]}>본문을 불러오고 있습니다.</Text></View>
        : <View testID="chapter-text" onLayout={event => { geometry.current.chapterY = event.nativeEvent.layout.y; relayout(); }}>
          <Text style={[styles.chapterNumber, { color: readingPalette.muted }]}>제{data.chapter.number}{data.kind === 'novel' ? '화' : '장'}</Text>
          <View accessibilityRole="header" accessibilityLabel={data.chapter.title} style={styles.chapterTitleWords}>
            {data.chapter.title.trim().split(/\s+/).map((word, index) => <Text key={index}
              style={[styles.chapterTitle, { color: readingPalette.text, fontFamily: bodyFont }]}>{word}</Text>)}
          </View>
          {data.body.length === 0 ? <EmptyState title="이 회차의 본문이 비어 있습니다." tone={app.readingPreferences.theme === '다크' ? 'dark' : 'light'} />
            : <View testID="reader-body-text" onLayout={event => { geometry.current.textY = event.nativeEvent.layout.y; relayout(); }}>
              {segments.map((part, index) => <Text key={part.offset} selectable
                onLongPress={Platform.OS !== 'web' && highlights.authenticated ? () => selectPart(part) : undefined} onLayout={event => {
                anchors.current.set(part.offset, event.nativeEvent.layout.y);
                paragraphHeights.current.set(part.offset, event.nativeEvent.layout.height);
                relayout();
              }} onTextLayout={Platform.OS === 'web' ? undefined : event => {
                // 시스템 글자 크기에 따라 실제 줄 높이가 계산값과 다를 수 있어 측정된 줄 위치를 사용합니다.
                paragraphLines.current.set(part.offset, event.nativeEvent.lines.map(line =>
                  ({ top: line.y, height: line.height, blank: line.text.trim() === '' })));
                relayout();
              }} style={[s.text, { color: readingPalette.text, fontFamily: bodyFont, fontSize: bodySize, lineHeight: bodySize * 1.85 }]}>
                {painted[index].map((piece, edge) => piece.color ? <Text key={edge}
                  style={{ backgroundColor: highlightColors[piece.color], color: colors.ink }}>{piece.text}</Text> : piece.text)}
              </Text>)}
            </View>}
        </View>}
      {/* 어떤 화면 높이에서도 마지막 쪽 시작까지 스크롤할 수 있도록 창 높이만큼 여백을 둡니다. */}
      {paged && <View testID="reader-page-spacer" style={{ height: windowHeight }} />}
    </ScrollView>
    {/* 다음 쪽 시작 줄부터 아래는 잘리는 줄이며 다음 쪽에서 온전히 보입니다. 마지막 쪽은 가리지 않습니다. */}
    {paged && page.index < page.tops.length - 1 && <View testID="reader-page-mask" pointerEvents="none"
      style={[styles.pageMask, { top: page.tops[page.index + 1] - page.tops[page.index], backgroundColor: readingPalette.background }]} />}
    </View>
    {storage.enabled && (storage.status.problem !== null || storage.status.retry) && <View style={[styles.readerSave, { backgroundColor: readingPalette.background }]}>
      {!!storage.status.message && <Text accessibilityLiveRegion="polite" style={[s.muted, { color: readingPalette.text }]}>{storage.status.message}</Text>}
      {storage.status.problem === 'review' ? <Action compact tone="secondary" label="읽기 위치 다시 확인" onPress={() => void storage.review()} />
        : storage.status.problem === 'body' ? <Action compact tone="secondary" label="최신 본문 다시 불러오기" onPress={() => {
          setRestart(true);
          setAttempt(value => value + 1);
        }} />
        : <Action compact label="현재 위치 다시 저장" disabled={storage.status.busy} onPress={() => void saveVisible()} />}
    </View>}
    {selectedPart && data && workId && <HighlightEditor workId={workId} chapterId={data.chapter.id}
      offset={selectedPart.offset} text={selectedPart.text} contentVersion={data.contentVersion} contentHash={data.contentHash}
      onSaved={highlights.refresh} onClose={() => setSelectedPart(null)} />}
    {(nextError || autoContinue && offer.message) && <Text accessibilityRole="alert" style={[s.error, styles.readerSave]}>{nextError || offer.message}</Text>}
    <View style={[styles.readerFooter, app.readingPreferences.theme === '다크' && { backgroundColor: readingPalette.background }]}>
      <View accessibilityRole="progressbar" accessibilityLabel="현재 회차 읽기 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(viewportProgress * 100)} style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${viewportProgress * 100}%` }]} />
      </View>
      {paged && <View style={styles.pageActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 쪽" accessibilityState={{ disabled: !data }} disabled={!data}
          onPress={() => goPage(-1)} style={styles.footerAction}><Icon name="back" size={14} color={data && page.index > 0 ? colors.green : readingPalette.muted} /><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>이전 쪽</Text></Pressable>
        {/* 끝 안내를 카운터 안에 표시하여 안내 유무와 관계없이 하단 높이와 본문 화면 높이를 유지합니다. */}
        <Text accessibilityLiveRegion="polite" numberOfLines={1}
          accessibilityLabel={`전체 ${page.tops.length}쪽 중 ${page.index + 1}쪽${pageNotice ? `. ${pageNotice}` : ''}`}
          style={[s.text, styles.pageCounter, { color: readingPalette.muted }]}>{page.index + 1} / {page.tops.length}{pageNotice ? ' · 마지막 쪽' : ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다음 쪽" accessibilityState={{ disabled: !data }} disabled={!data}
          onPress={() => goPage(1)} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>다음 쪽</Text><Icon name="next" size={14} color={data ? colors.green : readingPalette.muted} /></Pressable>
      </View>}
      <View style={styles.readerActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="이전 회차" accessibilityState={{ disabled: !data?.previous }} disabled={!data?.previous} onPress={() => data?.previous && move(data.previous.id)} style={styles.footerAction}><Icon name="back" size={14} color={data?.previous ? colors.green : readingPalette.muted} /><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>이전화</Text></Pressable>
      <Pressable accessibilityRole="switch" accessibilityLabel="이어보기" accessibilityHint="회차 끝에서 더 스크롤하면 다음 화를 열고 미소장 회차는 자동 구매합니다."
        disabled={!data || advancing} accessibilityState={{ checked: autoContinue, disabled: !data || advancing }} onPress={() => {
        clearGesture();
        app.navigate({ ...app.baseRoute, autoContinue: !autoContinue }, false, true);
      }} style={styles.footerAction}>
        <Text style={[s.text, styles.footerLabel, { color: autoContinue ? colors.green : readingPalette.muted }]}>이어보기</Text>
      </Pressable>
      {data?.kind === 'novel' && <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'world', workId, chapterId, kind: data.kind })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>세계관</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'reviews', workId, chapterId, kind: data?.kind })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>댓글</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="다음 회차" accessibilityState={{ disabled: !data?.next }} disabled={!data?.next} onPress={() => data?.next && move(data.next.id)} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>다음화</Text><Icon name="next" size={14} color={data?.next ? colors.green : readingPalette.muted} /></Pressable>
    </View></View>
    <Modal visible={contentsOpen} transparent animationType="none" onRequestClose={() => setContentsOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}><ModalPanel visible={contentsOpen} style={{ backgroundColor: '#fff', maxWidth: 480, width: '100%', alignSelf: 'center', maxHeight: '85%', padding: 24, paddingBottom: 24 + insets.bottom }}><Text style={s.title}>목차</Text><ScrollView showsVerticalScrollIndicator={false}>{data?.contents.map(chapter => <Pressable key={chapter.id} accessibilityRole="button" accessibilityState={{ selected: chapter.id === chapterId }} accessibilityLabel={chapter.title + ' 열기'} onPress={() => move(chapter.id)} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.line }}><Text style={s.text}>{chapter.number}{data?.kind === 'novel' ? '화' : '장'} · {chapter.title}{chapter.id === chapterId ? ' · 현재 장' : ''}</Text></Pressable>)}</ScrollView><Action label="목차 닫기" onPress={() => setContentsOpen(false)} /></ModalPanel></View>
    </Modal>
  </View>;
}

/**
 * 앱북 시안의 이미지·설명·영상·오디오·상호작용 영역을 배치합니다.
 *
 * @remarks
 * 미디어 내용은 각 영역의 {@link EmptyState}로 유지하고 재생·확대·드래그를 비활성화합니다.
 * 목차와 본문 이동은 화면 이동만 수행하며 미디어 조회나 재생 상태를 만들지 않습니다.
 *
 * @returns 자체 헤더와 하단 이동 도구를 포함한 앱북 화면입니다.
 */
function MediaScreen() {
  const app = useApp();
  return (
    <View style={styles.media}>
      <View style={styles.mediaHeader}><IconButton icon="back" label="앱북에서 돌아가기" onPress={app.back} /><Text style={[s.subtitle, styles.mediaTitle]}>앱북</Text><IconButton icon="more" label="읽기 설정" onPress={() => app.navigate({ screen: 'readingSettings' })} /></View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.mediaBody}>
        <Text style={[s.text, styles.mediaEyebrow]}>앱북 · 관찰하기</Text>
        <EmptyState compact title="표시할 제목이 없습니다." style={styles.mediaHeading} />
        <View style={styles.imageFrame}>
          <EmptyState title="표시할 이미지가 없습니다." />
          <Pressable accessibilityRole="button" accessibilityLabel="이미지 확대" accessibilityState={{ disabled: true }} disabled style={styles.expandImage}><Icon name="image" color="#FFFFFF" size={16} /><Text style={[s.text, styles.expandLabel]}>확대</Text></Pressable>
        </View>
        <EmptyState compact title="표시할 설명이 없습니다." style={styles.caption} />
        <View style={styles.videoCard}>
          <View style={styles.videoThumbnail}><EmptyState compact title="—" style={styles.thumbnailEmpty} /></View>
          <View style={styles.mediaCardContent}><EmptyState compact title="표시할 영상이 없습니다." style={styles.mediaInlineEmpty} /><Text style={[s.muted, styles.videoLabel]}>영상</Text></View>
          <IconButton icon="play" label="영상 재생" disabled />
        </View>
        <View style={styles.audioRow}>
          <View style={styles.audioIcon}><Icon name="audio" color="#405E72" size={18} /></View>
          <View style={styles.mediaCardContent}><Text style={[s.text, styles.mediaLabel]}>오디오</Text><EmptyState compact title="표시할 오디오가 없습니다." style={styles.mediaInlineEmpty} /><View style={styles.audioTrack} /></View>
          <IconButton icon="pause" label="오디오 일시 정지" disabled />
        </View>
        <View style={styles.interactiveCard}><View style={styles.interactiveVisual}><EmptyState compact title="—" /></View><View style={styles.mediaCardContent}><EmptyState compact title="표시할 정보가 없습니다." style={styles.interactiveEmpty} /><Text style={[s.text, styles.interactiveHint]}>드래그하여 둘러보기</Text></View></View>
      </ScrollView>
      <View style={styles.mediaFooter}>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'detail', kind: 'magazine' })} style={styles.mediaFooterAction}><Icon name="list" size={19} /><Text style={[s.text, styles.mediaFooterLabel]}>목차</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'reader' })} style={styles.mediaFooterAction}><Text style={[s.text, styles.mediaFooterLabel]}>본문으로</Text><Icon name="next" size={17} /></Pressable>
      </View>
    </View>
  );
}

/**
 * 이미지 확대 시안의 어두운 바탕과 닫기 도구를 표시합니다.
 *
 * @remarks
 * 이미지·제목·설명은 어두운 배경용 {@link EmptyState}이며 확대나 이미지 조회를 수행하지 않습니다.
 * 닫기는 이전 화면으로 이동합니다.
 *
 * @returns 이미지가 없는 확대 화면의 구조입니다.
 */
export function ImageFullScreen() {
  const app = useApp();
  return (
    <View style={styles.imageFull}>
      <View style={styles.imageFullHeader}><Text style={[s.text, styles.imageFullTitle]}>이미지</Text><Pressable accessibilityRole="button" accessibilityLabel="이미지 닫기" onPress={app.back} style={styles.imageClose}><Icon name="close" size={22} color="#FFFFFF" /></Pressable></View>
      <View style={styles.fullImageArea}><EmptyState title="표시할 이미지가 없습니다." tone="dark" /></View>
      <EmptyState compact title="표시할 이미지 정보가 없습니다." tone="dark" style={styles.fullCaption} />
    </View>
  );
}
// #endregion

// #region 세계관 화면
/**
 * 세계관 화면의 제목과 요약·용어 전환을 표시합니다.
 *
 * @param props - 현재 선택한 세계관 화면입니다.
 * @returns 뒤로 가기와 두 화면 전환을 포함한 헤더입니다.
 */
function WorldHeader({ terms = false }: {
  /** 용어 화면 선택 여부입니다. 생략하면 요약 화면이 선택됩니다. */
  terms?: boolean;
}) {
  const app = useApp();
  return (
    <View style={styles.worldHeader}>
      <IconButton icon="back" label="세계관에서 돌아가기" onPress={app.back} />
      <Text style={[s.subtitle, styles.worldTitle]}>세계관</Text>
      <View style={styles.worldTabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: !terms }} onPress={() => app.navigate({ ...app.baseRoute, screen: 'world' }, false, true)} style={[styles.worldTab, !terms && styles.worldTabSelected]}><Text style={[s.text, styles.worldTabLabel, !terms && styles.worldSelectedText]}>요약</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: terms }} onPress={() => app.navigate({ ...app.baseRoute, screen: 'worldTerms' }, false, true)} style={[styles.worldTab, terms && styles.worldTabSelected]}><Text style={[s.text, styles.worldTabLabel, terms && styles.worldSelectedText]}>용어</Text></Pressable>
      </View>
    </View>
  );
}

/**
 * 관계도 시안의 작품 정보 영역, 분류 범례와 관계도 공간을 표시합니다.
 *
 * @remarks
 * 표지·작품·읽은 범위·관계도 내용은 생성하지 않습니다. 작품과 관계도에는
 * {@link EmptyState}를 배치하며 범례만 정적 화면 요소로 유지합니다.
 *
 * @returns 요약 탭이 선택된 세계관 화면입니다.
 */
export function WorldScreen() {
  const app = useApp();
  return (
    <View style={styles.world}>
      <WorldHeader />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.worldBody}>
        <View style={styles.workIdentity}><View style={styles.workCover}><EmptyState compact title="—" style={styles.thumbnailEmpty} /></View><EmptyState compact title="작품 정보가 없습니다." style={styles.workIdentityEmpty} /><View style={styles.readScope}><Icon name="lock" size={12} color={colors.muted} /><Text style={[s.muted, styles.scopeLabel]}>읽은 범위</Text></View></View>
        <Text style={[s.subtitle, styles.relationTitle]}>전체 관계도</Text>
        <View style={styles.legend}>{([['인물', '#45714A'], ['사물', '#9A784F'], ['장소', '#8B9054'], ['고유 설정', '#668995']] as const).map(([label, color]) => <View key={label} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={[s.muted, styles.legendLabel]}>{label}</Text></View>)}</View>
        <View style={styles.relationMap}><EmptyState title="표시할 관계가 없습니다." /></View>
      </ScrollView>
      <View style={styles.worldFooter}><Action label="본문으로 돌아가기" onPress={app.back} style={styles.returnButton} /></View>
    </View>
  );
}

/**
 * 세계관 시안의 용어 탭과 고유 용어 목록 공간을 표시합니다.
 *
 * @remarks
 * 작품 제목·용어 개수·이름·정의·연결을 만들지 않고 {@link EmptyState}를 표시합니다.
 * 요약 탭과 본문으로 돌아가는 화면 이동만 제공합니다.
 *
 * @returns 용어 탭이 선택된 세계관 화면입니다.
 */
export function WorldTermsScreen() {
  const app = useApp();
  return (
    <View style={styles.world}>
      <WorldHeader terms />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.termsBody}>
        <EmptyState compact title="작품 정보가 없습니다." style={styles.termsWork} />
        <Text style={[s.subtitle, styles.termsTitle]}>고유 용어</Text>
        <View style={styles.termList}><EmptyState title="표시할 고유 용어가 없습니다." /></View>
      </ScrollView>
      <View style={styles.worldFooter}><Action label="본문으로 돌아가기" onPress={app.back} style={styles.returnButton} /></View>
    </View>
  );
}
// #endregion

// #region 독서 화면 스타일
/** 독서·미디어·세계관 시안의 헤더, 빈 본문 공간과 하단 도구 배치를 정의합니다. */
const styles = StyleSheet.create({
  reader: { flex: 1, backgroundColor: '#F7F8F2' },
  readerHeader: { height: 72, paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
  roundTool: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  readerTitle: { flex: 1, marginLeft: 5, fontSize: 14, fontWeight: '500' },
  typeTool: { fontSize: 21 },
  readerBody: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 28 },
  chapterNumber: { fontSize: 11, fontWeight: '600', marginBottom: 18 },
  chapterTitleWords: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 7, marginBottom: 24 },
  chapterTitle: { maxWidth: '100%', fontSize: 27, lineHeight: 38, fontWeight: '600' },
  readerSave: { paddingHorizontal: 16, paddingVertical: 7, gap: 6 },
  magazine: { flex: 1, minHeight: 0, backgroundColor: '#F7F8F2' },
  magazineHeaderSpace: { flex: 1 },
  magazineScroll: { flex: 1, minHeight: 0 },
  magazinePage: { paddingHorizontal: 16, paddingBottom: 18, gap: 10 },
  magazineImage: { width: '100%', backgroundColor: '#ECEFE8' },
  magazineControls: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  magazineTurn: { opacity: 0.5 },
  magazineBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  magazineContents: { width: '100%', maxWidth: 480, alignSelf: 'center', maxHeight: '82%', padding: 22, gap: 12, backgroundColor: '#fff' },
  magazineArticle: { paddingVertical: 14, gap: 4, borderBottomWidth: 1, borderColor: colors.line },
  readerFooter: { flexShrink: 0, backgroundColor: '#FFFFFF', paddingVertical: 6 },
  progressTrack: { marginHorizontal: 28, height: 2, backgroundColor: '#DDE6D7' },
  progressFill: { height: 2, backgroundColor: colors.green },
  readerActions: { flexDirection: 'row', paddingHorizontal: 20, minHeight: 44, marginTop: 6 },
  readerPages: { flex: 1 },
  pageMask: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  pageActions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, minHeight: 44, marginTop: 6 },
  pageCounter: { flex: 1, textAlign: 'center', fontSize: 12, fontVariant: ['tabular-nums'] },
  footerAction: { flex: 1, minHeight: 44, gap: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footerLabel: { fontSize: 12, fontWeight: '600' },
  media: { flex: 1, backgroundColor: '#FFFFFF' },
  mediaHeader: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#E3E8DC' },
  mediaTitle: { flex: 1, textAlign: 'center', fontSize: 16 },
  mediaBody: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
  mediaEyebrow: { fontSize: 12, color: '#6B7D65' },
  mediaHeading: { minHeight: 54, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 8 },
  imageFrame: { height: 207, borderRadius: 20, backgroundColor: '#F2F6ED', justifyContent: 'center', overflow: 'hidden' },
  expandImage: { position: 'absolute', right: 12, bottom: 12, minHeight: 28, borderRadius: 14, paddingHorizontal: 10, backgroundColor: '#52634E', flexDirection: 'row', alignItems: 'center', gap: 5, opacity: 0.55 },
  expandLabel: { color: '#FFFFFF', fontSize: 10 },
  caption: { minHeight: 68, paddingVertical: 10, flexDirection: 'row', justifyContent: 'flex-start' },
  videoCard: { minHeight: 80, borderRadius: 20, backgroundColor: '#F2F6ED', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 15 },
  videoThumbnail: { width: 78, height: 56, borderRadius: 12, borderWidth: 1, borderColor: '#E3E8DC', justifyContent: 'center' },
  thumbnailEmpty: { padding: 0, gap: 2 },
  videoLabel: { fontSize: 11 },
  mediaCardContent: { flex: 1, minWidth: 0 },
  mediaLabel: { fontSize: 13, fontWeight: '700' },
  mediaInlineEmpty: { minHeight: 28, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 6 },
  audioRow: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  audioIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCE7EC', alignItems: 'center', justifyContent: 'center' },
  audioTrack: { height: 3, borderRadius: 2, backgroundColor: '#D8E2D0', marginTop: 10 },
  interactiveCard: { minHeight: 109, borderRadius: 16, backgroundColor: '#E6EEF1', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16 },
  interactiveVisual: { width: 146, height: 85, justifyContent: 'center' },
  interactiveEmpty: { minHeight: 42, padding: 0, alignItems: 'flex-start', gap: 3 },
  interactiveHint: { color: '#405E72', fontSize: 11 },
  mediaFooter: { height: 60, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#E3E8DC' },
  mediaFooterAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9 },
  mediaFooterLabel: { fontSize: 12, fontWeight: '600' },
  imageFull: { flex: 1, backgroundColor: '#20372D' },
  imageFullHeader: { minHeight: 76, paddingHorizontal: 24, paddingTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  imageFullTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  imageClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#365044', alignItems: 'center', justifyContent: 'center' },
  fullImageArea: { height: 262, marginTop: 98, justifyContent: 'center' },
  fullCaption: { paddingHorizontal: 24, alignItems: 'flex-start', minHeight: 100, marginTop: 36 },
  world: { flex: 1, backgroundColor: '#FFFFFF' },
  worldHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 20 },
  worldTitle: { flex: 1, fontSize: 20, marginLeft: 13 },
  worldTabs: { width: 129, height: 38, padding: 4, borderRadius: 20, backgroundColor: '#F2F6ED', flexDirection: 'row' },
  worldTab: { flex: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  worldTabSelected: { backgroundColor: '#FFFFFF' },
  worldTabLabel: { fontSize: 12, color: '#625D50' },
  worldSelectedText: { color: colors.green, fontWeight: '700' },
  worldBody: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 18 },
  workIdentity: { minHeight: 110, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#E3E8DC', paddingHorizontal: 4, gap: 16 },
  workCover: { width: 44, height: 66, borderRadius: 5, backgroundColor: '#F2F6ED', justifyContent: 'center' },
  workIdentityEmpty: { flex: 1, minHeight: 72, padding: 0, alignItems: 'flex-start', gap: 6 },
  readScope: { alignSelf: 'flex-start', marginTop: 32, minHeight: 26, borderRadius: 13, backgroundColor: '#F2F6ED', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  scopeLabel: { fontSize: 10 },
  relationTitle: { marginTop: 25, marginHorizontal: 4, fontSize: 18 },
  legend: { flexDirection: 'row', gap: 15, marginHorizontal: 4, marginTop: 12, marginBottom: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10 },
  relationMap: { flex: 1, minHeight: 360, borderRadius: 20, backgroundColor: '#F2F6ED', justifyContent: 'center' },
  worldFooter: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 12, backgroundColor: '#FFFFFF' },
  returnButton: { minHeight: 48, borderRadius: 26 },
  termsBody: { flexGrow: 1, paddingHorizontal: 24 },
  termsWork: { minHeight: 64, padding: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: 10 },
  termsTitle: { fontSize: 20, marginTop: 10 },
  termList: { flex: 1, minHeight: 360, justifyContent: 'center' },
});
// #endregion
