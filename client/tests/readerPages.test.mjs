import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPageTops, classifyPageTouch, pageOf, pageTop, turnPage } from '../src/readerPages.ts';

/** 같은 높이 줄을 top부터 count개 만듭니다. */
const run = (top, count, height) => Array.from({ length: count }, (_, index) => ({ top: top + index * height, height }));

/** 모든 줄이 정확히 한 쪽에서 완전히 보이고 쪽 시작이 줄 중간이 아닌지 검사합니다. */
function assertLineAligned(lines, viewport, tops, message) {
  assert.equal(tops[0], 0, message);
  for (let index = 1; index < tops.length; index++) {
    assert.ok(tops[index] > tops[index - 1], message);
    assert.ok(lines.some(line => line.top === tops[index]), `${message}: ${tops[index]}은 줄 시작입니다.`);
    assert.ok(!lines.some(line => line.top < tops[index] && tops[index] < line.top + line.height), `${message}: 줄 중간에서 시작하지 않습니다.`);
  }
  for (const line of lines) {
    const pages = tops.filter(top => top <= line.top && line.top + line.height <= top + viewport + 0.5);
    assert.equal(pages.length, 1, `${message}: ${line.top} 줄은 한 쪽에서만 온전히 보입니다.`);
  }
}

test('줄이 뷰포트에 정확히 맞으면 다음 쪽은 바로 다음 줄에서 시작합니다.', () => {
  assert.deepEqual(buildPageTops(run(0, 10, 25), 100), [0, 100, 200]);
  assert.deepEqual(buildPageTops(run(0, 4, 25), 100), [0], '한 쪽에 모두 들어갑니다.');
  assert.deepEqual(buildPageTops([], 100), [0]);
  assert.deepEqual(buildPageTops(run(0, 10, 25), 0), [0], '레이아웃 전에는 한 쪽입니다.');
});

test('뷰포트에 걸친 줄은 다음 쪽의 첫 줄이 됩니다.', () => {
  const lines = run(0, 10, 30);
  assert.deepEqual(buildPageTops(lines, 100), [0, 90, 180, 270]);
  assertLineAligned(lines, 100, buildPageTops(lines, 100), '30px 줄');
});

test('문단 사이 간격은 줄이 아니므로 쪽 시작은 다음 문단의 첫 줄입니다.', () => {
  const lines = [...run(0, 3, 30), ...run(110, 3, 30)];
  assert.deepEqual(buildPageTops(lines, 100), [0, 110]);
  assert.deepEqual(buildPageTops([...run(0, 2, 30), ...run(95, 3, 30)], 100), [0, 95], '간격 뒤 걸친 줄도 줄 시작입니다.');
});

test('제목 블록은 쪼개지 않고 넘치면 블록 시작에서 다음 쪽을 시작합니다.', () => {
  const lines = [...run(0, 2, 30), { top: 60, height: 62 }, ...run(122, 3, 30)];
  assert.deepEqual(buildPageTops(lines, 100), [0, 60, 152]);
  assertLineAligned(lines, 100, buildPageTops(lines, 100), '제목 블록');
});

test('뷰포트보다 큰 블록은 뷰포트만큼 전진하여 무한 반복하지 않습니다.', () => {
  assert.deepEqual(buildPageTops([{ top: 0, height: 250 }, ...run(250, 2, 30)], 100), [0, 100, 200, 280]);
  assert.deepEqual(buildPageTops([...run(0, 2, 30), { top: 60, height: 150 }, { top: 210, height: 30 }], 100), [0, 60, 160]);
});

test('마지막 쪽도 본문 끝이 아니라 줄 시작에 맞춥니다.', () => {
  // 실기기 2쪽 회차: 9줄 + 본문 끝. 예전 계산은 마지막 쪽을 높이−뷰포트(170)로 맞춰 줄 중간에서 시작했습니다.
  const lines = run(0, 9, 30);
  const tops = buildPageTops(lines, 100);
  assert.deepEqual(tops, [0, 90, 180]);
  assert.ok(!tops.includes(170));
});

test('소수 줄 높이가 누적되어도 0.5px 안의 오차는 같은 쪽에 넣습니다.', () => {
  const lines = run(0, 20, 31.45);
  const tops = buildPageTops(lines, 94.35);
  assert.equal(tops[1], lines[3].top);
  assertLineAligned(lines, 94.35, tops, '31.45px 줄');
});

test('빈 줄은 쪽 경계 판정에서 빠져 쪽이 빈 줄로 시작하지 않습니다.', () => {
  const lines = [...run(0, 2, 30), { top: 60, height: 30, blank: true }, ...run(90, 3, 30)];
  assert.deepEqual(buildPageTops(lines, 80), [0, 90, 150]);
  assert.deepEqual(buildPageTops(lines.map(({ blank, ...line }) => line), 80), [0, 60, 120], '빈 줄을 빼지 않으면 60의 빈 줄에서 시작합니다.');
});

test('임의의 문단·간격·제목에서도 모든 줄은 정확히 한 쪽에서 온전히 보이고 쪽은 줄 중간에서 시작하지 않습니다.', () => {
  let seed = 36;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  for (let round = 0; round < 300; round++) {
    const viewport = 80 + Math.floor(random() * 600);
    const lineHeight = 18 + random() * 30;
    const lines = [{ top: 0, height: 40 + random() * 80 }];
    let y = lines[0].height;
    for (let paragraph = 0, count = 1 + Math.floor(random() * 30); paragraph < count; paragraph++) {
      y += Math.floor(random() * 3) * lineHeight * random();
      const block = run(y, 1 + Math.floor(random() * 12), lineHeight);
      // 문단 끝의 \n\n처럼 마지막 줄을 가끔 빈 줄로 둡니다.
      if (block.length > 1 && random() < 0.5) block.at(-1).blank = true;
      lines.push(...block);
      y = block.at(-1).top + lineHeight;
    }
    if (lines.some(line => line.height > viewport)) continue;
    const tops = buildPageTops([...lines].reverse(), viewport);
    assertLineAligned(lines.filter(line => !line.blank), viewport, tops, `round ${round}`);
    assert.ok(!lines.some(line => line.blank && tops.includes(line.top)), `round ${round}: 빈 줄에서 시작하지 않습니다.`);
  }
});

test('쪽 시작은 범위를 벗어나지 않고 y 위치의 쪽은 쪽 시작 4px 앞부터 계산합니다.', () => {
  const tops = [0, 90, 180, 270];
  assert.deepEqual([0, 1, 2, 3].map(index => pageTop(index, tops)), tops);
  assert.equal(pageTop(-1, tops), 0);
  assert.equal(pageTop(99, tops), 270);
  assert.equal(pageTop(0, []), 0);
  assert.equal(pageOf(0, tops), 0);
  assert.equal(pageOf(85, tops), 0);
  assert.equal(pageOf(86, tops), 1, '쪽 시작 4px 앞은 다음 쪽입니다.');
  assert.equal(pageOf(179, tops), 2);
  assert.equal(pageOf(-50, tops), 0);
  assert.equal(pageOf(5_000, tops), 3);
  assert.equal(pageOf(50, [0]), 0);
  for (let index = 0; index < tops.length; index++) assert.equal(pageOf(pageTop(index, tops), tops), index, '쪽 시작은 같은 쪽입니다.');
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
