import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecentWorksStore, parseRecentWorks } from '../src/recentWorks.ts';

const work = id => ({ id, title: id, imageUrl: `/media/${id}.png`, kind: 'book', lastReadAt: '2026-11-11T01:00:00Z' });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(status = 'anonymous', request = async () => []) {
  let auth = { status, member: status === 'authenticated' ? { id: 'a' } : null, generation: 0, error: null };
  const listeners = new Set();
  const calls = [];
  const client = {
    getSnapshot: () => auth,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request(path, init) { calls.push([path, init?.method ?? 'GET']); return request(path, init); },
  };
  const store = createRecentWorksStore(client);
  store.start();
  return {
    store, client, calls, listeners,
    change(next) { auth = { ...auth, ...next }; for (const listener of listeners) listener(); },
  };
}

test('비회원의 두 화면은 같은 목록을 구독하고 중복 제거·20개 제한·삭제를 공유합니다.', async () => {
  const { store, calls } = fixture();
  let home, screen;
  store.subscribe(() => { home = store.getSnapshot(); });
  store.subscribe(() => { screen = store.getSnapshot(); });
  for (let id = 0; id < 22; id++) await store.record(work(`book-${id}`));
  await store.record(work('book-5'));
  assert.strictEqual(home, screen);
  assert.equal(home.items.length, 20);
  assert.equal(home.items[0].id, 'book-5');
  assert.equal(home.items.filter(item => item.id === 'book-5').length, 1);
  store.clearGuest();
  assert.equal(home.items.length, 0);
  assert.deepEqual(calls, []);
  store.dispose();
});

test('로그인 시 비회원 기록을 합치지 않고 회원 목록을 가져옵니다.', async () => {
  const { store, change, calls } = fixture('anonymous', async () => [work('member-book')]);
  await store.record(work('guest-book'));
  change({ status: 'authenticated', member: { id: 'a' }, generation: 1 });
  assert.equal(store.getSnapshot().status, 'loading');
  assert.deepEqual(store.getSnapshot().items, []);
  await store.refresh();
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['member-book']);
  assert.deepEqual(calls, [['/api/members/recent-works', 'GET']]);
  store.clearGuest();
  assert.equal(store.getSnapshot().items.length, 1);
  change({ status: 'anonymous', member: null, generation: 2 });
  assert.deepEqual(store.getSnapshot().items, []);
  store.dispose();
});

test('이전 회원의 늦은 조회 응답을 새 회원 목록에 반영하지 않습니다.', async () => {
  const old = deferred();
  let count = 0;
  const { store, change } = fixture('authenticated', () => ++count === 1 ? old.promise : Promise.resolve([work('b-book')]));
  const first = store.refresh();
  change({ status: 'authenticated', member: { id: 'b' }, generation: 1 });
  assert.deepEqual(store.getSnapshot().items, []);
  await store.refresh();
  old.resolve([work('a-book')]);
  await first;
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['b-book']);
  store.dispose();
});

test('세대 값이 같아도 회원 ID가 바뀌면 목록을 초기화합니다.', async () => {
  const { store, change, calls } = fixture('authenticated', async () => []);
  await store.refresh();
  change({ member: { id: 'b' } });
  await store.refresh();
  assert.equal(calls.length, 2);
  store.dispose();
});

test('같은 회원의 세션 재확인은 목록을 초기화하거나 중복 조회하지 않습니다.', async () => {
  const { store, change, calls } = fixture('authenticated', async () => [work('a-book')]);
  await store.refresh();
  const state = store.getSnapshot();
  change({ member: { id: 'a' } });
  assert.strictEqual(store.getSnapshot(), state);
  assert.equal(calls.length, 1);
  store.dispose();
});

test('진행 중인 목록 조회는 홈과 전용 화면의 새로고침 요청이 공유합니다.', async () => {
  const pending = deferred();
  const { store, calls } = fixture('authenticated', () => pending.promise);
  const home = store.refresh(), screen = store.refresh();
  assert.strictEqual(home, screen);
  assert.equal(calls.length, 1);
  pending.resolve([]);
  await home;
  store.dispose();
});

test('기록 전에 시작한 조회가 늦게 도착해도 저장 후 조회 결과를 덮어쓰지 않습니다.', async () => {
  const old = deferred();
  let reads = 0;
  const { store } = fixture('authenticated', async (_path, init) => {
    if (init?.method === 'POST') return null;
    return ++reads === 1 ? old.promise : [work('new-book')];
  });
  const first = store.refresh();
  await store.record(work('new-book'));
  old.resolve([work('old-book')]);
  await first;
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['new-book']);
  store.dispose();
});

test('연속 상세 열람은 기록 요청을 직렬화하고 저장된 목록을 다시 읽습니다.', async () => {
  const first = deferred();
  let saved = [], posts = [];
  const { store } = fixture('authenticated', async (path, init) => {
    if (init?.method !== 'POST') return [...saved];
    const id = path.split('/').at(-1);
    posts.push(id);
    if (id === 'first') await first.promise;
    saved = [work(id), ...saved];
    return null;
  });
  await store.refresh();
  const a = store.record(work('first')), b = store.record(work('second'));
  await Promise.resolve();
  assert.deepEqual(posts, ['first']);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(posts, ['first', 'second']);
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['second', 'first']);
  store.dispose();
});

test('계정 변경 전 대기 중이던 기록은 새 회원으로 전송하지 않습니다.', async () => {
  const pending = deferred();
  const posts = [];
  const { store, change } = fixture('authenticated', async (path, init) => {
    if (init?.method !== 'POST') return [];
    const id = path.split('/').at(-1);
    posts.push(id);
    if (id === 'a-first') await pending.promise;
    return null;
  });
  await store.refresh();
  const first = store.record(work('a-first')), queued = store.record(work('a-queued'));
  await Promise.resolve();
  change({ status: 'authenticated', member: { id: 'b' }, generation: 1 });
  await store.record(work('b-first'));
  pending.resolve();
  await Promise.all([first, queued]);
  assert.deepEqual(posts, ['a-first', 'b-first']);
  store.dispose();
});

test('저장 실패는 메모리 성공으로 대체하지 않으며 다음 기록은 재시도할 수 있습니다.', async () => {
  let fail = true;
  const { store } = fixture('authenticated', async (_path, init) => {
    if (init?.method === 'POST') {
      if (fail) throw new Error('기록 저장 실패');
      return null;
    }
    return fail ? [] : [work('saved-book')];
  });
  await store.refresh();
  await store.record(work('failed-book'));
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, '기록 저장 실패');
  assert.deepEqual(store.getSnapshot().items, []);
  fail = false;
  await store.record(work('saved-book'));
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['saved-book']);
  store.dispose();
});

test('인증 확인 실패 시 비회원 기록을 대신 보여 주지 않습니다.', async () => {
  const { store, change } = fixture();
  await store.record(work('guest-book'));
  change({ status: 'error', error: '로그인 상태 확인 실패' });
  assert.equal(store.getSnapshot().status, 'error');
  assert.deepEqual(store.getSnapshot().items, []);
  change({ status: 'anonymous', error: null });
  assert.deepEqual(store.getSnapshot().items, []);
  store.dispose();
});

test('저장소 폐기 후 늦은 응답을 반영하지 않으며 인증 구독도 해제합니다.', async () => {
  const pending = deferred();
  const { store, listeners } = fixture('authenticated', () => pending.promise);
  const read = store.refresh();
  const state = store.getSnapshot();
  store.dispose();
  pending.resolve([work('old-book')]);
  await read;
  assert.strictEqual(store.getSnapshot(), state);
  assert.equal(listeners.size, 0);
});

test('인증 확인 실패의 재시도는 세션을 다시 확인한 뒤 회원 목록을 읽습니다.', async () => {
  const { store, client, change } = fixture('error', async () => [work('member-book')]);
  client.refresh = async () => { change({ status: 'authenticated', member: { id: 'a' }, error: null }); };
  await store.refresh();
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), ['member-book']);
  store.dispose();
});

test('회원 응답의 중복 작품과 날짜가 없는 항목을 거부합니다.', () => {
  assert.throws(() => parseRecentWorks([work('same'), work('same')]));
  assert.throws(() => parseRecentWorks([{ ...work('a'), lastReadAt: '잘못된 시각' }]));
  assert.deepEqual(parseRecentWorks([work('a')]), [work('a')]);
});
