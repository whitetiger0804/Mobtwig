import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeWorkLinks, parseWorkLink } from '../src/workLinks.ts';
import { defaultShareBaseUrl } from '../src/workSharing.ts';

test('custom scheme과 지정 origin의 정확한 작품 경로만 허용합니다.', () => {
  assert.equal(parseWorkLink('mobtwig://works/book-care'), 'book-care');
  assert.equal(parseWorkLink(defaultShareBaseUrl + '/s/works/book-care'), 'book-care');
  assert.equal(parseWorkLink('http://localhost:8090/s/works/book-care', 'http://localhost:8090'), 'book-care');
  for (const value of [
    'mobtwig://works/book-care?excerpt=secret', 'mobtwig://works/book-care#x',
    'mobtwig://works/%62ook-care', 'mobtwig://works/a/../book-care',
    'mobtwig://works/Book-Care', 'mobtwig://evil/book-care', 'mobtwig:///works/book-care',
    defaultShareBaseUrl + '.evil.test/s/works/book-care',
    defaultShareBaseUrl + '/s/works/../book-care', defaultShareBaseUrl + '/s/works/book-care/',
    'https://evil.test/s/works/book-care', 'https://a@mobtwig.xn--3h3b098b.kro.kr/s/works/book-care',
  ]) assert.equal(parseWorkLink(value), null, value);
});

function source() {
  let listener, resolveInitial;
  let removed = false;
  return {
    getInitialURL: () => new Promise(resolve => { resolveInitial = resolve; }),
    addEventListener: (type, callback) => { assert.equal(type, 'url'); listener = callback; return { remove: () => { removed = true; } }; },
    initial: url => resolveInitial(url),
    receive: url => listener({ url }),
    removed: () => removed,
  };
}

test('런타임 링크는 지연된 최초 URL보다 우선하며 해제 후에는 처리하지 않습니다.', async () => {
  const launched = source(), values = [];
  const stop = observeWorkLinks(launched, target => values.push(target));
  launched.receive('mobtwig://works/second');
  launched.initial('mobtwig://works/first');
  await Promise.resolve();
  assert.deepEqual(values, [{ workId: 'second', sequence: 1 }]);
  launched.receive('mobtwig://works/third');
  assert.deepEqual(values[1], { workId: 'third', sequence: 2 });
  stop();
  assert.ok(launched.removed());
  launched.receive('mobtwig://works/fourth');
  assert.equal(values.length, 2);
});

test('종료 상태의 작품 링크와 잘못된 링크를 구분하고 개발 런처는 일반 시작으로 처리합니다.', async () => {
  for (const [url, expected] of [
    ['mobtwig://works/book-care', { workId: 'book-care', sequence: 1 }],
    ['mobtwig://works/invalid?', { workId: null, sequence: 1 }],
    [defaultShareBaseUrl + '/s/works/book-care', { workId: 'book-care', sequence: 1 }],
    [defaultShareBaseUrl + '/s/invalid', { workId: null, sequence: 1 }],
    ['exp://127.0.0.1:8081', null],
    ['exp+mobtwig://?__expo_url=http%3A%2F%2F127.0.0.1%3A8081', null],
  ]) {
    const cold = source(), results = [];
    const dispose = observeWorkLinks(cold, target => results.push(target));
    cold.initial(url);
    await Promise.resolve();
    assert.deepEqual(results, [expected]);
    dispose();
  }
});

test('비공유 URL 이벤트는 초기 작품 링크와 실행 중 작품을 덮지 않고 순서도 올리지 않습니다.', async () => {
  const launched = source(), values = [];
  const stop = observeWorkLinks(launched, target => values.push(target));
  const otherUrls = ['exp://127.0.0.1:8081',
    'exp+mobtwig://?__expo_url=http%3A%2F%2F127.0.0.1%3A8081',
    'https://example.test/s/works/other', defaultShareBaseUrl + '/works/other'];
  for (const url of otherUrls) launched.receive(url);
  assert.deepEqual(values, []);
  launched.initial(defaultShareBaseUrl + '/s/works/first');
  await Promise.resolve();
  assert.deepEqual(values, [{ workId: 'first', sequence: 1 }]);
  for (const url of otherUrls) launched.receive(url);
  assert.deepEqual(values, [{ workId: 'first', sequence: 1 }]);
  launched.receive('mobtwig://works/second');
  assert.deepEqual(values[1], { workId: 'second', sequence: 2 });
  stop();
});

test('실행 중 잘못된 앱 주소와 공유 경로는 계속 링크 오류로 전달합니다.', async () => {
  const launched = source(), values = [];
  const stop = observeWorkLinks(launched, target => values.push(target));
  launched.initial(null);
  await Promise.resolve();
  launched.receive('mobtwig://works/invalid?');
  launched.receive(defaultShareBaseUrl + '/s/invalid');
  assert.deepEqual(values, [null, { workId: null, sequence: 1 }, { workId: null, sequence: 2 }]);
  stop();
});
