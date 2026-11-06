import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectChapter } from '../src/readerNavigation.ts';

test('공개 회차가 비연속 ID여도 서버 목차 순서로 앞뒤 회차를 찾습니다.', () => {
  const chapters = [{ id: '910', title: '공개 첫 장' }, { id: '12', title: '공개 둘째 장' }, { id: '73', title: '공개 마지막 장' }];
  const middle = selectChapter(chapters, '12');
  assert.equal(middle.current, chapters[1]);
  assert.equal(middle.previous, chapters[0]);
  assert.equal(middle.next, chapters[2]);
  assert.equal(middle.index, 1);
  assert.equal(middle.total, 3);
  assert.equal(selectChapter(chapters).previous, null);
  assert.equal(selectChapter(chapters, '73').next, null);
  assert.equal(selectChapter(chapters, '910').next.id, '12');
});

test('빈 목차·단일 회차·사라진 회차를 구분하고 다른 본문을 대신 열지 않습니다.', () => {
  assert.equal(selectChapter([]), null);
  const single = selectChapter([{ id: 'one', title: '유일한 장' }]);
  assert.equal(single.previous, null);
  assert.equal(single.next, null);
  assert.equal(single.total, 1);
  assert.throws(() => selectChapter([], 'removed'), /공개 목차/);
  assert.throws(() => selectChapter([{ id: 'one', title: '첫째' }], 'removed'), /공개 목차/);
});
