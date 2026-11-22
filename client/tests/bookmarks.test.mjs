import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmark, deleteBookmark, hasBookmarkAtPosition, listBookmarks, listWorkBookmarks, parseBookmark } from '../src/bookmarks.ts';
import { createMemberSessionClient } from '../src/memberSession.ts';

const position = { chapterId: '9007199254740993', offset: 4, unit: 'utf16', contentVersion: 2, contentHash: 'a'.repeat(64) };
const available = { id: '9007199254740995', state: 'available', workId: 'test-novel', workTitle: '작품', kind: 'novel',
  chapterTitle: '첫 화', position, snippet: '현재 본문', createdAt: '2026-11-13T01:00:00Z' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('비공개 기록의 내용은 화면에 전달하지 않고 기존 텍스트 좌표는 재확인으로 표시합니다.', () => {
  const hidden = parseBookmark({ ...available, state: 'hidden' });
  assert.equal(hidden.id, available.id);
  for (const field of ['workId', 'workTitle', 'chapterTitle', 'position', 'snippet']) assert.equal(hidden[field], null);
  const stale = { ...available, state: 'stale', position: { ...position, contentHash: null }, snippet: null };
  assert.deepEqual(parseBookmark(stale), stale);
  assert.throws(() => parseBookmark({ ...stale, state: 'available' }), /응답/);
});

test('같은 회원 세션으로 조회하고 저장·삭제에는 CSRF를 전송합니다.', async () => {
  const calls = [];
  const client = createMemberSessionClient('https://example.test', async (url, init) => {
    const target = new URL(url);
    if (target.pathname === '/api/auth/session') return json({ id: '1', email: 'reader@example.test', nickname: '독자', createdAt: available.createdAt });
    if (target.pathname === '/api/auth/csrf') return json({ headerName: 'X-CSRF-TOKEN', token: 'bookmark-csrf' });
    assert.equal(init.credentials, 'include');
    calls.push(init.method ?? 'GET');
    if (init.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'bookmark-csrf');
      assert.deepEqual(JSON.parse(init.body), { workId: 'test-novel', chapterId: position.chapterId, offset: 4,
        contentVersion: 2 });
      return json(available);
    }
    if (init.method === 'DELETE') {
      assert.equal(new Headers(init.headers).get('X-CSRF-TOKEN'), 'bookmark-csrf');
      assert.equal(target.pathname, '/api/members/bookmarks/' + available.id);
      return new Response(null, { status: 204 });
    }
    assert.equal(target.searchParams.get('workId'), 'test-novel');
    assert.equal(target.searchParams.get('page'), '2');
    return json({ items: [available], page: 2, hasNext: false });
  });
  try {
    await client.refresh();
    assert.deepEqual(await createBookmark(client, 'test-novel', position), available);
    assert.deepEqual((await listBookmarks(client, 2, 'test-novel')).items, [available]);
    await deleteBookmark(client, available.id);
    assert.deepEqual(calls, ['POST', 'GET', 'DELETE']);
  } finally {
    client.dispose();
  }
});

test('현재 작품의 정확한 본문 위치에 available 책갈피가 있을 때만 색칠합니다.', () => {
  assert.equal(hasBookmarkAtPosition([available], available.workId, position), true);
  assert.equal(hasBookmarkAtPosition([available], available.workId, null), false);
  assert.equal(hasBookmarkAtPosition([available], 'other-work', position), false);
  for (const change of [{ chapterId: '2' }, { offset: 5 }, { unit: 'page' }, { contentVersion: 3 }, { contentHash: 'b'.repeat(64) }]) {
    assert.equal(hasBookmarkAtPosition([available], available.workId, { ...position, ...change }), false);
  }
  for (const state of ['stale', 'hidden']) {
    assert.equal(hasBookmarkAtPosition([{ ...available, state }], available.workId, position), false);
  }
  const page = { chapterId: '81', offset: 8, unit: 'page', contentVersion: 1, contentHash: null };
  const magazine = { ...available, kind: 'magazine', position: page, snippet: null };
  assert.equal(hasBookmarkAtPosition([magazine], magazine.workId, page), true);
  assert.equal(hasBookmarkAtPosition([magazine], magazine.workId, { ...page, offset: 9 }), false);
});

test('작품의 30건 이후 책갈피도 한 번 조회하고 위치 이동·삭제 표시는 목록 안에서 계산합니다.', async () => {
  const calls = [];
  const controller = new AbortController();
  const first = Array.from({ length: 30 }, (_, index) => ({ ...available, id: String(index + 1),
    position: { ...position, offset: index + 100 } }));
  const client = { async request(path, init) {
    const url = new URL(path, 'https://example.test');
    assert.equal(url.searchParams.get('workId'), available.workId);
    assert.equal(init.signal, controller.signal);
    const page = Number(url.searchParams.get('page'));
    calls.push(page);
    return { items: page === 1 ? first : [available], page, hasNext: page === 1 };
  } };
  const items = await listWorkBookmarks(client, available.workId, controller.signal);
  assert.equal(items.length, 31);
  assert.equal(hasBookmarkAtPosition(items, available.workId, position), true);
  assert.equal(hasBookmarkAtPosition(items, available.workId, { ...position, offset: 5 }), false);
  assert.equal(hasBookmarkAtPosition(items, available.workId, position), true);
  assert.equal(hasBookmarkAtPosition(items.filter(item => item.id !== available.id), available.workId, position), false);
  assert.deepEqual(calls, [1, 2]);
});

test('화면을 떠나 취소한 조회는 늦은 마지막 페이지도 반환하지 않고 다음 페이지를 요청하지 않습니다.', async () => {
  for (const hasNext of [false, true]) {
    const controller = new AbortController();
    let requests = 0;
    const client = { async request() {
      requests++;
      controller.abort();
      return { items: [available], page: 1, hasNext };
    } };
    await assert.rejects(listWorkBookmarks(client, available.workId, controller.signal), { name: 'AbortError' });
    assert.equal(requests, 1);
    await assert.rejects(listWorkBookmarks(client, available.workId, controller.signal), { name: 'AbortError' });
    assert.equal(requests, 1);
  }
});

test('서버나 회원 교체로 폐기한 세션의 늦은 책갈피 응답은 사용하지 않습니다.', async () => {
  const pending = Promise.withResolvers();
  const requested = Promise.withResolvers();
  const client = createMemberSessionClient('https://example.test', async (url, init) => {
    if (url.endsWith('/api/auth/session')) return json({ id: '1', email: 'reader@example.test', nickname: '독자', createdAt: available.createdAt });
    requested.resolve(init.signal);
    return pending.promise;
  });
  await client.refresh();
  const controller = new AbortController();
  const reading = listWorkBookmarks(client, available.workId, controller.signal);
  const signal = await requested.promise;
  client.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve(json({ items: [available], page: 1, hasNext: false }));
  await assert.rejects(reading, { name: 'AbortError' });
});
