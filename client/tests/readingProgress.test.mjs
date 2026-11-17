import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { matchesReadingResume, parseReadingProgress, readingSegments, restoreReadingOffset, sameReadingPosition, saveReadingProgress } from '../src/readingProgress.ts';
import { createMemberSessionClient, MemberRequestError } from '../src/memberSession.ts';
import { adjacentMagazinePage, magazineArticle, startMagazinePage } from '../src/magazineReader.ts';
import { highlightPieces, isTextBoundary } from '../src/highlights.ts';
import { selectChapter } from '../src/readerNavigation.ts';

const hash = 'a'.repeat(64);
const position = { chapterId: '9007199254740993', offset: 8, unit: 'utf16', contentVersion: 3, contentHash: hash };
const saved = { workId: 'test-novel', kind: 'novel', state: 'saved', position, revision: '9007199254740995',
  lastReadAt: '2026-11-10T10:00:00Z', chapterPercent: 24, workPercent: null, maxChapterId: position.chapterId,
  libraryStatus: 'READING', hasNewChapters: false };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('원문 UTF-16 문단 경계를 보존하고 회차 끝을 구분합니다.', () => {
  const text = 'A😀B\n\n두 번째\n한 줄\n\n마지막\n\n';
  const parts = readingSegments(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.map(part => part.offset), [0, 6, text.indexOf('마지막')]);
  assert.equal(restoreReadingOffset(parts, 8, text.length), 6);
  assert.equal(restoreReadingOffset(parts, text.length, text.length), text.length);
  assert.deepEqual(readingSegments(''), []);
});

test('읽기 위치 파서는 작품, 단위, 상태와 정밀한 ID를 검사합니다.', () => {
  assert.deepEqual(parseReadingProgress(saved, 'test-novel'), saved);
  assert.throws(() => parseReadingProgress(saved, 'other'), /응답/);
  assert.throws(() => parseReadingProgress({ ...saved, kind: 'magazine' }, 'test-novel'), /응답/);
  assert.throws(() => parseReadingProgress({ ...saved, position: null }, 'test-novel'), /응답/);
  assert.throws(() => parseReadingProgress({ ...saved, revision: null }, 'test-novel'), /응답/);
});

test('상세의 위치를 더 새로운 서버 revision과 섞지 않습니다.', () => {
  assert.equal(matchesReadingResume(saved, position, saved.revision), true);
  assert.equal(matchesReadingResume({ ...saved, revision: '9007199254740996' }, position, saved.revision), false);
  const changed = { ...position, contentHash: 'b'.repeat(64), offset: 0 };
  assert.equal(matchesReadingResume({ ...saved, state: 'stale', position: changed }, position, saved.revision), false);
});

test('저장에는 같은 세션의 CSRF와 revision만 보내고 충돌 코드를 보존합니다.', async () => {
  const client = createMemberSessionClient('https://test.example', async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/api/auth/session') return json({ id: '1', email: 'reader@example.test', nickname: '독자', createdAt: saved.lastReadAt });
    if (path === '/api/auth/csrf') return json({ headerName: 'X-CSRF-TOKEN', token: 'csrf-progress' });
    assert.equal(path, '/api/members/works/test-novel/reading-progress');
    assert.equal(init.credentials, 'include');
    assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'csrf-progress');
    assert.deepEqual(JSON.parse(init.body), { chapterId: position.chapterId, offset: 8, contentVersion: 3, expectedRevision: null });
    return json({ code: 'PROGRESS_CONFLICT', message: '새 위치' }, 409);
  });
  try {
    await client.refresh();
    await assert.rejects(saveReadingProgress(client, 'test-novel', position, null),
      error => error instanceof MemberRequestError && error.status === 409 && error.code === 'PROGRESS_CONFLICT');
  } finally {
    client.dispose();
  }
});

// #region 실제 리더의 저장·하이라이트 흐름
const ts = createRequire(import.meta.url)('typescript');
const readerSource = ts.createSourceFile('ReadingScreens.tsx',
  readFileSync(new URL('../src/ReadingScreens.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const textBody = '첫 장\n\n가😀나다\n\n마지막 문단';
const textOffset = textBody.indexOf('가');
const readerData = { workId: 'test-novel', workTitle: '작품', kind: 'novel',
  chapter: { id: '11', title: '첫 장', number: 1 },
  contents: [{ id: '11', title: '첫 장', number: 1 }, { id: '12', title: '둘째 장', number: 2 }],
  body: textBody, contentVersion: 2, contentHash: hash };
const readerIssue = { workId: 'test-magazine', title: '매거진', pageCount: 3,
  articles: [{ chapterId: '21', title: '첫 기사', startPage: 1, endPage: 3, contentVersion: 2 }] };
const textPosition = { chapterId: '11', offset: textOffset, unit: 'utf16', contentVersion: 2, contentHash: hash };
const pagePosition = { chapterId: '21', offset: 1, unit: 'page', contentVersion: 2, contentHash: null };

/** 실제 TSX 함수와 이벤트를 실행하며 네이티브 배치·네트워크만 대체합니다. */
function readerHarness({ magazine = false, entry, version = 2, canSave = true, highlights = [], realStorage = false } = {}) {
  const name = magazine ? 'MagazineReader' : 'TextReader';
  const declaration = readerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const saveSource = realStorage ? readerSource.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'useReadingSave'
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(readerSource) === 'emptySaveView'))
    .map(node => node.getText(readerSource)).join('\n') : '';
  const compiled = ts.transpileModule(saveSource + '\n' + declaration.getText(readerSource) + '\nexport { ' + name + ' };', {
    fileName: 'ReadingScreens.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const route = { workId: magazine ? readerIssue.workId : readerData.workId, chapterId: magazine ? '21' : '11' };
  if (entry) route[entry] = { ...(magazine ? pagePosition : textPosition), contentVersion: version };
  const app = { baseRoute: route, overlay: null, readingPreferences: { theme: '크림', size: 2, font: '기본 명조' },
    back: () => navigation.push('back'), navigate: value => navigation.push(value) };
  const saves = [], navigation = [], cells = [], effects = [], timers = new Map(), frames = new Map();
  const memberClient = {};
  let serverProgress = { ...saved, workId: route.workId, kind: magazine ? 'magazine' : 'novel',
    position: magazine ? pagePosition : { ...textPosition, offset: 0 } };
  let cursor = 0, dirty = true, tree, clock = 1000, sequence = 0;
  const storage = { canAutoSave: canSave, status: { busy: false, problem: null, retry: false, message: '' },
    latest: { position: textPosition }, wait: () => undefined,
    save: async (value, automatic) => { saves.push({ ...value, automatic }); return true; },
    continueHere: () => { storage.status = { ...storage.status, problem: null }; storage.canAutoSave = true; dirty = true; } };
  const unchanged = (previous, next) => previous && next && previous.length === next.length && next.every((value, i) => Object.is(value, previous[i]));
  const useEffect = (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || !unchanged(previous.dependencies, dependencies)) {
      const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const jsx = (type, props, key) => {
    if (type === 'ScrollView' && props.ref) props.ref.current = { scrollTo: () => {}, getScrollableNode: () => undefined };
    return { type, props, key: key ?? null };
  };
  const context = { exports: {}, require: module => {
    assert.equal(module, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  }, useEffect, useLayoutEffect: useEffect,
  useState: initial => {
    const index = cursor++;
    cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [cells[index].value, next => {
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(cells[index].value, value)) { cells[index].value = value; dirty = true; }
    }];
  }, useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; },
  useMemo: (calculate, dependencies) => {
    const index = cursor++;
    if (!cells[index] || !unchanged(cells[index].dependencies, dependencies)) cells[index] = { value: calculate(), dependencies };
    return cells[index].value;
  }, useApp: () => app, useApiUrl: () => 'https://test.example', useSafeAreaInsets: () => ({ bottom: 0 }),
  useMemberAuth: () => ({ client: memberClient, state: { status: 'authenticated' } }),
  useReadingSave: (_workId, eligible) => ({ ...storage, enabled: eligible, canAutoSave: eligible && storage.canAutoSave }),
  useReaderHighlights: () => ({ items: highlights, authenticated: true, failed: false, refresh: () => {} }),
  fetchChapterText: async () => readerData, fetchMagazineIssue: async () => readerIssue,
  fetchMagazinePage: async (_url, _issue, page) => 'data:image/png;base64,' + Buffer.from('page-' + page).toString('base64'),
  readingSegments, restoreReadingOffset, selectChapter, magazineArticle, adjacentMagazinePage, startMagazinePage,
  matchesReadingResume, sameReadingPosition,
  readReadingProgress: async () => serverProgress,
  saveReadingProgress: async (_client, _workId, value) => {
    saves.push({ ...value }); serverProgress = { ...serverProgress, position: value }; return serverProgress;
  },
  highlightPieces, isTextBoundary, highlightColors: { YELLOW: '#F7DF7B', GREEN: '#A7DFAB' }, MemberRequestError,
  readingFailure: error => error.message, AbortController, Error,
  Date: class extends Date { static now() { return clock; } },
  setTimeout: (run, delay) => { const id = ++sequence; timers.set(id, { run, due: clock + delay }); return id; },
  clearTimeout: id => timers.delete(id),
  requestAnimationFrame: run => { const id = ++sequence; frames.set(id, run); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  Platform: { OS: 'android', select: values => values.default }, styles: {}, s: {}, colors: {} };
  for (const type of ['View', 'Text', 'ScrollView', 'Image', 'ActivityIndicator', 'Action', 'IconButton', 'Modal',
    'Pressable', 'Icon', 'BookmarkButton', 'HighlightEditor', 'ReadingAccessActions', 'EmptyState']) context[type] = type;
  runInNewContext(compiled, context);
  const nodes = (node = tree) => node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).filter(child => child && typeof child === 'object').flatMap(child => nodes(child))] : [];
  const find = (type, label) => nodes().find(node => node.type === type
    && (label === undefined || node.props.label === label || node.props.accessibilityLabel === label));
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (dirty) { dirty = false; cursor = 0; tree = context.exports[name](); }
      effects.splice(0).forEach(run => run());
      for (const [id, run] of [...frames]) { frames.delete(id); run(); }
      await Promise.resolve(); await Promise.resolve();
      if (!dirty && !effects.length && !frames.size) return;
    }
    assert.fail('리더 상태가 안정되지 않았습니다.');
  }
  return { saves, navigation, storage, nodes, find, settle,
    async rerender() { dirty = true; await settle(); },
    async layout() {
      await settle();
      if (magazine) find('Image').props.onLoad({ nativeEvent: { source: { width: 600, height: 800 } } });
      else {
        const scroll = find('ScrollView');
        scroll.props.onLayout({ nativeEvent: { layout: { height: 100 } } });
        nodes().filter(node => node.props.testID === 'chapter-text' || node.props.testID === 'reader-body-text')
          .forEach(node => node.props.onLayout({ nativeEvent: { layout: { y: 0 } } }));
        nodes().filter(node => node.type === 'Text' && node.props.onLayout)
          .forEach((node, index) => node.props.onLayout({ nativeEvent: { layout: { y: index * 240 } } }));
        scroll.props.onContentSizeChange(300, 1000);
      }
      await settle();
    },
    async scroll(y, gesture = true) {
      const scroll = find('ScrollView');
      if (gesture) scroll.props.onScrollBeginDrag();
      scroll.props.onScroll({ nativeEvent: { contentOffset: { y }, contentSize: { height: 1000 }, layoutMeasurement: { height: 100 } } });
      await settle();
    },
    async advance(milliseconds) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.run(); }
      await settle();
    } };
}

test('일반 열람은 첫 표시를 저장하고 기록 진입은 복원·같은 위치 터치·이탈만으로 저장하지 않습니다.', async () => {
  const ordinary = readerHarness(); await ordinary.layout();
  assert.equal(ordinary.saves.length, 1);
  for (const entry of ['bookmarkPosition', 'highlightPosition']) {
    const reader = readerHarness({ entry }); await reader.layout();
    assert.equal(reader.saves.length, 0);
    await reader.scroll(40, false); await reader.scroll(40); await reader.advance(500);
    assert.equal(reader.saves.length, 0);
    reader.find('IconButton', '읽기 화면에서 돌아가기').props.onPress(); await reader.settle();
    assert.deepEqual(reader.navigation, ['back']); assert.equal(reader.saves.length, 0);
    const next = readerHarness({ entry }); await next.layout();
    next.find('Pressable', '다음 회차').props.onPress(); await next.settle();
    assert.equal(next.saves.length, 0); assert.equal(next.navigation[0].chapterId, '12');
  }
});

test('기록 진입 뒤 실제 스크롤은 저장하며 서버 위치 조회 중의 실제 이동도 유지합니다.', async () => {
  for (const canSave of [true, false]) {
    const reader = readerHarness({ entry: 'highlightPosition', canSave }); await reader.layout();
    await reader.scroll(260); await reader.advance(500);
    if (!canSave) { assert.equal(reader.saves.length, 0); reader.storage.canAutoSave = true; await reader.rerender(); }
    assert.equal(reader.saves.length, 1);
    assert.equal(reader.saves[0].offset, textBody.indexOf('마지막'));
  }
});

test('하이라이트 편집은 저장 타이머를 취소하고 숨긴 제목 뒤의 원문 좌표와 색 조각을 유지합니다.', async () => {
  const range = { chapterId: '11', unit: 'utf16', contentVersion: 2, contentHash: hash,
    startOffset: textBody.indexOf('😀'), endOffset: textBody.indexOf('😀') + 2 };
  const reader = readerHarness({ entry: 'highlightPosition', highlights: [{ state: 'available', range, color: 'YELLOW' }] });
  await reader.layout();
  const paragraphs = reader.nodes().filter(node => node.type === 'Text' && node.props.onLayout);
  assert.equal(paragraphs.length, 2); assert.equal(paragraphs[0].key, textOffset);
  const colored = reader.nodes(paragraphs[0]).find(node => node.props.style?.backgroundColor === '#F7DF7B');
  assert.equal(colored.props.children, '😀');
  await reader.scroll(260);
  paragraphs[0].props.onLongPress(); await reader.settle();
  assert.equal(reader.find('HighlightEditor').props.offset, textOffset);
  assert.equal(reader.find('HighlightEditor').props.text, readingSegments(textBody)[1].text);
  await reader.advance(500); await reader.scroll(300); await reader.advance(500);
  assert.equal(reader.saves.length, 0);
  reader.find('IconButton', '읽기 화면에서 돌아가기').props.onPress(); await reader.settle();
  assert.deepEqual(reader.navigation, ['back']); assert.equal(reader.saves.length, 0);
});

test('이전 버전 위치에서 계속 읽기를 선택하면 이전 좌표를 버리고 현재 본문의 저장을 재개합니다.', async () => {
  const reader = readerHarness({ entry: 'resumePosition', version: 1, realStorage: true });
  await reader.layout(); assert.equal(reader.saves.length, 0);
  reader.find('Action', '이 위치에서 계속 읽기').props.onPress(); await reader.settle();
  assert.equal(reader.saves.length, 1); assert.equal(reader.saves[0].contentVersion, 2);
});

test('책갈피·하이라이트 진입 직전 본문 버전이 바뀌어도 확인 후 실제 독서부터 저장할 수 있습니다.', async () => {
  for (const entry of ['bookmarkPosition', 'highlightPosition']) {
    for (const read of [false, true]) {
      const reader = readerHarness({ entry, version: 1, realStorage: true });
      await reader.layout(); assert.equal(reader.saves.length, 0);
      const confirm = reader.find('Action', '현재 본문에서 계속 읽기');
      assert.ok(confirm, '기록 진입에는 서버 이어보기 충돌과 별도의 본문 확인 동작이 필요합니다.');
      confirm.props.onPress(); await reader.settle();
      assert.equal(reader.saves.length, 0);
      if (read) {
        await reader.scroll(260); await reader.advance(500);
        assert.equal(reader.saves.length, 1);
        assert.equal(reader.saves[0].contentVersion, 2);
        assert.equal(reader.saves[0].offset, textBody.indexOf('마지막'));
      } else {
        reader.find('IconButton', '읽기 화면에서 돌아가기').props.onPress(); await reader.settle();
        assert.deepEqual(reader.navigation, ['back']); assert.equal(reader.saves.length, 0);
      }
    }
  }
});

test('매거진 기록 진입은 동일 쪽·로딩으로 저장하지 않고 실제 쪽 넘김 후 저장하며 페이지 키를 분리합니다.', async () => {
  const ordinary = readerHarness({ magazine: true }); await ordinary.layout(); assert.equal(ordinary.saves.length, 1);
  for (const entry of ['bookmarkPosition', 'highlightPosition']) {
    const reader = readerHarness({ magazine: true, entry }); await reader.settle();
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout();
    assert.equal(reader.saves.length, 0);
    reader.find('IconButton', '매거진 목차').props.onPress(); await reader.settle();
    reader.nodes().find(node => node.type === 'Pressable' && node.key === '21').props.onPress(); await reader.settle();
    assert.equal(reader.saves.length, 0);
    reader.find('BookmarkButton').props.onHighlight(); await reader.settle();
    const keys = reader.nodes()[0].props.children.filter(Boolean).map(node => node.key).filter(key => key !== null);
    assert.equal(new Set(keys).size, keys.length);
    reader.find('HighlightEditor').props.onClose(); await reader.settle();
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout();
    assert.equal(reader.saves.length, 1); assert.equal(reader.saves[0].offset, 2);
  }
});

test('긴 매거진 쪽은 복원·드래그 시작만으로 저장하지 않고 실제 스크롤 뒤 같은 쪽을 저장합니다.', async () => {
  for (const canSave of [true, false]) {
    const reader = readerHarness({ magazine: true, entry: 'highlightPosition', canSave }); await reader.layout();
    await reader.scroll(40, false); await reader.scroll(40);
    assert.equal(reader.saves.length, 0);
    reader.find('BookmarkButton').props.onHighlight(); await reader.settle();
    await reader.scroll(80);
    reader.find('HighlightEditor').props.onClose(); await reader.settle();
    assert.equal(reader.saves.length, 0);
    await reader.scroll(120);
    if (!canSave) { assert.equal(reader.saves.length, 0); reader.storage.canAutoSave = true; await reader.rerender(); }
    assert.equal(reader.saves.length, 1); assert.equal(reader.saves[0].offset, 1);
  }
});
// #endregion
