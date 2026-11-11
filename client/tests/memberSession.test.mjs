import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createMemberSessionClient, parseMemberIdentity } from '../src/memberSession.ts';

const a = { id: '9007199254740994', email: 'a@example.test', nickname: '첫 회원', createdAt: '2026-11-07T01:00:00Z' };
const b = { id: '2', email: 'b@example.test', nickname: '다른 회원', createdAt: '2026-11-07T02:00:00Z' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

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

test('회원 요청으로 관리자 경로를 우회하지 않고 폐기한 클라이언트는 늦게 복원되지 않습니다.', async () => {
  const server = transport(); const client = createMemberSessionClient('https://api.example.test', server.fetcher); await client.refresh();
  for (const path of ['/api/admin/session', '/api/members/../admin/session', '/api/members/%2e%2e/admin/session', '/api/members/..?x=1', '//evil.test/api/members/me']) await assert.rejects(client.request(path), /경로/);
  const calls = server.calls.length; client.dispose(); await client.refresh();
  assert.equal(server.calls.length, calls); assert.equal(client.getSnapshot().member, null);
});
