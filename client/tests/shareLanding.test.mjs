import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { landingWorkId, publicWork } from '../../server/src/main/resources/static/share/work.js';

const work = { id: 'book-care', title: '<img src=x onerror=alert(1)>', author: '<script>test</script>',
  kind: 'book', imageUrl: '/media/covers/cover.png' };
const origin = 'https://example.test';

test('웹 안내는 정확한 slug와 안전한 표지 주소만 사용합니다.', () => {
  assert.equal(landingWorkId('/s/works/book-care'), 'book-care');
  for (const path of ['/s/works/%61', '/s/works/../book-care', '/s/works/book-care/', '/s/works/A']) {
    assert.equal(landingWorkId(path), null);
  }
  assert.equal(publicWork(work, work.id, origin).imageUrl, origin + work.imageUrl);
  assert.equal(publicWork({ ...work, imageUrl: '/media/고요를 연습하는 시간.png' }, work.id, origin).imageUrl,
    origin + '/media/%EA%B3%A0%EC%9A%94%EB%A5%BC%20%EC%97%B0%EC%8A%B5%ED%95%98%EB%8A%94%20%EC%8B%9C%EA%B0%84.png');
  for (const imageUrl of ['javascript:alert(1)', '//evil.test/x', 'data:image/svg+xml,test',
    'https://name:pass@example.test/x', '/\n/path', '/\\evil.test/x']) {
    assert.throws(() => publicWork({ ...work, imageUrl }, work.id, origin));
  }
  assert.throws(() => publicWork({ ...work, id: 'another' }, work.id, origin));
});

test('웹 안내는 콘텐츠를 DOM 텍스트로 넣고 한 번만 조회하며 앱에 같은 slug를 전달합니다.', async () => {
  const code = (await readFile(new URL('../../server/src/main/resources/static/share/app.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/, '');
  const elements = new Map();
  const callbacks = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: true, addEventListener: (event, action) => callbacks.set(id + event, action) });
    return elements.get(id);
  };
  let calls = 0;
  const document = { getElementById: element, title: '' };
  runInNewContext(code, {
    document, landingWorkId, publicWork,
    location: { pathname: '/s/works/book-care', origin, search: '?title=<script>bad</script>' },
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, '/works/book-care');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      return Response.json(work);
    },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  assert.equal(element('work-title').textContent, work.title);
  assert.equal(element('author').textContent, work.author);
  assert.equal(element('work-title').innerHTML, undefined);
  assert.equal(element('open-app').href, 'mobtwig://works/book-care');
  assert.equal(element('open-app').hidden, false);
  assert.equal(element('address').textContent, origin + '/s/works/book-care');
  assert.equal(element('retry').hidden, true);
});

test('없는 작품과 통신 오류를 구분하고 재시도 클릭마다 한 번 요청합니다.', async () => {
  const code = (await readFile(new URL('../../server/src/main/resources/static/share/app.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/, '');
  for (const status of [404, 503]) {
    const elements = new Map();
    const callbacks = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { hidden: true, addEventListener: (event, action) => callbacks.set(id + event, action) });
      return elements.get(id);
    };
    let calls = 0;
    runInNewContext(code, {
      document: { getElementById: element }, landingWorkId, publicWork,
      location: { pathname: '/s/works/book-care', origin },
      fetch: async () => { calls++; return new Response(null, { status }); },
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 1);
    assert.equal(element('open-app').hidden, true);
    assert.equal(element('retry').hidden, status === 404);
    assert.match(element('status').textContent, status === 404 ? /공개된 작품이 없습니다/ : /불러오지 못했습니다/);
    if (status === 503) {
      await callbacks.get('retryclick')();
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(calls, 2);
    }
  }
});
