import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createMockServer } from '../../server/mock/index.mjs';
import { fetchChapterText, parseChapterText } from '../src/chapterText.ts';

async function start(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
const contents = [{ id: '91', title: '첫 장', number: 2 }, { id: '12', title: '둘째 장', number: 8 }];
const example = () => ({ workId: 'test', workTitle: '작품', kind: 'novel', chapter: contents[0], contents,
  currentIndex: 0, previous: null, next: contents[1], body: '  가🌱\n\n끝\n', characterCount: '  가🌱\n\n끝\n'.length, contentVersion: 3, contentHash: 'a'.repeat(64) });

test('본문의 공백·개행·UTF-16 길이와 DB 정수 버전을 그대로 수용합니다.', () => {
  const value = example(); assert.equal(parseChapterText(value), value);
  assert.ok(value.body.length > [...value.body].length);
  const single = { ...value, contents: [contents[0]], next: null, body: '', characterCount: 0 };
  assert.deepEqual(parseChapterText(single), single);
});

test('불일치한 장·목차·이웃·문자 수·버전을 본문으로 대신 표시하지 않습니다.', () => {
  for (const change of [
    v => { v.chapter = { ...v.chapter, id: 'wrong' }; },
    v => { delete v.previous; }, v => { v.previous = contents[1]; },
    v => { v.next = null; }, v => { v.contents.push(v.contents[0]); },
    v => { v.currentIndex = 1; }, v => { v.contents[1].number = 1; },
    v => { v.characterCount--; }, v => { v.body += '\r'; v.characterCount++; },
    v => { v.contentVersion = 'hash'; }, v => { v.contentVersion = 0; },
    v => { v.contentHash = 'invalid'; }, v => { v.contents = []; },
  ]) { const value = structuredClone(example()); change(value); assert.throws(() => parseChapterText(value)); }
});

test('간이 서버의 세 분류 전체 회차와 첫·끝 경계를 실제 fetch로 검사합니다.', async t => {
  const url = await start(t, await createMockServer());
  const works = JSON.parse(await readFile(new URL('../../server/mock/fixtures/works.json', import.meta.url), 'utf8'));
  for (const work of works) for (const [index, chapter] of work.contents.entries()) {
    const value = await fetchChapterText(url, work.id, chapter.id, new AbortController().signal);
    assert.equal(value.chapter.id, chapter.id); assert.equal(value.currentIndex, index);
    assert.equal(value.previous?.id ?? null, work.contents[index - 1]?.id ?? null);
    assert.equal(value.next?.id ?? null, work.contents[index + 1]?.id ?? null);
    assert.equal(value.characterCount, value.body.length);
  }
});

test('HTTP 오류 본문이 HTML이어도 JSON으로 해석하지 않고 잘못된 작품 응답을 거부합니다.', async t => {
  for (const status of [404, 415, 503, 500]) {
    const url = await start(t, createServer((_, response) => { response.writeHead(status); response.end('<h1>private path</h1>'); }));
    await assert.rejects(fetchChapterText(url, 'test', '91', new AbortController().signal), e => !e.message.includes('private path'));
  }
  const url = await start(t, createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(example())); }));
  await assert.rejects(fetchChapterText(url, 'other', '91', new AbortController().signal), /일치하지/);
  await assert.rejects(fetchChapterText(url, 'test', '12', new AbortController().signal), /일치하지/);
});

test('회차 이동·이탈 시 지연 중 요청을 취소할 수 있고 재시도는 새 요청입니다.', async t => {
  let calls = 0; let entered;
  const requested = new Promise(resolve => { entered = resolve; });
  const url = await start(t, createServer((_, response) => {
    calls++; if (calls === 1) { entered(); return; }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(example()));
  }));
  const controller = new AbortController();
  const pending = fetchChapterText(url, 'test', '91', controller.signal);
  await requested; controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await fetchChapterText(url, 'test', '91', new AbortController().signal)).body, example().body);
  assert.equal(calls, 2);
});
