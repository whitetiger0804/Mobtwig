import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createMemberSessionClient, MemberRequestError } from '../src/memberSession.ts';
import {
  createWorkReview, deleteWorkReview, normalizeReviewBody, readMemberWorkReviews, readWorkReviews, updateWorkReview,
  createReviewComment, deleteReviewComment, readMemberReviewComments, readReviewComments, updateReviewComment,
  reportReview, reportReviewComment, setReviewCommentLike, setReviewLike,
} from '../src/workReviews.ts';

const base = 'https://reviews.example.test';
const timestamp = '2026-11-18T06:00:00Z';
const signal = new AbortController().signal;
const item = { id: '9007199254740993', nickname: '독자', rating: 4, body: null, createdAt: timestamp,
  commentCount: 0, likeCount: 2, mine: false, liked: false, reported: false, deleted: false };
const own = { ...item, mine: true };
const deleted = { ...item, id: '10', rating: null, body: null, nickname: null, commentCount: 1, deleted: true };
const comment = { id: '31', body: '첫 댓글', nickname: '댓글 독자', createdAt: timestamp,
  likeCount: 0, mine: false, liked: false, reported: false };
const empty = { averageRating: null, reviewCount: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  items: [], hasNext: false, myReview: null };
const one = { ...empty, averageRating: 4, reviewCount: 1,
  ratingDistribution: { ...empty.ratingDistribution, 4: 1 }, items: [item]};
const thread = { review: { ...item, commentCount: 1 }, items: [comment] };
const identity = { id: '2', email: 'member@example.test', nickname: '회원', createdAt: timestamp };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('공개 리뷰는 페이지와 크기를 전송하고 쿠키를 보내지 않습니다.', async context => {
  const payload = { ...one, items: [{ ...item, email: 'discard@example.test' }], memberId: 'private' };
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, base + '/works/book-example/reviews?page=1&size=20');
    assert.deepEqual(options, { signal, credentials: 'omit' });
    return Response.json(payload);
  });
  assert.deepEqual(await readWorkReviews(base, 'book-example', 1, 20, signal), one);
});

test('회원 리뷰는 회원 경로와 취소 신호를 쓰고 페이지 밖 본인 리뷰를 보존합니다.', async () => {
  const myReview = { ...own, id: '3' };
  const payload = { ...one, reviewCount: 2, ratingDistribution: { ...one.ratingDistribution, 4: 2 },
    hasNext: true, myReview, items: [{ ...item, liked: true, reported: true }] };
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/works/book-example/reviews?page=1&size=1');
    assert.deepEqual(init, { signal });
    return payload;
  } };
  assert.deepEqual(await readMemberWorkReviews(client, 'book-example', 1, 1, signal), payload);
});

test('삭제 자리표시와 서버의 집계·다음 쪽 상태를 재계산하지 않고 받습니다.', async context => {
  let response = { ...empty, items: [{ ...deleted, commentCount: 0 }] };
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  assert.deepEqual(await readWorkReviews(base, 'book-example', 1, 20, signal), response);
  response = { ...one, averageRating: 4.01, ratingDistribution: empty.ratingDistribution, hasNext: true };
  assert.deepEqual(await readWorkReviews(base, 'book-example', 1, 20, signal), response);
  response = { ...response, totalItems: '사용하지 않는 메타', ratingDistribution: { ...empty.ratingDistribution, 6: 7 } };
  assert.deepEqual(await readWorkReviews(base, 'book-example', 2, 1, signal), {
    ...one, averageRating: 4.01, ratingDistribution: empty.ratingDistribution, hasNext: true,
  });
});

test('빈 응답과 잘못된 기본 형식·삭제 원문·상태 필드·중복 행을 구분합니다.', async context => {
  let response = Response.json(empty);
  context.mock.method(globalThis, 'fetch', async () => response);
  const read = () => readWorkReviews(base, 'book-example', 1, 20, signal);
  assert.deepEqual(await read(), empty);
  const without = (value, key) => { const copy = { ...value }; delete copy[key]; return copy; };
  for (const invalid of [
    { ...one, averageRating: '4' }, { ...one, reviewCount: 1.5 }, { ...one, reviewCount: '1' },
    { ...one, ratingDistribution: { ...one.ratingDistribution, 4: -1 } },
    { ...one, items: [item, item] }, { ...empty, items: [{ ...deleted, body: '삭제 원문' }] },
    { ...empty, items: [{ ...deleted, rating: 4 }] }, { ...empty, items: [{ ...deleted, nickname: '삭제 저자' }] },
    { ...empty, items: [{ ...deleted, mine: true }] },
    { ...one, items: [{ ...item, rating: null }] }, { ...one, items: [{ ...item, nickname: null }] },
    { ...one, items: [{ ...item, nickname: '\u0085' }] }, { ...one, items: [{ ...item, body: '' }] },
    { ...one, items: [{ ...item, body: '　본문 ' }] }, { ...one, items: [{ ...item, body: '😀'.repeat(1001) }] },
    { ...one, items: [{ ...item, commentCount: -1 }] }, { ...one, items: [{ ...item, likeCount: 1.5 }] },
    { ...one, items: [{ ...item, mine: true }] }, { ...one, items: [{ ...item, liked: true }] },
    { ...one, items: [{ ...item, reported: true }] },
    { ...one, items: [{ ...item, createdAt: '2026-02-30T00:00:00Z' }] },
    { ...one, items: [{ ...item, createdAt: '2026-11-18T06:00:00+00:00' }] },
    { ...one, items: [{ ...item, createdAt: '2026-11-18T24:00:00Z' }] },
    { ...one, items: [{ ...item, createdAt: timestamp + '\n' }] },
    { ...one, myReview: own }, without(one, 'myReview'), without(one, 'averageRating'), without(one, 'hasNext'),
    { ...one, hasNext: 'true' },
    ...['commentCount', 'likeCount', 'mine', 'liked', 'reported', 'deleted'].map(key => ({ ...one, items: [without(item, key)] })),
  ]) {
    response = Response.json(invalid);
    await assert.rejects(read(), /형식/);
  }
  for (const averageRating of [NaN, Infinity, -Infinity]) {
    await assert.rejects(readMemberWorkReviews({ request: async () => ({ ...one, averageRating }) }, 'book-example', 1, 20, signal), /형식/);
  }
});

test('회원 목록은 본인 리뷰 연결을 확인하고 집계나 같은 리뷰의 본문 차이는 허용합니다.', async () => {
  let payload = { ...empty, items: [own], myReview: { ...own, body: '별도로 반환한 본문' } };
  const read = () => readMemberWorkReviews({ request: async () => payload }, 'book-example', 1, 20, signal);
  assert.deepEqual(await read(), payload);
  payload = { ...one, items: [{ ...item, likeCount: 0, liked: true }] };
  assert.deepEqual(await read(), payload);
  for (const invalid of [
    { ...one, items: [own] }, { ...one, myReview: item }, { ...one, myReview: deleted },
    { ...one, items: [own], myReview: { ...own, id: '3' } },
    { ...one, items: [{ ...own, liked: true }], myReview: { ...own, liked: true } },
    { ...one, items: [{ ...own, reported: true }], myReview: { ...own, reported: true } },
  ]) {
    payload = invalid;
    await assert.rejects(read(), /형식/);
  }
});

test('리뷰 목록은 초 미만 시각과 큰 ID를 보존하면서 서버가 반환한 순서를 사용합니다.', async context => {
  const older = { ...item, createdAt: '2026-11-18T06:00:00.000000001Z' };
  const newer = { ...item, id: '9007199254740994', createdAt: '2026-11-18T06:00:00.000000002Z' };
  let payload = { ...one, items: [newer, older] };
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  assert.deepEqual((await readWorkReviews(base, 'book-example', 1, 20, signal)).items, [newer, older]);
  payload = { ...payload, items: [older, newer] };
  assert.deepEqual((await readWorkReviews(base, 'book-example', 1, 20, signal)).items, [older, newer]);
});

test('입력 slug·페이지·크기가 유효하지 않으면 공개·회원 네트워크 요청을 보내지 않습니다.', async context => {
  context.mock.method(globalThis, 'fetch', () => assert.fail('잘못된 입력을 전송했습니다.'));
  const client = { request: () => assert.fail('잘못된 회원 입력을 전송했습니다.') };
  for (const slug of ['../book', '', '가나다', 'book\n', 'a'.repeat(121), 1]) {
    await assert.rejects(readWorkReviews(base, slug, 1, 20, signal), /작품/);
    await assert.rejects(readMemberWorkReviews(client, slug, 1, 20, signal), /작품/);
    await assert.rejects(createWorkReview(client, slug, 4, '', signal), /작품/);
  }
  for (const [page, size] of [[0, 20], [-1, 20], [1.5, 20], [2147483648, 20], [NaN, 20], ['1', 20],
    [1, 0], [1, 51], [1, 1.5], [1, Infinity], [1, '20']]) {
    await assert.rejects(readWorkReviews(base, 'book-example', page, size, signal), /페이지/);
    await assert.rejects(readMemberWorkReviews(client, 'book-example', page, size, signal), /페이지/);
  }
});

test('공개 HTTP 오류와 JSON 오류·취소 오류는 성공 데이터로 대체하지 않습니다.', async context => {
  let response = Response.json({}, { status: 404 });
  context.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(readWorkReviews(base, 'book-example', 1, 20, signal), /공개된 작품/);
  await assert.rejects(readReviewComments(base, item.id, signal), /리뷰를 찾을/);
  response = Response.json({}, { status: 503 });
  await assert.rejects(readWorkReviews(base, 'book-example', 1, 20, signal), /불러오지/);
  await assert.rejects(readReviewComments(base, item.id, signal), /불러오지/);
  response = new Response('{');
  await assert.rejects(readWorkReviews(base, 'book-example', 1, 20, signal), SyntaxError);
  const aborted = new Error('취소됐습니다.'); aborted.name = 'AbortError';
  context.mock.method(globalThis, 'fetch', async () => { throw aborted; });
  await assert.rejects(readWorkReviews(base, 'book-example', 1, 20, signal), failure => failure === aborted);
});

test('회원 세션에 정리된 본문과 필수 별점을 보내고 별점만 등록할 수 있습니다.', async () => {
  assert.equal(normalizeReviewBody('\u00a0　한 줄\n둘째 줄\u0085\uFEFF'), '한 줄\n둘째 줄');
  assert.equal(normalizeReviewBody('\u200b내용\u200b'), '\u200b내용\u200b');
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/works/book-example/reviews');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.signal, signal);
    const input = JSON.parse(init.body);
    assert.deepEqual(Object.keys(input), ['rating', 'body']);
    return { ...own, ...input };
  } };
  assert.deepEqual(await createWorkReview(client, 'book-example', 4, '　\u00a0 ', signal), own);
  const text = '😀'.repeat(1000);
  assert.equal((await createWorkReview(client, 'book-example', 4, '  ' + text + '　', signal)).body, text);
  const never = { request: () => assert.fail('유효하지 않은 리뷰를 전송했습니다.') };
  await assert.rejects(createWorkReview(never, 'book-example', 4, text + '😀', signal), /확인/);
  for (const rating of [0, 6, 1.5, NaN, null, '4']) {
    await assert.rejects(createWorkReview(never, 'book-example', rating, '', signal), /확인/);
  }
  assert.deepEqual(await createWorkReview({ request: async () => ({ ...own, body: '서버에서 정리한 본문', rating: 5 }) }, 'book-example', 4, '', signal),
    { ...own, body: '서버에서 정리한 본문', rating: 5 });
  for (const invalid of [item, deleted]) {
    await assert.rejects(createWorkReview({ request: async () => invalid }, 'book-example', 4, '', signal), /형식/);
  }
});

test('리뷰 수정과 삭제는 ID 경로·메서드·본문·취소 신호를 사용합니다.', async () => {
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/reviews/' + item.id);
    assert.equal(init.signal, signal);
    assert.equal(init.method, 'PUT');
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init.body), { rating: 5, body: '수정 본문' });
    return { ...own, rating: 5, body: '수정 본문' };
  } };
  assert.equal((await updateWorkReview(client, item.id, 5, '　수정 본문\u0085', signal)).body, '수정 본문');
  const deletedClient = { request: async (path, init) => {
    assert.equal(path, '/api/members/reviews/' + item.id);
    assert.deepEqual(init, { method: 'DELETE', signal }); return null;
  } };
  assert.equal(await deleteWorkReview(deletedClient, item.id, signal), undefined);
  await assert.rejects(deleteWorkReview({ request: async () => ({}) }, item.id, signal), /형식/);
  assert.equal((await updateWorkReview({ request: async () => ({ ...own, body: '서버에서 정리한 본문' }) }, item.id, 4, '', signal)).body, '서버에서 정리한 본문');
  for (const invalid of [item, { ...own, id: '3' }]) {
    await assert.rejects(updateWorkReview({ request: async () => invalid }, item.id, 4, '', signal), /형식/);
  }
});

test('공개·회원 댓글은 각 경로와 부모 리뷰를 확인하고 비공개 응답 필드를 제거합니다.', async context => {
  context.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, base + '/reviews/' + item.id + '/comments');
    assert.deepEqual(init, { signal, credentials: 'omit' });
    return Response.json({ review: { ...thread.review, memberId: 'private' }, items: [{ ...comment, email: 'private' }] });
  });
  assert.deepEqual(await readReviewComments(base, item.id, signal), thread);
  const memberThread = { review: own, items: [] };
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/reviews/' + item.id + '/comments');
    assert.deepEqual(init, { signal }); return memberThread;
  } };
  assert.deepEqual(await readMemberReviewComments(client, item.id, signal), memberThread);
});

test('삭제 부모는 기존 댓글 및 마지막 댓글 삭제 뒤 빈 스레드도 반환할 수 있습니다.', async context => {
  let payload = { review: deleted, items: [comment] };
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  assert.deepEqual(await readReviewComments(base, deleted.id, signal), payload);
  payload = { review: { ...deleted, commentCount: 0 }, items: [] };
  assert.deepEqual(await readReviewComments(base, deleted.id, signal), payload);
  payload = { review: { ...deleted, commentCount: 1 }, items: [{ ...comment, mine: true }] };
  assert.deepEqual(await readMemberReviewComments({ request: async () => payload }, deleted.id, signal), payload);
});

test('댓글 스레드는 부모·중복 ID·필수 본문·상태 불일치를 거부합니다.', async context => {
  let payload;
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  for (const invalid of [
    { ...thread, review: { ...thread.review, id: '3' } },
    { ...thread, items: [{ ...comment, body: null }] }, { ...thread, items: [{ ...comment, body: '' }] },
    { ...thread, items: [{ ...comment, body: '😀'.repeat(501) }] },
    { ...thread, items: [{ ...comment, body: ' 본문 ' }] }, { ...thread, items: [{ ...comment, nickname: null }] },
    { ...thread, items: [{ ...comment, mine: true }] }, { ...thread, items: [{ ...comment, liked: true, likeCount: 1 }] },
    { ...thread, items: [{ ...comment, reported: true }] },
    { ...thread, review: { ...thread.review, commentCount: 2 }, items: [comment, comment] },
    { ...thread, items: [{ ...comment, createdAt: '2026-02-30T06:00:00Z' }] },
  ]) {
    payload = invalid;
    await assert.rejects(readReviewComments(base, item.id, signal), /형식/);
  }
  payload = { review: { ...item, commentCount: 7 }, items: [{ ...comment, id: '32' }, comment] };
  assert.deepEqual(await readReviewComments(base, item.id, signal), payload);
});

test('댓글 생성·수정은 500 코드 포인트까지 정규화해서 보내고 본인 응답을 확인합니다.', async () => {
  for (const [write, path, method, target] of [
    [createReviewComment, '/api/members/reviews/' + item.id + '/comments', 'POST', item.id],
    [updateReviewComment, '/api/members/review-comments/' + comment.id, 'PUT', comment.id],
  ]) {
    const text = '😀'.repeat(500);
    const result = { ...comment, body: text, mine: true };
    const client = { request: async (receivedPath, init) => {
      assert.equal(receivedPath, path);
      assert.deepEqual(init, { method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }) });
      return result;
    } };
    assert.deepEqual(await write(client, target, '\u0085 ' + text + '　', signal), result);
    const never = { request: () => assert.fail('유효하지 않은 댓글을 전송했습니다.') };
    for (const invalid of ['', '　\u0085', text + '😀']) {
      await assert.rejects(write(never, target, invalid, signal), /확인/);
    }
    assert.equal((await write({ request: async () => ({ ...result, body: '서버에서 정리한 댓글' }) }, target, text, signal)).body, '서버에서 정리한 댓글');
    for (const invalid of [comment, { ...result, liked: true, likeCount: 1 }]) {
      await assert.rejects(write({ request: async () => invalid }, target, text, signal), /형식/);
    }
  }
  await assert.rejects(updateReviewComment({ request: async () => ({ ...comment, id: '3', mine: true }) }, comment.id, comment.body, signal), /형식/);
});

test('댓글 삭제는 본문 없이 DELETE하고 204의 null만 성공으로 인정합니다.', async () => {
  const client = { request: async (path, init) => {
    assert.equal(path, '/api/members/review-comments/' + comment.id);
    assert.deepEqual(init, { method: 'DELETE', signal }); return null;
  } };
  assert.equal(await deleteReviewComment(client, comment.id, signal), undefined);
  await assert.rejects(deleteReviewComment({ request: async () => undefined }, comment.id, signal), /형식/);
});

test('리뷰·댓글 공감은 PUT·DELETE로 지정 상태를 멱등 요청합니다.', async () => {
  for (const [set, path, target] of [
    [setReviewLike, '/api/members/reviews/', item.id],
    [setReviewCommentLike, '/api/members/review-comments/', comment.id],
  ]) {
    for (const liked of [true, false]) {
      const result = { likeCount: liked ? 3 : 2, liked };
      const client = { request: async (receivedPath, init) => {
        assert.equal(receivedPath, path + target + '/like');
        assert.deepEqual(init, { method: liked ? 'PUT' : 'DELETE', signal }); return result;
      } };
      assert.deepEqual(await set(client, target, liked, signal), result);
      assert.deepEqual(await set(client, target, liked, signal), result);
    }
    assert.deepEqual(await set({ request: async () => ({ liked: true, likeCount: 0 }) }, target, true, signal), { liked: true, likeCount: 0 });
    for (const invalid of [{ liked: false, likeCount: 1 }, { liked: true, likeCount: '1' },
      { liked: true, likeCount: -1 }, { likeCount: 1 }]) {
      await assert.rejects(set({ request: async () => invalid }, target, true, signal), /형식/);
    }
  }
});

test('리뷰·댓글 신고는 고정 사유와 정규화된 상세를 보내고 중복 접수도 완료합니다.', async () => {
  for (const [send, path, target] of [
    [reportReview, '/api/members/reviews/', item.id],
    [reportReviewComment, '/api/members/review-comments/', comment.id],
  ]) {
    const result = { id: '92', reported: true };
    for (const reason of ['SPAM', 'ABUSE', 'INAPPROPRIATE', 'SPOILER', 'OTHER']) {
      const client = { request: async (receivedPath, init) => {
        assert.equal(receivedPath, path + target + '/reports');
        assert.deepEqual(init, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, detail: null }) }); return result;
      } };
      assert.equal(await send(client, target, reason, '\u0085　', signal), undefined);
      assert.equal(await send(client, target, reason, '', signal), undefined);
    }
    const text = '😀'.repeat(500);
    const client = { request: async (_path, init) => {
      assert.deepEqual(JSON.parse(init.body), { reason: 'OTHER', detail: text }); return result;
    } };
    assert.equal(await send(client, target, 'OTHER', '　' + text + '\u0085', signal), undefined);
    const never = { request: () => assert.fail('유효하지 않은 신고를 전송했습니다.') };
    await assert.rejects(send(never, target, 'OTHER', text + '😀', signal), /확인/);
    assert.equal(await send({ request: async () => ({ reported: true }) }, target, 'SPAM', '', signal), undefined);
    for (const invalid of [{ ...result, reported: false }, {}, null]) {
      await assert.rejects(send({ request: async () => invalid }, target, 'SPAM', '', signal), /형식/);
    }
  }
});

test('요청과 응답 ID는 정규 signed BIGINT 문자열 범위를 검증합니다.', async context => {
  const never = { request: () => assert.fail('유효하지 않은 ID를 전송했습니다.') };
  context.mock.method(globalThis, 'fetch', () => assert.fail('유효하지 않은 ID를 전송했습니다.'));
  for (const id of ['', '0', '-0', '01', '+1', '1\n', '../1', '1/2', '9223372036854775808', '-9223372036854775809', 1]) {
    for (const call of [
      () => readReviewComments(base, id, signal), () => readMemberReviewComments(never, id, signal),
      () => updateWorkReview(never, id, 4, '', signal), () => deleteWorkReview(never, id, signal),
      () => createReviewComment(never, id, '본문', signal), () => updateReviewComment(never, id, '본문', signal),
      () => deleteReviewComment(never, id, signal), () => setReviewLike(never, id, true, signal),
      () => setReviewCommentLike(never, id, false, signal), () => reportReview(never, id, 'SPAM', '', signal),
      () => reportReviewComment(never, id, 'SPAM', '', signal),
    ]) await assert.rejects(call(), /선택/);
    await assert.rejects(readMemberWorkReviews({ request: async () => ({ ...one, items: [{ ...item, id }] }) }, 'book-example', 1, 20, signal), /형식/);
  }
  for (const id of ['-9223372036854775808', '9223372036854775807']) {
    const payload = { review: { ...item, id }, items: [] };
    assert.deepEqual(await readMemberReviewComments({ request: async () => payload }, id, signal), payload);
  }
});

test('실제 회원 클라이언트가 모든 기능의 HTTP 오류를 MemberRequestError로 전달합니다.', async context => {
  let status = 200;
  const client = createMemberSessionClient(base, async url => {
    if (url.endsWith('/api/auth/session')) return Response.json(identity);
    if (url.endsWith('/api/auth/csrf')) return Response.json({ token: 'token', headerName: 'X-CSRF-TOKEN' });
    return Response.json({ message: '서버 오류 안내입니다.' }, { status });
  });
  context.after(() => client.dispose());
  const operations = [
    () => readMemberWorkReviews(client, 'book-example', 1, 20, signal),
    () => readMemberReviewComments(client, item.id, signal),
    () => createWorkReview(client, 'book-example', 4, '', signal),
    () => updateWorkReview(client, item.id, 4, '', signal), () => deleteWorkReview(client, item.id, signal),
    () => createReviewComment(client, item.id, '본문', signal), () => updateReviewComment(client, comment.id, '본문', signal),
    () => deleteReviewComment(client, comment.id, signal), () => setReviewLike(client, item.id, true, signal),
    () => setReviewCommentLike(client, comment.id, false, signal),
    () => reportReview(client, item.id, 'SPAM', '', signal), () => reportReviewComment(client, comment.id, 'OTHER', '', signal),
  ];
  for (status of [400, 401, 403, 404, 409]) {
    for (const operation of operations) {
      await client.refresh();
      await assert.rejects(operation(), failure => failure instanceof MemberRequestError && failure.status === status && failure.code === null);
    }
  }
});

test('회원 세대가 바뀌거나 화면 신호가 취소되면 지연된 리뷰 JSON을 버립니다.', async context => {
  let identityResponse = identity;
  let body = deferred(), started = deferred(), receivedSignal;
  const client = createMemberSessionClient(base, async (url, init) => {
    if (url.endsWith('/api/auth/session')) return Response.json(identityResponse);
    receivedSignal = init.signal;
    return { ok: true, status: 200, json: () => { started.resolve(); return body.promise; } };
  });
  context.after(() => client.dispose());
  await client.refresh();
  const pending = readMemberWorkReviews(client, 'book-example', 1, 20, signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started.promise;
  identityResponse = { ...identity, id: '3' };
  await client.refresh();
  assert.equal(receivedSignal.aborted, true);
  body.resolve(one); await rejected;
  assert.equal(client.getSnapshot().member.id, '3');

  body = deferred(); started = deferred();
  const controller = new AbortController();
  const canceled = readMemberReviewComments(client, item.id, controller.signal);
  const canceledResult = assert.rejects(canceled, { name: 'AbortError' });
  await started.promise;
  controller.abort(); assert.equal(receivedSignal.aborted, true);
  body.resolve(thread); await canceledResult;
});

// #region 조회와 반응 변경의 경합
/** 실제 조회 훅·화면·행을 함께 실행하고 API 응답 순서만 제어합니다. */
function reviewRaceHarness(view = 'list', multiple = false) {
  const source = ts.createSourceFile('ReviewScreens.tsx',
    readFileSync(new URL('../src/ReviewScreens.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ['starPath', 'reportReasons'].includes(value.name.getText(source))));
  const compiled = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n')
    + '\nexport { ReviewsScreen, WorkReviewPreview, ReviewCommentsScreen };', {
    fileName: 'ReviewScreens.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const clone = value => JSON.parse(JSON.stringify(value));
  const server = clone(view === 'thread' ? thread : multiple ? { ...one, reviewCount: 2,
    ratingDistribution: { ...one.ratingDistribution, 4: 2 }, items: [item, { ...item, id: '32' }] } : one);
  const state = { status: 'authenticated', generation: 1, member: identity };
  const api = { gets: [], writes: [], load: null, mutate: null };
  const navigation = [], instances = new Map(), effects = [];
  let active, dirty = true, mounted = true, tree, query;
  const client = { getSnapshot: () => state, request: async (path, init) => {
    const request = { path, method: init.method ?? 'GET', signal: init.signal, snapshot: clone(server) };
    if (request.method === 'GET') { api.gets.push(request); return api.load ? api.load(request) : request.snapshot; }
    api.writes.push(request);
    const apply = () => {
      const id = path.split('/').at(-2), target = path.includes('/review-comments/') ? 'comment' : 'review';
      const row = target === 'comment' ? server.items.find(value => value.id === id)
        : view === 'thread' ? server.review : server.items.find(value => value.id === id);
      assert.ok(row, path);
      if (path.endsWith('/reports')) { row.reported = true; return { id: '501', reported: true }; }
      const liked = request.method === 'PUT';
      row.likeCount += row.liked === liked ? 0 : liked ? 1 : -1; row.liked = liked;
      return { likeCount: row.likeCount, liked };
    };
    return api.mutate ? api.mutate(request, apply) : apply();
  } };
  const info = { workId: 'book-example', workTitle: '작품', kind: 'book', reviewId: item.id };
  const app = { baseRoute: { ...info, screen: view === 'thread' ? 'reviewComments' : 'reviews' },
    navigate: value => navigation.push(value), back: () => navigation.push('back') };
  const same = (a, b) => a && a.length === b.length && b.every((value, i) => Object.is(a[i], value));
  const useEffect = (run, dependencies) => {
    const owner = active, index = owner.cursor++, previous = owner.cells[index];
    if (!previous || !same(previous.dependencies, dependencies)) {
      const cell = { dependencies, cleanup: previous?.cleanup }; owner.cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); if (owner.mounted) cell.cleanup = run(); });
    }
  };
  const sandbox = { exports: {}, require: module => {
    assert.equal(module, 'react/jsx-runtime'); const jsx = (type, props, key) => ({ type, props, key });
    return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  }, useState: initial => {
    const owner = active, index = owner.cursor++; owner.cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [owner.cells[index].value, next => {
      if (!owner.mounted) return;
      const value = typeof next === 'function' ? next(owner.cells[index].value) : next;
      if (!Object.is(value, owner.cells[index].value)) { owner.cells[index].value = value; dirty = true; }
    }];
  }, useRef: initial => { const index = active.cursor++; return active.cells[index] ??= { current: initial }; },
  useCallback: (callback, dependencies) => {
    const index = active.cursor++;
    if (!active.cells[index] || !same(active.cells[index].dependencies, dependencies)) active.cells[index] = { callback, dependencies };
    return active.cells[index].callback;
  }, useEffect, useLayoutEffect: useEffect, useApp: () => app, useApiUrl: () => base,
  useMemberAuth: () => ({ client, state }), normalizeReviewBody, readMemberWorkReviews, readWorkReviews,
  readMemberReviewComments, readReviewComments, createWorkReview, updateWorkReview, deleteWorkReview,
  createReviewComment, updateReviewComment, deleteReviewComment, setReviewLike, setReviewCommentLike,
  reportReview, reportReviewComment, MemberRequestError, AbortController, URL, TypeError, Error, styles: {}, colors: {}, s: {} };
  for (const type of ['View', 'Text', 'ScrollView', 'TextInput', 'Pressable', 'ActivityIndicator', 'Action',
    'Title', 'Icon', 'Svg', 'Path', 'Image', 'Modal', 'ModalPanel', 'EmptyState']) sandbox[type] = type;
  runInNewContext(compiled, sandbox);
  for (const name of ['useReviewPage', 'useReviewThread']) {
    const original = sandbox[name]; sandbox[name] = (...args) => { query = original(...args); return query; };
  }
  const root = view === 'thread' ? 'ReviewCommentsScreen' : view === 'preview' ? 'WorkReviewPreview' : 'ReviewsScreen';
  function dispose(owner) { owner.mounted = false; for (const cell of owner.cells) cell?.cleanup?.(); }
  function render(node, path, visited) {
    if (Array.isArray(node)) return node.map((child, index) => render(child, path + '/' + (child?.key ?? index), visited));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const id = path + ':' + node.type.name;
      const owner = instances.get(id) ?? { cells: [], cursor: 0, mounted: true }; instances.set(id, owner); visited.add(id);
      active = owner; owner.cursor = 0; const output = node.type(node.props);
      return { type: node.type.name, key: node.key, props: { ...node.props, children: render(output, id, visited) } };
    }
    return { ...node, props: { ...node.props,
      children: node.type === 'Modal' && !node.props.visible ? null : render(node.props.children, path + '/children', visited) } };
  }
  const nodes = (node = tree) => {
    const collect = value => Array.isArray(value) ? value.flatMap(collect)
      : value && typeof value === 'object' && value.props ? [value, ...collect(value.props.children)] : [];
    return collect(node);
  };
  const find = (type, label, node = tree) => nodes(node).find(value => value.type === type
    && (label === undefined || value.props.label === label || value.props.accessibilityLabel === label));
  const row = (target, id) => nodes().find(node => node.type === 'ItemActions' && node.props.target === target && node.props.item.id === id);
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (mounted && dirty) {
        dirty = false; const visited = new Set(); tree = render({ type: sandbox.exports[root], props: info }, 'root', visited);
        for (const [id, owner] of instances) if (!visited.has(id)) { dispose(owner); instances.delete(id); }
      }
      effects.splice(0).forEach(run => run()); await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    assert.fail('리뷰 경합 화면이 안정되지 않았습니다.');
  }
  async function press(node) { assert.ok(node); assert.ok(!node.props.disabled); node.props.onPress(); await settle(); }
  return { api, server, navigation, nodes, row, settle, get query() { return query; },
    like: async (target, id) => press(nodes(row(target, id)).find(node => node.type === 'Pressable' && / 공감 \d+개$/.test(node.props.accessibilityLabel))),
    report: async (target, id) => {
      const label = target === 'review' ? '리뷰' : '댓글';
      await press(find('Pressable', label + ' 신고', row(target, id)));
      await press(find('Pressable', '스팸·광고', row(target, id))); await press(find('Action', '신고 접수', row(target, id)));
    },
    selected: (target, id) => nodes(row(target, id)).find(node => node.type === 'Pressable' && / 공감 \d+개$/.test(node.props.accessibilityLabel))?.props.accessibilityState.selected,
    reported: (target, id) => !!find('Pressable', (target === 'review' ? '리뷰' : '댓글') + ' 신고 접수됨', row(target, id)),
    async refresh() { query.retry(); await settle(); },
    async retry() { await press(find('Action', '다시 불러오기')); },
    async changeMember() { state.generation++; state.member = { ...identity, id: '3' }; dirty = true; await settle(); },
    async unmount() { mounted = false; dirty = false; for (const owner of instances.values()) dispose(owner); instances.clear(); tree = null; await settle(); },
  };
}

test('리뷰 조회 경합은 변경 전에 시작한 응답을 버리고 그 뒤의 신선한 조회를 반영합니다.', async () => {
  for (const [view, target, id] of [['preview', 'review', item.id], ['list', 'review', item.id],
    ['thread', 'review', item.id], ['thread', 'comment', comment.id]]) {
    for (const operation of ['like', 'report']) {
      const ui = reviewRaceHarness(view); await ui.settle();
      const value = target === 'comment' ? ui.server.items[0] : view === 'thread' ? ui.server.review : ui.server.items[0];
      value.likeCount++;
      const old = deferred(), fresh = deferred(), last = deferred();
      ui.api.load = () => ui.api.gets.length === 2 ? old.promise : ui.api.gets.length === 3 ? fresh.promise : last.promise;
      await ui.refresh(); const oldRequest = ui.api.gets[1];
      await ui[operation](target, id);
      assert.equal(operation === 'like' ? ui.selected(target, id) : ui.reported(target, id), true);
      old.resolve(oldRequest.snapshot); await ui.settle();
      assert.equal(operation === 'like' ? ui.selected(target, id) : ui.reported(target, id), true);
      assert.equal(oldRequest.signal.aborted, true); assert.equal(ui.api.gets.length, 3);
      const freshRequest = ui.api.gets[2];
      await ui.like(target, id);
      assert.equal(freshRequest.signal.aborted, true); assert.equal(ui.api.gets.length, 4);
      const selected = operation !== 'like';
      assert.equal(ui.selected(target, id), selected);
      fresh.resolve(freshRequest.snapshot); await ui.settle(); assert.equal(ui.selected(target, id), selected);
      value.likeCount += 2; last.resolve(JSON.parse(JSON.stringify(ui.server))); await ui.settle();
      assert.equal(ui.row(target, id).props.item.likeCount, value.likeCount);
      assert.equal(ui.selected(target, id), selected);
      if (operation === 'report') assert.equal(ui.reported(target, id), true);
      assert.equal(ui.api.writes.at(-1).path, '/api/members/' + (target === 'review' ? 'reviews/' : 'review-comments/') + id + '/like');
    }
  }
});

test('리뷰 조회 경합은 두 행의 동시 성공을 보존하고 대기 조회가 없으면 추가 GET을 만들지 않습니다.', async () => {
  for (const view of ['list', 'thread']) {
    const ui = reviewRaceHarness(view, true); await ui.settle();
    const first = ['review', item.id], second = view === 'thread' ? ['comment', comment.id] : ['review', '32'];
    const pending = [];
    ui.api.mutate = (_request, apply) => { const task = deferred(); pending.push(task); return task.promise.then(apply); };
    await ui.like(...first); await ui.like(...second);
    pending.forEach(task => task.resolve()); await ui.settle();
    assert.equal(ui.selected(...first), true); assert.equal(ui.selected(...second), true);
    assert.equal(ui.api.gets.length, 1); assert.equal(ui.api.writes.length, 2);
  }
});

test('리뷰 조회 경합의 재조회 실패는 성공 상태와 오류·재시도를 함께 표시합니다.', async () => {
  for (const [view, target, id] of [['list', 'review', item.id], ['thread', 'comment', comment.id]]) {
    const ui = reviewRaceHarness(view); await ui.settle(); const old = deferred();
    ui.api.load = () => ui.api.gets.length === 2 ? old.promise : Promise.reject(new TypeError('조회 연결 오류'));
    await ui.refresh(); await ui.like(target, id);
    assert.equal(ui.selected(target, id), true);
    assert.ok(ui.nodes().find(node => node.type === 'QueryProblem'));
    old.resolve(ui.api.gets[1].snapshot); await ui.settle(); assert.equal(ui.selected(target, id), true);
    ui.api.load = null; await ui.retry();
    assert.equal(ui.selected(target, id), true); assert.equal(ui.nodes().some(node => node.type === 'QueryProblem'), false);
  }
});

test('리뷰 조회 경합은 변경 실패와 회원 전환·언마운트의 기존 응답 취소를 유지합니다.', async () => {
  const failed = reviewRaceHarness(); await failed.settle(); const old = deferred();
  failed.api.load = () => old.promise; await failed.refresh();
  failed.api.mutate = async () => { throw new Error('변경 연결 오류'); };
  await failed.like('review', item.id);
  assert.equal(failed.selected('review', item.id), false); assert.equal(failed.api.gets[1].signal.aborted, false);
  old.resolve(failed.api.gets[1].snapshot); await failed.settle();
  for (const leave of ['changeMember', 'unmount']) {
    const ui = reviewRaceHarness('thread'); await ui.settle(); const mutation = deferred();
    ui.api.mutate = () => mutation.promise; await ui.like('comment', comment.id);
    const request = ui.api.writes[0]; await ui[leave](); assert.equal(request.signal.aborted, true);
    mutation.resolve({ liked: true, likeCount: 4 }); await ui.settle();
    if (leave === 'changeMember') assert.equal(ui.selected('comment', comment.id), false);
    else assert.equal(ui.nodes().length, 0);
  }
});
// #endregion

// #region 상세 리뷰 작성과 전체보기
const ts = createRequire(import.meta.url)('typescript');
const reviewSource = ts.createSourceFile('ReviewScreens.tsx',
  readFileSync(new URL('../src/ReviewScreens.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const uiFunctions = new Set(['WorkReviewPreview', 'ReviewDraft', 'useReviewAction', 'context', 'loginForReview']);
const reviewUi = ts.transpileModule(reviewSource.statements.filter(node =>
  ts.isFunctionDeclaration(node) && uiFunctions.has(node.name?.text)).map(node => node.getText(reviewSource)).join('\n')
  + '\nexport { ReviewDraft };', {
  fileName: 'ReviewScreens.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

/** 실제 TSX·API를 실행하며 훅 상태·네이티브 요소·네트워크를 메모리에서 구성합니다. */
function reviewUiHarness(name, { page = empty, authenticated = true, props = {} } = {}) {
  const navigation = [], requests = [], reads = [], cells = [], effects = [];
  const state = { status: authenticated ? 'authenticated' : 'anonymous', generation: 1 };
  const info = { kind: 'book', workId: 'book-example', workTitle: '작품 제목', workAuthor: '저자', workImageUrl: '/cover.png' };
  const app = { baseRoute: { ...info, screen: 'detail' }, navigate: route => navigation.push({ ...route }), back: () => navigation.push('back') };
  let cursor = 0, dirty = true, tree;
  const query = { data: page, error: null, busy: false, retries: 0, retry: () => { query.retries++; } };
  const api = { respond: null };
  const client = { getSnapshot: () => state, request: async (path, init) => {
    const body = JSON.parse(init.body); requests.push({ path, method: init.method, body, signal: init.signal });
    return api.respond ? api.respond(path, init) : { ...own, id: init.method === 'POST' ? '77' : path.split('/').at(-1), ...body };
  } };
  const currentProps = name === 'WorkReviewPreview' ? info : {
    original: null, refresh: query.retry, loadError: null, onSaved: query.retry, inline: true, ...props,
  };
  const effect = (run, dependencies) => {
    const index = cursor++, previous = cells[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      const cell = { dependencies, cleanup: previous?.cleanup }; cells[index] = cell;
      effects.push(() => { cell.cleanup?.(); cell.cleanup = run(); });
    }
  };
  const jsx = (type, properties, key) => ({ type, props: properties, key });
  const sandbox = { exports: {}, require: module => {
    assert.equal(module, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  }, useState: initial => {
    const index = cursor++; cells[index] ??= { value: initial };
    return [cells[index].value, next => {
      const value = typeof next === 'function' ? next(cells[index].value) : next;
      if (!Object.is(value, cells[index].value)) { cells[index].value = value; dirty = true; }
    }];
  }, useRef: initial => { const index = cursor++; return cells[index] ??= { current: initial }; },
  useEffect: effect, useLayoutEffect: effect,
  useApp: () => app, useMemberAuth: () => ({ state, client }),
  useReviewPage: (...args) => { reads.push(args); return query; },
  normalizeReviewBody, createWorkReview, updateWorkReview, MemberRequestError, AbortController, TypeError, Error,
  styles: {}, colors: {}, s: {}, starPath: '' };
  for (const type of ['View', 'Text', 'ScrollView', 'TextInput', 'Pressable', 'ActivityIndicator', 'Action',
    'Title', 'Icon', 'Svg', 'Path', 'QueryProblem', 'ReviewCard', 'WorkSummary']) sandbox[type] = type;
  runInNewContext(reviewUi, sandbox);
  const nodes = (node = tree) => node && typeof node === 'object' && node.props
    ? [node, ...[node.props.children, node.props.action].flat(Infinity)
      .filter(child => child && typeof child === 'object').flatMap(child => nodes(child))] : [];
  const find = (type, label) => nodes().find(node => (typeof node.type === 'function' ? node.type.name : node.type) === type
    && (label === undefined || node.props.label === label || node.props.accessibilityLabel === label));
  async function settle() {
    for (let round = 0; round < 20; round++) {
      if (dirty) { dirty = false; cursor = 0; tree = sandbox.exports[name](currentProps); }
      effects.splice(0).forEach(run => run());
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty && !effects.length) return;
    }
    assert.fail('리뷰 화면 상태가 안정되지 않았습니다.');
  }
  return { navigation, requests, reads, query, api, currentProps, nodes, find, settle,
    async change(value) { Object.assign(currentProps, value); dirty = true; await settle(); },
    async press(type, label) { const node = find(type, label); assert.ok(node, label); assert.ok(!node.props.disabled, label); node.props.onPress(); await settle(); },
    async input(value) { const node = find('TextInput', '리뷰 내용'); assert.ok(node.props.editable); node.props.onChangeText(value); await settle(); },
  };
}

test('상세는 리뷰 다섯 개를 요청하며 여섯 번째 항목부터 기존 전체 목록으로 연결합니다.', async () => {
  for (const total of [0, 5, 6]) {
    const page = { ...empty, reviewCount: total, hasNext: total > 5,
      items: Array.from({ length: Math.min(total, 5) }, (_, i) => ({ ...item, id: String(i + 1) })) };
    const screen = reviewUiHarness('WorkReviewPreview', { page }); await screen.settle();
    assert.deepEqual(screen.reads[0], ['book-example', 1, 5]);
    assert.equal(screen.nodes().filter(node => node.type === 'ReviewCard').length, Math.min(total, 5));
    assert.ok(screen.find('ReviewDraft'), '빈 목록에도 작성 칸을 제공합니다.');
    assert.equal(!!screen.find('Pressable', '리뷰 전체보기'), total > 5);
    if (total > 5) {
      await screen.press('Pressable', '리뷰 전체보기');
      assert.equal(screen.navigation[0].screen, 'reviews');
      assert.equal(screen.navigation[0].workId, 'book-example');
      assert.equal(screen.navigation[0].workTitle, '작품 제목');
    }
  }
  const remaining = reviewUiHarness('WorkReviewPreview', { page: { ...empty, hasNext: true,
    items: Array.from({ length: 5 }, (_, i) => ({ ...deleted, id: String(i + 1) })) } });
  await remaining.settle();
  assert.ok(remaining.find('Pressable', '리뷰 전체보기'), '평가에서 빠진 삭제 자리표시의 댓글도 전체 목록에서 접근할 수 있습니다.');
});

test('인라인 신규 등록은 상세에 머물며 목록을 갱신하고 재작성은 반환된 ID로 수정합니다.', async () => {
  const preview = reviewUiHarness('WorkReviewPreview'); await preview.settle();
  const editor = reviewUiHarness('ReviewDraft', { props: preview.find('ReviewDraft').props }); await editor.settle();
  assert.ok(editor.find('Action', '등록').props.disabled);
  await editor.press('Pressable', '5점'); await editor.input('  첫 감상  '); await editor.press('Action', '등록');
  assert.equal(editor.requests[0].method, 'POST');
  assert.equal(editor.requests[0].path, '/api/members/works/book-example/reviews');
  assert.deepEqual(editor.requests[0].body, { rating: 5, body: '첫 감상' });
  assert.equal(preview.query.retries, 1); assert.deepEqual(editor.navigation, []);
  assert.equal(editor.find('TextInput', '리뷰 내용').props.value, '첫 감상');
  assert.ok(editor.find('Action', '수정').props.disabled, '저장 직후 같은 내용을 중복 등록하지 않습니다.');
  await editor.input('수정한 감상'); await editor.press('Action', '수정');
  assert.equal(editor.requests[1].method, 'PUT'); assert.equal(editor.requests[1].path, '/api/members/reviews/77');
  assert.equal(preview.query.retries, 2); assert.deepEqual(editor.navigation, []);
});

test('기존 내 리뷰는 수정하며 조회 중 제출과 변경 없는 재저장을 막습니다.', async () => {
  const editor = reviewUiHarness('ReviewDraft', { props: { original: { ...own, id: '88', body: '기존 감상' } } });
  await editor.settle(); assert.ok(editor.find('Action', '수정').props.disabled);
  await editor.input('바뀐 감상'); await editor.change({ refreshing: true });
  assert.ok(editor.find('Action', '수정').props.disabled);
  editor.find('Action', '수정').props.onPress(); await editor.settle(); assert.equal(editor.requests.length, 0);
  await editor.change({ refreshing: false }); await editor.press('Action', '수정');
  assert.equal(editor.requests[0].method, 'PUT'); assert.equal(editor.requests[0].path, '/api/members/reviews/88');
  assert.deepEqual(editor.requests[0].body, { rating: 4, body: '바뀐 감상' });
  assert.equal(editor.query.retries, 1); assert.deepEqual(editor.navigation, []);
});

test('인라인 저장 실패는 별점과 입력을 유지하고 목록 갱신·화면 이동을 실행하지 않습니다.', async () => {
  const editor = reviewUiHarness('ReviewDraft'); await editor.settle();
  editor.api.respond = async () => { throw new TypeError('연결 실패'); };
  await editor.press('Pressable', '3점'); await editor.input('지워지면 안 되는 감상'); await editor.press('Action', '등록');
  assert.equal(editor.find('TextInput', '리뷰 내용').props.value, '지워지면 안 되는 감상');
  assert.equal(editor.find('Pressable', '3점').props.accessibilityState.checked, true);
  assert.ok(editor.find('Action', '내 리뷰 다시 확인'));
  assert.equal(editor.query.retries, 0); assert.deepEqual(editor.navigation, []);
});

test('익명 작성 칸은 쓰기 요청을 보내지 않고 로그인 후 작품 상세로 돌아갈 경로를 전달합니다.', async () => {
  const editor = reviewUiHarness('ReviewDraft', { authenticated: false }); await editor.settle();
  assert.equal(editor.find('TextInput', '리뷰 내용').props.editable, false);
  assert.equal(editor.find('Pressable', '5점').props.disabled, true);
  assert.equal(editor.find('Action', '등록'), undefined);
  await editor.press('Action', '로그인하고 리뷰 쓰기');
  assert.equal(editor.requests.length, 0); assert.equal(editor.navigation[0].screen, 'login');
  assert.equal(editor.navigation[0].workId, 'book-example'); assert.equal(editor.navigation[0].reviewReturnScreen, 'detail');
});
// #endregion
