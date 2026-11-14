import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightPieces, isTextBoundary, parseHighlight } from '../src/highlights.ts';

const hash = 'a'.repeat(64);
const original = { id: '9007199254740993', state: 'available', workId: 'novel', workTitle: '작품', kind: 'novel',
  chapterTitle: '회차', range: { chapterId: '1', startOffset: 5, endOffset: 7, unit: 'utf16', contentVersion: 1, contentHash: hash },
  color: 'YELLOW', snippet: '반복', createdAt: '2026-11-14T01:00:00Z' };

test('두 번째 반복 문장만 표시하고 원문과 줄바꿈을 보존합니다.', () => {
  const text = '반복 😀반복\n\n';
  assert.equal(isTextBoundary(text, 4), false);
  const pieces = highlightPieces(text, 0, [parseHighlight(original)]);
  assert.equal(pieces.map(piece => piece.text).join(''), text);
  assert.deepEqual(pieces.filter(piece => piece.color), [{ text: '반복', color: 'YELLOW' }]);
  assert.equal(pieces[0].text, '반복 😀');
  assert.deepEqual(highlightPieces('반복\n', 5, [parseHighlight(original)])[0], { text: '반복', color: 'YELLOW' });
});

test('쪽 한 장과 해시가 없는 이전 텍스트 기록을 구분합니다.', () => {
  assert.equal(parseHighlight({ ...original, state: 'hidden' }).range, null);
  assert.equal(parseHighlight({ ...original, state: 'stale', snippet: null, range: { ...original.range, contentHash: null } }).state, 'stale');
  assert.equal(parseHighlight({ ...original, kind: 'magazine', snippet: null,
    range: { ...original.range, startOffset: 6, endOffset: 6, unit: 'page', contentHash: null } }).range.startOffset, 6);
  assert.throws(() => parseHighlight({ ...original, range: { ...original.range, endOffset: 5 } }), /응답/);
});
