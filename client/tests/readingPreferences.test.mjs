import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readingFontNames, readingFonts } from '../src/readingFonts.ts';
import { loadLibraryTab } from '../src/libraryPreferences.ts';
import { loadReadingPreferences, parseReadingPreferences, saveReadingPreferences } from '../src/readingPreferences.ts';

test('처음 실행한 기기에는 기존 기본값을 적용합니다.', async () => {
  const preferences = await loadReadingPreferences({ getItem: async () => null });
  assert.deepEqual(preferences, { theme: '크림', font: '기본 명조', size: 2, mode: '스크롤' });
});

test('기기에 저장한 설정은 새 실행에서 복원되며 원본 객체 변경의 영향을 받지 않습니다.', async () => {
  const values = new Map();
  const preferences = { theme: '다크', font: '고운바탕', size: 4, mode: '책장' };
  const saved = await saveReadingPreferences({ setItem: async (key, value) => { values.set(key, value); } }, preferences);
  preferences.theme = '크림';
  const restored = await loadReadingPreferences({ getItem: async key => values.get(key) ?? null });
  assert.deepEqual(restored, { theme: '다크', font: '고운바탕', size: 4, mode: '책장' });
  assert.deepEqual(saved, restored);
});

test('지원하지 않는 설정과 손상된 JSON을 정상 설정으로 처리하지 않습니다.', async () => {
  const valid = { theme: '크림', font: '기본 명조', size: 2 };
  for (const value of [null, [], {}, { ...valid, theme: '없는 테마' }, { ...valid, font: '없는 글꼴' },
    { ...valid, size: -1 }, { ...valid, size: 5 }, { ...valid, size: 2.5 }, { ...valid, size: '2' },
    { ...valid, mode: '페이지' }, { ...valid, mode: null }, { ...valid, mode: 1 }, { ...valid, mode: '' }]) {
    assert.throws(() => parseReadingPreferences(value));
  }
  await assert.rejects(loadReadingPreferences({ getItem: async () => '{' }));
});

test('읽기 방식이 없는 기존 v1 저장값은 스크롤로 읽고 두 읽기 방식을 그대로 복원합니다.', async () => {
  const legacy = JSON.stringify({ theme: '연노랑', font: '나눔고딕', size: 3 });
  const restored = await loadReadingPreferences({ getItem: async key => key === 'mobtwig:reading-preferences:v1' ? legacy : null });
  assert.deepEqual(restored, { theme: '연노랑', font: '나눔고딕', size: 3, mode: '스크롤' });
  for (const mode of ['스크롤', '책장']) {
    const values = new Map();
    await saveReadingPreferences({ setItem: async (key, value) => { values.set(key, value); } },
      { theme: '크림', font: '기본 명조', size: 2, mode });
    assert.deepEqual([...values.keys()], ['mobtwig:reading-preferences:v1']);
    assert.equal((await loadReadingPreferences({ getItem: async key => values.get(key) ?? null })).mode, mode);
  }
  assert.equal(parseReadingPreferences({ theme: '크림', font: '기본 명조', size: 2, mode: '책장', extra: true }).extra, undefined);
});

test('읽기·쓰기 실패를 호출자에게 전달하며 쓰기 완료 전에 성공하지 않습니다.', async () => {
  const failure = new Error('기기 저장소 오류');
  await assert.rejects(loadReadingPreferences({ getItem: async () => { throw failure; } }), failure);
  await assert.rejects(saveReadingPreferences({ setItem: async () => { throw failure; } },
    { theme: '크림', font: '기본 명조', size: 2 }), failure);
  let finish;
  let completed = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const save = saveReadingPreferences({ setItem: () => pending }, { theme: '연회색', font: '기본 고딕', size: 0 })
    .then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  await save;
  assert.equal(completed, true);
});

const ts = createRequire(import.meta.url)('typescript');
const appUrl = new URL('../App.tsx', import.meta.url);
const appSource = ts.createSourceFile('App.tsx', readFileSync(appUrl, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const startupSource = appSource.statements.filter(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'AppStartup'
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(appSource) === 'readingFontSources'))
  .map(node => node.getText(appSource)).join('\n');
const startupCode = ts.transpileModule(startupSource + '\nexport { AppStartup };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

/** 실제 초기화 함수를 실행하고 글꼴 로드와 네이티브 화면 요소만 대체합니다. */
function startupHarness(context, loadFonts) {
  const cells = [], effects = [], fontCalls = [];
  let cursor = 0, dirty = true, tree, refreshes = 0;
  const link = { ready: true, target: null };
  const state = { status: 'anonymous' };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const runtime = { exports: {}, require: module => {
    if (module === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    const asset = fileURLToPath(new URL(module, appUrl));
    assert.ok(existsSync(asset), asset);
    return asset;
  }, readingFontNames, readingFonts, loadReadingPreferences, loadLibraryTab,
  AsyncStorage: { getItem: async () => null },
  Font: { loadAsync: definitions => { fontCalls.push(definitions); return loadFonts(); } },
  useWorkLink: () => link, useMemberAuth: () => ({ state, client: { refresh: async () => { refreshes++; } } }),
  useState: initial => {
    const index = cursor++;
    cells[index] ??= { value: initial };
    return [cells[index].value, next => {
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; }
    }];
  }, useEffect: (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || !dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) {
      const cell = { dependencies, cleanup: previous?.cleanup };
      cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  }, s: {}, View: 'View', Text: 'Text', Action: 'Action', LoadingScreens: 'LoadingScreens',
  AppProvider: 'AppProvider', IncomingWorkLink: 'IncomingWorkLink', Shell: 'Shell' };
  runInNewContext(startupCode, runtime);
  context.after(() => { for (const cell of cells) cell?.cleanup?.(); });
  const render = () => {
    let rounds = 0;
    while (dirty) {
      assert.ok(++rounds < 30, '초기화 화면이 반복 렌더링됩니다.');
      dirty = false; cursor = 0; tree = runtime.exports.AppStartup();
      effects.splice(0).forEach(run => run());
    }
  };
  const nodes = (node = tree) => node && typeof node === 'object'
    ? [node, ...[node.props.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : [];
  return { fontCalls, nodes, get tree() { return tree; }, get refreshes() { return refreshes; },
    async settle() {
      for (let round = 0; round < 4; round++) { render(); await new Promise(resolve => setImmediate(resolve)); }
      render();
    } };
}

test('기존 여덟 저장 이름을 유지하고 각 선택을 서로 다른 실제 글꼴에 연결합니다.', async () => {
  assert.deepEqual(readingFontNames, ['기본 명조', '기본 고딕', '나눔명조', '나눔고딕', '고운바탕', '고운돋움', '함렛', '플렉스고딕']);
  assert.equal(new Set(readingFontNames.map(name => readingFonts[name].family)).size, 8);
  assert.equal(readingFonts['플렉스고딕'].label, '프리텐다드');
  for (const name of readingFontNames) {
    let value;
    await saveReadingPreferences({ setItem: async (_key, next) => { value = next; } }, { theme: '크림', font: name, size: 2 });
    assert.equal((await loadReadingPreferences({ getItem: async () => value })).font, name);
    assert.match(readingFonts[name].license, /SIL OPEN FONT LICENSE/);
    assert.ok(readingFonts[name].copyright);
  }
});

test('글꼴 여덟 개가 준비되기 전에는 앱을 열지 않고 준비 후 저장 설정으로 초기화합니다.', async context => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const app = startupHarness(context, () => pending);
  await app.settle();
  assert.equal(app.tree.type, 'LoadingScreens');
  assert.equal(app.fontCalls.length, 1);
  assert.deepEqual(Array.from(app.fontCalls[0], definition => definition.fontFamily), readingFontNames.map(name => readingFonts[name].family));
  assert.equal(new Set(Array.from(app.fontCalls[0], definition => definition.fontDefinitions[0].path)).size, 8);
  finish();
  await app.settle();
  assert.equal(app.tree.type, 'AppProvider');
  assert.equal(app.tree.props.initialReadingPreferences.font, '기본 명조');
});

test('글꼴 로드 실패는 오류를 표시하고 기존 다시 확인 동작으로 재시도합니다.', async context => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const app = startupHarness(context, () => ++calls === 1 ? Promise.reject(new Error('글꼴 로드 실패')) : pending);
  await app.settle();
  assert.ok(app.nodes().some(node => node.type === 'Text' && node.props.accessibilityRole === 'alert' && node.props.children.includes('글꼴')));
  app.nodes().find(node => node.type === 'Action' && node.props.label === '다시 확인').props.onPress();
  await app.settle();
  assert.equal(app.fontCalls.length, 2);
  assert.equal(app.refreshes, 1);
  assert.equal(app.tree.type, 'LoadingScreens');
  finish();
  await app.settle();
  assert.equal(app.tree.type, 'AppProvider');
});
