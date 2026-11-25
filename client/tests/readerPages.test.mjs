import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPageTouch, pageCount, pageOf, pageStep, pageTop, turnPage } from '../src/readerPages.ts';

test('쪽 간격은 뷰포트에서 한 줄을 겹치고 겹침은 뷰포트 절반을 넘지 않습니다.', () => {
  assert.equal(pageStep(600, 30), 570);
  assert.equal(pageStep(100, 31.45), 68.55);
  assert.equal(pageStep(100, 80), 50, '줄 높이가 커도 절반만 겹칩니다.');
  assert.equal(pageStep(100, -5), 100);
  assert.equal(pageStep(0, 30), 1, '레이아웃 전에도 0 이하 간격으로 무한 반복하지 않습니다.');
});

test('본문이 뷰포트보다 짧으면 한 쪽이고 나머지는 마지막 쪽으로 계산합니다.', () => {
  assert.equal(pageCount(80, 100, 70), 1);
  assert.equal(pageCount(100, 100, 70), 1);
  assert.equal(pageCount(240, 100, 70), 3, '본문 끝이 쪽 간격과 정확히 맞습니다.');
  assert.equal(pageCount(241, 100, 70), 4, '남은 1px도 한 쪽입니다.');
});

test('쪽 시작은 범위를 벗어나지 않고 마지막 쪽은 본문 끝에 맞춥니다.', () => {
  assert.deepEqual([0, 1, 2, 3].map(index => pageTop(index, 260, 100, 70)), [0, 70, 140, 160]);
  assert.equal(pageTop(-1, 260, 100, 70), 0);
  assert.equal(pageTop(99, 260, 100, 70), 160);
  assert.equal(pageTop(1, 80, 100, 70), 0, '한 쪽짜리 본문은 항상 처음입니다.');
});

test('y 위치의 쪽은 경계 허용 오차 4px로 계산하고 범위 밖은 첫 쪽과 마지막 쪽으로 맞춥니다.', () => {
  const at = y => pageOf(y, 1000, 100, 70);
  assert.equal(pageCount(1000, 100, 70), 14);
  assert.equal(at(0), 0);
  assert.equal(at(65), 0);
  assert.equal(at(66), 1, '쪽 시작 4px 앞은 다음 쪽입니다.');
  assert.equal(at(70), 1);
  assert.equal(at(135), 1);
  assert.equal(at(136), 2);
  assert.equal(at(895), 12);
  assert.equal(at(896), 13, '본문 끝 4px 앞부터 마지막 쪽입니다.');
  assert.equal(at(900), 13);
  assert.equal(at(-50), 0);
  assert.equal(at(5000), 13);
  assert.equal(pageOf(50, 80, 100, 70), 0);
  for (let index = 0; index < 14; index++) assert.equal(at(pageTop(index, 1000, 100, 70)), index, '쪽 시작은 같은 쪽입니다.');
});

test('첫 쪽 이전과 마지막 쪽 다음은 쪽을 유지하고 닿은 경계를 알립니다.', () => {
  assert.deepEqual(turnPage(0, -1, 5), { index: 0, edge: 'start' });
  assert.deepEqual(turnPage(0, 1, 5), { index: 1, edge: null });
  assert.deepEqual(turnPage(2, -1, 5), { index: 1, edge: null });
  assert.deepEqual(turnPage(4, 1, 5), { index: 4, edge: 'end' });
  assert.deepEqual(turnPage(0, 1, 1), { index: 0, edge: 'end' });
  assert.deepEqual(turnPage(9, -1, 5), { index: 3, edge: null }, '범위 밖 현재 쪽은 먼저 맞춥니다.');
});

test('가로 48px 이상이고 세로보다 긴 이동은 시간과 무관하게 스와이프입니다.', () => {
  const swipe = (dx, dy, duration = 100) => classifyPageTouch({ x: 200, y: 300 }, { x: 200 + dx, y: 300 + dy }, 400, duration);
  assert.equal(swipe(-48, 0), 1);
  assert.equal(swipe(48, 0), -1);
  assert.equal(swipe(-47, 0), null);
  assert.equal(swipe(-60, 60), null, '대각선은 넘기지 않습니다.');
  assert.equal(swipe(-60, 59), 1);
  assert.equal(swipe(0, -120), null);
  assert.equal(swipe(-80, 0, 5_000), 1);
  assert.equal(classifyPageTouch({ x: 395, y: 300 }, { x: 300, y: 300 }, 400, 100), 1, '가장자리에서 시작해도 스와이프입니다.');
});

test('10px 미만·300ms 미만 탭만 좌우 22% 영역에서 쪽을 넘깁니다.', () => {
  const tap = (x, { dx = 0, dy = 0, duration = 100, width = 400 } = {}) =>
    classifyPageTouch({ x, y: 300 }, { x: x + dx, y: 300 + dy }, width, duration);
  assert.equal(tap(10), -1);
  assert.equal(tap(87.9), -1);
  assert.equal(tap(88), null, '왼쪽 22% 경계는 가운데입니다.');
  assert.equal(tap(200), null);
  assert.equal(tap(312), null, '오른쪽 22% 경계는 가운데입니다.');
  assert.equal(tap(312.1), 1);
  assert.equal(tap(390), 1);
  assert.equal(tap(390, { dx: 9 }), 1);
  assert.equal(tap(390, { dx: 6, dy: 8 }), null, '10px 이동은 탭이 아닙니다.');
  assert.equal(tap(390, { duration: 299 }), 1);
  assert.equal(tap(390, { duration: 300 }), null, '롱프레스는 하이라이트에 맡깁니다.');
  assert.equal(tap(10, { width: 0 }), null, '폭을 모르면 탭을 판정하지 않습니다.');
});
