// #region 의존성 가져오기
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from './appState';
import { useApiUrl } from './serverConnection';
import { fetchChapterText, type ChapterText } from './chapterText';
import { selectChapter } from './readerNavigation';
import { useMemberAuth } from './memberAuth';
import { MemberRequestError } from './memberSession';
import { matchesReadingResume, readReadingProgress, readingSegments, restoreReadingOffset, sameReadingPosition, saveReadingProgress,
  type ReadingPosition, type ReadingProgress } from './readingProgress';
import { EmptyState } from './EmptyState';
import { Action, colors, Icon, IconButton, s } from './ui';
// #endregion

// #region 독서 화면
/**
 * 본문 독서 도구 또는 앱북의 미디어 배치를 표시합니다.
 *
 * @remarks
 * 본문 화면은 상단 목차·기록·설정과 하단 회차 이동 도구를 유지합니다.
 * 공개 본문을 표시하고 텍스트 회원 위치를 문단 경계로 저장·복원합니다.
 * 이전/다음은 공개 목차의 이웃이며 경계에서 비활성화합니다.
 *
 * @returns 현재 독서 종류에 맞는 본문 또는 미디어 화면입니다.
 */
export function ReadingScreen() {
  const app = useApp();
  if (app.baseRoute.screen === 'media') return <MediaScreen />;
  return <TextReader />;
}

type SaveView = { busy: boolean; problem: 'review' | 'body' | 'resume' | null; message: string; retry: boolean };
type SaveRun = { current: ReadingProgress | null; draft: ReadingPosition | null; busy: boolean; reviewRequired: boolean; write: Promise<boolean> | null };
const emptySaveView: SaveView = { busy: false, problem: null, message: '', retry: false };

/** 실패한 좌표는 보존하고, 서버 확인 뒤 명시적 재시도를 받습니다. */
function useReadingSave(workId: string | undefined, eligible: boolean, resume?: ReadingPosition, revision?: string | null) {
  const { state: auth, client } = useMemberAuth();
  const enabled = !!workId && eligible && auth.status === 'authenticated';
  const run = useRef<SaveRun | null>(null);
  const [status, setStatus] = useState(emptySaveView);

  async function review() {
    const active = run.current;
    if (!active || !workId || active.busy) return;
    active.busy = true;
    setStatus({ ...emptySaveView, busy: true, message: '서버 위치 확인 중…' });
    try {
      const previous = active.current;
      const actual = await readReadingProgress(client, workId);
      if (run.current !== active) return;
      active.current = actual;
      active.reviewRequired = false;
      if (!previous && resume && !matchesReadingResume(actual, resume, revision)) {
        active.reviewRequired = true;
        setStatus({ ...emptySaveView, problem: 'resume', message: '상세에서 확인한 위치가 바뀌었습니다. 어디에서 읽을지 선택해 주세요.' });
      } else if (active.draft && actual.state === 'saved' && sameReadingPosition(actual.position, active.draft)) {
        active.draft = null;
        setStatus({ ...emptySaveView, message: '서버에서 저장 위치를 확인했습니다.' });
      } else if (active.draft) {
        setStatus({ ...emptySaveView, retry: true, message: previous?.revision === actual.revision
          ? '이 화면에 남긴 위치를 다시 저장할 수 있습니다.'
          : '서버 위치가 바뀌었습니다. 이 화면의 위치를 저장하려면 다시 저장을 선택해 주세요.' });
      } else {
        setStatus(emptySaveView);
      }
    } catch {
      if (run.current === active) setStatus({ ...emptySaveView, problem: 'review', message: '서버 위치를 확인하지 못했습니다.' });
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
    while (run.current === active && active.draft && active.current) {
      const target = active.draft;
      active.draft = null;
      if (active.current.state === 'saved' && sameReadingPosition(active.current.position, target)) {
        if (!automatic) setStatus({ ...emptySaveView, message: '이 위치가 이미 저장되어 있습니다.' });
        continue;
      }
      setStatus({ ...emptySaveView, busy: true, message: '읽기 위치 저장 중…' });
      try {
        const result = await saveReadingProgress(client, slug, target, active.current.revision);
        if (run.current !== active) return false;
        active.current = result;
        setStatus({ ...emptySaveView, message: '읽기 위치를 저장했습니다.' });
      } catch (error) {
        if (run.current !== active) return false;
        active.draft ??= target;
        active.reviewRequired = true;
        const changed = error instanceof MemberRequestError && error.code === 'CONTENT_CHANGED';
        const conflict = error instanceof MemberRequestError && error.status === 409;
        setStatus({ ...emptySaveView, problem: changed ? 'body' : 'review',
          message: changed ? '본문이 바뀌었습니다. 최신 본문에서 위치를 다시 확인해 주세요.'
            : conflict ? '다른 기기의 위치가 먼저 저장되었습니다. 현재 위치를 이 화면에 남겼습니다.'
              : '저장을 확인하지 못했습니다. 현재 위치를 이 화면에 남겼습니다.' });
        return false;
      }
    }
    return run.current === active;
  }

  const canAutoSave = !!run.current?.current && !run.current.reviewRequired && (!run.current.draft || !!run.current.write);
  return { enabled, canAutoSave, status, review, save, latest: run.current?.current ?? null, wait: () => run.current?.write,
    continueHere: () => {
      if (run.current) run.current.reviewRequired = false;
      setStatus(emptySaveView);
    }, retry: () => {
    const draft = run.current?.draft;
    if (draft) void save(draft);
  } };
}

/** 선택이 바뀌면 요청을 취소하고 이전 본문을 새 회차로 표시하지 않습니다. */
function TextReader() {
  const app = useApp(), apiUrl = useApiUrl();
  const insets = useSafeAreaInsets();
  const { workId, chapterId, resumePosition, resumeRevision } = app.baseRoute;
  const readingPalette = {
    '크림': { background: '#F7F8F2', text: colors.ink, muted: colors.muted },
    '연노랑': { background: '#FFF8DE', text: '#3D3526', muted: '#82765D' },
    '연회색': { background: '#ECEEF1', text: '#29323B', muted: '#68717C' },
    '다크': { background: '#233B2F', text: '#F5F1E6', muted: '#C5CEC5' },
  }[app.readingPreferences.theme];
  const bodySize = [13, 15, 17, 19, 21][app.readingPreferences.size] ?? 17;
  const serif = ['기본 명조', '나눔명조', '고운바탕', '함렛'].includes(app.readingPreferences.font);
  const bodyFont = serif ? Platform.select({ ios: 'Georgia', default: 'serif' }) : Platform.select({ ios: 'System', default: 'sans-serif' });
  const [data, setData] = useState<ChapterText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0), [contentsOpen, setContentsOpen] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [restart, setRestart] = useState(false);
  const storage = useReadingSave(workId, !!data && data.kind !== 'magazine', restart ? undefined : resumePosition, resumeRevision);
  const segments = useMemo(() => readingSegments(data?.body ?? ''), [data?.body]);
  const geometry = useRef({ y: 0, viewport: 0, height: 0, chapterY: 0, textY: 0 });
  const anchors = useRef(new Map<number, number>());
  const restored = useRef(false);
  const gestureUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const leaving = useRef(false);
  const validResume = !restart && data && resumePosition?.chapterId === data.chapter.id
    && resumePosition.contentVersion === data.contentVersion && resumePosition.contentHash === data.contentHash
    && resumePosition.offset <= data.body.length ? resumePosition : null;
  const autoPositionReady = !resumePosition || restart || !!validResume;

  const clearGesture = () => {
    gestureUntil.current = 0;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const startGesture = () => {
    if (restored.current && !app.overlay) gestureUntil.current = Date.now() + 1_500;
  };
  useEffect(() => {
    clearGesture();
    return clearGesture;
  }, [app.overlay, bodySize, bodyFont, app.readingPreferences.theme, data]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = scroll.current?.getScrollableNode() as unknown as HTMLElement | undefined;
    if (!node?.addEventListener) return;
    const key = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) startGesture();
    };
    node.addEventListener('wheel', startGesture, { passive: true });
    node.addEventListener('keydown', key);
    return () => { node.removeEventListener('wheel', startGesture); node.removeEventListener('keydown', key); };
  }, [app.overlay, data]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function restore() {
    if (!data || restored.current || geometry.current.viewport <= 0 || geometry.current.height <= 0) return;
    const anchor = restoreReadingOffset(segments, validResume?.offset ?? 0, data.body.length);
    if (anchor > 0 && anchor < data.body.length && !anchors.current.has(anchor)) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const { chapterY, textY, height, viewport } = geometry.current;
      const y = anchor === 0 ? 0 : anchor === data.body.length ? Math.max(0, height - viewport)
        : chapterY + textY + (anchors.current.get(anchor) ?? 0);
      clearGesture();
      restored.current = true;
      geometry.current.y = y;
      scroll.current?.scrollTo({ y, animated: false });
    });
  }

  function saveVisible(automatic = false, atEnd = false): Promise<boolean> {
    if (!data || data.kind === 'magazine' || !restored.current || automatic && !autoPositionReady) {
      return Promise.resolve(false);
    }
    const { y, viewport, height, chapterY, textY } = geometry.current;
    let offset = 0;
    if (atEnd || height > viewport + 4 && y + viewport >= height - 4) offset = data.body.length;
    else {
      for (const part of segments) {
        const top = anchors.current.get(part.offset);
        if (top !== undefined && chapterY + textY + top <= y + 12) offset = part.offset;
      }
    }
    return storage.save({ chapterId: data.chapter.id, offset, unit: 'utf16', contentVersion: data.contentVersion, contentHash: data.contentHash }, automatic);
  }

  function leave(next: () => void) {
    if (leaving.current) return;
    const flush = timer.current !== null && storage.canAutoSave && autoPositionReady;
    clearGesture();
    const pending = flush ? saveVisible(true) : storage.wait();
    if (!pending) { next(); return; }
    leaving.current = true;
    void pending.then(saved => { if (saved) next(); }).finally(() => { leaving.current = false; });
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    geometry.current.y = contentOffset.y;
    geometry.current.height = contentSize.height;
    geometry.current.viewport = layoutMeasurement.height;
    if (gestureUntil.current < Date.now() || !restored.current || app.overlay || !storage.canAutoSave || !autoPositionReady) return;
    gestureUntil.current = Date.now() + 1_500;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { clearGesture(); void saveVisible(true); }, 450);
  }

  useEffect(() => {
    setData(null); setError(null); setContentsOpen(false);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    anchors.current.clear();
    restored.current = false;
    geometry.current.y = 0;
    clearGesture();
    if (!workId || !chapterId) { setError('작품 상세의 목차에서 읽을 회차를 선택해 주십시오.'); return; }
    const controller = new AbortController();
    fetchChapterText(apiUrl, workId, chapterId, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '본문을 불러오지 못했습니다.');
    });
    return () => controller.abort();
  }, [apiUrl, workId, chapterId, attempt]);
  const selection = data ? selectChapter(data.contents, data.chapter.id) : null;
  const move = (id: string) => {
    if (!data || id === data.chapter.id) { setContentsOpen(false); return; }
    leave(() => app.navigate({ screen: 'reader', workId: data.workId, chapterId: id, kind: data.kind }, false, true));
  };
  return <View style={[styles.reader, { backgroundColor: readingPalette.background }]}>
    <View style={[styles.readerHeader, { backgroundColor: readingPalette.background }]}>
      <View style={styles.roundTool}><IconButton icon="back" label="읽기 화면에서 돌아가기" onPress={() => leave(app.back)} /></View>
      <Text numberOfLines={1} style={[s.subtitle, styles.readerTitle, { color: readingPalette.text }]}>{data?.workTitle ?? '독서'}</Text>
      <View style={styles.roundTool}><IconButton icon="list" label="목차" disabled={!data} onPress={() => setContentsOpen(true)} /></View>
      <View style={styles.roundTool}><IconButton icon="bookmark" label="밑줄과 책갈피" onPress={() => app.navigate({ screen: 'records', workId })} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="읽기 설정" onPress={() => app.navigate({ screen: 'readingSettings' })} style={styles.roundTool}><Text style={[s.text, styles.typeTool]}>가</Text></Pressable>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.readerBody} showsVerticalScrollIndicator={false}
      onLayout={event => { geometry.current.viewport = event.nativeEvent.layout.height; restore(); }}
      onContentSizeChange={(_, height) => { clearGesture(); geometry.current.height = height; restore(); }}
      onScrollBeginDrag={startGesture} scrollEventThrottle={16} onScroll={onScroll}>
      {error ? <View accessibilityLiveRegion="polite"><Text style={[s.subtitle, { color: readingPalette.text }]}>본문을 불러오지 못했습니다.</Text><Text style={s.error}>{error}</Text>{workId && chapterId && <Action label="다시 불러오기" onPress={() => setAttempt(v => v + 1)} />}{workId && <Action label="작품 상세로" onPress={() => app.navigate({ screen: 'detail', workId }, false, true)} />}</View>
        : !data ? <View accessibilityLiveRegion="polite"><ActivityIndicator color={colors.green} /><Text style={[s.muted, { color: readingPalette.muted }]}>본문을 불러오고 있습니다.</Text></View>
        : <View testID="chapter-text" onLayout={event => { geometry.current.chapterY = event.nativeEvent.layout.y; restore(); }}>
          <Text style={[s.muted, { color: readingPalette.muted }]}>공개 목차 {data.currentIndex + 1} / {data.contents.length}</Text>
          <Text accessibilityRole="header" style={[s.title, { marginVertical: 24, color: readingPalette.text }]}>{data.chapter.number}{data.kind === 'novel' ? '화' : '장'} · {data.chapter.title}</Text>
          {!restart && resumePosition && !validResume && <Text style={s.muted}>본문이 바뀌어 회차 처음을 표시합니다.</Text>}
          {data.body.length === 0 ? <EmptyState title="이 회차의 본문이 비어 있습니다." tone={app.readingPreferences.theme === '다크' ? 'dark' : 'light'} />
            : <View testID="reader-body-text" onLayout={event => { geometry.current.textY = event.nativeEvent.layout.y; restore(); }}>
              {segments.map(part => <Text key={part.offset} selectable onLayout={event => {
                anchors.current.set(part.offset, event.nativeEvent.layout.y);
                restore();
              }} style={[s.text, { color: readingPalette.text, fontFamily: bodyFont, fontSize: bodySize, lineHeight: bodySize + 15 }]}>{part.text}</Text>)}
            </View>}
        </View>}
    </ScrollView>
    {storage.enabled && <View style={[styles.readerSave, { backgroundColor: readingPalette.background }]}>
      {!!storage.status.message && <Text accessibilityLiveRegion="polite" style={[s.muted, { color: readingPalette.text }]}>{storage.status.message}</Text>}
      {storage.status.problem === 'review' ? <Action compact tone="secondary" label="서버 위치 확인" onPress={() => void storage.review()} />
        : storage.status.problem === 'resume' ? <View style={styles.readerSaveActions}>
          {storage.latest?.position?.unit === 'utf16' && <Action compact label="서버 위치로 이동" onPress={() => {
            const latest = storage.latest;
            if (latest?.position) app.navigate({ screen: 'reader', workId: latest.workId, chapterId: latest.position.chapterId,
              kind: latest.kind, resumePosition: latest.position, resumeRevision: latest.revision }, false, true);
          }} />}
          <Action compact tone="secondary" label="이 위치에서 계속 읽기" onPress={storage.continueHere} />
        </View>
        : storage.status.problem === 'body' ? <Action compact tone="secondary" label="최신 본문 다시 불러오기" onPress={() => {
          setRestart(true);
          setAttempt(value => value + 1);
        }} />
        : <View style={styles.readerSaveActions}>
          {storage.status.retry ? <Action compact label="이 위치 다시 저장" disabled={storage.status.busy} onPress={storage.retry} />
            : <Action compact tone="secondary" label="현재 위치 저장" disabled={storage.status.busy} onPress={() => { clearGesture(); void saveVisible(); }} />}
          {!!data?.body.length && !storage.status.retry && <Action compact tone="secondary" label="회차 끝 저장" disabled={storage.status.busy}
            onPress={() => {
              clearGesture();
              scroll.current?.scrollToEnd({ animated: false });
              saveVisible(false, true);
            }} />}
        </View>}
    </View>}
    <View style={[styles.readerFooter, { backgroundColor: readingPalette.background, borderColor: readingPalette.muted }]}><View style={styles.readerActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="이전 회차" accessibilityState={{ disabled: !selection?.previous }} disabled={!selection?.previous} onPress={() => selection?.previous && move(selection.previous.id)} style={styles.footerAction}><Icon name="back" size={14} color={selection?.previous ? colors.green : readingPalette.muted} /><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>이전화</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="현재 장 처음으로" disabled={!data} accessibilityState={{ disabled: !data }} onPress={() => {
        clearGesture();
        scroll.current?.scrollTo({ y: 0, animated: true });
      }} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>현재 장</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'world', workId, chapterId, kind: data?.kind })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>세계관</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => app.navigate({ screen: 'reviews', workId, chapterId, kind: data?.kind })} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>댓글</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="다음 회차" accessibilityState={{ disabled: !selection?.next }} disabled={!selection?.next} onPress={() => selection?.next && move(selection.next.id)} style={styles.footerAction}><Text style={[s.text, styles.footerLabel, { color: readingPalette.text }]}>다음화</Text><Icon name="next" size={14} color={selection?.next ? colors.green : readingPalette.muted} /></Pressable>
    </View></View>
    <Modal visible={contentsOpen} transparent animationType="fade" onRequestClose={() => setContentsOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}><View style={{ backgroundColor: '#fff', maxWidth: 480, width: '100%', alignSelf: 'center', maxHeight: '85%', padding: 24, paddingBottom: 24 + insets.bottom }}><Text style={s.title}>목차</Text><ScrollView showsVerticalScrollIndicator={false}>{data?.contents.map(chapter => <Pressable key={chapter.id} accessibilityRole="button" accessibilityState={{ selected: chapter.id === chapterId }} accessibilityLabel={chapter.title + ' 열기'} onPress={() => move(chapter.id)} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.line }}><Text style={s.text}>{chapter.number}{data?.kind === 'novel' ? '화' : '장'} · {chapter.title}{chapter.id === chapterId ? ' · 현재 장' : ''}</Text></Pressable>)}</ScrollView><Action label="목차 닫기" onPress={() => setContentsOpen(false)} /></View></View>
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
  readerTitle: { flex: 1, marginLeft: 5, fontSize: 15 },
  typeTool: { fontSize: 21 },
  readerBody: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 10 },
  readerSave: { paddingHorizontal: 16, paddingVertical: 7, gap: 6 },
  readerSaveActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryButton: { alignSelf: 'flex-start', minHeight: 32, borderRadius: 16, paddingHorizontal: 12, gap: 8, backgroundColor: '#EEE3D3', flexDirection: 'row', alignItems: 'center' },
  summaryLabel: { color: colors.brown, fontSize: 12, fontWeight: '600' },
  turnUp: { transform: [{ rotate: '180deg' }] },
  summary: { marginTop: 12, backgroundColor: '#EEE3D3', borderRadius: 12 },
  manuscript: { flex: 1, minHeight: 340, justifyContent: 'center' },
  readerFooter: { minHeight: 110, backgroundColor: '#FFFFFF', paddingTop: 17, borderTopWidth: 1, borderColor: '#E3E8DC' },
  progressTrack: { marginHorizontal: 28, height: 4, borderRadius: 2, backgroundColor: '#E3E8DC' },
  readerActions: { flexDirection: 'row', paddingHorizontal: 20, marginTop: 17, minHeight: 48 },
  footerAction: { flex: 1, minHeight: 44, gap: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footerLabel: { fontSize: 12, fontWeight: '600' },
  disabledText: { color: colors.muted },
  continueLabel: { color: colors.green, opacity: 0.55 },
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
