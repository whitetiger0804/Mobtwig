import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockServer } from './index.mjs';

// #region 테스트 서버와 요청 유틸리티

const mockDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(mockDirectory, 'fixtures', 'home.json');
const worksPath = join(mockDirectory, 'fixtures', 'works.json');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8'));
const works = JSON.parse(await readFile(worksPath, 'utf8'));

/**
 * 실제 HTTP 서버를 임시 포트에서 실행하고 테스트 종료 시 닫습니다.
 *
 * @param context - 종료 후 정리를 등록할 테스트 컨텍스트입니다.
 * @param options - 간이 서버 생성 옵션입니다.
 * @returns 실행 중인 서버의 기본 URL입니다.
 */
async function startServer(context, options) {
  const server = await createMockServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * URL 정규화 없이 입력한 경로를 보내 경로 탐색 차단을 검증합니다.
 *
 * @param baseUrl - 실행 중인 간이 서버 주소입니다.
 * @param path - 그대로 전송할 HTTP 요청 경로입니다.
 * @returns HTTP 상태와 문자열 본문입니다.
 */
async function requestRawPath(baseUrl, path) {
  return new Promise((resolve, reject) => {
    const outgoing = request(baseUrl, { path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/**
 * 원본 예시를 보존하면서 수정 가능한 임시 JSON 파일을 준비합니다.
 *
 * @param context - 임시 파일 정리를 등록할 테스트 컨텍스트입니다.
 * @param sourcePath - 복사할 원본 JSON 파일의 경로입니다.
 * @returns 복사한 JSON 파일의 경로입니다.
 */
async function copyFixture(context, sourcePath = fixturePath) {
  const prefix = join(tmpdir(), 'mobtwig-sdui-test-');
  const directory = await mkdtemp(prefix);
  const copiedFixture = join(directory, basename(sourcePath));
  await copyFile(sourcePath, copiedFixture);
  context.after(async () => {
    assert.ok(directory.startsWith(prefix));
    await rm(directory, { recursive: true, force: true });
  });
  return copiedFixture;
}

// #endregion

// #region 실제 HTTP 응답 검증

test('상태 확인과 웹 개발용 CORS 헤더를 반환합니다.', async (context) => {
  const baseUrl = await startServer(context);
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', service: 'mobtwig-mock' });
});

test('네 종류의 제목·순서·항목 수를 JSON 원문대로 반환합니다.', async (context) => {
  const baseUrl = await startServer(context);

  for (const kind of ['all', 'book', 'magazine', 'novel']) {
    const response = await fetch(`${baseUrl}/sdui/home?kind=${kind}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), fixtures[kind]);
  }
});

test('빈 최근 작품과 빈 최근 도서에 항목을 추가하지 않습니다.', async (context) => {
  const baseUrl = await startServer(context);
  const all = await (await fetch(`${baseUrl}/sdui/home?kind=all`)).json();
  const book = await (await fetch(`${baseUrl}/sdui/home?kind=book`)).json();
  assert.deepEqual(all.sections.find((section) => section.id === 'recent-works').items, []);
  assert.deepEqual(book.sections.find((section) => section.id === 'recent-books').items, []);
});

test('도서 홈은 작품 목록 앞의 상단 자리에 오늘의 책 요소를 보냅니다.', async (context) => {
  const baseUrl = await startServer(context);
  const response = await fetch(`${baseUrl}/sdui/home?kind=book`);
  assert.equal(response.status, 200);
  const home = await response.json();
  assert.equal(home.sections[0].type, 'featuredWork');
  assert.equal(home.sections[0].items[0].label, '오늘의 책');
  assert.equal(home.sections[0].items[0].title, '나를 돌보는 연습');
  assert.equal(home.sections[0].items[0].imageUrl, '/assets/도서/나를 돌보는 연습.png');
  assert.ok(home.sections.findIndex((section) => section.type === 'workShelf') > 0);
});

test('응답에서 사용하는 이미지 17개를 실제 PNG로 제공합니다.', async (context) => {
  const baseUrl = await startServer(context);
  const urls = new Set(Object.values(fixtures).flatMap((home) => home.sections)
    .flatMap((section) => section.items)
    .filter((item) => item.imageUrl)
    .map((item) => item.imageUrl));
  assert.equal(urls.size, 17);

  for (const url of urls) {
    assert.ok(url.startsWith('/assets/'));
    const response = await fetch(new URL(url, baseUrl));
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('content-type'), 'image/png', url);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], url);
    assert.ok(body.length > 1000, url);
  }
});

test('홈의 작품 16개를 같은 ID·제목·표지의 상세 정보로 연결합니다.', async (context) => {
  const baseUrl = await startServer(context);
  const homeWorks = new Map();

  for (const kind of ['all', 'book', 'magazine', 'novel']) {
    const response = await fetch(`${baseUrl}/sdui/home?kind=${kind}`);
    const home = await response.json();

    for (const section of home.sections.filter((item) => ['workShelf', 'featuredWork'].includes(item.type))) {
      for (const work of section.items) {
        homeWorks.set(work.id, work);
      }
    }
  }

  assert.equal(homeWorks.size, 16);
  assert.equal(works.length, 16);
  assert.equal(new Set(works.map((work) => work.id)).size, 16);
  assert.deepEqual(Object.fromEntries(['book', 'magazine', 'novel'].map((kind) => [
    kind, works.filter((work) => work.kind === kind).length,
  ])), { book: 6, magazine: 5, novel: 5 });

  for (const [id, homeWork] of homeWorks) {
    const response = await fetch(`${baseUrl}/works/${id}`);
    assert.equal(response.status, 200, id);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const detail = await response.json();
    assert.deepEqual(detail, works.find((work) => work.id === id), id);
    assert.equal(detail.title, homeWork.title, id);
    assert.equal(detail.imageUrl, homeWork.imageUrl, id);
    assert.equal('sections' in detail, false, id);
    assert.equal('type' in detail, false, id);

    for (const field of ['author', 'description', 'publisher', 'category', 'fileFormat']) {
      assert.equal(typeof detail[field], 'string', `${id}: ${field}`);
      assert.ok(detail[field].length > 0, `${id}: ${field}`);
    }

    assert.match(detail.publishedAt, /^\d{4}-\d{2}-\d{2}$/, id);
    assert.ok(detail.contents.length > 0, id);
    assert.equal(new Set(detail.contents.map((item) => item.id)).size, detail.contents.length, id);
    assert.ok(detail.contents.every((item) => typeof item.id === 'string' && item.title.length > 0), id);
  }

  const care = works.find((work) => work.id === 'book-care');
  assert.equal(care.author, '서지온');
  assert.equal(care.publisher, '모북출판');
  assert.equal(care.publishedAt, '2026-09-18');
  assert.equal(care.pageCount, 248);
  const orbit = works.find((work) => work.id === 'magazine-orbit');
  assert.equal(orbit.issue, '2026.10 · VOL.08');
  assert.equal(orbit.publicationCycle, '월간');
  assert.deepEqual(works.find((work) => work.id === 'novel-record').statistics, {
    views: 12000, recommendations: 486, rating: 4.8,
  });
});

test('없는 작품과 상세 하위 경로를 거절하고 작품 파일 자체는 공개하지 않습니다.', async (context) => {
  const baseUrl = await startServer(context);

  for (const id of ['missing-work', '__proto__', 'constructor']) {
    const response = await fetch(`${baseUrl}/works/${id}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: '요청한 작품이 없습니다.' });
  }

  for (const path of ['/works', '/works/', '/works/book-care/contents', '/works/book%2Fcare', '/fixtures/works.json']) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
  }

  assert.equal((await requestRawPath(baseUrl, '/works/%2e%2e%2ffixtures%2fworks.json')).status, 404);
  assert.equal((await requestRawPath(baseUrl, '/works/%XX')).status, 400);
  const response = await fetch(`${baseUrl}/works/book-care`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('상세 정보를 매번 읽어 소개 변경과 빈 목차를 서버 재시작 없이 반영합니다.', async (context) => {
  const copiedWorks = await copyFixture(context, worksPath);
  const baseUrl = await startServer(context, { worksPath: copiedWorks });
  const endpoint = `${baseUrl}/works/${works[0].id}`;
  assert.deepEqual(await (await fetch(endpoint)).json(), works[0]);

  const modified = structuredClone(works);
  modified[0].description = '변경된 작품 소개를 그대로 반환합니다.';
  modified[0].contents = [];
  delete modified[0].quote;
  await writeFile(copiedWorks, JSON.stringify(modified), 'utf8');
  assert.deepEqual(await (await fetch(endpoint)).json(), modified[0]);
  assert.deepEqual(await (await fetch(`${baseUrl}/sdui/home?kind=all`)).json(), fixtures.all);
});

test('작품 JSON 오류와 파일 부재에 500을 반환하고 파일 경로는 노출하지 않습니다.', async (context) => {
  const copiedWorks = await copyFixture(context, worksPath);
  const baseUrl = await startServer(context, { worksPath: copiedWorks });

  for (const invalid of ['{invalid', '{}']) {
    await writeFile(copiedWorks, invalid, 'utf8');
    const response = await fetch(`${baseUrl}/works/book-care`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: '작품 정보 파일을 읽지 못했습니다.' });
  }

  await unlink(copiedWorks);
  const missing = await fetch(`${baseUrl}/works/book-care`);
  assert.equal(missing.status, 500);
  assert.deepEqual(await missing.json(), { error: '작품 정보 파일을 읽지 못했습니다.' });
});

test('잘못된 종류·메서드·없는 리소스를 명시적인 상태 코드로 거절합니다.', async (context) => {
  const baseUrl = await startServer(context);

  for (const query of ['', '?kind=', '?kind=unknown', '?kind=book&kind=novel']) {
    const response = await fetch(`${baseUrl}/sdui/home${query}`);
    assert.equal(response.status, 400);
  }

  for (const path of ['/missing', '/assets/missing.png', '/fixtures/home.json']) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404);
  }

  const response = await fetch(`${baseUrl}/sdui/home?kind=all`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('인코딩한 상위 경로와 Windows 구분자로 자산 외부 파일을 읽을 수 없습니다.', async (context) => {
  const baseUrl = await startServer(context);

  for (const path of [
    '/assets/../fixtures/home.json',
    '/assets/%2e%2e/fixtures/home.json',
    '/assets/%2e%2e%2ffixtures%2fhome.json',
    '/assets/%2e%2e%5cfixtures%5chome.json',
    '/assets/%00.png',
  ]) {
    const response = await requestRawPath(baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(JSON.parse(response.body), { error: '요청한 리소스가 없습니다.' });
  }

  assert.equal((await requestRawPath(baseUrl, '/assets/%XX')).status, 400);
});

test('서버 재시작 없이 제목·순서·항목 수 변경과 빈 화면을 반영합니다.', async (context) => {
  const copiedFixture = await copyFixture(context);
  const baseUrl = await startServer(context, { fixturePath: copiedFixture });
  const initial = await (await fetch(`${baseUrl}/sdui/home?kind=all`)).json();
  assert.deepEqual(initial, fixtures.all);

  const modified = structuredClone(fixtures);
  modified.all.sections.reverse();
  const shelf = modified.all.sections.find((section) => section.id === 'recommended-works');
  shelf.title = '서버에서 변경한 작품 목록';
  const sampleItem = shelf.items[0];
  shelf.items = Array.from({ length: 9 }, (_, index) => ({ ...sampleItem, id: `changed-${index}` }));
  await writeFile(copiedFixture, JSON.stringify(modified), 'utf8');

  const changed = await (await fetch(`${baseUrl}/sdui/home?kind=all`)).json();
  assert.deepEqual(changed, modified.all);
  assert.equal(changed.sections.find((section) => section.id === 'recommended-works').items.length, 9);

  modified.all.sections = [];
  await writeFile(copiedFixture, JSON.stringify(modified), 'utf8');
  assert.deepEqual(await (await fetch(`${baseUrl}/sdui/home?kind=all`)).json(), { version: 1, sections: [] });
});

test('JSON 오류와 파일 부재를 성공 응답으로 숨기거나 서버 경로를 노출하지 않습니다.', async (context) => {
  const copiedFixture = await copyFixture(context);
  const baseUrl = await startServer(context, { fixturePath: copiedFixture });
  await writeFile(copiedFixture, '{invalid', 'utf8');
  const malformed = await fetch(`${baseUrl}/sdui/home?kind=all`);
  assert.equal(malformed.status, 500);
  assert.deepEqual(await malformed.json(), { error: '화면 응답 파일을 읽지 못했습니다.' });

  await unlink(copiedFixture);
  const missing = await fetch(`${baseUrl}/sdui/home?kind=all`);
  assert.equal(missing.status, 500);
  assert.deepEqual(await missing.json(), { error: '화면 응답 파일을 읽지 못했습니다.' });
});

// #endregion
