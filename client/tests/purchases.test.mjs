import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemberRequestError } from '../src/memberSession.ts';
import { parsePurchaseProducts, parsePurchaseRecord, purchaseProduct, readMemberLibrary,
  readPurchaseHistory, readPurchaseProducts } from '../src/purchases.ts';

// #region 계약 자료와 회원 요청
const product = (kind = 'book', values = {}) => ({
  productId: '11', workId: 'sample-work', kind, title: '첫 번째 작품', imageUrl: '/media/표지.png',
  chapterId: kind === 'novel' ? '21' : null, chapterTitle: kind === 'novel' ? '첫 번째 회차' : null,
  price: 100, currency: 'KRW', owned: false, readable: false, paymentMode: 'DEMO', ...values,
});
const record = (item = product(), values = {}) => {
  const { owned, readable, ...snapshot } = item;
  return { ...snapshot, purchaseId: '31', purchasedAt: '2026-11-14T01:02:03Z', ...values };
};
const libraryWork = (values = {}) => ({ id: 'sample-work', title: '첫 번째 작품', imageUrl: '/media/표지.png',
  kind: 'book', author: '서재 저자', libraryStatus: 'WANT_TO_READ', lastReadChapterNumber: null,
  statistics: null, hasNextChapter: false, ...values });

/** 요청 본문과 회원 세대를 제어하며 실제 서버·DB에는 접속하지 않습니다. */
function fixture(handler = async () => [], status = 'authenticated') {
  let auth = { status, generation: 0, member: status === 'authenticated' ? { id: '1' } : null };
  const calls = [];
  const client = {
    getSnapshot: () => auth,
    async request(path, init) { calls.push({ path, init }); return handler(path, init); },
  };
  return { client, calls, change(next) { auth = { ...auth, ...next }; } };
}

/** 새 구매에만 사용한 UUID의 개수를 확인합니다. */
function ids() {
  let count = 0;
  return { next: () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`, get count() { return count; } };
}

/** 늦은 응답과 동시에 들어온 구매를 재현합니다. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const body = call => JSON.parse(call.init.body);
// #endregion

// #region 응답 계약
test('작품 전체 상품과 회차 상품 및 무료·소장 열람 여부를 구분합니다.', () => {
  for (const kind of ['book', 'magazine', 'novel']) {
    for (const state of [{}, { price: 0, readable: true }, { owned: true, readable: true },
      { readable: true }, { owned: true, readable: false }, { price: 0, readable: false }]) {
      const item = product(kind, state);
      assert.deepEqual(parsePurchaseProducts([item], item.workId), [item]);
      assert.deepEqual(parsePurchaseRecord(record(item)), record(item));
    }
  }
  assert.deepEqual(parsePurchaseProducts([], 'sample-work'), []);
  const chapters = [product('novel'), product('novel', { productId: '12', chapterId: '22', chapterTitle: '두 번째 회차' })];
  assert.deepEqual(parsePurchaseProducts(chapters, 'sample-work'), chapters);
});

test('잘못된 상품 필드·회차 단위·소장 상태·다른 작품·중복 상품을 거절합니다.', () => {
  const invalid = [
    { productId: 11 }, { productId: '0' }, { workId: 'another-work' }, { kind: 'all' },
    { title: ' ' }, { imageUrl: 'file:///private.png' }, { imageUrl: '//other.test/a.png' },
    { imageUrl: 'https://user:password@example.test/a.png' }, { price: -1 }, { price: 0.5 },
    { price: 2_147_483_648 }, { currency: 'USD' }, { paymentMode: 'REAL' },
    { chapterId: '21', chapterTitle: '회차' }, { owned: 'false' }, { readable: 'true' },
  ];
  for (const patch of invalid) assert.throws(() => parsePurchaseProducts([product('book', patch)], 'sample-work'), Error);
  for (const patch of [{ chapterId: null, chapterTitle: null }, { chapterId: '' }, { chapterTitle: ' ' }]) {
    assert.throws(() => parsePurchaseProducts([product('novel', patch)], 'sample-work'), Error);
  }
  for (const value of [null, {}, { products: [] }, [null], [product(), product()],
    [product(), product('book', { productId: '12' })]]) {
    assert.throws(() => parsePurchaseProducts(value, 'sample-work'), Error);
  }
});

test('구매 내역의 구매 식별자·시각과 작품별·회차별 스냅샷을 검사합니다.', () => {
  for (const patch of [{ purchaseId: '' }, { purchaseId: 31 }, { purchasedAt: '잘못된 날짜' },
    { purchasedAt: '2026-11-14' }, { chapterTitle: '작품 전체에는 회차가 없습니다.' }, { paymentMode: 'LIVE' }]) {
    assert.throws(() => parsePurchaseRecord(record(product(), patch)), Error);
  }
});

test('같은 작품의 여러 회차 구매를 purchaseId별로 유지하며 중복 구매 기록은 거절합니다.', async () => {
  const snapshots = [record(product('novel')), record(product('novel', { productId: '12', chapterId: '22' }), { purchaseId: '32' })];
  let response = snapshots;
  const f = fixture(async () => response);
  assert.deepEqual(await readPurchaseHistory(f.client), snapshots);
  assert.equal(f.calls[0].path, '/api/members/purchase-history');
  response = [snapshots[0], snapshots[0]];
  await assert.rejects(readPurchaseHistory(f.client), /형식/);
  response = {};
  await assert.rejects(readPurchaseHistory(f.client), /형식/);
  response = [];
  assert.deepEqual(await readPurchaseHistory(f.client), []);
});

test('서재의 분류·상태·최근 회차·중복 작품을 검사하고 목록 조회만 수행합니다.', async () => {
  let response = [libraryWork()];
  const f = fixture(async () => response);
  assert.deepEqual(await readMemberLibrary(f.client, 'book'), response);
  assert.deepEqual(f.calls[0], { path: '/api/members/library?kind=book', init: undefined });
  for (const value of [{}, [libraryWork({ kind: 'novel' })], [libraryWork({ libraryStatus: 'OWNED' })],
    [libraryWork({ imageUrl: 'javascript:bad' })], [libraryWork(), libraryWork()],
    ...[undefined, 0, -1, 1.5, '7', 2_147_483_648].map(lastReadChapterNumber => [libraryWork({ lastReadChapterNumber })]),
    [libraryWork({ author: '' })], [libraryWork({ hasNextChapter: 'false' })],
    [libraryWork({ statistics: { views: 1, recommendations: 2, chapterCount: 3 } })]]) {
    response = value;
    await assert.rejects(readMemberLibrary(f.client, 'book'), /서재 응답/);
  }
  const novel = libraryWork({ id: 'another-work', kind: 'novel', libraryStatus: 'COMPLETED', lastReadChapterNumber: 7,
    statistics: { views: 123, recommendations: 45, chapterCount: 2 }, hasNextChapter: true });
  response = [libraryWork({ hasNextChapter: true }), novel];
  assert.deepEqual(await readMemberLibrary(f.client, 'all'), response);
  for (const statistics of [null, {}, { views: -1, recommendations: 0, chapterCount: 2 },
    { views: 1, recommendations: 0, chapterCount: 1.5 }]) {
    response = [{ ...novel, statistics }];
    await assert.rejects(readMemberLibrary(f.client, 'novel'), /서재 응답/);
  }
  response = [];
  assert.deepEqual(await readMemberLibrary(f.client, 'magazine'), []);
});
// #endregion

// #region 공개·회원 조회 경로
test('비회원은 공개 상품, 회원은 기존 세션의 회원 상품 경로로 조회합니다.', async t => {
  const publicCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    publicCalls.push({ url, init });
    return new Response(JSON.stringify([product()]), { headers: { 'Content-Type': 'application/json' } });
  });
  const guest = fixture(async () => assert.fail('비회원은 회원 요청을 보내지 않습니다.'), 'anonymous');
  const signal = new AbortController().signal;
  assert.deepEqual(await readPurchaseProducts('https://api.example.test', guest.client, 'sample-work', signal), [product()]);
  assert.equal(publicCalls[0].url, 'https://api.example.test/works/sample-work/purchase-products');
  assert.strictEqual(publicCalls[0].init.signal, signal);
  const member = fixture(async () => [product('book', { owned: true, readable: true })]);
  assert.equal((await readPurchaseProducts('https://api.example.test', member.client, 'sample-work', signal))[0].owned, true);
  assert.equal(member.calls[0].path, '/api/members/works/sample-work/purchase-products');
  assert.strictEqual(member.calls[0].init.signal, signal);
  assert.equal(publicCalls.length, 1);
});

test('공개 상품의 HTTP 실패를 빈 무료 상품 목록으로 바꾸지 않습니다.', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('실패', { status: 503 }));
  const guest = fixture(undefined, 'anonymous');
  await assert.rejects(readPurchaseProducts('https://api.example.test', guest.client, 'sample-work', new AbortController().signal), /503/);
});

test('상품 조회 중 회원이 바뀌거나 화면에서 취소하면 늦은 결과를 거절합니다.', async () => {
  for (const reason of ['member', 'screen']) {
    const waiting = deferred(), f = fixture(() => waiting.promise), controller = new AbortController();
    const result = readPurchaseProducts('https://api.example.test', f.client, 'sample-work', controller.signal);
    const rejected = assert.rejects(result, { name: 'AbortError' });
    if (reason === 'member') f.change({ generation: 1, member: { id: '2' } });
    else controller.abort();
    waiting.resolve([product('book', { owned: true, readable: true })]);
    await rejected;
  }
});
// #endregion

// #region 동일 구매 재시도와 세대 보호
for (const failure of ['network', 'server', 'parse', 'different-product', 'different-price']) {
  test(`${failure} 실패 뒤 화면에서 다시 호출해도 원래 UUID와 가격을 유지합니다.`, async () => {
    let first = true;
    const f = fixture(async () => {
      if (!first) return record();
      first = false;
      if (failure === 'network') throw new TypeError('연결이 끊겼습니다.');
      if (failure === 'server') throw new MemberRequestError(503, null);
      if (failure === 'parse') return null;
      return record(product(), failure === 'different-product' ? { productId: '99' } : { price: 200 });
    });
    const uuid = ids();
    await assert.rejects(purchaseProduct(f.client, product(), uuid.next), Error);
    assert.deepEqual(await purchaseProduct(f.client, product('book', { price: 200 }), uuid.next), record());
    assert.deepEqual(body(f.calls[0]), body(f.calls[1]));
    assert.deepEqual(Object.keys(body(f.calls[0])).sort(), ['expectedPrice', 'productId', 'requestId']);
    assert.equal(body(f.calls[1]).expectedPrice, 100);
    assert.equal(f.calls[0].path, '/api/members/purchases');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(uuid.count, 1);
  });
}

test('같은 상품을 동시에 눌러도 요청과 UUID를 하나만 생성합니다.', async () => {
  const waiting = deferred(), f = fixture(() => waiting.promise), uuid = ids();
  const first = purchaseProduct(f.client, product(), uuid.next);
  const second = purchaseProduct(f.client, product('book', { price: 200 }), uuid.next);
  assert.strictEqual(first, second);
  assert.equal(f.calls.length, 1);
  assert.equal(uuid.count, 1);
  waiting.resolve(record());
  assert.deepEqual(await first, record());
  assert.deepEqual(await second, record());
});

test('성공을 확인한 다음 구매에는 새 UUID와 새로 확인한 가격을 사용합니다.', async () => {
  const f = fixture(async (_path, init) => record(product('book', { price: JSON.parse(init.body).expectedPrice })));
  const uuid = ids();
  await purchaseProduct(f.client, product(), uuid.next);
  await purchaseProduct(f.client, product('book', { price: 200 }), uuid.next);
  assert.notEqual(body(f.calls[0]).requestId, body(f.calls[1]).requestId);
  assert.equal(body(f.calls[1]).expectedPrice, 200);
  assert.equal(uuid.count, 2);
});

for (const code of ['PRICE_CHANGED', 'ALREADY_OWNED', 'REQUEST_CONFLICT']) {
  test(`${code}로 거부가 확정되면 이전 시도를 폐기합니다.`, async () => {
    let first = true;
    const f = fixture(async (_path, init) => {
      if (first) { first = false; throw new MemberRequestError(409, code); }
      return record(product('book', { price: JSON.parse(init.body).expectedPrice }));
    });
    const uuid = ids();
    await assert.rejects(purchaseProduct(f.client, product(), uuid.next), { status: 409, code });
    await purchaseProduct(f.client, product('book', { price: 200 }), uuid.next);
    assert.notEqual(body(f.calls[0]).requestId, body(f.calls[1]).requestId);
    assert.equal(body(f.calls[1]).expectedPrice, 200);
    assert.equal(uuid.count, 2);
  });
}

test('회원 세대가 바뀌면 이전 응답을 차단하고 새 회원에게 새 UUID를 발급합니다.', async () => {
  const oldReply = deferred(), newReply = deferred();
  let count = 0;
  const f = fixture(() => ++count === 1 ? oldReply.promise : newReply.promise), uuid = ids();
  const oldRequest = purchaseProduct(f.client, product(), uuid.next);
  const oldRejected = assert.rejects(oldRequest, { name: 'AbortError' });
  f.change({ generation: 1, member: { id: '2' } });
  const newRequest = purchaseProduct(f.client, product('book', { price: 200 }), uuid.next);
  oldReply.resolve(record());
  await oldRejected;
  newReply.resolve(record(product('book', { price: 200 }), { purchaseId: '32' }));
  assert.equal((await newRequest).purchaseId, '32');
  assert.notEqual(body(f.calls[0]).requestId, body(f.calls[1]).requestId);
  assert.equal(body(f.calls[1]).expectedPrice, 200);
  assert.equal(uuid.count, 2);
});

test('비회원은 구매 요청과 UUID를 생성하지 않습니다.', async () => {
  const f = fixture(undefined, 'anonymous'), uuid = ids();
  await assert.rejects(purchaseProduct(f.client, product(), uuid.next), { status: 401 });
  assert.equal(f.calls.length, 0);
  assert.equal(uuid.count, 0);
});
// #endregion
