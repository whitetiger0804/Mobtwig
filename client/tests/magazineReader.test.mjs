import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentMagazinePage, magazineArticle, magazinePageUrl, parseMagazineIssue, startMagazinePage } from '../src/magazineReader.ts';

const issue = {
  workId: 'issue-one', title: '검증 호', pageCount: 12,
  articles: [
    { chapterId: '9007199254740993', title: '첫 기사', startPage: 1, endPage: 4, contentVersion: 1 },
    { chapterId: '2', title: '둘째 기사', startPage: 5, endPage: 8, contentVersion: 3 },
    { chapterId: '4', title: '넷째 기사', startPage: 11, endPage: 12, contentVersion: 2 },
  ],
};

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
