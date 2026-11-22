import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fetchWorkDetail, parseWorkDetail } from '../src/workDetails.ts';
import { searchWorks } from '../src/workSearch.ts';
import { createMockServer } from '../../server/mock/index.mjs';

// #region 작품 예시와 테스트 서버
const works = JSON.parse(await readFile(new URL('../../server/mock/fixtures/works.json', import.meta.url), 'utf8'));

/**
 * 임시 서버를 시작하고 테스트 종료 시 연결과 포트를 정리합니다.
 * @param context - 종료 후 정리를 등록할 테스트 컨텍스트입니다.
 * @param server - 검사할 응답을 제공하는 HTTP 서버입니다.
 * @returns 임시 포트의 기본 주소입니다.
 */
async function startServer(context, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return 'http://127.0.0.1:' + server.address().port;
}
// #endregion

// #region 검색 결과와 상세 연결
test('검색어와 종류를 전달하고 검색 결과의 slug로 상세를 조회합니다.', async context => {
  const work = works.find(item => item.kind === 'book');
  const query = '한글 & 작품';
  const apiUrl = await startServer(context, createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/works') {
      assert.equal(url.searchParams.get('query'), query);
      assert.equal(url.searchParams.get('kind'), 'book');
      response.end(JSON.stringify([{ id: work.id, title: work.title, imageUrl: work.imageUrl, kind: work.kind }]));
    } else {
      assert.equal(url.pathname, `/works/${work.id}`);
      response.end(JSON.stringify(work));
    }
  }));
  const results = await searchWorks(apiUrl, query, 'book', AbortSignal.timeout(5000));
  assert.equal(results.length, 1);
  assert.deepEqual(await fetchWorkDetail(apiUrl, results[0].id, AbortSignal.timeout(5000)), work);
});

test('선택 장르는 한 번만 인코딩해 전달하고 해제하면 요청에서 생략합니다.', async context => {
  const requests = [];
  const apiUrl = await startServer(context, createServer((request, response) => {
    requests.push(new URL(request.url, 'http://localhost').searchParams);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('[]');
  }));
  const genre = '로맨스 판타지 & +😀';
  await searchWorks(apiUrl, '제목 & 저자', 'novel', AbortSignal.timeout(5000), genre);
  await searchWorks(apiUrl, '제목 & 저자', 'novel', AbortSignal.timeout(5000));
  assert.deepEqual(requests[0].getAll('genre'), [genre]);
  assert.equal(requests[0].get('query'), '제목 & 저자');
  assert.equal(requests[0].get('kind'), 'novel');
  assert.equal(requests[1].has('genre'), false);
});

test('검색 결과 없음과 서버 오류·잘못된 응답을 구분합니다.', async context => {
  let status = 200;
  let body = [];
  const apiUrl = await startServer(context, createServer((request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }));
  assert.deepEqual(await searchWorks(apiUrl, '검색', 'all', AbortSignal.timeout(5000)), []);
  status = 500;
  await assert.rejects(searchWorks(apiUrl, '검색', 'all', AbortSignal.timeout(5000)), /HTTP 500/);
  status = 200;
  body = { items: [] };
  await assert.rejects(searchWorks(apiUrl, '검색', 'all', AbortSignal.timeout(5000)), /형식/);
  body = [{ id: 'invalid', title: '잘못된 종류', imageUrl: '/cover.png', kind: 'all' }];
  await assert.rejects(searchWorks(apiUrl, '검색', 'all', AbortSignal.timeout(5000)), /형식/);
});
// #endregion

// #region 상세 정보 계약
test('세 분류의 상세 예시 16개를 서버 값 그대로 수용합니다.', () => {
  assert.equal(works.length, 16);
  assert.deepEqual([...new Set(works.map(work => work.kind))].sort(), ['book', 'magazine', 'novel']);
  for (const work of works) assert.deepEqual(parseWorkDetail(work), work, work.id);
});

test('선택 정보가 없는 작품과 0개·1개·여러 개 목차의 순서를 보존합니다.', () => {
  for (const count of [0, 1, 8]) {
    const work = structuredClone(works[0]);
    for (const field of ['pageCount', 'quote', 'issue', 'publicationCycle', 'statistics', 'descriptionTitle']) delete work[field];
    work.contents = Array.from({ length: count }, (_, index) => ({ id: 'chapter-' + index, title: '제목 ' + index })).reverse();
    assert.deepEqual(parseWorkDetail(work), work);
  }
});

test('필수 정보 누락·잘못된 출판 정보·중복 목차를 빈 작품으로 바꾸지 않습니다.', () => {
  for (const change of [
    work => { delete work.id; },
    work => { work.kind = 'all'; },
    work => { work.author = ' '; },
    work => { work.publishedAt = '2026-99-99'; },
    work => { work.publishedAt = '2026-02-30'; },
    work => { work.publishedAt = '2026-04-31'; },
    work => { work.pageCount = -1; },
    work => { work.contents = null; },
    work => { work.contents = [{ id: 'same', title: '첫째' }, { id: 'same', title: '둘째' }]; },
    work => { work.contents[0].pageNumber = 0; },
    work => { work.contents[0].characterCount = -1; },
    work => { work.contents[0].category = ' '; },
    work => { work.contents[0].publishedAt = '2026-02-30'; },
    work => { work.statistics = { views: 1, recommendations: 0, rating: 8 }; },
  ]) {
    const work = structuredClone(works[0]);
    change(work);
    assert.throws(() => parseWorkDetail(work), Error);
  }
  for (const value of [null, [], { sections: [] }]) assert.throws(() => parseWorkDetail(value), Error);
});

test('지원하지 않는 표지 주소를 거절하고 한글 상대 경로는 수용합니다.', () => {
  for (const imageUrl of ['javascript:alert(1)', '//example.com/cover.png', '../cover.png', 'https://', 'https://user:password@example.com/cover.png']) {
    assert.throws(() => parseWorkDetail({ ...works[0], imageUrl }), Error);
  }
  assert.deepEqual(parseWorkDetail(works[0]), works[0]);
});
// #endregion

// #region 실제 조회와 실패 처리
test('클라이언트 조회 함수로 간이 서버의 모든 작품을 읽고 알 수 없는 ID는 거절합니다.', async context => {
  const apiUrl = await startServer(context, await createMockServer());
  for (const work of works) {
    assert.deepEqual(await fetchWorkDetail(apiUrl, work.id, AbortSignal.timeout(5000)), work, work.id);
  }
  await assert.rejects(fetchWorkDetail(apiUrl, 'missing-work', AbortSignal.timeout(5000)), /작품을 찾을 수 없습니다/);
});

test('서버가 다른 작품이나 화면 구성을 보내면 요청한 상세 정보로 표시하지 않습니다.', async context => {
  let body = { ...works[0], id: 'another-work' };
  const apiUrl = await startServer(context, createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }));
  await assert.rejects(fetchWorkDetail(apiUrl, works[0].id, AbortSignal.timeout(5000)), /일치하지 않습니다/);
  body = { version: 1, sections: [] };
  await assert.rejects(fetchWorkDetail(apiUrl, works[0].id, AbortSignal.timeout(5000)), /형식이 올바르지 않습니다/);
});

test('응답 대기 중 화면의 취소 신호를 받으면 진행 중인 조회를 중단합니다.', async context => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const apiUrl = await startServer(context, createServer(() => markStarted()));
  const controller = new AbortController();
  const pending = fetchWorkDetail(apiUrl, works[0].id, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await rejected;
});
// #endregion
