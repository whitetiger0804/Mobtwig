import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createMemberSessionClient } from '../src/memberSession.ts';
import { PasswordChangeProblem, parsePasswordChangeProblem, validatePasswordChange } from '../src/memberPassword.ts';

const identity = { id: '42', email: 'member@example.test', nickname: '회원', createdAt: '2026-11-01T00:00:00Z' };
const input = { currentPassword: 'original123', newPassword: ' next-pass456 ', newPasswordConfirmation: ' next-pass456 ' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('비밀번호 변경은 유니코드 문자·UTF-8 바이트 경계와 일치를 확인하고 공백을 유지합니다.', () => {
  assert.deepEqual(validatePasswordChange(input), input);
  for (const next of ['a1😀😀😀😀😀😀', 'a1' + 'a'.repeat(70), 'a1' + '한'.repeat(22) + '😀']) {
    assert.equal(validatePasswordChange({ ...input, newPassword: next, newPasswordConfirmation: next }).newPassword, next);
  }
  for (const next of ['a1😀😀😀😀😀', 'abcdefgh', '12345678', 'a1' + 'a'.repeat(71), 'a1' + '한'.repeat(24), 'a123456\ud800', input.currentPassword]) {
    assert.throws(() => validatePasswordChange({ ...input, newPassword: next, newPasswordConfirmation: next }), error => error instanceof PasswordChangeProblem && !!error.fields.newPassword);
  }
  assert.throws(() => validatePasswordChange({ ...input, newPasswordConfirmation: input.newPassword.trim() }), error => !!error.fields.newPasswordConfirmation);
  assert.throws(() => validatePasswordChange({ ...input, currentPassword: '' }), error => !!error.fields.currentPassword);
  assert.deepEqual(parsePasswordChangeProblem({ message: '임의 본문', fieldErrors: { newPassword: '다른 값으로 입력해 주세요.', password: '무시', request: 12 } }).fields,
    { newPassword: '다른 값으로 입력해 주세요.' });
});

async function session(t, respond = () => new Response(null, { status: 204 })) {
  const calls = [];
  let reader = async () => json(identity);
  const client = createMemberSessionClient('https://api.example.test', async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/session')) return reader();
    if (url.endsWith('/csrf')) return json({ token: 'csrf-test', headerName: 'X-CSRF-TOKEN' });
    if (url.endsWith('/password')) return respond(init);
    return json({ private: true });
  });
  t.after(() => client.dispose()); await client.refresh();
  return { client, calls, readWith(next) { reader = next; } };
}

test('성공 204만 모든 회원 상태를 비우고 이메일을 전달하며 늦은 세션 확인은 복원하지 않습니다.', async t => {
  const gate = deferred(); const { client, calls, readWith } = await session(t);
  readWith(() => gate.promise);
  const stale = client.refresh();
  const before = client.getSnapshot().generation;
  assert.equal(await client.changePassword(input), identity.email);
  const post = calls.find(call => call.url.endsWith('/password'));
  assert.equal(post.init.credentials, 'include'); assert.equal(post.init.headers['X-CSRF-TOKEN'], 'csrf-test');
  assert.deepEqual(JSON.parse(post.init.body), input);
  assert.equal(client.getSnapshot().member, null); assert.equal(client.getSnapshot().status, 'anonymous');
  assert.equal(client.getSnapshot().generation, before + 1); assert.equal(client.getSnapshot().passwordChangedEmail, identity.email);
  gate.resolve(json(identity)); await stale;
  assert.equal(client.getSnapshot().member, null);
  readWith(async () => json({}, 401)); await client.refresh();
  assert.equal(client.getSnapshot().passwordChangedEmail, identity.email);
  assert.ok(!JSON.stringify(client.getSnapshot()).includes(input.newPassword));
});

test('입력·CSRF 거절은 재시도할 수 있고 만료·불확실한 결과는 개인 상태를 비웁니다.', async t => {
  for (const status of [400, 403, 401, 200, 500, 'network']) {
    const { client } = await session(t, () => {
      if (status === 'network') throw new Error('비밀 원문을 화면으로 보내지 않음');
      return json({ fieldErrors: { currentPassword: '현재 비밀번호를 확인해 주세요.' } }, status);
    });
    const before = client.getSnapshot().generation;
    await assert.rejects(client.changePassword(input));
    const state = client.getSnapshot();
    assert.equal(state.passwordChangedEmail, undefined);
    assert.equal(state.generation, before + ([400, 403].includes(status) ? 0 : 1));
    assert.equal(!!state.member, [400, 403].includes(status));
  }
});

test('변경 요청을 중복 제출하지 않으며 다른 인증 요청과 개인 요청을 겹치지 않습니다.', async t => {
  const gate = deferred(); const { client, calls } = await session(t, () => gate.promise);
  const pending = client.changePassword(input);
  await assert.rejects(client.changePassword(input), /처리/);
  await assert.rejects(client.login('other@example.test', 'other1234'), /처리/);
  await assert.rejects(client.logout(), /처리/);
  await assert.rejects(client.request('/api/members/purchases'), /처리/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.url.endsWith('/password')).length, 1);
  client.dispose(); gate.resolve(new Response(null, { status: 204 }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(client.getSnapshot().passwordChangedEmail, undefined);
});

test('다른 기기에서 폐기되어 첫 CSRF 조회가 401이면 POST 전에 인증과 입력 화면을 정리합니다.', async t => {
  let posted = false;
  const client = createMemberSessionClient('https://api.example.test', async url => {
    if (url.endsWith('/session')) return json(identity);
    if (url.endsWith('/password')) posted = true;
    return json({}, 401);
  });
  t.after(() => client.dispose()); await client.refresh();
  const ui = screenHarness(client); t.after(ui.dispose);
  for (const [label, value] of [['현재 비밀번호', input.currentPassword], ['새 비밀번호', input.newPassword], ['새 비밀번호 확인', input.newPasswordConfirmation]]) {
    ui.find('AccountField', label).props.onChangeText(value); ui.render();
  }
  ui.find('Action', '비밀번호 변경').props.onPress(); await ui.flush();
  assert.equal(posted, false); assert.equal(client.getSnapshot().member, null);
  assert.equal(client.getSnapshot().status, 'anonymous'); assert.equal(ui.route.screen, 'home');
  assert.equal(ui.find('AccountField', '현재 비밀번호'), undefined); assert.equal(ui.route.passwordChanged, undefined);
});

// 실제 화면 함수와 AppProvider를 실행하고, publish 중 동기 렌더/정리를 강제해 가장 빠른 unmount 순서도 검사합니다.
function screenHarness(client) {
  const ts = createRequire(import.meta.url)('typescript');
  const extract = (file, name) => {
    const source = ts.createSourceFile(file, readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source);
  };
  const jsx = (type, props) => ({ type, props });
  let active, auth = client.getSnapshot(), tree, app, mountedScreen, ignored = 0;
  const provider = { cells: [], effects: [], dirty: true, mounted: true }, screen = { cells: [], effects: [], dirty: true, mounted: true };
  const state = initial => {
    const index = active.cursor++, owner = active;
    owner.cells[index] ??= { value: initial };
    return [owner.cells[index].value, next => {
      if (!owner.mounted) { ignored++; return; }
      owner.cells[index].value = typeof next === 'function' ? next(owner.cells[index].value) : next; owner.dirty = true;
    }];
  };
  const effect = (run, dependencies) => {
    const index = active.cursor++, owner = active, previous = owner.cells[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      owner.cells[index] = { dependencies, cleanup: previous?.cleanup };
      const cell = owner.cells[index]; owner.effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const sandbox = { exports: {}, require: () => ({ jsx, jsxs: jsx }),
    useState: state, useRef: initial => { const index = active.cursor++; return active.cells[index] ??= { current: initial }; },
    useEffect: effect, useLayoutEffect: effect, useCallback: fn => fn,
    useMemberAuth: () => ({ client, state: auth }), useApp: () => app,
    AppContext: { Provider: 'Provider' }, BackHandler: { addEventListener: () => ({ remove() {} }) }, overlays: new Set(['share']),
    validatePasswordChange, PasswordChangeProblem, styles: {}, s: {}, colors: {},
  };
  for (const name of ['View', 'Text', 'Action', 'ScrollView', 'AccountField', 'Image', 'Icon', 'Pressable']) sandbox[name] = name;
  const source = extract('appState.tsx', 'AppProvider') + '\n' + extract('AccountScreens.tsx', 'PasswordScreen') + '\n' + extract('AccountScreens.tsx', 'LoginScreen');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, sandbox);
  const render = () => {
    for (let turn = 0; turn < 15; turn++) {
      provider.cursor = 0; provider.dirty = false; active = provider;
      const result = sandbox.exports.AppProvider({ initialRoute: { screen: 'password' }, initialReadingPreferences: {}, initialLibraryTab: 'book', children: null });
      app = result.props.value;
      provider.effects.splice(0).forEach(run => run());
      if (provider.dirty) continue;
      if (mountedScreen !== app.route.screen) {
        screen.mounted = false; for (const cell of screen.cells) cell.cleanup?.();
        screen.cells = []; screen.effects = []; screen.mounted = true; mountedScreen = app.route.screen;
      }
      screen.cursor = 0; screen.dirty = false; active = screen;
      tree = mountedScreen === 'password' ? sandbox.exports.PasswordScreen() : mountedScreen === 'login' ? sandbox.exports.LoginScreen() : null;
      screen.effects.splice(0).forEach(run => run());
      if (!screen.dirty) return;
    }
    assert.fail('화면이 안정되지 않았습니다.');
  };
  const unsubscribe = client.subscribe(() => { auth = client.getSnapshot(); render(); });
  const nodes = (node = tree) => node && typeof node === 'object' && node.props
    ? [node, ...[node.props.children].flat(Infinity).filter(child => child && typeof child === 'object').flatMap(child => nodes(child))] : [];
  render();
  return { render, get route() { return app.route; }, get ignored() { return ignored; },
    nodes, find: (type, label) => nodes().find(node => node.type === type && node.props.label === label),
    async flush() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    dispose() { unsubscribe(); for (const owner of [provider, screen]) { owner.mounted = false; for (const cell of owner.cells) cell.cleanup?.(); } },
  };
}

test('성공 publish가 submit 복귀 전에 화면을 해제해도 로그인 이메일·안내와 빈 비밀번호가 남습니다.', async t => {
  const { client } = await session(t); const ui = screenHarness(client); t.after(ui.dispose);
  for (const [label, value] of [['현재 비밀번호', input.currentPassword], ['새 비밀번호', input.newPassword], ['새 비밀번호 확인', input.newPasswordConfirmation]]) {
    ui.find('AccountField', label).props.onChangeText(value); ui.render();
  }
  ui.find('Action', '비밀번호 변경').props.onPress();
  await ui.flush();
  assert.equal(ui.route.screen, 'login'); assert.equal(ui.route.passwordChanged, true); assert.equal(ui.route.registeredEmail, identity.email);
  assert.equal(ui.find('AccountField', '이메일').props.value, identity.email); assert.equal(ui.find('AccountField', '비밀번호').props.value, '');
  assert.ok(ui.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('모든 기기에서 로그아웃')));
  assert.equal(ui.ignored, 0);
});

test('필드 오류는 비밀번호 화면에 표시하고 실패를 성공 안내로 바꾸지 않습니다.', async t => {
  const { client } = await session(t, () => json({ fieldErrors: { currentPassword: '현재 비밀번호를 확인해 주세요.' } }, 400));
  const ui = screenHarness(client); t.after(ui.dispose);
  for (const [label, value] of [['현재 비밀번호', input.currentPassword], ['새 비밀번호', input.newPassword], ['새 비밀번호 확인', input.newPasswordConfirmation]]) {
    ui.find('AccountField', label).props.onChangeText(value); ui.render();
  }
  ui.find('Action', '비밀번호 변경').props.onPress(); await ui.flush();
  assert.equal(ui.route.screen, 'password'); assert.equal(ui.find('AccountField', '현재 비밀번호').props.error, '현재 비밀번호를 확인해 주세요.');
  assert.equal(ui.find('Action', '비밀번호 변경').props.disabled, false);
});
