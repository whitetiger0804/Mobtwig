import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { matchesReadingResume, parseReadingProgress, readingSegments, restoreReadingOffset, sameReadingPosition, saveReadingProgress } from '../src/readingProgress.ts';
import { createMemberSessionClient, MemberRequestError } from '../src/memberSession.ts';
import { adjacentMagazinePage, fetchMagazinePage, magazineArticle, startMagazinePage } from '../src/magazineReader.ts';
import { highlightPieces, isTextBoundary } from '../src/highlights.ts';
import { parseChapterText } from '../src/chapterText.ts';
import { readingFontNames, readingFonts } from '../src/readingFonts.ts';
import { buildPageTops, classifyPageTouch, pageOf, pageTop, turnPage } from '../src/readerPages.ts';

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
const readerChapters = [{ id: '11', title: '첫 장', number: 1 }, { id: '12', title: '첫 장', number: 2 }];
const readerData = { workId: 'test-novel', workTitle: '작품', kind: 'novel',
  chapter: readerChapters[0], contents: readerChapters, currentIndex: 0, previous: null, next: readerChapters[1],
  body: textBody, characterCount: textBody.length, contentVersion: 2, contentHash: hash };
const readerIssue = { workId: 'test-magazine', title: '매거진', pageCount: 3,
  articles: [{ chapterId: '21', title: '첫 기사', startPage: 1, endPage: 3, contentVersion: 2 }] };
const textPosition = { chapterId: '11', offset: textOffset, unit: 'utf16', contentVersion: 2, contentHash: hash };
const pagePosition = { chapterId: '21', offset: 1, unit: 'page', contentVersion: 2, contentHash: null };

/** 실제 화면 공급자의 스택·패널·Android 뒤로가기 이벤트를 실행합니다. */
function navigationHarness(route, preferences, auth) {
  const source = ts.createSourceFile('appState.tsx', readFileSync(new URL('../src/appState.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppProvider'
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(source) === 'overlays'));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n') + '\nexport { AppProvider };', {
    fileName: 'appState.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const cells = [], effects = [], subscriptions = [];
  let cursor = 0, dirty = true, value;
  const unchanged = (previous, next) => previous && next && next.length === previous.length && next.every((item, i) => Object.is(item, previous[i]));
  const context = { exports: {}, AppContext: { Provider: 'AppProvider' }, useMemberAuth: () => ({ state: auth }),
    require: module => { assert.equal(module, 'react/jsx-runtime'); return { jsx: (type, props) => ({ type, props }) }; },
    useState: initial => {
      const index = cursor++; cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, next => {
        const result = typeof next === 'function' ? next(cells[index].value) : next;
        if (!Object.is(result, cells[index].value)) { cells[index].value = result; dirty = true; }
      }];
    },
    useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; },
    useCallback: (callback, dependencies) => {
      const index = cursor++;
      if (!cells[index] || !unchanged(cells[index].dependencies, dependencies)) cells[index] = { callback, dependencies };
      return cells[index].callback;
    },
    useEffect: (run, dependencies) => {
      const index = cursor++, previous = cells[index];
      if (!previous || !unchanged(previous.dependencies, dependencies)) {
        const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
        effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
      }
    },
    BackHandler: { addEventListener: (type, handler) => {
      assert.equal(type, 'hardwareBackPress'); subscriptions.push(handler);
      return { remove: () => subscriptions.splice(subscriptions.indexOf(handler), 1) };
    } },
  };
  runInNewContext(compiled, context);
  function render() {
    for (let round = 0; dirty && round < 30; round++) {
      dirty = false; cursor = 0;
      value = context.exports.AppProvider({ children: null, initialRoute: { screen: 'home', kind: 'all' },
        initialReadingPreferences: preferences, initialLibraryTab: 'all' }).props.value;
      effects.splice(0).forEach(run => run());
    }
    assert.equal(dirty, false, '화면 이동 상태가 안정되지 않았습니다.');
  }
  render(); value.navigate({ screen: 'detail', workId: route.workId }); render(); value.navigate(route); render();
  return { render, get value() { return value; }, hardwareBack: () => [...subscriptions].reverse().some(handler => handler()) };
}

const workProductsSource = ts.createSourceFile('useWorkProducts.ts',
  readFileSync(new URL('../src/useWorkProducts.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** 실제 TSX 함수와 이벤트를 실행하며 네이티브 배치·네트워크만 대체합니다. */
function readerHarness({ magazine = false, entry, version = 2, canSave = true, highlights = [], realStorage = false,
  progress, resumeRevision = saved.revision, autoContinue = false, platform = 'android', chapterId = '11',
  readerKind = 'novel', authenticated = true, font = '기본 명조', realNavigation = false, realProducts = false, mode, entryOffset } = {}) {
  const name = magazine ? 'MagazineReader' : 'TextReader';
  const declaration = readerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const saveSource = realStorage ? readerSource.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'useReadingSave'
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(readerSource) === 'emptySaveView'))
    .map(node => node.getText(readerSource)).join('\n') : '';
  const productsSource = realProducts ? workProductsSource.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'useWorkProducts').getText(workProductsSource) : '';
  const compiled = ts.transpileModule(productsSource + '\n' + saveSource + '\n' + declaration.getText(readerSource) + '\nexport { ' + name + ' };', {
    fileName: 'ReadingScreens.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const route = { screen: 'reader', kind: magazine ? 'magazine' : readerKind,
    workId: magazine ? readerIssue.workId : readerData.workId, chapterId: magazine ? '21' : chapterId, autoContinue };
  if (entry) route[entry] = { ...(magazine ? pagePosition : textPosition), contentVersion: version,
    ...(entryOffset === undefined ? {} : { offset: entryOffset }) };
  if (entry === 'resumePosition') route.resumeRevision = resumeRevision;
  let backHandler = null;
  const app = { baseRoute: route, overlay: null, readingPreferences: { theme: '크림', size: 2, font, ...(mode ? { mode } : {}) },
    registerBackHandler: handler => { backHandler = handler; return () => { backHandler = null; }; },
    back: () => { const next = () => navigation.push('back'); if (backHandler) backHandler(next); else next(); },
    navigate: (value, reset, replace) => {
      navigation.push(value); transitions.push({ reset, replace });
      if (realStorage && value.screen === 'reader') nextRoute = value;
    } };
  const saves = [], writes = [], navigation = [], transitions = [], scrolls = [], pages = [];
  let pageBuilds = 0;
  const purchases = [], productReads = [], listeners = new Map(), documentListeners = new Map();
  const cells = [], effects = [], timers = new Map(), frames = new Map();
  const auth = { status: authenticated ? 'authenticated' : 'anonymous', generation: 1 };
  const provider = realNavigation ? navigationHarness(route, app.readingPreferences, auth) : null;
  if (provider) Object.assign(app, provider.value);
  const memberClient = { getSnapshot: () => auth };
  const network = { page: null, progress: progress ?? { ...saved, workId: route.workId, kind: magazine ? 'magazine' : 'novel',
    position: magazine ? pagePosition : { ...textPosition, offset: 0 } }, read: null, save: null, reads: 0 };
  let cursor = 0, dirty = true, tree, clock = 1000, sequence = 0, mount = 0, nextRoute = null;
  const offer = { loading: false, busy: false, error: null, message: null, buy: null,
    products: [{ productId: '2', workId: readerData.workId, kind: 'novel', chapterId: '12',
      title: '작품', chapterTitle: '둘째 장', price: 300, currency: 'KRW', owned: false, readable: false }],
    purchase: async product => {
      purchases.push({ ...product });
      return offer.buy ? offer.buy(product) : true;
    } };
  const scrollNode = { addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); } };
  const storage = { canAutoSave: canSave, status: { busy: false, problem: null, retry: false, message: '' },
    latest: { position: textPosition }, wait: () => undefined,
    save: async (value, automatic) => { saves.push({ ...value, automatic }); return true; } };
  const unchanged = (previous, next) => previous && next && previous.length === next.length && next.every((value, i) => Object.is(value, previous[i]));
  const useEffect = (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || !unchanged(previous.dependencies, dependencies)) {
      const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const jsx = (type, props, key) => {
    if (type === 'ScrollView' && props.ref) props.ref.current = {
      scrollTo: value => scrolls.push(value), getScrollableNode: () => platform === 'web' ? scrollNode : undefined };
    return { type, props, key: key ?? null };
  };
  const context = { exports: {}, require: module => {
    assert.equal(module, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  }, useEffect, useLayoutEffect: useEffect,
  useState: initial => {
    const index = cursor++, owner = mount;
    cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [cells[index].value, next => {
      if (owner !== mount) return;
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(cells[index].value, value)) { cells[index].value = value; dirty = true; }
    }];
  }, useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; },
  useMemo: (calculate, dependencies) => {
    const index = cursor++;
    if (!cells[index] || !unchanged(cells[index].dependencies, dependencies)) cells[index] = { value: calculate(), dependencies };
    return cells[index].value;
  }, useApp: () => app, useApiUrl: () => 'https://test.example', useSafeAreaInsets: () => ({ bottom: 0 }),
  useMemberAuth: () => ({ client: memberClient, state: { ...auth } }),
  useWorkProducts: workId => workId ? offer : { ...offer, products: null, loading: false, busy: false },
  readPurchaseProducts: async (_url, _client, workId) => { productReads.push(workId); return offer.products; },
  useReadingSave: (_workId, eligible) => ({ ...storage, enabled: eligible, canAutoSave: eligible && storage.canAutoSave }),
  useReaderHighlights: () => ({ items: highlights, authenticated: true, failed: false, refresh: () => {} }),
  fetchChapterText: async (_url, _workId, chapterId) => {
    const contents = readerData.contents;
    const index = chapterId === undefined ? 0 : contents.findIndex(chapter => chapter.id === chapterId);
    return parseChapterText({ ...readerData, kind: readerKind, chapter: contents[index],
      currentIndex: index, previous: contents[index - 1] ?? null, next: contents[index + 1] ?? null });
  },
  fetchMagazineIssue: async () => readerIssue,
  fetchMagazinePage: async (url, issue, page, signal, client) => {
    pages.push(page);
    return network.page ? network.page(url, issue, page, signal, client)
      : 'data:image/png;base64,' + Buffer.from('page-' + page).toString('base64');
  },
  readingFonts, readingSegments, restoreReadingOffset, classifyPageTouch, pageOf, pageTop, turnPage,
  buildPageTops: (...values) => { pageBuilds++; return buildPageTops(...values); },
  document: { addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => { if (documentListeners.get(type) === listener) documentListeners.delete(type); } }, magazineArticle, adjacentMagazinePage, startMagazinePage,
  matchesReadingResume, sameReadingPosition,
  readReadingProgress: async () => {
    network.reads++; return network.read ? network.read() : network.progress;
  },
  saveReadingProgress: async (_client, _workId, value, revision) => {
    saves.push({ ...value }); writes.push({ position: { ...value }, revision });
    if (network.save) return network.save(value, revision);
    network.progress = { ...network.progress, state: 'saved', position: value, revision: String(BigInt(revision ?? 0) + 1n) };
    return network.progress;
  },
  highlightPieces, isTextBoundary, highlightColors: { YELLOW: '#F7DF7B', GREEN: '#A7DFAB' }, MemberRequestError,
  readingFailure: error => error.message, AbortController, Error,
  Date: class extends Date { static now() { return clock; } },
  setTimeout: (run, delay) => { const id = ++sequence; timers.set(id, { run, due: clock + delay }); return id; },
  clearTimeout: id => timers.delete(id),
  requestAnimationFrame: run => { const id = ++sequence; frames.set(id, run); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  Platform: { OS: platform, select: values => values[platform] ?? values.default }, styles: {}, s: {}, colors: {} };
  for (const type of ['View', 'Text', 'ScrollView', 'Image', 'ActivityIndicator', 'Action', 'IconButton', 'Modal', 'ModalPanel',
    'Pressable', 'Icon', 'BookmarkButton', 'HighlightEditor', 'ReadingAccessActions', 'EmptyState']) context[type] = type;
  runInNewContext(compiled, context);
  const nodes = (node = tree) => node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).filter(child => child && typeof child === 'object').flatMap(child => nodes(child))] : [];
  const find = (type, label) => nodes().find(node => node.type === type
    && (label === undefined || node.props.label === label || node.props.accessibilityLabel === label));
  function remount(next) {
    for (const cell of cells) cell?.cleanup?.();
    cells.length = 0; effects.length = 0; mount++;
    app.baseRoute = next; dirty = true;
  }
  const routeKey = value => [value.screen, value.kind, value.workId, value.chapterId, value.resumeRevision,
    ...['resumePosition', 'bookmarkPosition', 'highlightPosition'].flatMap(key =>
      [value[key]?.contentVersion, value[key]?.contentHash, value[key]?.offset])].join(':');
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (provider) {
        const previous = app.baseRoute, previousOverlay = app.overlay;
        provider.render(); Object.assign(app, provider.value);
        if (previous !== app.baseRoute || previousOverlay !== app.overlay) dirty = true;
        if (app.baseRoute.screen !== 'reader') {
          for (const cell of cells) cell?.cleanup?.();
          cells.length = 0; effects.length = 0; mount++; dirty = false; tree = null;
          return;
        }
      }
      if (nextRoute) {
        const next = nextRoute; nextRoute = null;
        if (routeKey(app.baseRoute) === routeKey(next)) { app.baseRoute = next; dirty = true; }
        else remount(next);
      }
      if (dirty) { dirty = false; cursor = 0; tree = context.exports[name](); }
      effects.splice(0).forEach(run => run());
      for (const [id, run] of [...frames]) { frames.delete(id); run(); }
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length && !frames.size && !nextRoute) return;
    }
    assert.fail('리더 상태가 안정되지 않았습니다.');
  }
  return { get pageBuilds() { return pageBuilds; }, saves, writes, navigation, transitions, scrolls, pages, purchases, productReads, offer, network, storage, nodes, find, settle,
    get route() { return app.baseRoute; }, get overlayRoute() { return app.overlay; },
    async hardwareBack() { assert.ok(provider); const handled = provider.hardwareBack(); await settle(); return handled; },
    async navigate(route) { assert.ok(provider); provider.value.navigate(route); await settle(); },
    async changeSession() { auth.generation++; remount(app.baseRoute); await settle(); },
    async overlay(value) {
      if (provider) { if (value) provider.value.navigate(value); else provider.value.back(); }
      else app.overlay = value;
      dirty = true; await settle();
    },
    async touch(phase, { x = 100, y = 300, touches = 1 } = {}) {
      find('ScrollView').props['onTouch' + phase]({ nativeEvent: { pageX: x, pageY: y, touches: Array(touches).fill({}) } });
      await settle();
    },
    async dragEnd(velocity = -1) {
      find('ScrollView').props.onScrollEndDrag({ nativeEvent: { velocity: { y: velocity } } });
      await settle();
    },
    async wheel(deltaY) { listeners.get('wheel')({ deltaY }); await settle(); },
    async key(key, repeat = false) { listeners.get('keydown')({ key, repeat, preventDefault() {} }); await settle(); },
    async rerender() { dirty = true; await settle(); },
    /**
     * 본문 레이아웃을 흉내 냅니다. 문단 i는 i×spacing에서 시작하고 마지막 문단은 height까지 차지합니다.
     * line을 주면 네이티브 onTextLayout으로 그 높이의 실제 줄 위치를 함께 보냅니다. extra는 책장 모드 여백처럼 콘텐츠 높이에만 더합니다.
     */
    async layout({ height = 1000, viewport = 100, spacing = 240, line, extra = 0 } = {}) {
      await settle();
      if (magazine) find('Image').props.onLoad({ nativeEvent: { source: { width: 600, height: 800 } } });
      else {
        const scroll = find('ScrollView');
        nodes().find(node => node.props.testID === 'reader-pages')
          ?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: viewport } } });
        scroll.props.onLayout({ nativeEvent: { layout: { height: viewport } } });
        nodes().filter(node => node.props.testID === 'chapter-text' || node.props.testID === 'reader-body-text')
          .forEach(node => node.props.onLayout({ nativeEvent: { layout: { y: 0 } } }));
        const paragraphs = nodes().filter(node => node.type === 'Text' && node.props.onLayout);
        paragraphs.forEach((node, index) => {
          const size = index < paragraphs.length - 1 ? spacing : height - index * spacing;
          node.props.onLayout({ nativeEvent: { layout: { y: index * spacing, height: size } } });
          if (line) node.props.onTextLayout?.({ nativeEvent: { lines: Array.from({ length: Math.floor(size / line) }, (_, at) => ({ y: at * line, height: line })) } });
        });
        scroll.props.onContentSizeChange(300, height + extra);
      }
      await settle();
    },
    async scroll(y, gesture = true) {
      const scroll = find('ScrollView');
      if (gesture) scroll.props.onScrollBeginDrag();
      scroll.props.onScroll({ nativeEvent: { contentOffset: { y }, contentSize: { height: 1000 }, layoutMeasurement: { height: 100 } } });
      await settle();
    },
    async preferences(change) { app.readingPreferences = { ...app.readingPreferences, ...change }; dirty = true; await settle(); },
    async viewport(height) { find('ScrollView').props.onLayout({ nativeEvent: { layout: { height } } }); await settle(); },
    async pageTouch(start, end, duration = 100) {
      const area = nodes().find(node => node.props.testID === 'reader-pages');
      area.props.onTouchStart?.({ nativeEvent: { pageX: start.x, pageY: start.y, touches: [{}] } });
      clock += duration;
      area.props.onTouchEnd?.({ nativeEvent: { pageX: end.x, pageY: end.y, touches: [] } });
      await settle();
    },
    async pageKey(key) {
      let prevented = false;
      documentListeners.get('keydown')?.({ key, repeat: false, target: null, preventDefault() { prevented = true; } });
      await settle();
      return prevented;
    },
    async advance(milliseconds) {
      clock += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.due <= clock) { timers.delete(id); timer.run(); }
      await settle();
    } };
}

test('공개 PNG의 15초 제한은 실제 HTTP 본문 수신과 연결도 중단합니다.', { timeout: 20_000 }, async t => {
  let bodyStarted, disconnected;
  const receiving = new Promise(resolve => { bodyStarted = resolve; });
  const closed = new Promise(resolve => { disconnected = resolve; });
  const server = createServer((_request, response) => {
    response.on('close', disconnected);
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.write(Buffer.from([137, 80, 78, 71]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const reader = readerHarness({ magazine: true, authenticated: false, realNavigation: true });
  t.after(async () => {
    await reader.navigate({ screen: 'home' });
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (...args) => {
    const response = await nativeFetch(...args);
    const blob = response.blob.bind(response);
    response.blob = () => { bodyStarted(); return blob(); };
    return response;
  });
  let signal;
  reader.network.page = (_url, issue, page, current, client) => {
    assert.equal(client, undefined);
    signal = current;
    return fetchMagazinePage('http://127.0.0.1:' + server.address().port, issue, page, current);
  };
  await reader.settle();
  await receiving;
  await reader.advance(14_999);
  assert.equal(signal.aborted, false);
  await reader.advance(1);
  assert.equal(signal.aborted, true);
  await closed;
  assert.ok(reader.find('Action', '쪽 다시 불러오기'));
  assert.equal(reader.find('Image'), undefined);
});

test('PNG 시간 초과 후 늦은 결과는 버리고 재시도 요청은 새 제한 시간으로 처리합니다.', async () => {
  const reader = readerHarness({ magazine: true, authenticated: false });
  const calls = [];
  reader.network.page = (_url, _issue, _page, signal) => new Promise(resolve => { calls.push({ signal, resolve }); });
  await reader.settle();
  await reader.advance(15_000);
  assert.equal(calls[0].signal.aborted, true);
  reader.find('Action', '쪽 다시 불러오기').props.onPress();
  await reader.settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal.aborted, false);
  calls[0].resolve('data:image/png;base64,b2xk');
  await reader.settle();
  assert.equal(reader.find('Image'), undefined);
  await reader.advance(14_999);
  assert.equal(calls[1].signal.aborted, false);
  calls[1].resolve('data:image/png;base64,bmV3');
  await reader.layout();
  await reader.advance(1);
  assert.equal(calls[1].signal.aborted, false);
  assert.equal(reader.find('Image').props.source.uri, 'data:image/png;base64,bmV3');
});

test('표시한 PNG는 시간 초과로 중단하지 않고 쪽 변경과 화면 이탈 때 기존 요청만 정리합니다.', async () => {
  const reader = readerHarness({ magazine: true, authenticated: false, realNavigation: true });
  const signals = [];
  reader.network.page = (_url, _issue, page, signal) => {
    signals.push(signal);
    return 'data:image/png;base64,' + Buffer.from('page-' + page).toString('base64');
  };
  await reader.layout();
  await reader.advance(15_000);
  assert.equal(signals[0].aborted, false);
  reader.find('IconButton', '다음 쪽').props.onPress();
  await reader.layout();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  await reader.navigate({ screen: 'home' });
  assert.equal(signals[1].aborted, true);
});

test('공통 뒤로가기는 450ms 전에 최신 본문 위치를 저장하고 대기 중 반복 입력도 한 번만 이동합니다.', async () => {
  for (const action of ['hardware', 'header']) {
    const reader = readerHarness({ realStorage: true, realNavigation: true }); await reader.layout();
    const before = reader.saves.length; let complete;
    reader.network.save = () => new Promise(resolve => { complete = resolve; });
    await reader.scroll(260);
    assert.equal(reader.saves.length, before);
    if (action === 'hardware') assert.equal(await reader.hardwareBack(), true);
    else { reader.find('IconButton', '읽기 화면에서 돌아가기').props.onPress(); await reader.settle(); }
    assert.equal(reader.route.screen, 'reader');
    assert.equal(reader.saves.length, before + 1);
    assert.equal(reader.saves.at(-1).offset, textBody.indexOf('마지막'));
    await reader.hardwareBack(); await reader.hardwareBack(); await reader.advance(500);
    assert.equal(reader.saves.length, before + 1);
    complete({ ...reader.network.progress, state: 'saved', position: reader.saves.at(-1), revision: '42' });
    await reader.settle(); assert.equal(reader.route.screen, 'detail');
    await reader.hardwareBack(); assert.equal(reader.route.screen, 'home');
    assert.equal(await reader.hardwareBack(), false);
  }
});

test('공통 뒤로가기는 매거진 저장을 기다리고 반복 입력으로 이전 화면을 건너뛰지 않습니다.', async () => {
  for (const action of ['hardware', 'header']) {
    const reader = readerHarness({ magazine: true, realStorage: true, realNavigation: true }); await reader.layout();
    let complete;
    reader.network.save = () => new Promise(resolve => { complete = resolve; });
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout();
    assert.equal(reader.saves.at(-1).offset, 2);
    if (action === 'hardware') await reader.hardwareBack();
    else { reader.find('IconButton', '매거진에서 돌아가기').props.onPress(); await reader.settle(); }
    await reader.hardwareBack(); await reader.hardwareBack();
    assert.equal(reader.route.screen, 'reader');
    complete({ ...reader.network.progress, state: 'saved', position: reader.saves.at(-1), revision: '42' });
    await reader.settle(); assert.equal(reader.route.screen, 'detail');
    await reader.hardwareBack(); assert.equal(reader.route.screen, 'home');
  }
});

test('공통 뒤로가기는 저장 실패 시 리더를 유지하고 외부 화면 이동 뒤의 응답은 무시합니다.', async () => {
  for (const magazine of [false, true]) {
    for (const leaveElsewhere of [false, true]) {
      const reader = readerHarness({ magazine, realStorage: true, realNavigation: true }); await reader.layout();
      let complete, reject;
      reader.network.save = () => new Promise((resolve, fail) => { complete = resolve; reject = fail; });
      if (magazine) { reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout(); }
      else await reader.scroll(260);
      await reader.hardwareBack();
      assert.equal(reader.route.screen, 'reader');
      if (leaveElsewhere) {
        await reader.navigate({ screen: 'detail', workId: 'another-work' });
        complete({ ...reader.network.progress, state: 'saved', position: reader.saves.at(-1), revision: '42' });
        await new Promise(resolve => setImmediate(resolve));
      } else reject(new Error('저장 연결 오류'));
      await reader.settle(); assert.equal(reader.route.screen, leaveElsewhere ? 'detail' : 'reader');
      if (leaveElsewhere) assert.equal(reader.route.workId, 'another-work');
    }
  }
});

test('공통 뒤로가기는 패널부터 닫으며 기록 위치를 보기만 한 경우 새 위치를 저장하지 않습니다.', async () => {
  const reader = readerHarness({ realStorage: true, realNavigation: true }); await reader.layout();
  const before = reader.saves.length;
  await reader.scroll(260); await reader.overlay({ screen: 'readingSettings' });
  await reader.hardwareBack();
  assert.equal(reader.route.screen, 'reader'); assert.equal(reader.overlayRoute, null); assert.equal(reader.saves.length, before);
  await reader.hardwareBack(); assert.equal(reader.route.screen, 'detail');
  assert.equal(reader.saves.at(-1).offset, textBody.indexOf('마지막'));
  for (const magazine of [false, true]) {
    for (const entry of ['bookmarkPosition', 'highlightPosition']) {
      const record = readerHarness({ magazine, entry, realStorage: true, realNavigation: true }); await record.layout();
      await record.hardwareBack(); assert.equal(record.route.screen, 'detail'); assert.equal(record.saves.length, 0);
    }
  }
});

test('저장한 여덟 글꼴을 실제 텍스트 본문에 각각 연결합니다.', async () => {
  for (const font of readingFontNames) {
    const reader = readerHarness({ font });
    await reader.settle();
    const body = reader.nodes().find(node => node.type === 'Text' && Array.isArray(node.props.children)
      && node.props.children.some(piece => typeof piece === 'string' && piece.includes('가😀나다')));
    assert.ok(body, font);
    assert.equal(body.props.style.find(style => style?.fontFamily).fontFamily, readingFonts[font].family, font);
  }
});

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

test('이전 버전 이어보기는 선택 없이 서버의 현재 본문 위치로 이동합니다.', async () => {
  const reader = readerHarness({ entry: 'resumePosition', version: 1, realStorage: true });
  await reader.layout();
  assert.equal(reader.navigation.length, 1);
  assert.equal(reader.navigation[0].resumePosition.contentVersion, 2);
  assert.equal(reader.scrolls.at(-1).y, 0);
  assert.equal(reader.find('Action', '이 위치에서 계속 읽기'), undefined);
  assert.ok(reader.saves.every(value => value.contentVersion === 2));
});

test('오래된 책갈피·하이라이트는 확인 버튼 없이 처음을 표시하며 실제 독서부터 저장합니다.', async () => {
  for (const entry of ['bookmarkPosition', 'highlightPosition']) {
    for (const read of [false, true]) {
      const reader = readerHarness({ entry, version: 1, realStorage: true });
      await reader.layout(); assert.equal(reader.saves.length, 0);
      assert.equal(reader.find('Action', '현재 본문에서 계속 읽기'), undefined);
      assert.equal(reader.scrolls.at(-1).y, 0);
      assert.equal(reader.navigation.length, 0);
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

test('이어보기의 위치 또는 revision이 바뀌면 경로를 교체하고 최신 텍스트 위치를 복원합니다.', async () => {
  for (const chapterId of ['11', '12']) {
    for (const offset of [textOffset, textBody.indexOf('마지막')]) {
      const latest = { ...saved, position: { ...textPosition, chapterId, offset }, revision: '42' };
      const reader = readerHarness({ entry: 'resumePosition', realStorage: true, progress: latest });
      await reader.layout();
      assert.equal(reader.navigation.length, 1);
      assert.equal(reader.transitions[0].reset, false); assert.equal(reader.transitions[0].replace, true);
      assert.equal(reader.navigation[0].chapterId, chapterId);
      assert.equal(reader.navigation[0].resumePosition.offset, offset);
      assert.equal(reader.navigation[0].resumeRevision, '42');
      assert.equal(reader.scrolls.at(-1).y, offset === textOffset ? 0 : 240);
      assert.equal(reader.saves.length, 0);
      assert.equal(reader.find('Action', '저장한 위치로 이동'), undefined);
      assert.equal(reader.find('Action', '이 위치에서 계속 읽기'), undefined);
    }
  }
});

test('매거진 이어보기는 선택 없이 서버의 최신 쪽 이미지를 표시합니다.', async () => {
  const latest = { ...saved, workId: readerIssue.workId, kind: 'magazine',
    position: { ...pagePosition, offset: 3 }, revision: '42' };
  const reader = readerHarness({ magazine: true, entry: 'resumePosition', realStorage: true, progress: latest });
  await reader.layout();
  assert.equal(reader.navigation.length, 1);
  assert.equal(reader.navigation[0].resumePosition.offset, 3);
  assert.equal(reader.pages.at(-1), 3);
  assert.equal(reader.find('BookmarkButton').props.position.offset, 3);
  assert.equal(reader.saves.length, 0);
  assert.equal(reader.find('Action', '저장한 쪽으로 이동'), undefined);
  assert.equal(reader.find('Action', '이 쪽에서 계속 읽기'), undefined);
});

test('저장 충돌은 최신 위치를 자동 조회·복원하며 실패한 옛 위치를 다시 저장하지 않습니다.', async () => {
  for (const magazine of [false, true]) {
    const reader = readerHarness({ magazine, realStorage: true });
    await reader.layout();
    const before = reader.saves.length;
    reader.network.save = async () => {
      reader.network.progress = { ...reader.network.progress, revision: '42', position: magazine
        ? { ...pagePosition, offset: 3 } : { ...textPosition, chapterId: '12' } };
      throw new MemberRequestError(409, 'PROGRESS_CONFLICT');
    };
    if (magazine) { reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout(); }
    else { await reader.scroll(260); await reader.advance(500); }
    reader.network.save = null;
    await reader.layout();
    assert.equal(reader.saves.length, before + 1);
    assert.equal(reader.navigation.length, 1);
    assert.equal(reader.navigation[0].resumeRevision, '42');
    if (magazine) assert.equal(reader.pages.at(-1), 3);
    else { assert.equal(reader.navigation[0].chapterId, '12'); assert.equal(reader.scrolls.at(-1).y, 0); }
    assert.equal(reader.find('Action', '읽기 위치 다시 확인'), undefined);
  }
});

test('충돌 후 서버에 같은 위치가 이미 저장됐으면 이동·중복 저장 없이 해제합니다.', async () => {
  const reader = readerHarness({ realStorage: true }); await reader.layout();
  const before = reader.saves.length;
  reader.network.save = async value => {
    reader.network.progress = { ...reader.network.progress, position: value, revision: '42' };
    throw new MemberRequestError(409, 'PROGRESS_CONFLICT');
  };
  await reader.scroll(260); await reader.advance(500);
  assert.equal(reader.navigation.length, 0);
  assert.equal(reader.saves.length, before + 1);
  assert.equal(reader.find('Action', '읽기 위치 다시 확인'), undefined);
  reader.network.save = null;
  await reader.scroll(0); await reader.advance(500);
  assert.equal(reader.writes.at(-1).revision, '42');
});

test('재시도 위치는 서버 재확인 전·중·후에 스크롤한 현재 본문 위치입니다.', async () => {
  for (const timing of ['before', 'during', 'after']) {
    const reader = readerHarness({ realStorage: true });
    reader.network.save = async () => { throw new MemberRequestError(503); };
    await reader.layout();
    assert.equal(reader.saves.at(-1).offset, textOffset);
    if (timing === 'before') await reader.scroll(260);
    let reviewed;
    const actual = { ...reader.network.progress }, revision = actual.revision;
    reader.network.read = () => new Promise(resolve => { reviewed = resolve; });
    reader.find('Action', '읽기 위치 다시 확인').props.onPress(); await reader.settle();
    if (timing === 'during') await reader.scroll(260);
    reviewed(actual); await reader.settle();
    if (timing === 'after') await reader.scroll(260);
    assert.equal(reader.saves.length, 1); assert.equal(reader.navigation.length, 0);
    const retry = reader.find('Action', '현재 위치 다시 저장'); assert.ok(retry);
    reader.network.save = null;
    retry.props.onPress(); await reader.settle();
    assert.equal(reader.saves.length, 2);
    assert.equal(reader.saves[1].offset, textBody.indexOf('마지막'));
    assert.equal(reader.writes[1].revision, revision);
  }
});

test('재시도 위치는 실패한 매거진 쪽 대신 재확인 전·후에 표시한 현재 쪽입니다.', async () => {
  for (const timing of ['before', 'after']) {
    const reader = readerHarness({ magazine: true, realStorage: true }); await reader.layout();
    const before = reader.saves.length, revision = reader.network.progress.revision;
    reader.network.save = async () => { throw new MemberRequestError(503); };
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout();
    assert.equal(reader.saves.at(-1).offset, 2);
    if (timing === 'before') { reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout(); }
    reader.find('Action', '읽기 위치 다시 확인').props.onPress(); await reader.settle();
    if (timing === 'after') { reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout(); }
    assert.equal(reader.saves.length, before + 1);
    const retry = reader.find('Action', '현재 쪽 다시 저장'); assert.ok(retry); assert.equal(retry.props.disabled, false);
    reader.network.save = null;
    retry.props.onPress(); await reader.settle();
    assert.equal(reader.saves[before + 1].offset, 3);
    assert.equal(reader.writes[before + 1].revision, revision);
    assert.equal(reader.saves.length, before + 2);
  }
});

test('재시도 위치는 매거진 이미지가 표시된 뒤에만 저장할 수 있습니다.', async () => {
  for (const failImage of [false, true]) {
    const reader = readerHarness({ magazine: true, realStorage: true }); await reader.layout();
    reader.network.save = async () => { throw new MemberRequestError(503); };
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.layout();
    reader.find('Action', '읽기 위치 다시 확인').props.onPress(); await reader.settle();
    reader.find('IconButton', '다음 쪽').props.onPress(); await reader.settle();
    if (failImage) { reader.find('Image').props.onError(); await reader.settle(); }
    const before = reader.saves.length;
    assert.equal(reader.find('Action', '현재 쪽 다시 저장').props.disabled, true);
    assert.equal(reader.saves.length, before);
    if (!failImage) {
      await reader.layout();
      const retry = reader.find('Action', '현재 쪽 다시 저장'); assert.equal(retry.props.disabled, false);
      reader.network.save = null;
      retry.props.onPress(); await reader.settle();
      assert.equal(reader.saves[before].offset, 3);
    }
  }
});

test('통신 실패와 본문 변경은 임의 이동 없이 기존 오류·재시도 동작을 유지합니다.', async () => {
  for (const code of [null, 'CONTENT_CHANGED', 'PROGRESS_CONFLICT']) {
    const reader = readerHarness({ realStorage: true }); await reader.layout();
    reader.network.save = async () => { throw new MemberRequestError(code ? 409 : 503, code); };
    if (code === 'PROGRESS_CONFLICT') reader.network.read = async () => { throw new Error('연결 실패'); };
    await reader.scroll(260); await reader.advance(500);
    assert.equal(reader.navigation.length, 0);
    if (code === 'CONTENT_CHANGED') assert.ok(reader.find('Action', '최신 본문 다시 불러오기'));
    else {
      reader.network.read = async () => { throw new Error('연결 실패'); };
      reader.find('Action', '읽기 위치 다시 확인').props.onPress(); await reader.settle();
      assert.ok(reader.find('Action', '읽기 위치 다시 확인'));
      reader.network.read = null;
      reader.find('Action', '읽기 위치 다시 확인').props.onPress(); await reader.settle();
      assert.ok(reader.find('Action', '현재 위치 다시 저장'));
    }
  }
});

test('stale·new 응답은 서버가 제공한 위치나 회차 처음으로 이동하고 반복 탐색하지 않습니다.', async () => {
  for (const magazine of [false, true]) {
    for (const state of ['stale', 'new']) {
      for (const hasPosition of [false, true]) {
        const latest = { ...saved, workId: magazine ? readerIssue.workId : readerData.workId,
          kind: magazine ? 'magazine' : 'novel', state, revision: state === 'new' ? null : '42',
          lastReadAt: state === 'new' ? null : saved.lastReadAt,
          position: hasPosition ? magazine ? { ...pagePosition, offset: 2 }
            : { ...textPosition, offset: textBody.indexOf('마지막') } : null };
        const reader = readerHarness({ magazine, entry: 'resumePosition', realStorage: true, progress: latest });
        await reader.layout();
        assert.equal(reader.navigation.length, 1);
        assert.equal(!!reader.navigation[0].resumePosition, hasPosition);
        if (magazine) assert.equal(reader.pages.at(-1), hasPosition ? 2 : 1);
        else assert.equal(reader.scrolls.at(-1).y, hasPosition ? 240 : 0);
        assert.ok(reader.saves.length <= 1);
      }
    }
  }
});

test('기록으로 지정한 위치는 서버의 다른 진도로 바꾸지 않으며 세션 변경 뒤 늦은 조회는 무시합니다.', async () => {
  for (const entry of ['bookmarkPosition', 'highlightPosition']) {
    const reader = readerHarness({ entry, realStorage: true,
      progress: { ...saved, position: { ...textPosition, chapterId: '12' } } });
    await reader.layout();
    assert.equal(reader.navigation.length, 0); assert.equal(reader.saves.length, 0);
    reader.find('IconButton', '읽기 화면에서 돌아가기').props.onPress(); await reader.settle();
    assert.deepEqual(reader.navigation, ['back']); assert.equal(reader.saves.length, 0);
  }
  const reader = readerHarness({ entry: 'resumePosition', realStorage: true,
    progress: { ...saved, position: textPosition } });
  let resolveOld;
  reader.network.read = () => new Promise(resolve => { resolveOld = resolve; });
  await reader.settle();
  assert.equal(typeof resolveOld, 'function');
  reader.network.read = null;
  await reader.changeSession(); await reader.layout();
  resolveOld({ ...saved, revision: '42', position: { ...textPosition, chapterId: '12' } });
  await reader.settle();
  assert.equal(reader.navigation.length, 0); assert.equal(reader.saves.length, 0);
});

/** 바닥에서 시작한 추가 위쪽 스와이프를 전달합니다. 실제 좌표 이동은 필요하지 않습니다. */
async function nextSwipe(reader) {
  await reader.touch('Start');
  await reader.touch('End', { y: 220 });
}

test('이어보기는 기본 OFF이며 ON에서도 복원·처음 바닥 도달·불완전한 제스처는 구매하지 않습니다.', async () => {
  const reader = readerHarness({ realStorage: true }); await reader.layout();
  assert.equal(reader.find('Pressable', '이어보기').props.accessibilityState.checked, false);
  await reader.scroll(900, false); await nextSwipe(reader);
  assert.equal(reader.purchases.length, 0); assert.equal(reader.navigation.length, 0);
  const before = reader.scrolls.length;
  reader.find('Pressable', '이어보기').props.onPress(); await reader.settle();
  assert.equal(reader.find('Pressable', '이어보기').props.accessibilityState.checked, true);
  assert.equal(reader.scrolls.length, before, '스위치만 변경할 때 본문을 재마운트하지 않습니다.');
  await reader.scroll(0, false); await reader.touch('Start');
  await reader.scroll(900); await reader.touch('End', { y: 100 }); await reader.advance(500);
  assert.equal(reader.purchases.length, 0);
  for (const end of [{ y: 300 }, { y: 253 }, { y: 350 }, { x: 300, y: 220 }]) {
    await reader.touch('Start'); await reader.touch('End', end);
  }
  await reader.touch('Start', { touches: 2 }); await reader.touch('End', { y: 100 });
  await reader.touch('Start'); await reader.touch('Cancel'); await reader.touch('End', { y: 100 });
  assert.equal(reader.purchases.length, 0);
  await nextSwipe(reader);
  assert.equal(reader.purchases.length, 1);
  assert.equal(reader.purchases[0].chapterId, '12');
  assert.equal(reader.navigation.at(-1).chapterId, '12');
  assert.equal(reader.navigation.at(-1).autoContinue, true);
});

test('네이티브 터치 인계는 취소만으로 구매하지 않고 새 위쪽 드래그의 종료에서 한 번 처리합니다.', async () => {
  const reader = readerHarness({ realStorage: true, autoContinue: true }); await reader.layout();
  await reader.touch('Start'); await reader.scroll(900); await reader.touch('Cancel', { y: 280 });
  await reader.dragEnd();
  assert.equal(reader.purchases.length, 0, '바닥까지 내려온 기존 스크롤은 실행하지 않습니다.');
  await reader.touch('Start'); await reader.touch('Cancel', { y: 292 }); await reader.advance(1000);
  assert.equal(reader.purchases.length, 0, '인계 취소만으로는 구매하지 않습니다.');
  for (const end of [{ y: 300 }, { y: 293 }, { y: 310 }, { x: 120, y: 290 }]) {
    await reader.touch('Start'); await reader.touch('Cancel', end); await reader.dragEnd();
  }
  await reader.touch('Start', { touches: 2 }); await reader.touch('Cancel', { y: 280 }); await reader.dragEnd();
  await reader.touch('Start'); await reader.touch('Cancel', { y: 290 }); await reader.dragEnd(1); await reader.dragEnd();
  assert.equal(reader.purchases.length, 0, '역방향·짧은 이동·다중 터치·뒤집힌 속도는 실행하지 않습니다.');
  let completePurchase;
  reader.offer.buy = () => new Promise(resolve => { completePurchase = resolve; });
  await reader.touch('Start'); await reader.touch('Cancel', { y: 290 });
  assert.equal(reader.purchases.length, 0);
  await reader.dragEnd(); await reader.dragEnd();
  assert.equal(reader.purchases.length, 1); assert.equal(reader.navigation.length, 0);
  completePurchase(true); await reader.settle();
  assert.equal(reader.navigation.length, 1); assert.equal(reader.navigation[0].chapterId, '12');
});

test('실제 상품 hook은 다음 웹소설 회차를 자동으로 열 때만 상품을 조회합니다.', async () => {
  for (const [autoContinue, chapterId, readerKind, expected] of [
    [true, '12', 'novel', 0], [true, '11', 'novel', 1], [false, '11', 'novel', 0], [true, '11', 'book', 0],
  ]) {
    const reader = readerHarness({ autoContinue, chapterId, readerKind, realProducts: true });
    await reader.layout();
    assert.deepEqual(reader.productReads, expected ? [reader.route.workId] : []);
    assert.equal(reader.purchases.length, 0);
    assert.equal(reader.navigation.length, 0);
  }
});

test('무료·소장 회차와 도서의 다음 장은 구매 없이 열고 마지막 회차는 이동하지 않습니다.', async () => {
  for (const mode of ['free', 'owned', 'book', 'last', 'short']) {
    const reader = readerHarness({ realStorage: true, autoContinue: true,
      readerKind: mode === 'book' ? 'book' : 'novel', chapterId: mode === 'last' ? '12' : '11' });
    if (mode !== 'short') Object.assign(reader.offer.products[0], { readable: true,
      owned: mode === 'owned', price: mode === 'free' ? 0 : 300 });
    await reader.layout(mode === 'short' ? { height: 80, viewport: 100 } : undefined);
    assert.equal(reader.purchases.length, 0);
    if (mode !== 'short') await reader.scroll(900, false);
    const before = reader.saves.length;
    await nextSwipe(reader);
    assert.equal(reader.purchases.length, mode === 'short' ? 1 : 0);
    assert.equal(reader.navigation.length, mode === 'last' ? 0 : 1);
    if (mode === 'last') assert.equal(reader.saves.length, before);
    else assert.equal(reader.saves.at(-1).offset, textBody.length);
  }
});

test('상품 로딩·구매 중·조회 오류·목록 누락은 자동 구매나 무료 열람으로 넘어가지 않습니다.', async () => {
  for (const mode of ['loading', 'busy', 'error', 'missing']) {
    const reader = readerHarness({ realStorage: true, autoContinue: true });
    if (mode === 'loading') reader.offer.loading = true;
    if (mode === 'busy') reader.offer.busy = true;
    if (mode === 'error') { reader.offer.error = '상품 조회 오류'; reader.offer.products = null; }
    if (mode === 'missing') reader.offer.products = [];
    await reader.layout(); await reader.scroll(900, false); await nextSwipe(reader);
    assert.equal(reader.purchases.length, 0); assert.equal(reader.navigation.length, 0);
    if (mode === 'error' || mode === 'missing') assert.ok(reader.nodes().some(node => node.props.accessibilityRole === 'alert'));
  }
});

test('가격 변경·구매 실패는 현재 회차에 머물며 추가 동작 없이 구매를 반복하지 않습니다.', async () => {
  for (const message of ['가격이 변경되었습니다.', '구매 결과를 확인하지 못했습니다.']) {
    const reader = readerHarness({ realStorage: true, autoContinue: true });
    reader.offer.buy = async () => { reader.offer.message = message; return false; };
    await reader.layout(); await reader.scroll(900, false); await nextSwipe(reader);
    await reader.advance(5000);
    assert.equal(reader.purchases.length, 1); assert.equal(reader.navigation.length, 0);
    assert.ok(reader.nodes().some(node => node.props.accessibilityRole === 'alert' && node.props.children === message));
  }
});

test('끝 위치 저장·구매의 대기 중 반복 입력은 하나로 묶고 두 단계가 성공해야 다음 회차를 엽니다.', async () => {
  const reader = readerHarness({ realStorage: true, autoContinue: true }); await reader.layout();
  let completeSave, completePurchase;
  reader.network.save = value => new Promise(resolve => {
    completeSave = () => {
      reader.network.progress = { ...reader.network.progress, position: value, revision: '42' };
      resolve(reader.network.progress);
    };
  });
  reader.offer.buy = () => new Promise(resolve => { completePurchase = resolve; });
  await reader.scroll(900, false); await nextSwipe(reader); await nextSwipe(reader);
  assert.equal(typeof completeSave, 'function'); assert.equal(reader.purchases.length, 0);
  assert.equal(reader.navigation.length, 0);
  completeSave(); await reader.settle(); await nextSwipe(reader);
  assert.equal(reader.purchases.length, 1); assert.equal(reader.navigation.length, 0);
  completePurchase(true); await reader.settle();
  assert.equal(reader.navigation.length, 1); assert.equal(reader.navigation[0].chapterId, '12');
});

test('OFF 전환·패널 열기·회원 전환은 이전 제스처나 구매 응답의 뒤늦은 이동을 막습니다.', async () => {
  const off = readerHarness({ realStorage: true, autoContinue: true }); await off.layout();
  await off.scroll(900, false); await off.touch('Start');
  off.find('Pressable', '이어보기').props.onPress(); await off.settle();
  await off.touch('End', { y: 100 });
  assert.equal(off.purchases.length, 0);
  assert.equal(off.find('Pressable', '이어보기').props.accessibilityState.checked, false);
  for (const mode of ['overlay', 'session']) {
    const reader = readerHarness({ realStorage: true, autoContinue: true }); await reader.layout();
    let completePurchase;
    reader.offer.buy = () => new Promise(resolve => { completePurchase = resolve; });
    await reader.scroll(900, false); await nextSwipe(reader);
    assert.equal(reader.purchases.length, 1);
    if (mode === 'overlay') await reader.overlay({ screen: 'share' });
    else await reader.changeSession();
    completePurchase(true); await reader.settle();
    assert.equal(reader.navigation.length, 0);
  }
});

test('끝 위치 저장 실패·충돌은 다음 회차를 구매하지 않으며 충돌 복원에도 ON 상태를 유지합니다.', async () => {
  for (const conflict of [false, true]) {
    const reader = readerHarness({ realStorage: true, autoContinue: true }); await reader.layout();
    reader.network.save = async () => {
      if (conflict) reader.network.progress = { ...reader.network.progress, revision: '42',
        position: { ...textPosition, chapterId: '12' } };
      throw new MemberRequestError(conflict ? 409 : 503, conflict ? 'PROGRESS_CONFLICT' : null);
    };
    await reader.scroll(900, false); await nextSwipe(reader);
    assert.equal(reader.purchases.length, 0);
    assert.equal(reader.navigation.length, conflict ? 1 : 0);
    if (conflict) {
      assert.equal(reader.navigation[0].resumeRevision, '42');
      assert.equal(reader.navigation[0].autoContinue, true);
    } else assert.ok(reader.find('Action', '읽기 위치 다시 확인'));
  }
});

test('웹은 바닥에서 새로 시작한 wheel 묶음만 멈춘 뒤 한 번 처리합니다.', async () => {
  const reader = readerHarness({ platform: 'web', realStorage: true, autoContinue: true }); await reader.layout();
  await reader.wheel(80); await reader.scroll(900, false); await reader.wheel(80); await reader.advance(200);
  assert.equal(reader.purchases.length, 0, '바닥까지 내려온 기존 묶음은 자동 구매하지 않습니다.');
  await reader.wheel(-80); await reader.wheel(160); await reader.advance(200);
  assert.equal(reader.purchases.length, 0, '역방향이 섞인 묶음은 이어보기 입력으로 사용하지 않습니다.');
  await reader.wheel(30); await reader.advance(100); await reader.wheel(30); await reader.advance(179);
  assert.equal(reader.purchases.length, 0);
  await reader.advance(1);
  assert.equal(reader.purchases.length, 1); assert.equal(reader.navigation.length, 1);
  assert.equal(reader.navigation[0].autoContinue, true);
});

test('비회원은 무료 회차만 바로 열며 유료 회차에서는 구매 대신 로그인으로 이동합니다.', async () => {
  for (const readable of [true, false]) {
    const reader = readerHarness({ realStorage: true, autoContinue: true, authenticated: false });
    Object.assign(reader.offer.products[0], { readable, price: readable ? 0 : 300 });
    await reader.layout(); await reader.scroll(900, false); await nextSwipe(reader);
    assert.equal(reader.purchases.length, 0);
    assert.equal(reader.navigation[0].screen, readable ? 'reader' : 'login');
  }
});
// #endregion

// #region 책장 모드
/** 하니스 layout()의 문단을 웹 폴백과 같은 방식(문단 높이 ÷ 줄 높이)으로 나눈 줄 목록입니다. */
const harnessLines = (size = 2, { height = 1000, spacing = 240 } = {}) => [spacing, height - spacing].flatMap((paragraph, index) => {
  const count = Math.max(1, Math.round(paragraph / ([13, 15, 17, 19, 21][size] * 1.85)));
  return Array.from({ length: count }, (_, line) => ({ top: index * spacing + line * paragraph / count, height: paragraph / count }));
});
const topsAt = (size = 2, { viewport = 100, ...layout } = {}) => buildPageTops(harnessLines(size, layout), viewport);
const pageTopAt = (index, size = 2) => pageTop(index, topsAt(size));
const secondParagraph = readingSegments(textBody).at(-1).offset;
const press = async (reader, label) => { reader.find('Pressable', label).props.onPress(); await reader.settle(); };

test('스크롤 모드는 기존 스크롤을 유지하고 쪽 넘김 도구와 판정을 붙이지 않습니다.', async () => {
  const reader = readerHarness(); await reader.layout();
  assert.equal(reader.find('ScrollView').props.scrollEnabled, true);
  assert.equal(reader.find('Pressable', '다음 쪽'), undefined);
  assert.equal(reader.nodes().find(node => node.props.testID === 'reader-pages').props.onTouchStart, undefined);
});

test('책장 모드의 버튼·스와이프·가장자리 스와이프·좌우 탭·웹 키는 같은 쪽 넘김 결과를 만듭니다.', async () => {
  const count = topsAt().length;
  const inputs = {
    button: [reader => press(reader, '다음 쪽'), reader => press(reader, '이전 쪽')],
    swipe: [reader => reader.pageTouch({ x: 260, y: 300 }, { x: 200, y: 310 }), reader => reader.pageTouch({ x: 200, y: 300 }, { x: 260, y: 290 })],
    edgeSwipe: [reader => reader.pageTouch({ x: 395, y: 300 }, { x: 300, y: 300 }, 600), reader => reader.pageTouch({ x: 5, y: 300 }, { x: 100, y: 300 }, 600)],
    tap: [reader => reader.pageTouch({ x: 380, y: 300 }, { x: 383, y: 302 }), reader => reader.pageTouch({ x: 20, y: 300 }, { x: 22, y: 300 })],
    arrow: [async reader => assert.equal(await reader.pageKey('ArrowRight'), true), async reader => assert.equal(await reader.pageKey('ArrowLeft'), true)],
    page: [async reader => assert.equal(await reader.pageKey('PageDown'), true), async reader => assert.equal(await reader.pageKey('PageUp'), true)],
  };
  for (const [name, [next, previous]] of Object.entries(inputs)) {
    const reader = readerHarness({ mode: '책장', platform: ['arrow', 'page'].includes(name) ? 'web' : 'android' });
    await reader.layout();
    assert.equal(reader.find('ScrollView').props.scrollEnabled, false);
    assert.ok(reader.find('Text', `전체 ${count}쪽 중 1쪽`));
    const before = reader.scrolls.length;
    await next(reader);
    assert.deepEqual(reader.scrolls.slice(before).map(value => value.y), [pageTopAt(1)], name);
    assert.ok(reader.find('Text', `전체 ${count}쪽 중 2쪽`), name);
    await previous(reader);
    assert.deepEqual(reader.scrolls.slice(before).map(value => value.y), [pageTopAt(1), 0], name);
    assert.ok(reader.find('Text', `전체 ${count}쪽 중 1쪽`), name);
  }
});

test('첫 쪽 이전은 이동하지 않고 마지막 쪽 다음은 이어보기 설정에 따라 다음 화나 끝 안내로 처리합니다.', async () => {
  const tops = topsAt(), count = tops.length;
  for (const autoContinue of [false, true]) {
    const reader = readerHarness({ mode: '책장', autoContinue }); await reader.layout();
    const before = reader.scrolls.length;
    await press(reader, '이전 쪽');
    await reader.pageTouch({ x: 20, y: 300 }, { x: 20, y: 300 });
    assert.equal(reader.scrolls.length, before);
    for (let index = 1; index < count; index++) await press(reader, '다음 쪽');
    assert.equal(reader.scrolls.at(-1).y, tops.at(-1), '마지막 쪽은 높이−뷰포트(900)가 아니라 줄 시작입니다.');
    assert.notEqual(tops.at(-1), 900);
    assert.ok(harnessLines().some(line => line.top === tops.at(-1)));
    assert.ok(reader.find('Text', `전체 ${count}쪽 중 ${count}쪽`));
    const moved = reader.scrolls.length;
    await press(reader, '다음 쪽');
    assert.equal(reader.scrolls.length, moved);
    const notice = reader.nodes().some(node => node.type === 'Text' && node.props.children === '회차의 마지막 쪽입니다.');
    if (autoContinue) {
      assert.equal(notice, false);
      assert.equal(reader.purchases.length, 1);
      assert.equal(reader.navigation.at(-1).chapterId, '12');
      assert.equal(reader.navigation.at(-1).autoContinue, true);
    } else {
      assert.equal(notice, true);
      assert.equal(reader.purchases.length, 0);
      assert.equal(reader.navigation.length, 0);
    }
  }
});

test('하이라이트 선택·설정 패널·목차가 열려 있으면 책장 모드에서도 쪽을 넘기지 않습니다.', async () => {
  const reader = readerHarness({ mode: '책장', platform: 'web' }); await reader.layout();
  const before = reader.scrolls.length;
  const attempt = async () => {
    await press(reader, '다음 쪽');
    await reader.pageTouch({ x: 300, y: 300 }, { x: 200, y: 300 });
    await reader.pageTouch({ x: 390, y: 300 }, { x: 390, y: 300 });
    assert.equal(await reader.pageKey('PageDown'), false, '막힌 키는 기본 동작을 막지 않습니다.');
    assert.equal(reader.scrolls.length, before);
  };
  reader.find('BookmarkButton').props.onHighlight(); await reader.settle();
  assert.ok(reader.find('HighlightEditor'));
  await attempt();
  reader.find('HighlightEditor').props.onClose(); await reader.settle();
  await reader.overlay({ screen: 'readingSettings' });
  await attempt();
  await reader.overlay(null);
  reader.find('IconButton', '목차').props.onPress(); await reader.settle();
  await attempt();
  reader.find('Action', '목차 닫기').props.onPress(); await reader.settle();
  await press(reader, '다음 쪽');
  assert.equal(reader.scrolls.at(-1).y, pageTopAt(1));
});

test('가장자리 롱프레스와 짧은 탭을 누른 시간으로 구분하고 스와이프는 시간과 무관하게 넘깁니다.', async () => {
  const reader = readerHarness({ mode: '책장' }); await reader.layout();
  const before = reader.scrolls.length;
  await reader.pageTouch({ x: 390, y: 300 }, { x: 390, y: 300 }, 300);
  await reader.pageTouch({ x: 200, y: 300 }, { x: 202, y: 300 });
  await reader.pageTouch({ x: 200, y: 100 }, { x: 230, y: 300 });
  assert.equal(reader.scrolls.length, before, '롱프레스·가운데 탭·세로 이동은 넘기지 않습니다.');
  await reader.pageTouch({ x: 390, y: 300 }, { x: 390, y: 300 }, 299);
  assert.equal(reader.scrolls.at(-1).y, pageTopAt(1));
  await reader.pageTouch({ x: 300, y: 300 }, { x: 200, y: 300 }, 2_000);
  assert.equal(reader.scrolls.at(-1).y, pageTopAt(2));
});

test('스크롤→책장→스크롤 전환은 화면 상단 문단을 유지하고 책장에서는 그 문단의 쪽으로 맞춥니다.', async () => {
  const reader = readerHarness(); await reader.layout();
  await reader.scroll(240);
  assert.equal(reader.find('BookmarkButton').props.position.offset, secondParagraph);
  await reader.preferences({ mode: '책장' });
  const snapped = pageTopAt(pageOf(240, topsAt()));
  assert.equal(reader.scrolls.at(-1).y, snapped);
  assert.ok(snapped < 240 - 12, '쪽 시작이 문단보다 위에 있는 경우를 검사합니다.');
  assert.equal(reader.find('BookmarkButton').props.position.offset, secondParagraph);
  await reader.preferences({ mode: '스크롤' });
  assert.equal(reader.scrolls.at(-1).y, 240);
  assert.equal(reader.find('BookmarkButton').props.position.offset, secondParagraph);
  await reader.preferences({ mode: '책장' });
  await reader.preferences({ mode: '스크롤' });
  assert.equal(reader.scrolls.at(-1).y, 240, '반복 전환에도 기준 문단이 흐르지 않습니다.');
});

test('책장 모드에서 글자 크기 2→4→2와 화면 높이 변경 후에도 같은 utf16 문단의 쪽으로 맞추고 저장합니다.', async () => {
  const start = pageOf(240, topsAt());
  assert.ok(start > 0);
  const reader = readerHarness({ mode: '책장' }); await reader.layout();
  for (let index = 0; index < start; index++) await press(reader, '다음 쪽');
  assert.equal(reader.scrolls.at(-1).y, pageTopAt(start));
  await reader.advance(450);
  assert.deepEqual([reader.saves.at(-1).offset, reader.saves.at(-1).unit], [secondParagraph, 'utf16']);
  await reader.preferences({ size: 4 });
  await reader.layout({ spacing: 300 });
  assert.equal(reader.scrolls.at(-1).y, pageTop(pageOf(300, topsAt(4, { spacing: 300 })), topsAt(4, { spacing: 300 })));
  assert.equal(reader.find('BookmarkButton').props.position.offset, secondParagraph);
  await reader.preferences({ size: 2 });
  await reader.layout({ spacing: 240 });
  assert.equal(reader.scrolls.at(-1).y, pageTopAt(start));
  assert.equal(reader.find('BookmarkButton').props.position.offset, secondParagraph);
  await reader.viewport(150);
  const tall = topsAt(2, { viewport: 150 });
  assert.equal(reader.scrolls.at(-1).y, pageTop(pageOf(240, tall), tall));
  assert.ok(reader.find('Text', `전체 ${tall.length}쪽 중 ${pageOf(240, tall) + 1}쪽`));
});
test('책장 모드는 잘린 맨 아래 줄에서 시작한 문단을 그 쪽이 아닌 다음 쪽의 문단으로 저장하고 같은 쪽으로 복원합니다.', async () => {
  // 30px 줄·뷰포트 100px: 1쪽은 0~90의 세 줄만 온전히 보이고 90에서 시작하는 둘째 문단의 첫 줄은 가려지며 2쪽 맨 위에 옵니다.
  const layout = { spacing: 90, line: 30 };
  const reader = readerHarness({ mode: '책장' }); await reader.layout(layout);
  const mask = reader.nodes().find(node => node.props.testID === 'reader-page-mask');
  assert.equal(mask.props.pointerEvents, 'none');
  assert.equal(mask.props.style.at(-1).height, 10, '잘리는 줄 영역만 가립니다.');
  await reader.scroll(0, false);
  await press(reader, '다음 쪽');
  await press(reader, '이전 쪽');
  await reader.advance(450);
  assert.notEqual(reader.saves.at(-1).offset, secondParagraph, '1쪽은 가려진 줄의 문단을 저장하지 않습니다.');
  await press(reader, '다음 쪽');
  assert.equal(reader.scrolls.at(-1).y, 90);
  await reader.advance(450);
  assert.equal(reader.saves.at(-1).offset, secondParagraph);
  const reopened = readerHarness({ mode: '책장', entry: 'bookmarkPosition', entryOffset: reader.saves.at(-1).offset });
  await reopened.layout(layout);
  assert.equal(reopened.scrolls.at(-1).y, 90);
  assert.match(reopened.nodes().find(node => node.props.accessibilityLabel?.startsWith('전체')).props.accessibilityLabel, /쪽 중 2쪽$/);
});

test('네이티브 줄 높이가 계산값과 달라도(fontScale 1.3) 모든 쪽은 실제 줄 시작에서 시작합니다.', async () => {
  const line = 17 * 1.85 * 1.3;
  const lines = [...Array.from({ length: Math.floor(240 / line) }, (_, at) => at * line),
    ...Array.from({ length: Math.floor(760 / line) }, (_, at) => 240 + at * line)];
  const reader = readerHarness({ mode: '책장' }); await reader.layout({ line });
  const label = reader.nodes().find(node => node.props.accessibilityLabel?.startsWith('전체')).props.accessibilityLabel;
  const count = Number(label.match(/전체 (\d+)쪽/)[1]);
  assert.ok(count > 1);
  for (let index = 1; index < count; index++) await press(reader, '다음 쪽');
  const visited = reader.scrolls.map(value => value.y).filter(y => y > 0);
  assert.equal(visited.length, count - 1);
  for (const y of visited) assert.ok(lines.some(top => Math.abs(top - y) < 1e-9), `${y}는 실제 줄 시작입니다.`);
  const estimated = topsAt();
  assert.notDeepEqual([0, ...visited], estimated, '계산 줄 높이로 추정한 경계와 다릅니다.');
});

test('책장 모드 마지막 쪽은 위치와 무관하게 끝이며 진행률 100%·본문 끝 저장·이어보기를 처리합니다.', async () => {
  const tops = topsAt();
  // 책장 모드 여백(뷰포트 높이)까지 포함한 콘텐츠 높이에서는 위치 기준 끝 판정이 마지막 쪽을 끝으로 보지 못합니다.
  const reader = readerHarness({ mode: '책장', autoContinue: true }); await reader.layout({ extra: 100 });
  const progress = () => reader.nodes().find(node => node.props.accessibilityRole === 'progressbar').props['aria-valuenow'];
  for (let index = 1; index < tops.length; index++) await press(reader, '다음 쪽');
  assert.ok(tops.at(-1) + 100 < 1100 - 4, '마지막 쪽 위치는 높이−뷰포트보다 위입니다.');
  assert.equal(progress(), 100);
  await reader.advance(450);
  assert.equal(reader.saves.at(-1).offset, textBody.length);
  await press(reader, '다음 쪽');
  assert.equal(reader.navigation.at(-1).chapterId, '12', '마지막 쪽 다음은 이어보기로 다음 화를 엽니다.');
  assert.equal(reader.saves.at(-1).offset, textBody.length);
});

test('책장 모드에만 뷰포트 높이 여백을 붙이고 레이아웃이 연달아 바뀌어도 쪽 경계는 프레임당 한 번만 계산합니다.', async () => {
  const scrolling = readerHarness(); await scrolling.layout();
  assert.equal(scrolling.nodes().find(node => node.props.testID === 'reader-page-spacer'), undefined);
  assert.equal(scrolling.nodes().find(node => node.props.testID === 'reader-page-mask'), undefined);
  const reader = readerHarness({ mode: '책장' });
  await reader.settle();
  const before = reader.pageBuilds;
  await reader.layout();
  assert.equal(reader.pageBuilds - before, 1);
  assert.equal(reader.nodes().find(node => node.props.testID === 'reader-page-spacer').props.style.height, 100);
});
// #endregion
