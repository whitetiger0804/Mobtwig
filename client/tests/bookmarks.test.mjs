import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookmark, deleteBookmark, listBookmarks, parseBookmark } from '../src/bookmarks.ts';
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
        contentVersion: 2, contentHash: position.contentHash });
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
