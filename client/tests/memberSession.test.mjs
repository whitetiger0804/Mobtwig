import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createMemberSessionClient, MemberRequestError, parseMemberIdentity } from '../src/memberSession.ts';

const a = { id: '9007199254740994', email: 'a@example.test', nickname: '첫 회원', createdAt: '2026-11-07T01:00:00Z' };
const b = { id: '2', email: 'b@example.test', nickname: '다른 회원', createdAt: '2026-11-07T02:00:00Z' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('회원 PNG는 쿠키를 포함하여 Blob으로 받고 JSON 파서를 호출하지 않습니다.', async t => {
  const calls = [];
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  let page = { ok: true, status: 200, headers: new Headers({ 'Content-Type': 'image/png' }),
    blob: async () => png, json: () => assert.fail('PNG를 JSON으로 읽었습니다.') };
  const client = createMemberSessionClient('https://api.example.test', async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/api/auth/session') ? json(a) : page;
  });
  t.after(() => client.dispose());
  await client.refresh();
  const path = '/api/members/works/magazine/magazine/pages/1?contentVersion=3';
  assert.equal(await client.requestPng(path), png);
  assert.equal(calls.at(-1).url, 'https://api.example.test' + path);
  assert.equal(calls.at(-1).init.credentials, 'include');
  page = json({ code: 'PURCHASE_REQUIRED' }, 402);
  await assert.rejects(client.requestPng(path), failure => failure instanceof MemberRequestError && failure.status === 402);
  page = json({ unexpected: true });
  await assert.rejects(client.requestPng(path), /형식/);
  await assert.rejects(client.requestPng('/works/public'), /경로/);
});

test('PNG 본문을 받는 중 회원이 바뀌면 지연된 이미지 바이트를 반환하지 않습니다.', async t => {
  let identity = a;
  const bytes = deferred(), started = deferred();
  const client = createMemberSessionClient('https://api.example.test', async url => {
    if (url.endsWith('/api/auth/session')) return json(identity);
    return { ok: true, status: 200, headers: new Headers({ 'Content-Type': 'image/png' }), blob: () => { started.resolve(); return bytes.promise; } };
  });
  t.after(() => client.dispose());
  await client.refresh();
  const pending = client.requestPng('/api/members/works/issue/magazine/pages/1?contentVersion=1');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  identity = b; await client.refresh();
  bytes.resolve(new Blob(['이전 회원의 페이지'], { type: 'image/png' }));
  await rejected;
  assert.equal(client.getSnapshot().member.id, b.id);
});

test('화면의 취소 신호는 회원 요청에도 전달되며 늦은 JSON 응답을 버립니다.', async t => {
  const body = deferred(), started = deferred();
  let receivedSignal;
  const client = createMemberSessionClient('https://api.example.test', async (url, init) => {
    if (url.endsWith('/api/auth/session')) return json(a);
    receivedSignal = init.signal;
    return { ok: true, status: 200, json: () => { started.resolve(); return body.promise; } };
  });
  t.after(() => client.dispose());
  await client.refresh();
  const controller = new AbortController();
  const pending = client.request('/api/members/works/book/chapters/1', { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  assert.equal(receivedSignal.aborted, true);
  body.resolve({ body: '취소된 본문' });
  await rejected;
});

test('로그인 확인 실패는 미인증 화면의 세대를 바꾸지 않으며 재시도 중에는 확인 상태를 표시합니다.', async () => {
  let requester = async () => { throw new Error('연결 실패'); };
  const client = createMemberSessionClient('https://api.example.test', (...args) => requester(...args));
  await client.refresh();
  assert.equal(client.getSnapshot().status, 'error');
  assert.equal(client.getSnapshot().generation, 0);
  const response = deferred();
  requester = () => response.promise;
  const retry = client.refresh();
  assert.equal(client.getSnapshot().status, 'checking');
  response.resolve(json({}, 401));
  await retry;
  assert.equal(client.getSnapshot().status, 'anonymous');
  assert.equal(client.getSnapshot().generation, 0);
  client.dispose();
});

test('실제 HTTP 쿠키 전송으로 CSRF·세션 교체·종료를 연결합니다.', async () => {
  const sessions = new Map();
  const server = createServer(async (request, response) => {
    const cookie = request.headers.cookie?.split('=')[1];
    const session = sessions.get(cookie);
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url === '/api/auth/csrf') {
      const id = session ? cookie : randomUUID();
      if (!session) sessions.set(id, { token: randomUUID(), member: null });
      response.setHeader('Set-Cookie', `MEMBER_SESSION=${id}; Path=/api; HttpOnly; SameSite=Strict`);
      return json(200, { token: sessions.get(id).token, headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' });
    }
    if (request.method === 'POST') {
      if (!session || request.headers['x-csrf-token'] !== session.token) return json(403, {});
      if (request.url === '/api/auth/logout') {
        sessions.delete(cookie); response.setHeader('Set-Cookie', 'MEMBER_SESSION=; Path=/api; Max-Age=0');
        response.writeHead(204); return response.end();
      }
      let body = ''; for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      if (form.get('password') !== 'Password123') return json(401, {});
      const id = randomUUID(); sessions.delete(cookie);
      sessions.set(id, { token: randomUUID(), member: form.get('email') === b.email ? b : a });
      response.setHeader('Set-Cookie', `MEMBER_SESSION=${id}; Path=/api; HttpOnly; SameSite=Strict`);
      response.writeHead(204); return response.end();
    }
    return session?.member ? json(200, session.member) : json(401, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let cookie = '';
  const fetchWithPlatformJar = async (input, init) => {
    assert.equal(init.credentials, 'include');
    const headers = new Headers(init.headers); if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(input, { ...init, headers });
    for (const value of response.headers.getSetCookie()) cookie = value.split(';')[0];
    return response;
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createMemberSessionClient(base, fetchWithPlatformJar);
  try {
    await client.refresh(); assert.equal(client.getSnapshot().status, 'anonymous');
    await client.login(a.email, 'Password123'); const firstCookie = cookie;
    assert.equal(client.getSnapshot().member.id, a.id);
    const reopened = createMemberSessionClient(base, fetchWithPlatformJar);
    await reopened.refresh();
    assert.equal(reopened.getSnapshot().status, 'authenticated');
    assert.equal(reopened.getSnapshot().member.id, a.id);
    reopened.dispose();
    await client.login(b.email, 'Password123'); assert.notEqual(cookie, firstCookie);
    assert.equal((await fetch(base + '/api/auth/session', { headers: { Cookie: firstCookie } })).status, 401);
    assert.equal(client.getSnapshot().member.id, b.id);
    const lastCookie = cookie; await client.logout();
    assert.equal((await fetch(base + '/api/auth/session', { headers: { Cookie: lastCookie } })).status, 401);
    assert.equal(client.getSnapshot().member, null);
  } finally { client.dispose(); await new Promise(resolve => server.close(resolve)); }
});

function transport(initial = a) {
  let member = initial, logoutStatus = 204;
  const calls = [];
  let privateHandler = async () => json(member);
  const fetcher = async (input, init = {}) => {
    assert.equal(init.credentials, 'include'); assert.ok(init.signal);
    const path = new URL(input).pathname; calls.push({ path, method: init.method || 'GET' });
    if (path === '/api/auth/csrf') return json({ token: 'token-for-current-cookie', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' });
    if (path === '/api/auth/session') return member ? json(member) : json({}, 401);
    if (path.startsWith('/api/members/')) return privateHandler(input, init);
    assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'token-for-current-cookie');
    if (path === '/api/auth/logout') { if (logoutStatus === 204) member = null; return new Response(null, { status: logoutStatus }); }
    if (path === '/api/auth/login') {
      const form = new URLSearchParams(init.body);
      if (form.get('password') !== 'Password123') return json({}, 401);
      member = form.get('email') === b.email ? b : a; return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected request');
  };
  return { fetcher, calls, setLogoutStatus: status => { logoutStatus = status; }, setPrivate: handler => { privateHandler = handler; }, setMember: value => { member = value; } };
}

test('회원 ID 정밀도를 보존하고 비밀번호·임의 필드를 화면 정보로 전달하지 않습니다.', () => {
  assert.deepEqual(parseMemberIdentity({ ...a, passwordHash: 'never-expose', session: 'never-expose' }), a);
  for (const value of [{ ...a, id: Number(a.id) }, { ...a, createdAt: '2026-02-30T00:00:00Z' }, { ...a, nickname: '' }]) assert.throws(() => parseMemberIdentity(value));
});

test('이전 계정 로그아웃 확인 후 새 로그인·새 세션 상태를 확인합니다.', async () => {
  const server = transport(); const client = createMemberSessionClient('https://api.example.test', server.fetcher);
  await client.refresh(); assert.equal(client.getSnapshot().member.id, a.id);
  await client.login(b.email, 'Password123');
  assert.equal(client.getSnapshot().member.id, b.id);
  assert.deepEqual(server.calls.filter(c => c.method === 'POST').map(c => c.path), ['/api/auth/logout', '/api/auth/login']);
  assert.ok(client.getSnapshot().generation > 0);
  await client.logout(); assert.equal(client.getSnapshot().member, null); assert.equal(client.getSnapshot().status, 'anonymous');
  client.dispose();
});

test('늦은 이전 회원 401은 새 계정의 로그인을 지우지 않습니다.', async () => {
  const server = transport(), late = deferred(), entered = deferred();
  const client = createMemberSessionClient('https://api.example.test', server.fetcher); await client.refresh();
  server.setPrivate(async () => { entered.resolve(); return late.promise; });
  const old = client.request('/api/members/me'); const rejected = assert.rejects(old, { name: 'AbortError' });
  await entered.promise; await client.login(b.email, 'Password123'); late.resolve(json({}, 401)); await rejected;
  assert.equal(client.getSnapshot().member.id, b.id); client.dispose();
});

test('로그인 전에 시작한 세션 확인은 새 계정 확인 뒤에 완료돼도 폐기합니다.', async () => {
  const server = transport(), late = deferred(), entered = deferred(); let delayFirst = true;
  const requester = async (input, init) => {
    if (new URL(input).pathname === '/api/auth/session' && delayFirst) {
      delayFirst = false; entered.resolve(); return late.promise;
    }
    return server.fetcher(input, init);
  };
  const client = createMemberSessionClient('https://api.example.test', requester);
  const previous = client.refresh(); await entered.promise;
  await client.login(b.email, 'Password123'); late.resolve(json(a)); await previous;
  assert.equal(client.getSnapshot().member.id, b.id); client.dispose();
});

test('헤더 이후 늦게 완료된 이전 회원 JSON도 새 계정에 반환하지 않습니다.', async () => {
  const server = transport(), entered = deferred(); let stream;
  const client = createMemberSessionClient('https://api.example.test', server.fetcher); await client.refresh();
  server.setPrivate(async () => new Response(new ReadableStream({ start(controller) { stream = controller; entered.resolve(); } }), { headers: { 'Content-Type': 'application/json' } }));
  const old = client.request('/api/members/me'); const rejected = assert.rejects(old, { name: 'AbortError' });
  await entered.promise; await client.login(b.email, 'Password123');
  stream.enqueue(new TextEncoder().encode(JSON.stringify({ ...a, privateRecord: 'old-account-only' }))); stream.close(); await rejected;
  assert.equal(client.getSnapshot().member.id, b.id); client.dispose();
});

test('현재 회원 401은 상태·요청 세대를 폐기하며 로그아웃 실패를 성공으로 표시하지 않습니다.', async () => {
  const server = transport(); const client = createMemberSessionClient('https://api.example.test', server.fetcher); await client.refresh();
  server.setPrivate(async () => json({}, 401)); const epoch = client.getSnapshot().generation;
  await assert.rejects(client.request('/api/members/me'), /만료/);
  assert.equal(client.getSnapshot().status, 'anonymous'); assert.equal(client.getSnapshot().member, null); assert.ok(client.getSnapshot().generation > epoch);
  server.setMember(a); await client.refresh(); server.setLogoutStatus(503);
  await assert.rejects(client.logout(), /확인하지/); assert.equal(client.getSnapshot().status, 'error'); assert.equal(client.getSnapshot().member, null);
  const logins = server.calls.filter(c => c.path === '/api/auth/login').length;
  await assert.rejects(client.login(b.email, 'Password123'), /이전 계정/);
  assert.equal(server.calls.filter(c => c.path === '/api/auth/login').length, logins); client.dispose();
});

/** 실제 세션 클라이언트의 로그아웃 HTTP 응답만 지연합니다. */
async function delayedLogoutClient(t, member = a) {
  const server = transport(member), gate = deferred(), requests = [];
  const client = createMemberSessionClient('https://api.example.test', async (input, init) => {
    if (new URL(input).pathname === '/api/auth/logout') { requests.push(init); await gate.promise; }
    return server.fetcher(input, init);
  });
  t.after(() => { gate.resolve(); client.dispose(); });
  await client.refresh();
  return { client, server, gate, requests };
}

/** 실제 계정 화면을 세션 구독·client 교체·언마운트와 함께 실행합니다. */
function accountLogoutHarness(initialClient) {
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile('AccountScreens.tsx',
    readFileSync(new URL('../src/AccountScreens.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AccountScreen');
  const compiled = ts.transpileModule(declaration.getText(source) + '\nexport { AccountScreen };', {
    fileName: 'AccountScreens.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const cells = [], effects = [], navigation = [];
  let client = initialClient, mounted = true, dirty = true, cursor = 0, tree, ignoredStateWrites = 0;
  let route = { screen: 'account' };
  const app = { baseRoute: route, navigate: (next, reset) => { route = next; navigation.push({ route: next, reset }); dirty = true; } };
  const effect = (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const sandbox = { exports: {}, require: module => {
    if (module === 'react/jsx-runtime') { const jsx = (type, props) => ({ type, props }); return { jsx, jsxs: jsx }; }
    assert.equal(module, '../assets/brand/header.png'); return 1;
  }, useState: initial => {
    const index = cursor++; cells[index] ??= { value: initial };
    return [cells[index].value, next => {
      if (!mounted) { ignoredStateWrites++; return; }
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; }
    }];
  }, useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; },
  useEffect: effect, useLayoutEffect: effect, useMemberAuth: () => ({ client, state: client.getSnapshot() }),
  useApp: () => app, styles: {}, s: {}, colors: {} };
  for (const type of ['View', 'Text', 'Action', 'Pressable', 'Image', 'Icon', 'AccountMenu']) sandbox[type] = type;
  runInNewContext(compiled, sandbox);
  let unsubscribe = client.subscribe(() => { dirty = true; });
  const nodes = (node = tree) => node && typeof node === 'object' && node.props
    ? [node, ...[node.props.children].flat(Infinity).filter(value => value && typeof value === 'object').flatMap(value => nodes(value))] : [];
  const find = (type, label) => nodes().find(node => node.type === type && (node.props.label === label
    || nodes(node).some(child => child.type === 'Text' && child.props.children === label)));
  function unmount() {
    if (!mounted) return;
    mounted = false; unsubscribe(); for (const cell of cells) cell?.cleanup?.();
    effects.length = 0; dirty = false; tree = null;
  }
  async function settle() {
    for (let round = 0; round < 25; round++) {
      if (mounted && route.screen !== 'account') unmount();
      if (mounted && dirty) { dirty = false; cursor = 0; tree = sandbox.exports.AccountScreen(); }
      effects.splice(0).forEach(run => run()); await new Promise(resolve => setImmediate(resolve));
      if (!mounted || !dirty && !effects.length) return;
    }
    assert.fail('로그아웃 계정 화면이 안정되지 않았습니다.');
  }
  return { navigation, nodes, find, settle, unmount, get route() { return route; }, get ignoredStateWrites() { return ignoredStateWrites; },
    async press(type, label) { const node = find(type, label); assert.ok(node); assert.ok(!node.props.disabled); node.props.onPress(); await settle(); },
    leave(next) { app.navigate(next); unmount(); },
    async replaceClient(next) { unsubscribe(); client = next; unsubscribe = client.subscribe(() => { dirty = true; }); dirty = true; await settle(); },
  };
}

test('로그아웃 화면 경합은 정상 세대 변경 후 한 번 이동하고 실패 후에는 다시 시도합니다.', async t => {
  for (const status of [204, 503]) {
    const session = await delayedLogoutClient(t), ui = accountLogoutHarness(session.client); t.after(ui.unmount);
    await ui.settle(); const generation = session.client.getSnapshot().generation;
    session.server.setLogoutStatus(status); await ui.press('Pressable', '로그아웃');
    assert.ok(session.client.getSnapshot().generation > generation); assert.equal(ui.navigation.length, 0);
    session.gate.resolve(); await ui.settle();
    if (status !== 204) {
      assert.equal(ui.route.screen, 'account'); assert.equal(ui.find('Action', '로그아웃 다시 시도').props.disabled, false);
      assert.ok(ui.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('로그아웃 완료를 확인하지 못했습니다.')));
      session.server.setLogoutStatus(204); await ui.press('Action', '로그아웃 다시 시도');
    }
    assert.equal(session.client.getSnapshot().status, 'anonymous');
    assert.equal(ui.navigation.length, 1); assert.equal(ui.route.screen, 'login'); assert.equal(ui.navigation[0].reset, true);
  }
});

test('로그아웃 화면 경합은 이탈 뒤의 응답이 화면을 되돌리지 않으며 전역 로그아웃을 완료합니다.', async t => {
  for (const status of [204, 503]) {
    const session = await delayedLogoutClient(t), ui = accountLogoutHarness(session.client); t.after(ui.unmount);
    await ui.settle(); session.server.setLogoutStatus(status); await ui.press('Pressable', '로그아웃');
    const destination = { screen: 'detail', workId: 'another-work' }; ui.leave(destination);
    assert.equal(session.requests[0].signal.aborted, false);
    session.gate.resolve(); await ui.settle();
    assert.equal(ui.route, destination); assert.equal(ui.navigation.length, 1); assert.equal(ui.ignoredStateWrites, 0);
    assert.equal(session.client.getSnapshot().status, status === 204 ? 'anonymous' : 'error');
  }
});

test('로그아웃 화면 경합은 옛 client의 완료가 새 client의 대기·오류·이동에 영향을 주지 않습니다.', async t => {
  for (const status of [204, 503]) {
    const first = await delayedLogoutClient(t), second = await delayedLogoutClient(t, b);
    const ui = accountLogoutHarness(first.client); t.after(ui.unmount); await ui.settle();
    first.server.setLogoutStatus(status); await ui.press('Pressable', '로그아웃');
    await ui.replaceClient(second.client); assert.equal(ui.find('Pressable', '로그아웃').props.disabled, false);
    await ui.press('Pressable', '로그아웃'); first.gate.resolve(); await ui.settle();
    assert.equal(ui.navigation.length, 0); assert.equal(ui.find('Action', '로그아웃 다시 시도').props.disabled, true);
    assert.equal(second.client.getSnapshot().status, 'checking');
    assert.ok(!ui.nodes().some(node => node.type === 'Text' && String(node.props.children).includes('로그아웃 완료를 확인하지 못했습니다.')));
    second.gate.resolve(); await ui.settle(); assert.equal(ui.route.screen, 'login'); assert.equal(ui.navigation.length, 1);
  }
});

test('로그아웃 화면 경합은 렌더 전 연속 입력에서도 요청 한 번과 대기 상태를 유지합니다.', async t => {
  const session = await delayedLogoutClient(t), ui = accountLogoutHarness(session.client); t.after(ui.unmount); await ui.settle();
  const press = ui.find('Pressable', '로그아웃').props.onPress; press(); press(); await ui.settle();
  assert.equal(session.requests.length, 1); assert.equal(ui.find('Action', '로그아웃 다시 시도').props.disabled, true);
  session.gate.resolve(); await ui.settle(); assert.equal(ui.navigation.length, 1); assert.equal(ui.route.screen, 'login');
});

test('회원 요청으로 관리자 경로를 우회하지 않고 폐기한 클라이언트는 늦게 복원되지 않습니다.', async () => {
  const server = transport(); const client = createMemberSessionClient('https://api.example.test', server.fetcher); await client.refresh();
  for (const path of ['/api/admin/session', '/api/members/../admin/session', '/api/members/%2e%2e/admin/session', '/api/members/..?x=1', '//evil.test/api/members/me']) await assert.rejects(client.request(path), /경로/);
  const calls = server.calls.length; client.dispose(); await client.refresh();
  assert.equal(server.calls.length, calls); assert.equal(client.getSnapshot().member, null);
});
