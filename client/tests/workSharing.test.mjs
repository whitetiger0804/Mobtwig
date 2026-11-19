import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultShareBaseUrl, shareOrigin, workShare } from '../src/workSharing.ts';

test('같은 작품은 항상 공개 링크를 공유하고 문장은 공유 본문에만 넣습니다.', () => {
  const share = workShare('novel-record', '괴이청', '문장?이름=내용#내용');
  assert.equal(share.url, defaultShareBaseUrl + '/s/works/novel-record');
  assert.equal(share.message, '문장?이름=내용#내용\n\n괴이청\n\n' + share.url);
  assert.equal(workShare('novel-record', '괴이청', undefined).url, share.url);
  assert.equal(workShare('novel-record', undefined, undefined, 'http://127.0.0.1:8090').url,
    'http://127.0.0.1:8090/s/works/novel-record');
});

test('공유 origin과 slug의 비정상 입력을 거절합니다.', () => {
  for (const origin of ['https://example.test/path', 'https://a:b@example.test', 'javascript:alert(1)',
    'https://example.test?token=x', 'https://example.test/#x', 'https://example.test\\evil']) {
    assert.throws(() => shareOrigin(origin));
  }
  for (const id of ['', '../admin', 'a/b', 'a?b', '%61', 'a'.repeat(121)]) {
    assert.throws(() => workShare(id));
  }
});
