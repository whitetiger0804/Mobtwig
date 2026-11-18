import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentMagazinePage, fetchMagazineIssue, fetchMagazinePage, magazineArticle, magazinePageUrl, parseMagazineIssue, startMagazinePage } from '../src/magazineReader.ts';
import { MemberRequestError } from '../src/memberSession.ts';

const issue = {
  workId: 'issue-one', title: '검증 호', pageCount: 12,
  articles: [
    { chapterId: '9007199254740993', title: '첫 기사', startPage: 1, endPage: 4, contentVersion: 1 },
    { chapterId: '2', title: '둘째 기사', startPage: 5, endPage: 8, contentVersion: 3 },
    { chapterId: '4', title: '넷째 기사', startPage: 11, endPage: 12, contentVersion: 2 },
  ],
};

test('소장 매거진의 목차와 PNG는 회원 경로·버전을 유지하고 이미지만 데이터 URL로 표시합니다.', async t => {
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64');
        this.onload();
      });
    }
  };
  t.after(() => { if (previous === undefined) delete globalThis.FileReader; else globalThis.FileReader = previous; });
  const calls = [];
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const client = {
    getSnapshot: () => ({ generation: 1 }),
    request: async path => { calls.push(path); return issue; },
    requestPng: async (path, signal) => { calls.push(path); assert.ok(signal instanceof AbortSignal); return png; },
  };
  const controller = new AbortController();
  assert.deepEqual(await fetchMagazineIssue('', issue.workId, controller.signal, client), issue);
  const uri = await fetchMagazinePage('', issue, 6, controller.signal, client);
  assert.equal(uri, 'data:image/png;base64,iVBORw==');
  assert.deepEqual(calls, ['/api/members/works/issue-one/magazine', '/api/members/works/issue-one/magazine/pages/6?contentVersion=3']);
  client.requestPng = async () => { throw new MemberRequestError(402, 'PURCHASE_REQUIRED'); };
  await assert.rejects(fetchMagazinePage('', issue, 6, controller.signal, client), failure => failure.status === 402);
});

test('이미지 디코딩 도중 계정 전환이나 페이지 취소가 발생하면 데이터 URL을 버립니다.', async t => {
  const previous = globalThis.FileReader;
  let reader;
  globalThis.FileReader = class {
    readAsDataURL() { reader = this; }
    abort() { this.aborted = true; }
  };
  t.after(() => { if (previous === undefined) delete globalThis.FileReader; else globalThis.FileReader = previous; });
  for (const reason of ['member', 'page']) {
    let generation = 1;
    const client = { getSnapshot: () => ({ generation }), requestPng: async () => new Blob(['png'], { type: 'image/png' }) };
    const controller = new AbortController();
    const pending = fetchMagazinePage('', issue, 6, controller.signal, client);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    if (reason === 'member') generation++;
    else controller.abort();
    reader.result = 'data:image/png;base64,cG5n';
    reader.onload();
    await rejected;
  }
});

test('호 식별자와 겹치지 않는 쪽 범위를 검증합니다.', () => {
  assert.deepEqual(parseMagazineIssue(issue, 'issue-one'), issue);
  assert.throws(() => parseMagazineIssue(issue, 'another-issue'), /목차/);
  assert.throws(() => parseMagazineIssue({ ...issue, articles: [issue.articles[0], { ...issue.articles[1], startPage: 4 }] }, 'issue-one'), /목차/);
  assert.throws(() => parseMagazineIssue({ ...issue, pageCount: 10 }, 'issue-one'), /목차/);
  assert.throws(() => parseMagazineIssue({ ...issue, pageCount: null }, 'issue-one'), /목차/);
});

test('유효한 버전의 저장 쪽만 복원하고 명시적으로 고른 기사는 처음부터 엽니다.', () => {
  const saved = { chapterId: '2', offset: 6, unit: 'page', contentVersion: 3, contentHash: null };
  assert.equal(startMagazinePage(issue), 1);
  assert.equal(startMagazinePage(issue, '2'), 5);
  assert.equal(startMagazinePage(issue, '2', saved), 6);
  assert.equal(startMagazinePage(issue, '2', { ...saved, contentVersion: 2 }), 5);
  assert.equal(startMagazinePage(issue, '2', { ...saved, offset: 9 }), 5);
  assert.equal(startMagazinePage(issue, 'unknown', saved), null);
  assert.equal(startMagazinePage({ ...issue, articles: [] }), null);
});

test('버튼과 PNG 주소가 비공개 쪽을 가리키지 않습니다.', () => {
  assert.equal(adjacentMagazinePage(issue, 1, -1), null);
  assert.equal(adjacentMagazinePage(issue, 12, 1), null);
  assert.equal(adjacentMagazinePage(issue, 4, 1), 5);
  assert.equal(adjacentMagazinePage(issue, 8, 1), 11);
  assert.equal(adjacentMagazinePage(issue, 11, -1), 8);
  assert.equal(magazineArticle(issue, 9), null);
  assert.throws(() => magazinePageUrl('https://api.example', issue, 9), /목차/);
  assert.equal(magazinePageUrl('https://api.example', issue, 6), 'https://api.example/works/issue-one/magazine/pages/6?contentVersion=3');
});
