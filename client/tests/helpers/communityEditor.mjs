import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as drafts from '../../src/communityDrafts.ts';
import * as body from '../../src/communityBody.ts';
import { communityImageUrl, normalizeCommunityText, validateCommunityPostForBoard } from '../../src/community.ts';
import { MemberRequestError } from '../../src/memberSession.ts';
const scope = { apiUrl: 'https://community.example.test', memberId: '13', boardId: '21' };
const input = { boardId: '21', workId: null, head: 'STORY', title: '저장할 제목', body: '저장할 본문', hasSpoiler: false,
  spoilerChapterId: null, images: [], stickerIds: [] };
const board = { id: '21', type: 'topic', name: '독서 이야기', work: null, heads: ['STORY', 'QUESTION'] };
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function device() {
  const values = new Map();
  return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } };
}

// 화면·조회·액션의 실제 함수를 실행합니다. 저장소만 지연/실패시키며 게시 응답은 별도 계약 테스트의 범위입니다.
function editor(storage, options = {}) {
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile('CommunityScreens.tsx', readFileSync(new URL('../../src/CommunityScreens.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ['useAction', 'useQuery', 'requestError', 'WritePostScreen'];
  const code = functions.map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)).join('\n');
  let cells = [], effects = [], cursor = 0, dirty = true, mounted = true, tree, posts = 0, ignored = 0;
  let state = { status: 'authenticated', member: { id: '13' }, generation: 1 };
  let client = { getSnapshot: () => state };
  const navigation = [], submissions = [];
  const currentBoard = options.board ?? board;
  const route = { screen: 'writePost', boardId: currentBoard.id, mode: currentBoard.type };
  const effect = (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const jsx = (type, props) => ({ type, props });
  const sandbox = { exports: {}, require: () => ({ jsx, jsxs: jsx }), AbortController, Map, Error, TypeError,
    useState: initial => { const index = cursor++; cells[index] ??= { value: initial }; return [cells[index].value, next => {
      if (!mounted) { ignored++; return; }
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; }
    }]; },
    useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; }, useEffect: effect, useLayoutEffect: effect,
    useMemberAuth: () => ({ state, client }),
    useConnection: () => ({ apiUrl: scope.apiUrl, state, client, reader: client, ready: true, key: state.member.id + ':' + state.generation }),
    useApp: () => ({ baseRoute: route, navigate(next) { navigation.push(next); unmount(); }, back() { navigation.push({ screen: 'back' }); unmount(); } }),
    useSearch: value => value, styles: {}, colors: {}, s: {}, heads: { STORY: '이야기', QUESTION: '질문', IMPRESSION: '감상', PROMOTION: '홍보' }, AsyncStorage: storage,
    readCommunityBoards: async () => ({ items: [options.board ?? board], stickers: options.stickers ?? [] }),
    readCommunityPost: async () => assert.fail('새 글 작성에서 게시글을 읽었습니다.'),
    readCommunityWorks: async () => ({ items: (options.works ?? []).map(work => ({ work })) }),
    fetchWorkDetail: async () => options.works?.[0] ?? assert.fail('연결 작품을 읽을 수 없습니다.'),
    createCommunityPost: async (_client, input) => { posts++; submissions.push(input); return options.publish ? options.publish(input)
      : { id: '99', boardId: currentBoard.id, boardType: currentBoard.type }; },
    normalizeCommunityText, validateCommunityPostForBoard, communityImageUrl, MemberRequestError, ...drafts, ...body,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, PixelRatio: { get: () => 1 },
  };
  for (const type of ['View', 'Text', 'TextInput', 'ScrollView', 'Pressable', 'Icon', 'Modal', 'ModalPanel', 'Action', 'Confirm', 'QueryStatus',
    'SpoilerButton', 'StickerPicker', 'StickerRow', 'Image', 'LoginRequired', 'CommunitySearch', 'WorkSummary', 'Pager', 'EmptyState']) sandbox[type] = type;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  function render() {
    for (let round = 0; round < 20 && mounted && dirty; round++) {
      dirty = false; cursor = 0; tree = sandbox.exports.WritePostScreen({ route }); effects.splice(0).forEach(run => run());
    }
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object' || !node.props || ['Modal', 'Confirm'].includes(node.type) && !node.props.visible) return [];
    return [node, ...[node.props.children].flat(Infinity).filter(child => child && typeof child === 'object').flatMap(child => nodes(child))];
  }
  const find = label => nodes().find(node => node.props.accessibilityLabel === label || node.props.label === label);
  function unmount() { if (!mounted) return; mounted = false; for (const cell of cells) cell.cleanup?.(); effects = []; tree = null; }
  async function flush() { for (let i = 0; i < 8; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); }
  return { navigation, submissions, find, nodes, flush, unmount, get posts() { return posts; }, get ignored() { return ignored; },
    text: () => nodes().filter(node => node.type === 'Text').map(node => [node.props.children].flat(Infinity).join('')).join(' '),
    async press(label) { const node = find(label); assert.ok(node, label); assert.ok(!node.props.disabled, label + ' 비활성'); node.props.onPress(); await flush(); },
    async fill(title = input.title, text = input.body) { find('게시글 제목').props.onChangeText(title); render(); find('게시글 본문').props.onChangeText(text); await flush(); },
    async confirm() { const node = nodes().find(node => node.type === 'Confirm'); assert.ok(node); node.props.onConfirm(); await flush(); },
    async changeMember(id) { state = { ...state, member: { id }, generation: state.generation + 1 }; client = { getSnapshot: () => state }; dirty = true; await flush(); },
  };
}


export { editor, device, scope, input, gate };
