import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesReadingResume, parseReadingProgress, readingSegments, restoreReadingOffset, saveReadingProgress } from '../src/readingProgress.ts';
import { createMemberSessionClient, MemberRequestError } from '../src/memberSession.ts';

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
