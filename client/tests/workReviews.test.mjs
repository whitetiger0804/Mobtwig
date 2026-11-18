import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkReview, normalizeReviewBody, readWorkReviews } from '../src/workReviews.ts';

const base = 'https://reviews.example.test';
const timestamp = '2026-11-18T06:00:00Z';
const item = { id: '9007199254740993', nickname: '독자', rating: 4, body: null, createdAt: timestamp };
const empty = { averageRating: null, reviewCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, items: [], hasNext: false };
const one = { ...empty, averageRating: 4, reviewCount: 1,
  ratingDistribution: { ...empty.ratingDistribution, 4: 1 }, items: [item] };

test('공개 리뷰는 페이지와 크기를 전송하고 쿠키를 보내지 않습니다.', async context => {
  const { signal } = new AbortController();
  const payload = { ...one, items: [{ ...item, email: 'discard@example.test' }] };
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, base + '/works/book-example/reviews?page=1&size=20');
    assert.deepEqual(options, { signal, credentials: 'omit' });
    return Response.json(payload);
  });
  assert.deepEqual(await readWorkReviews(base, 'book-example', 1, 20, signal), one);
});

test('빈 리뷰와 실패·잘못된 집계·중복 행을 구분합니다.', async context => {
  let response = Response.json(empty);
  context.mock.method(globalThis, 'fetch', async () => response);
  const read = () => readWorkReviews(base, 'book-example', 1, 20, new AbortController().signal);
  assert.deepEqual(await read(), empty);
  for (const invalid of [
    { ...one, averageRating: null }, { ...one, ratingDistribution: empty.ratingDistribution }, { ...one, hasNext: true },
    { ...one, reviewCount: 2, ratingDistribution: { ...one.ratingDistribution, 4: 2 }, items: [item, item] },
  ]) {
    response = Response.json(invalid);
    await assert.rejects(read(), /형식/);
  }
  response = Response.json({}, { status: 404 });
  await assert.rejects(read(), /공개된 작품/);
});

test('회원 세션에 정리된 본문과 필수 별점을 전달하고 별점만 등록할 수 있습니다.', async () => {
  const { signal } = new AbortController();
  assert.equal(normalizeReviewBody('\u00a0　한 줄\n둘째 줄\u0085\uFEFF'), '한 줄\n둘째 줄');
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/works/book-example/reviews');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.signal, signal);
    const input = JSON.parse(init.body);
    assert.deepEqual(Object.keys(input), ['rating', 'body']);
    return { ...item, ...input };
  } };
  assert.deepEqual(await createWorkReview(client, 'book-example', 4, '　\u00a0 ', signal), item);
  const text = '😀'.repeat(1000);
  assert.equal((await createWorkReview(client, 'book-example', 4, '  ' + text + '　', signal)).body, text);
  await assert.rejects(createWorkReview(client, 'book-example', 4, text + '😀', signal), /확인/);
  await assert.rejects(createWorkReview(client, 'book-example', 0, '', signal), /확인/);
  await assert.rejects(createWorkReview({ request: async () => item }, 'book-example', 5, '', signal), /형식/);
});
